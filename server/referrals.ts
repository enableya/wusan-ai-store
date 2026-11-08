import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import type { PaymentConfig } from '../src/types/orders.ts';
import { hashPassword, verifyPassword, dummyPasswordHash } from './passwords.ts';
import { hash, OrderError } from './orders.ts';

export function referralRepository(db: DatabaseSync, origin: string, environment: PaymentConfig['environment']) {
  const secure = origin.startsWith('https:');
  const cookieName = secure ? '__Host-wusan_customer' : 'wusan_customer';
  function token(request: IncomingMessage) {
    return (request.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1) || '';
  }
  function cookie(response: ServerResponse, value: string, age: number) {
    response.appendHeader('Set-Cookie', `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`);
  }
  function current(request: IncomingMessage) {
    return db.prepare(`SELECT c.id, c.username, c.invite_code AS inviteCode FROM customers c JOIN customer_sessions s
      ON s.customer_id = c.id WHERE s.token_hash = ? AND s.expires_at > ?`).get(hash(token(request)), Date.now()) as { id: string; username: string; inviteCode: string } | undefined;
  }
  function requireUser(request: IncomingMessage) {
    const user = current(request);
    if (!user) throw new OrderError(401, 'LOGIN_REQUIRED', '请先登录商城账号。');
    return user;
  }
  function invitation(owner: string | null) {
    if (!owner) return null;
    const row = db.prepare(`SELECT c.invite_code AS code, v.expires_at AS expiresAt
      FROM referral_visits v JOIN customers c ON c.id = v.inviter_id
      WHERE v.owner_hash = ? AND v.expires_at > ?
      AND NOT EXISTS (SELECT 1 FROM customer_browsers b WHERE b.owner_hash = v.owner_hash AND b.customer_id = v.inviter_id)`)
      .get(owner, Date.now());
    return row ? { code: String(row.code), expiresAt: Number(row.expiresAt) } : null;
  }
  function attribution(owner: string, buyerId?: string) {
    const row = db.prepare(`SELECT v.inviter_id FROM referral_visits v WHERE owner_hash = ? AND expires_at > ?
      AND NOT EXISTS (SELECT 1 FROM customer_browsers b WHERE b.owner_hash = v.owner_hash AND b.customer_id = v.inviter_id)`)
      .get(owner, Date.now());
    return row && row.inviter_id !== buyerId ? { inviterId: String(row.inviter_id), buyerId: buyerId ?? null } : undefined;
  }
  return {
    current, requireUser, attribution, invitation,
    async authenticate(request: IncomingMessage, response: ServerResponse, owner: string, input: Record<string, unknown>, register: boolean) {
      const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
      const password = typeof input.password === 'string' ? input.password : '';
      if (!/^[a-z0-9_-]{3,40}$/.test(username) || password.length < 8 || password.length > 128) throw new OrderError(400, 'INVALID_ACCOUNT', '账号需为 3–40 位字母、数字或下划线，密码需为 8–128 位。');
      let user = db.prepare('SELECT * FROM customers WHERE username = ?').get(username);
      if (register) {
        if (user) throw new OrderError(409, 'ACCOUNT_EXISTS', '该账号已存在，请登录或更换账号。');
        const encoded = await hashPassword(password);
        if (db.prepare('SELECT id FROM customers WHERE username = ?').get(username)) throw new OrderError(409, 'ACCOUNT_EXISTS', '该账号已存在。');
        const id = randomBytes(16).toString('hex');
        db.prepare('INSERT INTO customers VALUES (?, ?, ?, ?, ?)').run(id, username, encoded, randomBytes(8).toString('hex'), new Date().toISOString());
        user = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
      } else if (!await verifyPassword(password, String(user?.password_hash || dummyPasswordHash)) || !user) {
        throw new OrderError(401, 'LOGIN_FAILED', '账号或密码不正确。');
      }
      const id = String(user!.id);
      const next = randomBytes(32).toString('hex');
      db.prepare('DELETE FROM customer_sessions WHERE token_hash = ? OR expires_at <= ?').run(hash(token(request)), Date.now());
      db.prepare('INSERT INTO customer_sessions VALUES (?, ?, ?)').run(hash(next), id, Date.now() + 30 * 86400000);
      db.prepare('INSERT OR IGNORE INTO customer_browsers VALUES (?, ?)').run(owner, id);
      cookie(response, next, 30 * 86400);
      return { id, username: String(user!.username), inviteCode: String(user!.invite_code) };
    },
    logout(request: IncomingMessage, response: ServerResponse) {
      db.prepare('DELETE FROM customer_sessions WHERE token_hash = ?').run(hash(token(request)));
      cookie(response, '', 0);
      return { success: true };
    },
    visit(owner: string, code: unknown) {
      if (typeof code !== 'string' || !/^[a-f0-9]{16}$/.test(code)) return { accepted: false, invitation: invitation(owner) };
      const inviter = db.prepare('SELECT id FROM customers WHERE invite_code = ?').get(code);
      if (!inviter || db.prepare('SELECT 1 FROM customer_browsers WHERE owner_hash = ? AND customer_id = ?').get(owner, inviter.id)) return { accepted: false, invitation: invitation(owner) };
      // First valid invitation lasts 30 days; subsequent links cannot replace attribution.
      db.prepare(`INSERT INTO referral_visits VALUES (?, ?, ?) ON CONFLICT(owner_hash) DO UPDATE SET
        inviter_id = excluded.inviter_id, expires_at = excluded.expires_at WHERE referral_visits.expires_at <= ?`)
        .run(owner, inviter.id, Date.now() + 30 * 86400000, Date.now());
      return { accepted: true, invitation: invitation(owner) };
    },
    report(params: URLSearchParams, inviterId?: string) {
      const status = params.get('status') || 'all';
      const page = Number(params.get('page') || 1);
      if (!['pending','earned','cancelled','all'].includes(status)
        || !Number.isSafeInteger(page) || page < 1 || page > 100000) throw new OrderError(400, 'INVALID_FILTER', '筛选条件无效。');
      const where = `WHERE (? IS NULL OR r.inviter_id = ?) AND o.environment = ? AND
        (? = 'all' OR (CASE WHEN r.status = 'pending' AND o.expires_at <= ? THEN 'cancelled' ELSE r.status END) = ?)`;
      const now = new Date().toISOString();
      const args = [inviterId ?? null, inviterId ?? null, environment, status, now, status];
      const from = `FROM referral_orders r JOIN orders o ON o.id = r.order_id JOIN customers c ON c.id = r.inviter_id`;
      const totals = db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN r.status = 'earned' THEN r.amount_cents ELSE 0 END),0) AS earnedCents ${from} ${where}`).get(...args);
      const rows = db.prepare(`SELECT r.order_id AS orderId, ${inviterId ? "substr(r.order_id,1,5) || '…' || substr(r.order_id,-6)" : 'r.order_id'} AS displayOrderId,
        c.username AS inviter, c.invite_code AS inviteCode, json_extract(o.snapshot,'$.productName') AS productName,
        json_extract(o.snapshot,'$.priceCents') AS orderCents, r.amount_cents AS amountCents, o.environment,
        CASE WHEN r.status = 'pending' AND o.expires_at <= ? THEN 'cancelled' ELSE r.status END AS status,
        r.created_at AS createdAt, r.earned_at AS earnedAt ${from} ${where} ORDER BY r.created_at DESC, r.order_id DESC LIMIT 20 OFFSET ?`)
        .all(now, ...args, (page - 1) * 20).map(row => inviterId ? { ...row, orderId: row.displayOrderId } : row);
      return { ...totals, page, pageSize: 20, rows };
    },
  };
}
