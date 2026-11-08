import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { PaymentGateway } from './alipay.ts';
import type { Withdrawal, WithdrawalReport, PayoutResult } from '../src/types/withdrawals.ts';
import { withdrawalStatuses } from '../src/types/withdrawals.ts';
import { amountCents, OrderError } from './orders.ts';
import { verifyPassword, dummyPasswordHash } from './passwords.ts';

export function withdrawalRepository(db: DatabaseSync, gateway: PaymentGateway) {
  const environment = gateway.status.environment;
  const locks = new Set<string>();
  const now = () => new Date().toISOString();
  const fail = (message: string, code = 'WITHDRAWAL_CONFLICT') => new OrderError(409, code, message);
  function transaction<T>(operation: () => T) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function balance(customerId: string) {
    const earned = Number(db.prepare(`SELECT COALESCE(sum(r.amount_cents),0) AS n FROM referral_orders r
      JOIN orders o ON o.id = r.order_id WHERE r.inviter_id = ? AND o.environment = ? AND r.status = 'earned'`).get(customerId, environment)!.n);
    const row = db.prepare(`SELECT COALESCE(sum(CASE WHEN status IN ('pending','approved','processing') THEN amount_cents ELSE 0 END),0) AS held,
      COALESCE(sum(CASE WHEN status = 'paid' THEN amount_cents ELSE 0 END),0) AS paid
      FROM referral_withdrawals WHERE customer_id = ? AND environment = ?`).get(customerId, environment)!;
    const heldCents = Number(row.held), paidCents = Number(row.paid);
    return { earnedCents: earned, heldCents, paidCents, availableCents: Math.max(0, earned - heldCents - paidCents), deficitCents: Math.max(0, heldCents + paidCents - earned) };
  }
  function raw(id: string) {
    const row = db.prepare('SELECT * FROM referral_withdrawals WHERE id = ? AND environment = ?').get(id, environment);
    if (!row) throw new OrderError(404, 'WITHDRAWAL_NOT_FOUND', '提现申请不存在。');
    return row;
  }
  function view(row: Record<string, unknown>): Withdrawal {
    return { id: String(row.id), username: String(row.username || ''), amountCents: Number(row.amount_cents), account: String(row.payee_account),
      realName: String(row.payee_name), status: row.status as Withdrawal['status'], createdAt: String(row.created_at),
      reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null, reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
      paidAt: row.paid_at ? String(row.paid_at) : null, transferNo: row.transfer_no ? String(row.transfer_no) : null, note: String(row.note) };
  }
  function event(id: string, actor: string, action: string, status: string, note = '') {
    db.prepare('INSERT INTO referral_withdrawal_events(withdrawal_id,actor,action,status,note,created_at) VALUES (?,?,?,?,?,?)').run(id, actor, action, status, note, now());
  }
  function covered(customerId: string) {
    if (balance(customerId).deficitCents) throw fail('返利发生变动，余额不足以覆盖已申请金额，请核对退款记录并处理相关申请。', 'WITHDRAWAL_BALANCE_CHANGED');
  }
  function configured() {
    if (!gateway.payout?.enabled) throw new OrderError(503, 'PAYOUT_DISABLED', '支付宝打款暂未启用，申请可正常审核，启用后再打款。');
    return gateway.payout;
  }
  function merchant(row: Record<string, unknown>) {
    if (row.app_id !== gateway.appId || row.seller_id !== gateway.sellerId) throw fail('收款商户配置已变更，请使用原商户配置查询该笔打款。');
  }
  function applyResult(id: string, result: PayoutResult) {
    const row = raw(id);
    const cents = result.trans_amount || result.amount;
    if (result.code !== '10000' || result.out_biz_no !== id || (cents && amountCents(cents) !== row.amount_cents)
      || (row.transfer_no && result.order_id && row.transfer_no !== result.order_id)) throw fail('支付宝结果未能与提现单核对，请继续查询原单。');
    const state = result.status === 'SUCCESS' ? 'paid' : ['FAIL', 'REFUND'].includes(result.status) ? 'failed' : 'processing';
    if (state === 'paid' && !result.order_id) throw fail('支付宝未返回打款单号，请查询原单确认。');
    return transaction(() => {
      const current = raw(id);
      if (current.status !== 'processing') return view(current);
      const note = state === 'failed' ? '支付宝已确认打款失败，金额已退回可提现余额。' : state === 'processing' ? '支付宝正在处理，请查询打款结果。' : '';
      db.prepare('UPDATE referral_withdrawals SET status = ?, transfer_no = COALESCE(?,transfer_no), paid_at = ?, note = ? WHERE id = ?')
        .run(state, result.order_id || null, state === 'paid' ? now() : null, note, id);
      event(id, 'alipay', 'result', state, note);
      return view(raw(id));
    });
  }
  return {
    balance,
    list(params: URLSearchParams, customerId?: string): WithdrawalReport {
      const status = params.get('status') || 'all';
      const page = Number(params.get('page') || '1');
      if ([...params.keys()].some(key => !['status','page'].includes(key) || params.getAll(key).length !== 1)
        || (status !== 'all' && !Object.hasOwn(withdrawalStatuses, status)) || !Number.isSafeInteger(page) || page < 1 || page > 100000) throw new OrderError(400, 'INVALID_FILTER', '提现筛选条件无效。');
      const where = 'w.environment = ? AND (? IS NULL OR w.customer_id = ?) AND (? = \'all\' OR w.status = ?)';
      const args = [environment, customerId ?? null, customerId ?? null, status, status];
      const total = Number(db.prepare(`SELECT count(*) AS n FROM referral_withdrawals w WHERE ${where}`).get(...args)!.n);
      const currentPage = Math.min(page, Math.max(1, Math.ceil(total / 20)));
      const rows = db.prepare(`SELECT w.*, c.username FROM referral_withdrawals w JOIN customers c ON c.id = w.customer_id WHERE ${where}
        ORDER BY w.created_at DESC, w.id DESC LIMIT 20 OFFSET ?`).all(...args, (currentPage - 1) * 20).map(view);
      return { environment, payoutEnabled: !!gateway.payout?.enabled, page: currentPage, pageSize: 20, total, rows, balance: customerId ? balance(customerId) : null };
    },
    async request(customerId: string, input: Record<string, unknown>, key: string, authorize: () => void = () => {}) {
      const amount = typeof input.amount === 'string' ? amountCents(input.amount) : null;
      const account = typeof input.account === 'string' ? input.account.trim() : '';
      const realName = typeof input.realName === 'string' ? input.realName.trim() : '';
      if (!amount || amount < 10 || !/^[a-f0-9-]{16,80}$/i.test(key) || account.length > 254
        || !(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account) || /^1\d{10}$/.test(account))
        || !realName || realName.length > 100 || /[\x00-\x1f]/.test(realName)) throw new OrderError(400, 'INVALID_WITHDRAWAL', '请填写至少 0.10 元的提现金额、支付宝手机号或邮箱和实名姓名。');
      const password = typeof input.password === 'string' ? input.password : '';
      if (!password || password.length > 128) throw new OrderError(400, 'PASSWORD_REQUIRED', '请输入商城登录密码确认提现。');
      const user = db.prepare('SELECT password_hash FROM customers WHERE id = ?').get(customerId);
      if (!await verifyPassword(password, String(user?.password_hash || dummyPasswordHash)) || !user) throw new OrderError(403, 'PASSWORD_INCORRECT', '商城登录密码不正确。');
      return transaction(() => {
        authorize();
        const existing = db.prepare('SELECT * FROM referral_withdrawals WHERE customer_id = ? AND environment = ? AND idempotency_key = ?').get(customerId, environment, key);
        if (existing) {
          if (existing.amount_cents !== amount || existing.payee_account !== account || existing.payee_name !== realName) throw fail('本次申请编号已使用，请刷新提现记录后重新申请。');
          return view(existing);
        }
        if (balance(customerId).availableCents < amount) throw fail('可提现余额不足，请刷新余额后重试。', 'INSUFFICIENT_BALANCE');
        const id = 'WD' + randomBytes(16).toString('hex');
        db.prepare(`INSERT INTO referral_withdrawals(id,customer_id,environment,amount_cents,payee_account,payee_name,status,idempotency_key,created_at)
          VALUES (?,?,?,?,?,?,'pending',?,?)`).run(id, customerId, environment, amount, account, realName, key, now());
        event(id, customerId, 'request', 'pending');
        return view(raw(id));
      });
    },
    review(id: string, approve: boolean, actor: string, reason: unknown) {
      const note = typeof reason === 'string' ? reason.trim() : '';
      if ((!approve && !note) || note.length > 300) throw new OrderError(400, 'INVALID_REVIEW', '驳回时请填写原因，最多 300 字。');
      return transaction(() => {
        const row = raw(id);
        if (row.status !== 'pending' && !(row.status === 'approved' && !approve)) throw fail('申请状态已变更，请刷新列表。');
        if (approve) covered(String(row.customer_id));
        const status = approve ? 'approved' : 'rejected';
        db.prepare('UPDATE referral_withdrawals SET status = ?, reviewed_at = ?, reviewed_by = ?, note = ? WHERE id = ?').run(status, now(), actor, note, id);
        event(id, actor, approve ? 'approve' : 'reject', status, note);
        return view(raw(id));
      });
    },
    async pay(id: string, actor: string, queryOnly = false) {
      const payout = configured();
      if (locks.has(id)) throw fail('该笔打款正在处理中，请稍后查询。');
      locks.add(id);
      try {
        const row = transaction(() => {
          const current = raw(id);
          if (current.status === 'paid' || current.status === 'failed') return current;
          if (queryOnly) {
            if (current.status !== 'processing') throw fail('该笔提现尚未发起打款。');
            merchant(current); return current;
          }
          if (current.status !== 'approved') throw fail('仅审核通过且未打款的申请可以发起打款。');
          covered(String(current.customer_id));
          db.prepare("UPDATE referral_withdrawals SET status = 'processing', app_id = ?, seller_id = ?, note = '打款结果确认中，请勿重复发起。' WHERE id = ?")
            .run(gateway.appId, gateway.sellerId, id);
          event(id, actor, 'pay', 'processing');
          return current;
        });
        if (row.status === 'paid' || row.status === 'failed') return view(row);
        const request = { id, amountCents: Number(row.amount_cents), account: String(row.payee_account), realName: String(row.payee_name) };
        try { return applyResult(id, await (queryOnly ? payout.query(request) : payout.transfer(request))); }
        catch {
          // An unknown outcome remains reserved. Never create a second transfer number or infer failure from a timeout.
          transaction(() => {
            if (raw(id).status === 'processing') {
              db.prepare("UPDATE referral_withdrawals SET note = '打款结果暂未确认，请查询原单；金额仍保留，不会重复打款。' WHERE id = ?").run(id);
              event(id, actor, 'uncertain', 'processing');
            }
          });
          return view(raw(id));
        }
      } finally { locks.delete(id); }
    },
  };
}
