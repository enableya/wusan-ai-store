import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Order } from '../src/types/orders.ts';
import type { RedemptionAccount, RedemptionEvent, RedemptionPolicy, RedemptionResult, RedemptionView } from '../src/types/redemption.ts';
import { redemptionProgress } from '../src/lib/redemption-progress.ts';
import { OrderError } from './orders.ts';
import { readableDetail, redemptionUpstreamError } from './redemption-errors.ts';
import { reclaimableStaffVoucher } from './staff-voucher-reclaim.ts';

const endpoint = 'https://lovecodex.cn/api';
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown, limit = 256) =>
  typeof value === 'string' && value.length <= limit ? value : '';
const parse = <T>(value: string | null): T | null => value ? JSON.parse(value) as T : null;

type Prepared = { id: string; token: string; expiresAt: string; policy: RedemptionPolicy };
type StaffPreview = { account: string; session_hash: string; policy: string; expires_at: string; lease_until: number };
type Row = {
  code: string;
  submit_key: string;
  prepared: string | null;
  account: string | null;
  submitted: number;
  submitted_order_no: string | null;
  result: string | null;
  claim_token: string | null;
  recharge_email: string | null;
};

export function redemptionRepository(db: DatabaseSync, fetcher = fetch) {
  const inFlight = new Set<string>();
  const lastQuery = new Map<string, number>();
  const lookup = db.prepare(`
    SELECT r.*, v.code, f.recharge_email FROM order_redemptions r
    JOIN voucher_inventory v ON v.id = r.voucher_id
    LEFT JOIN order_fulfillment_details f ON f.order_id = r.order_id WHERE r.order_id = ?
  `);
  const rowFor = (id: string) => lookup.get(id) as unknown as Row | undefined;
  const staffPreview = (order: Order) => order.staffCheckout
    ? db.prepare('SELECT * FROM staff_redemption_previews WHERE order_id = ?').get(order.id) as unknown as StaffPreview | undefined
    : undefined;
  const available = () => process.env.LOVECODEX_ENABLED === 'true';
  const view = (order: Order): RedemptionView => {
    const row = rowFor(order.id);
    const prepared = parse<Prepared>(row?.prepared ?? null);
    const deferred = !row?.submitted ? staffPreview(order) : undefined;
    return {
      enabled: available(), submitted: !!row?.submitted,
      ...(deferred ? { requiresSession: true } : {}),
      rechargeEmail: row?.recharge_email || null,
      account: deferred ? (Date.parse(deferred.expires_at) > Date.now() ? parse<RedemptionAccount>(deferred.account) : null)
        : prepared && Date.parse(prepared.expiresAt) > Date.now() && !row?.submitted
        ? parse<RedemptionAccount>(row?.account ?? null) : null,
      result: parse<RedemptionResult>(row?.result ?? null),
    };
  };

  async function request(path: string, options: RequestInit = {}, privateValues: string[] = []) {
    try {
      const response = await fetcher(endpoint + path, {
        ...options, redirect: 'error',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        signal: AbortSignal.timeout(25000),
      });
      if (response.status === 429) throw new OrderError(429, 'REDEMPTION_RATE_LIMITED', '充值服务请求较多，请稍后再试。');
      let body: Record<string, unknown>;
      try { body = record(await response.json()); }
      catch { throw new OrderError(502, 'REDEMPTION_INVALID_RESPONSE', '充值服务返回了无法识别的响应，请稍后重试；当前无法确定是否为 Session 问题。'); }
      if (!response.ok || body.ok !== true) {
        const input = typeof options.body === 'string' ? record(JSON.parse(options.body)) : {};
        const session = typeof input.sessionInput === 'string' ? record(JSON.parse(input.sessionInput)) : {};
        const headers = new Headers(options.headers);
        const secrets = [...privateValues, input.sessionInput, input.voucherCode, input.claimToken, session.accessToken, headers.get('X-Redemption-Token')]
          .filter((value): value is string => typeof value === 'string' && !!value);
        throw redemptionUpstreamError(body, response.status, path.endsWith('/session'), secrets);
      }
      return body;
    } catch (error) {
      if (error instanceof OrderError) throw error;
      if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) {
        throw new OrderError(502, 'REDEMPTION_TIMEOUT', '连接充值服务超时，尚未确认请求结果，请稍后重试。');
      }
      throw new OrderError(502, 'REDEMPTION_CONNECTION_FAILED', '暂时无法连接充值服务，请稍后重试；当前无法确定是否为 Session 问题。');
    }
  }

  async function exclusive<T>(order: Order, action: () => Promise<T>, reconciliation = false) {
    if (!available() && !reconciliation) throw new OrderError(503, 'REDEMPTION_DISABLED', '当前环境暂未开放兑换。');
    if (!reconciliation) assertCanRedeem(order);
    if (inFlight.has(order.id)) throw new OrderError(409, 'REDEMPTION_BUSY', '这笔订单正在处理，请稍后刷新。');
    inFlight.add(order.id);
    try { return await action(); }
    finally { inFlight.delete(order.id); }
  }

  function assertCanRedeem(order: Order) {
    if (db.prepare("SELECT 1 FROM orders WHERE id=? AND json_extract(snapshot,'$.deliveryType')='voucher'").get(order.id)) throw new OrderError(409,'NOT_REDEMPTION_PRODUCT','该商品通过卡密直接交付，无需提交充值账号。');
    if (db.prepare('SELECT 1 FROM order_fulfillment_details WHERE order_id=? AND reclaimed_at IS NOT NULL').get(order.id)) {
      throw new OrderError(409,'VOUCHER_ALREADY_RECLAIMED','卡密已回收，订单已取消，不能继续充值。');
    }
    const blocked = db.prepare(`SELECT 1 FROM order_fulfillment_deadlines WHERE order_id = ? AND due_at <= ?
      UNION ALL SELECT 1 FROM order_cancellations WHERE order_id = ? AND state != 'fulfilled'`).get(order.id,new Date().toISOString(),order.id);
    if (blocked) throw new OrderError(409,'ORDER_FULFILLMENT_TIMEOUT','订单已申请取消或超过开通时限，暂不能继续充值，请刷新订单状态。');
  }
  function reserve(order: Order): Row {
    // A single SQLite write reserves at most one matching voucher per paid order.
    db.prepare(`
      INSERT OR IGNORE INTO order_redemptions (order_id, voucher_id, submit_key)
      SELECT ?, v.id, ? FROM voucher_inventory v
      WHERE v.environment = ? AND v.product_id = ?
        AND NOT EXISTS (SELECT 1 FROM order_redemptions r WHERE r.voucher_id = v.id)
        AND NOT EXISTS (SELECT 1 FROM order_cancellations c WHERE c.order_id = ? AND c.state != 'fulfilled')
        AND NOT EXISTS (SELECT 1 FROM order_fulfillment_deadlines d WHERE d.order_id = ? AND d.due_at <= ?)
      ORDER BY v.priority DESC, v.id LIMIT 1
    `).run(order.id, randomUUID(), order.environment, order.productId, order.id, order.id, new Date().toISOString());
    const row = rowFor(order.id);
    if (!row) throw new OrderError(409, 'VOUCHER_UNAVAILABLE', '该商品暂时没有可用卡密，请稍后重试或联系客服。');
    db.prepare(`INSERT OR IGNORE INTO order_fulfillment_details(order_id,voucher_id,voucher_code)
      SELECT r.order_id,r.voucher_id,v.code FROM order_redemptions r JOIN voucher_inventory v ON v.id=r.voucher_id WHERE r.order_id=?`).run(order.id);
    return row;
  }

  function saveResult(order: Order, response: Record<string, unknown>) {
    const upstream = record(response.order);
    const orderNo = string(upstream.orderNo);
    if (!orderNo) return;
    const email = string(upstream.accountEmail);
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) db.prepare(`INSERT INTO order_fulfillment_details(order_id,recharge_email) VALUES (?,?)
      ON CONFLICT(order_id) DO UPDATE SET recharge_email=excluded.recharge_email`).run(order.id,email);
    const progress = upstream.progress;
    const row = rowFor(order.id);
    const secrets = [row?.code,parse<Prepared>(row?.prepared ?? null)?.token,row?.claim_token,response.claimToken]
      .filter((value): value is string => typeof value === 'string' && !!value);
    const automation = record(upstream.automation);
    const reason = [record(upstream.failure).message,upstream.paymentLastError,upstream.relayMessage,
      automation.state === 'FAILED' ? automation.message : undefined]
      .map(value=>readableDetail(value,secrets)).find(Boolean);
    const result: RedemptionResult = {
      orderNo, state: string(upstream.orderState, 64), settlement: string(record(upstream.settlement).state, 64),
      progress: typeof progress === 'number' && Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : null,
      renewal: string(record(upstream.renewalSetup).state, 64),
      ...(reason ? { reason } : {}),
    };
    const processMessage = [record(upstream.processingStage).message,automation.state !== 'FAILED' ? automation.message : undefined]
      .map(value=>readableDetail(value,secrets)).find(Boolean);
    if (processMessage) result.processMessage = processMessage;
    // Sparse status responses must not erase a known explanation for the same
    // terminal result, or carry that explanation into a later successful result.
    const previous = parse<RedemptionResult>(row?.result ?? null);
    if (!reason && previous?.orderNo === result.orderNo && previous.state === result.state
      && previous.settlement === result.settlement && previous.renewal === result.renewal
      && (result.state === 'NO_CHARGE' || result.settlement === 'NO_CHARGE')) {
      const retained = readableDetail(previous.reason,secrets);
      if (retained) result.reason = retained;
    }
    const events: RedemptionEvent[] = previous?.orderNo === orderNo ? [...previous.timeline || []] : [];
    const timestamp = (value: unknown) => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
    if (Array.isArray(upstream.timeline)) for (const item of upstream.timeline.slice(-40)) {
      const event = record(item);
      const title = readableDetail(event.title,secrets), detail = readableDetail(event.detail,secrets);
      if (!title && !detail) continue;
      const next: RedemptionEvent = {title: title || '通道处理记录',detail,at: timestamp(event.at) || timestamp(event.createdAt),source:'provider'};
      if (!events.some(entry=>entry.source === next.source && entry.at === next.at && entry.title === next.title && entry.detail === next.detail)) events.push(next);
    }
    const progressView = redemptionProgress(result);
    const observed = [...events].reverse().find(event=>event.source === 'query');
    if (observed?.title !== progressView.title || observed?.detail !== progressView.detail) {
      events.push({title:progressView.title,detail:progressView.detail,at:new Date().toISOString(),source:'query'});
    }
    result.timeline = events.sort((a,b)=>(a.at || '').localeCompare(b.at || '')).slice(-40);
    db.prepare('UPDATE order_redemptions SET result = ?, claim_token = coalesce(?, claim_token) WHERE order_id = ?')
      .run(JSON.stringify(result), string(response.claimToken, 4096) || null, order.id);
  }

  async function getPolicy() {
    if (!available()) throw new OrderError(503, 'REDEMPTION_DISABLED', '当前环境暂未开放兑换。');
    const versions = record((await request('/bootstrap')).policyVersions);
    const policy = { terms: string(versions.terms), privacy: string(versions.privacy) };
    if (!policy.terms || !policy.privacy) throw new OrderError(502, 'REDEMPTION_POLICY', '暂时无法读取兑换条款。');
    return policy;
  }

  function readSession(input: unknown) {
    const sessionInput = string(input, 512000);
    if (typeof input === 'string' && Buffer.byteLength(input) > 512000) {
      throw new OrderError(400, 'SESSION_TOO_LARGE', '登录信息过大，请确认复制的是完整 Session JSON，而不是网页内容。');
    }
    let session: Record<string, unknown>;
    try { session = record(JSON.parse(sessionInput)); }
    catch { throw new OrderError(400, 'SESSION_INVALID_JSON', 'Session JSON 格式不正确或复制不完整，请重新复制页面全部内容。'); }
    const email = string(record(session.user).email);
    const expiry = Date.parse(string(session.expires));
    if (!string(session.accessToken, 65536)) throw new OrderError(400, 'SESSION_MISSING_TOKEN', 'Session 缺少有效的登录令牌（accessToken），请重新登录并复制完整登录信息。');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new OrderError(400, 'SESSION_INVALID_ACCOUNT', 'Session 缺少有效的账号邮箱，请复制完整登录信息。');
    if (!Number.isFinite(expiry)) throw new OrderError(400, 'SESSION_INVALID_EXPIRY', 'Session 缺少有效的到期时间，请重新获取完整登录信息。');
    if (expiry <= Date.now()) throw new OrderError(400, 'SESSION_EXPIRED', 'ChatGPT Session 已过期，请重新登录 ChatGPT 后获取最新登录信息。');
    return { sessionInput, email, expiry };
  }

  async function previewAccount(order: Order, input: Record<string, unknown>, allocate = false) {
    const { sessionInput, email, expiry } = readSession(input.sessionInput);
    const policy = await getPolicy();
    if (input.consent !== true || input.termsVersion !== policy.terms || input.privacyVersion !== policy.privacy) {
      throw new OrderError(409, 'REDEMPTION_POLICY', '请重新读取并确认兑换条款。');
    }
    assertCanRedeem(order);
    if (order.staffCheckout && !allocate) {
      if (rowFor(order.id)?.submitted) return view(order);
      const account: RedemptionAccount = { email, plan: '', validation: 'identified', confirmationId: randomUUID() };
      const now = Date.now();
      const stored = db.prepare(`INSERT INTO staff_redemption_previews(order_id,account,session_hash,policy,expires_at)
        SELECT ?,?,?,?,?
        WHERE NOT EXISTS (SELECT 1 FROM order_redemptions WHERE order_id=? AND (submitted=1 OR preview_until>?))
        ON CONFLICT(order_id) DO UPDATE SET account=excluded.account,session_hash=excluded.session_hash,
          policy=excluded.policy,expires_at=excluded.expires_at
        WHERE staff_redemption_previews.lease_until<=?`).run(
          order.id, JSON.stringify(account), createHash('sha256').update(sessionInput).digest('hex'),
          JSON.stringify(policy), new Date(Math.min(expiry, now + 900000)).toISOString(), order.id, now, now);
      if (!stored.changes) throw new OrderError(409, 'REDEMPTION_BUSY', '这笔订单正在处理，请稍后刷新。');
      return view(order);
    }
    const row = reserve(order);
    if (row.submitted) return view(order);
    const now = Date.now();
    const lease = now + 90000;
    const locked = db.prepare(`UPDATE order_redemptions SET account = NULL, preview_until = ?
      WHERE order_id = ? AND submitted = 0 AND preview_until <= ?
      AND NOT EXISTS (SELECT 1 FROM order_cancellations c WHERE c.order_id = order_redemptions.order_id AND c.state != 'fulfilled')
      AND NOT EXISTS (SELECT 1 FROM order_fulfillment_deadlines d WHERE d.order_id = order_redemptions.order_id AND d.due_at <= ?)
      `).run(lease, order.id, now, new Date(now).toISOString());
    if (!locked.changes) throw new OrderError(409, 'REDEMPTION_BUSY', '这笔订单正在处理，请稍后刷新。');
    try {
      let prepared = parse<Prepared>(row.prepared);
      if (!prepared || Date.parse(prepared.expiresAt) <= Date.now()) {
        const result = await request('/v2/redemptions/prepare', { method: 'POST', body: JSON.stringify({ voucherCode: row.code }) });
        prepared = { id: string(result.redemptionId), token: string(result.redemptionToken, 4096), expiresAt: string(result.expiresAt), policy };
        if (!prepared.id || !prepared.token || !(Date.parse(prepared.expiresAt) > Date.now())) {
          throw new OrderError(502, 'REDEMPTION_PREPARE', '兑换服务未返回有效会话。');
        }
        db.prepare('UPDATE order_redemptions SET prepared = ? WHERE order_id = ?')
          .run(JSON.stringify(prepared), order.id);
      }
      assertCanRedeem(order);
      const result = await request('/v2/redemptions/' + encodeURIComponent(prepared.id) + '/session', {
        method: 'PUT', headers: { 'X-Redemption-Token': prepared.token }, body: JSON.stringify({ sessionInput }),
      }, [row.code, prepared.token]);
      const redemption = record(result.redemption);
      if (redemption.state !== 'SESSION_READY') throw new OrderError(409, 'REDEMPTION_SESSION', '兑换服务未确认账号信息。');
      const details = record(redemption.session);
      const reportedEmail = string(details.accountDisplay) || string(details.accountHint);
      const account: RedemptionAccount = {
        email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reportedEmail) ? reportedEmail : email,
        plan: string(details.planType, 64), validation: string(details.validation, 32), confirmationId: randomUUID(),
      };
      const expiresAt = string(redemption.expiresAt) || prepared.expiresAt;
      if (!(Date.parse(expiresAt) > Date.now())) throw new OrderError(409, 'REDEMPTION_EXPIRED', '账号确认已过期，请重新验证。');
      db.prepare('UPDATE order_redemptions SET prepared = ?, account = ? WHERE order_id = ? AND preview_until = ?')
        .run(JSON.stringify({ ...prepared, expiresAt, policy }), JSON.stringify(account), order.id, lease);
      db.prepare('UPDATE order_fulfillment_details SET recharge_email=? WHERE order_id=?').run(account.email,order.id);
    } catch (error) {
      if (error instanceof OrderError && ['REDEMPTION_EXPIRED', 'REDEMPTION_NOT_FOUND'].includes(error.code)) {
        db.prepare('UPDATE order_redemptions SET prepared=NULL, account=NULL WHERE order_id=? AND submitted=0').run(order.id);
      }
      throw error;
    } finally {
      db.prepare('UPDATE order_redemptions SET preview_until = 0 WHERE order_id = ? AND preview_until = ?').run(order.id, lease);
    }
    return view(order);
  }

  async function submitPrepared(order: Order, confirmationId: unknown) {
    const row = rowFor(order.id);
    if (row?.submitted) return view(order);
    const prepared = parse<Prepared>(row?.prepared ?? null);
    const account = parse<RedemptionAccount>(row?.account ?? null);
    if (!row || !prepared || !account || account.confirmationId !== confirmationId || !(Date.parse(prepared.expiresAt) > Date.now())) {
      throw new OrderError(409, 'REDEMPTION_EXPIRED', '请先验证并确认当前账号。');
    }
    // Persist before the network call. An ambiguous response is reconciled by lookup.
    const started = db.prepare(`UPDATE order_redemptions SET submitted = 1, account = NULL WHERE order_id = ? AND submitted = 0 AND account = ? AND preview_until <= ?
      AND NOT EXISTS (SELECT 1 FROM order_cancellations c WHERE c.order_id = order_redemptions.order_id AND c.state != 'fulfilled')
      AND NOT EXISTS (SELECT 1 FROM order_fulfillment_deadlines d WHERE d.order_id = order_redemptions.order_id AND d.due_at <= ?)`).run(order.id, row.account, Date.now(), new Date().toISOString());
    if (!started.changes) throw new OrderError(409, 'REDEMPTION_BUSY', '账号确认信息已更新，请刷新后核对。');
    db.prepare('DELETE FROM staff_redemption_previews WHERE order_id = ?').run(order.id);
    try {
      const response = await request('/v2/redemptions/' + encodeURIComponent(prepared.id) + '/submit', {
        method: 'POST', headers: { 'X-Redemption-Token': prepared.token, 'Idempotency-Key': row.submit_key },
        body: JSON.stringify({ termsVersion: prepared.policy.terms, privacyVersion: prepared.policy.privacy }),
      }, [row.code, prepared.token]);
      const submittedOrderNo = string(record(response.order).orderNo);
      if (submittedOrderNo) db.prepare('UPDATE order_redemptions SET submitted_order_no = COALESCE(submitted_order_no,?) WHERE order_id = ?').run(submittedOrderNo,order.id);
      saveResult(order, response);
    } catch (error) {
      if (!(error instanceof OrderError)) throw error;
    }
    return view(order);
  }

  return {
    view,
    policy: getPolicy,
    reclaim(order: Order, actor: string, expectedVoucherCode: unknown, authorize = () => {}) {
      return exclusive(order, async () => {
        authorize();
        const done = () => db.prepare(`SELECT 1 FROM order_fulfillment_details f JOIN orders o ON o.id=f.order_id
          WHERE f.order_id=? AND f.reclaimed_at IS NOT NULL AND o.environment=?
          AND json_extract(o.snapshot,'$.staffCheckout')=1`).get(order.id,order.environment);
        if (done()) return { reclaimed: true as const };
        if (!available()) throw new OrderError(503,'REDEMPTION_DISABLED','充值通道未开启，暂时无法核实卡密是否未使用。');
        const invalid = () => new OrderError(409,'VOUCHER_CANNOT_RECLAIM','仅尚未成功充值、未被取消且有卡密的免付开通订单可回收；正在验证或提交时请稍后重试。');
        const lease = Date.now()+90000;
        db.exec('BEGIN IMMEDIATE');
        let reserved: NonNullable<ReturnType<typeof reclaimableStaffVoucher>>;
        try {
          const candidate = reclaimableStaffVoucher(db,order.id,order.environment);
          if (!candidate) throw invalid();
          if (typeof expectedVoucherCode !== 'string' || candidate.code !== expectedVoucherCode) {
            throw new OrderError(409,'VOUCHER_REFERENCE_CHANGED','卡密信息已变化，请刷新订单后重新核对。');
          }
          reserved = candidate;
          db.prepare('UPDATE order_redemptions SET preview_until=? WHERE order_id=?').run(lease,order.id);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        try {
          const response = await request('/v2/status/by-voucher',{method:'POST',body:JSON.stringify({voucherCode:reserved.code})},[String(reserved.code)]);
          const voucher = record(response.voucher), upstream = record(response.order);
          const settlement = record(upstream.settlement).state, renewal = record(upstream.renewalSetup).state;
          const noOrder = response.order == null;
          const terminalNoCharge = settlement === 'NO_CHARGE' && ['NO_CHARGE','CANCELED'].includes(String(upstream.orderState));
          const sameSubmission = !reserved.submitted || !!reserved.submitted_order_no && upstream.orderNo === reserved.submitted_order_no;
          // Local candidate checks already verify the voucher's product and environment.
          // Provider product IDs describe routes and cannot determine whether a card was used.
          if (voucher.state !== 'AVAILABLE'
            || upstream.orderState === 'FULFILLED' || settlement === 'PAID' || renewal === 'paid' || renewal === 'ready'
            || !sameSubmission || (reserved.submitted ? !terminalNoCharge : !noOrder && !terminalNoCharge)) {
            const message = voucher.state === 'CONSUMED' ? '上游返回卡密已使用，暂不能回收；若充值失败，请联系通道核实并恢复卡密状态。'
              : voucher.state === 'RESERVED' ? '上游返回卡密仍被占用或正在处理，请刷新充值状态后重试。'
              : voucher.state !== 'AVAILABLE' ? '上游尚未确认卡密可用，暂不能回收，请稍后重试或联系通道核实。'
              : upstream.orderState === 'FULFILLED' || settlement === 'PAID' || renewal === 'paid' || renewal === 'ready'
                ? '上游已确认充值完成或续费设置成功，不能回收。'
              : !sameSubmission ? '暂时无法核对本次充值订单，不能回收，请刷新充值状态或联系通道核实。'
              : '卡密当前可用，但关联充值尚未确认结束且未扣款，暂不能回收，请刷新充值状态后重试。';
            throw new OrderError(409,'VOUCHER_NOT_UNUSED',message);
          }
          db.exec('BEGIN IMMEDIATE');
          try {
            authorize();
            const held = db.prepare('UPDATE order_redemptions SET preview_until=0 WHERE order_id=? AND voucher_id=? AND preview_until=? AND preview_until>?')
              .run(order.id,reserved.voucher_id,lease,Date.now());
            const current = reclaimableStaffVoucher(db,order.id,order.environment);
            if (!held.changes || !current || current.voucher_id !== reserved.voucher_id || current.code !== reserved.code
              || current.submitted !== reserved.submitted || current.submitted_order_no !== reserved.submitted_order_no) throw invalid();
            const at = new Date().toISOString();
            db.prepare(`INSERT INTO order_fulfillment_details(order_id,voucher_id,voucher_code,reclaimed_at,reclaimed_by)
              VALUES (?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET voucher_id=excluded.voucher_id,voucher_code=excluded.voucher_code,
                reclaimed_at=excluded.reclaimed_at,reclaimed_by=excluded.reclaimed_by`).run(order.id,reserved.voucher_id,reserved.code,at,actor);
            db.prepare("UPDATE orders SET status='closed' WHERE id=? AND status='paid'").run(order.id);
            db.prepare('DELETE FROM staff_redemption_previews WHERE order_id=?').run(order.id);
            db.prepare('DELETE FROM order_redemptions WHERE order_id=? AND voucher_id=?').run(order.id,reserved.voucher_id);
            db.exec('COMMIT');
          } catch (error) { db.exec('ROLLBACK'); throw error; }
          return { reclaimed: true as const };
        } finally {
          db.prepare('UPDATE order_redemptions SET preview_until=0 WHERE order_id=? AND preview_until=?').run(order.id,lease);
        }
      },true);
    },
    preview(order: Order, input: Record<string, unknown>) {
      return exclusive(order, () => previewAccount(order, input));
    },
    submit(order: Order, confirmationId: unknown, sessionInput?: unknown) {
      return exclusive(order, async () => {
        if (rowFor(order.id)?.submitted) return view(order);
        const deferred = staffPreview(order);
        if (!deferred) return submitPrepared(order, confirmationId);
        const account = parse<RedemptionAccount>(deferred.account)!;
        if (account.confirmationId !== confirmationId || !(Date.parse(deferred.expires_at) > Date.now())) {
          throw new OrderError(409, 'REDEMPTION_EXPIRED', '请先验证并确认当前账号。');
        }
        const session = readSession(sessionInput);
        if (createHash('sha256').update(session.sessionInput).digest('hex') !== deferred.session_hash) {
          throw new OrderError(409, 'REDEMPTION_EXPIRED', '登录信息已变化，请重新识别并确认账号。');
        }
        const now = Date.now(), lease = now + 120000;
        const locked = db.prepare(`UPDATE staff_redemption_previews SET lease_until=?
          WHERE order_id=? AND account=? AND session_hash=? AND lease_until<=? AND expires_at>?`)
          .run(lease, order.id, deferred.account, deferred.session_hash, now, new Date(now).toISOString());
        if (!locked.changes) throw new OrderError(409, 'REDEMPTION_BUSY', '这笔订单正在处理，请稍后刷新。');
        try {
          const policy = parse<RedemptionPolicy>(deferred.policy)!;
          await previewAccount(order, { sessionInput: session.sessionInput, consent: true, termsVersion: policy.terms, privacyVersion: policy.privacy }, true);
          const verified = parse<RedemptionAccount>(rowFor(order.id)?.account ?? null);
          if (!verified || verified.email.toLowerCase() !== account.email.toLowerCase()) {
            db.prepare('UPDATE order_redemptions SET account=NULL WHERE order_id=? AND submitted=0').run(order.id);
            throw new OrderError(409, 'REDEMPTION_ACCOUNT_CHANGED', '充值服务识别的账号与确认邮箱不一致，请重新获取登录信息并核对账号。');
          }
          return await submitPrepared(order, verified.confirmationId);
        } finally {
          db.prepare('UPDATE staff_redemption_previews SET lease_until=0 WHERE order_id=? AND lease_until=?').run(order.id, lease);
        }
      });
    },
    timeoutCheck(order: Order) {
      return exclusive(order, async () => {
        if (order.deliveryType === 'voucher') return {state:db.prepare('SELECT 1 FROM order_card_deliveries WHERE order_id=?').get(order.id) ? 'fulfilled' as const : 'safe' as const,voucherId:null};
        const row = rowFor(order.id);
        if (!row) return { state: 'safe' as const, voucherId: null };
        const lease = db.prepare('SELECT preview_until,voucher_id FROM order_redemptions WHERE order_id = ?').get(order.id)!;
        if (Number(lease.preview_until) > Date.now()) return { state: 'uncertain' as const, voucherId: Number(lease.voucher_id) };
        const opened = (result: RedemptionResult | null) => result && (result.state === 'FULFILLED' || result.settlement === 'PAID' || ['paid','ready'].includes(result.renewal));
        if (opened(parse<RedemptionResult>(row.result))) return { state: 'fulfilled' as const, voucherId: Number(lease.voucher_id) };
        const response = await request('/v2/status/by-voucher',{method:'POST',body:JSON.stringify({voucherCode:row.code})});
        const upstream = record(response.order);
        if (row.submitted_order_no && upstream.orderNo && row.submitted_order_no !== upstream.orderNo) return {state:'uncertain' as const,voucherId:Number(lease.voucher_id)};
        saveResult(order,response);
        const next = parse<RedemptionResult>(rowFor(order.id)?.result ?? null);
        if (opened(next)) return { state:'fulfilled' as const,voucherId:Number(lease.voucher_id) };
        const voucher = record(response.voucher);
        const reusable = voucher.state === 'AVAILABLE';
        const noCharge = record(upstream.settlement).state === 'NO_CHARGE';
        const safe = reusable && (row.submitted ? !!row.submitted_order_no && upstream.orderNo === row.submitted_order_no && noCharge : !response.order || noCharge);
        return {state:safe ? 'safe' as const : 'uncertain' as const,voucherId:Number(lease.voucher_id)};
      },true);
    },
    refresh(order: Order) {
      return exclusive(order, async () => {
        const row = rowFor(order.id);
        if (!row?.submitted) return view(order);
        const now = Date.now();
        if ((lastQuery.get(order.id) ?? 0) > now) return view(order);
        for (const [id, next] of lastQuery) if (next <= now) lastQuery.delete(id);
        lastQuery.set(order.id, now + 5000);
        const result = parse<RedemptionResult>(row.result);
        const query = result?.orderNo && row.claim_token
          ? { path: '/v2/status/by-order', input: { orderNo: result.orderNo, claimToken: row.claim_token } }
          : { path: '/v2/status/by-voucher', input: { voucherCode: row.code } };
        const response = await request(query.path, { method: 'POST', body: JSON.stringify(query.input) }, [row.code, row.claim_token || '']);
        saveResult(order, response);
        return view(order);
      }, true);
    },
  };
}
