import { cancellationView } from './order-timeout-state.ts';
import { randomBytes, createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import type { Order } from '../src/types/orders.ts';
import { catalogRepository } from './database.ts';
import { couponRepository } from './coupons.ts';
import type { PaymentGateway, TradeResult } from './alipay.ts';
import { hashPassword, verifyPassword, dummyPasswordHash } from './passwords.ts';
import { normalizeContact, validContact, validNewQueryPassword, validQueryPassword } from '../src/lib/order-input.ts';

export class OrderError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
export function amountCents(value: string): number | null {
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(value || '');
  if (!match) return null;
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0'));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export function browserOwner(request: IncomingMessage, response: ServerResponse, gateway: PaymentGateway, create = false) {
  const secure = gateway.origin.startsWith('https:');
  const name = secure ? '__Host-wusan_browser' : 'wusan_browser';
  const value = (request.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
  if (value && /^[a-f0-9]{64}$/.test(value)) return hash(value);
  if (!create) return null;
  const token = randomBytes(32).toString('hex');
  response.setHeader('Set-Cookie', `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure ? '; Secure' : ''}`);
  return hash(token);
}

// Raw rows are never sent to the browser: email, owner hash and idempotency keys stay server-side.
function view(row: Record<string, unknown>): Order {
  const snapshot = JSON.parse(row.snapshot as string);
  return {
    productId: snapshot.productId, productName: snapshot.productName, priceCents: snapshot.priceCents,
    periodMonths: snapshot.periodMonths, details: snapshot.details, id: row.id as string,
    status: row.status as Order['status'], createdAt: row.created_at as string,
    expiresAt: row.expires_at as string, paidAt: row.paid_at as string | null,
    tradeNo: row.trade_no as string | null, environment: row.environment as Order['environment'],
    ...(snapshot.couponCode && Number.isSafeInteger(snapshot.originalPriceCents) && snapshot.originalPriceCents > snapshot.priceCents
      ? { originalPriceCents: snapshot.originalPriceCents as number } : {}),
    ...(snapshot.staffCheckout === true ? { staffCheckout: true as const } : {}),
  };
}

export function orderRepository(db: DatabaseSync, gateway: PaymentGateway) {
  const catalog = catalogRepository(db);
  const { environment } = gateway.status;
  const coupons = couponRepository(db, environment);
  const completedFulfillment = db.prepare(`SELECT f.recharge_email FROM order_redemptions r
    LEFT JOIN order_fulfillment_details f ON f.order_id = r.order_id
    WHERE r.order_id = ? AND (json_extract(r.result, '$.settlement') = 'PAID'
      OR json_extract(r.result, '$.renewal') = 'paid')`);
  const rechargeStatus = db.prepare(`SELECT submitted, json_extract(result, '$.state') AS state,
    json_extract(result, '$.settlement') AS settlement, json_extract(result, '$.renewal') AS renewal, json_extract(result, '$.reason') AS reason
    FROM order_redemptions WHERE order_id = ?`);
  const toView = (row: Record<string, unknown>): Order => {
    const order = view(row);
    const cancellation = cancellationView(db, order.id);
    const fulfillment = order.status === 'paid' && !cancellation ? completedFulfillment.get(order.id) : undefined;
    if (fulfillment) order.fulfillment = { status: 'succeeded', rechargeEmail: fulfillment.recharge_email ? String(fulfillment.recharge_email) : null };
    if (order.status === 'paid' && !cancellation) {
      const recharge = rechargeStatus.get(order.id);
      order.recharge = { submitted: Boolean(recharge?.submitted), state: String(recharge?.state || ''),
        settlement: String(recharge?.settlement || ''), renewal: String(recharge?.renewal || ''), ...(recharge?.reason ? { reason: String(recharge.reason) } : {}) };
    }
    const context = JSON.parse(String(row.snapshot)).payment;
    let cancelAction: Order['cancelAction'] = null;
    if (!cancellation && !order.staffCheckout && order.environment === environment) {
      if (order.status === 'pending') cancelAction = 'cancel';
      if (order.status === 'paid') {
        const blocked = db.prepare(`SELECT 1 FROM order_redemptions WHERE order_id=? AND
          (submitted=1 OR preview_until>? OR json_extract(result,'$.state')='FULFILLED' OR json_extract(result,'$.settlement')='PAID'
           OR json_extract(result,'$.renewal') IN ('paid','ready'))
          UNION ALL SELECT 1 FROM order_cancellations WHERE order_id=? AND source!='customer_unpaid'
          UNION ALL SELECT 1 FROM payment_refunds WHERE order_id=?`).get(order.id,Date.now(),order.id,order.id);
        if (!blocked) cancelAction = 'request_refund';
      }
    }
    if (cancelAction && (!gateway.status.enabled || context?.appId !== gateway.appId || context?.sellerId !== gateway.sellerId)) {
      order.cancelUnavailableReason = !gateway.status.enabled
        ? '暂无法核实支付状态，当前不能取消订单。'
        : '该订单的收款配置已变更，请联系客服核实后取消。';
      cancelAction = null;
    }
    return cancellation ? { ...order, cancelAction, cancellation, ...(cancellation.cancelledAt || cancellation.state === 'cancelled' ? { status: 'cancelled' as const } : {}) } : { ...order, cancelAction };
  };
  const raw = (id: string) => db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  function owned(id: string, owner: string | null, staffOwner: string | null = null) {
    const row = owner || staffOwner ? db.prepare(`SELECT * FROM orders WHERE id = ? AND environment = ? AND (owner_hash IN (?, ?) OR id IN
      (SELECT order_id FROM order_access WHERE owner_hash = ? AND expires_at > ?))`).get(id, environment, owner, staffOwner, owner, new Date().toISOString()) : undefined;
    if (!row) throw new OrderError(404, 'ORDER_NOT_FOUND', '订单不存在或当前浏览器无权访问。');
    return toView(row);
  }
  function ready() {
    if (!gateway.status.enabled) throw new OrderError(503, 'PAYMENT_NOT_CONFIGURED', gateway.status.message);
  }
  function sameEnvironment(order: Order) {
    if (order.staffCheckout) throw new OrderError(409, 'ORDER_PAYMENT_EXEMPT', '免付开通订单无需付款。');
    if (order.environment !== environment) throw new OrderError(409, 'PAYMENT_ENVIRONMENT_CHANGED', '该订单属于另一个支付环境，请重新下单。');
    const context = JSON.parse(raw(order.id)!.snapshot as string).payment;
    if (context?.appId !== gateway.appId || context?.sellerId !== gateway.sellerId) {
      throw new OrderError(409, 'PAYMENT_MERCHANT_CHANGED', '该订单的收款配置已变更，请联系经营方核实原交易。');
    }
  }
  function payable(id: string, owner: string | null) {
    ready();
    const order = owned(id, owner);
    sameEnvironment(order);
    if (order.status !== 'pending') throw new OrderError(409, 'ORDER_NOT_PENDING', '订单已付款或已关闭，请查看订单状态。');
    if (Date.parse(order.expiresAt) <= Date.now()) throw new OrderError(409, 'ORDER_EXPIRED', '付款时间已结束，请先查询支付结果；确认未付款后可重新下单。');
    return order;
  }
  function apply(order: Order, trade: TradeResult, notification: boolean) {
    if (trade.out_trade_no !== order.id || (notification && trade.app_id !== gateway.appId)
      || (notification && trade.seller_id !== gateway.sellerId)
      || (trade.seller_id && trade.seller_id !== gateway.sellerId)
      || !/^\d{1,10}(\.\d{1,2})?$/.test(trade.total_amount || '')
      || amountCents(trade.total_amount) !== order.priceCents) {
      throw new OrderError(400, 'TRADE_MISMATCH', '支付通知与订单不一致。');
    }
    const paid = ['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(trade.trade_status) && !(notification && (trade.out_biz_no || trade.gmt_refund || trade.refund_fee));
    if (paid && !/^\d{10,64}$/.test(trade.trade_no || '')) throw new OrderError(400, 'INVALID_TRADE', '交易号无效。');
    if (paid) {
      if (order.tradeNo && order.tradeNo !== trade.trade_no) throw new OrderError(400, 'TRADE_MISMATCH', '交易号不一致。');
      db.prepare(`UPDATE orders SET status = 'paid', trade_no = ?, paid_at = COALESCE(paid_at, ?)
        WHERE id = ?`).run(trade.trade_no, new Date().toISOString(), order.id);
      // A verified late payment always wins over a prior unpaid cancellation.
      db.prepare(`UPDATE order_cancellations SET state='fulfilled',note='已核实到账，保留已付款订单。',updated_at=?
        WHERE order_id=? AND source='customer_unpaid'`).run(new Date().toISOString(),order.id);
    } else if (trade.trade_status === 'TRADE_CLOSED') {
      db.prepare("UPDATE orders SET status = 'closed' WHERE id = ? AND status = 'pending'").run(order.id);
    } // Pending, unknown and non-payment events never imply payment success.
  }
  return {
    list(owner: string | null, staffOwner: string | null = null) {
      return owner || staffOwner ? db.prepare(`SELECT * FROM orders WHERE environment = ? AND (owner_hash IN (?, ?) OR id IN
        (SELECT order_id FROM order_access WHERE owner_hash = ? AND expires_at > ?))
        ORDER BY created_at DESC LIMIT 200`).all(environment, owner, staffOwner, owner, new Date().toISOString()).map(toView) : [];
    },
    owned,
    forAdmin(id: string) {
      const row = db.prepare('SELECT * FROM orders WHERE id=? AND environment=?').get(id,environment);
      if (!row) throw new OrderError(404,'ORDER_NOT_FOUND','未找到当前环境的订单。');
      return toView(row);
    },
    cancellationEligible(id: string, owner: string | null) {
      ready();
      const order = owned(id,owner);
      sameEnvironment(order);
      if (!order.cancelAction) throw new OrderError(409,'ORDER_CANNOT_CANCEL','订单状态已变更，已提交充值、正在处理或已取消的订单不能再次取消，请刷新查看。');
      return order;
    },
    async lookup(owner: string, input: Record<string, unknown>) {
      if (typeof input.contact !== 'string' || !validContact(input.contact) || typeof input.queryPassword !== 'string' || !validQueryPassword(input.queryPassword)) {
        throw new OrderError(400, 'INVALID_LOOKUP', '请填写联系方式和 6–64 位查询密码。');
      }
      const rows = db.prepare('SELECT * FROM orders WHERE contact = ? AND environment = ? AND query_password_hash IS NOT NULL ORDER BY created_at DESC LIMIT 50').all(normalizeContact(input.contact), environment);
      const found: Record<string, unknown>[] = [];
      if (!rows.length) await verifyPassword(input.queryPassword, dummyPasswordHash);
      for (const row of rows) if (await verifyPassword(input.queryPassword, String(row.query_password_hash))) found.push(row);
      if (!found.length) throw new OrderError(401, 'LOOKUP_FAILED', '联系方式或查询密码不正确，或未找到对应订单。');
      const now = new Date().toISOString();
      const expires = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM order_access WHERE expires_at <= ?').run(now);
        for (const row of found) db.prepare(`INSERT INTO order_access(order_id, owner_hash, expires_at) VALUES (?, ?, ?)
          ON CONFLICT(order_id, owner_hash) DO UPDATE SET expires_at = excluded.expires_at`).run(String(row.id), owner, expires);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return found.map(toView);
    },
    async create(owner: string, input: Record<string, unknown>, key: string, referral?: { inviterId: string; buyerId: string | null }) {
      ready();
      if (!/^[a-f0-9-]{16,80}$/i.test(key)) throw new OrderError(400, 'INVALID_IDEMPOTENCY_KEY', '请刷新页面后重新提交。');
      if (typeof input.productId !== 'string' || typeof input.contact !== 'string' || !validContact(input.contact)
        || typeof input.queryPassword !== 'string' || !validQueryPassword(input.queryPassword)) {
        throw new OrderError(400, 'INVALID_ORDER', '请填写有效的联系方式和查询密码。');
      }
      const contact = normalizeContact(input.contact);
      const fingerprint = hash(JSON.stringify([input.productId, contact, input.expectedPriceCents, typeof input.couponCode === 'string' ? input.couponCode.trim().toUpperCase() : '']));
      const existing = db.prepare('SELECT * FROM orders WHERE owner_hash = ? AND idempotency_key = ?').get(owner, key);
      if (existing) {
        if (existing.environment !== environment || existing.fingerprint !== fingerprint || !await verifyPassword(input.queryPassword, String(existing.query_password_hash || ''))) throw new OrderError(409, 'IDEMPOTENCY_CONFLICT', '该提交编号已用于其他订单，请刷新后重试。');
        return toView(existing);
      }
      if (!validNewQueryPassword(input.queryPassword)) {
        throw new OrderError(400, 'INVALID_ORDER', '请设置 6–14 位查询密码。');
      }
      const product = catalog.findProduct(input.productId);
      if (!product?.selectable || !product.priceCents || product.priceCents > 10000000000) {
        throw new OrderError(409, 'PRODUCT_UNAVAILABLE', '套餐已下架或暂不可购买。');
      }
      if (input.expectedPriceCents !== product.priceCents) throw new OrderError(409, 'PRICE_CHANGED', '套餐价格已更新，请刷新页面后确认新价格。');
      const passwordHash = await hashPassword(input.queryPassword);
      // Recheck after the asynchronous hash so concurrent retries cannot create duplicate orders.
      const repeated = db.prepare('SELECT * FROM orders WHERE owner_hash = ? AND idempotency_key = ?').get(owner, key);
      if (repeated) {
        if (repeated.environment !== environment || repeated.fingerprint !== fingerprint || !await verifyPassword(input.queryPassword, String(repeated.query_password_hash || ''))) throw new OrderError(409, 'IDEMPOTENCY_CONFLICT', '该提交编号已用于其他订单，请刷新后重试。');
        return toView(repeated);
      }
      const current = catalog.findProduct(input.productId);
      if (!current?.selectable || current.priceCents !== product.priceCents) throw new OrderError(409, 'PRICE_CHANGED', '商品或价格已更新，请刷新后重试。');
      const id = `WS${Date.now()}${randomBytes(8).toString('hex')}`;
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
      const coupon = input.couponCode ? coupons.quote(input.couponCode, product.id) : null;
      if (coupon && input.expectedDiscountCents !== coupon.discountCents) throw new OrderError(409, 'COUPON_CHANGED', '优惠券内容已变更，请重新验证后确认金额。');
      const snapshot = { productId: product.id, productName: product.name, category: product.category, priceCents: coupon?.payableCents ?? product.priceCents,
        originalPriceCents: product.priceCents, couponCode: coupon?.code, discountCents: coupon?.discountCents ?? 0,
        periodMonths: product.periodMonths, details: product.details, payment: { appId: gateway.appId, sellerId: gateway.sellerId } };
      db.prepare(`INSERT INTO orders (id, owner_hash, email, snapshot, status, created_at, expires_at,
        idempotency_key, fingerprint, environment, contact, query_password_hash, terms_version) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, '2026-10-21')`).run(
        id, owner, /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contact.trim()) ? input.contact.trim() : '', JSON.stringify(snapshot), createdAt, expiresAt, key, fingerprint, environment, contact, passwordHash);
      if (coupon) db.prepare('INSERT INTO coupon_orders(coupon_id,order_id,discount_cents) VALUES (?,?,?)').run(coupon.id,id,coupon.discountCents);
      if (referral) db.prepare('INSERT INTO referral_orders(order_id, inviter_id, buyer_id, created_at) VALUES (?, ?, ?, ?)')
        .run(id, referral.inviterId, referral.buyerId, createdAt);
      db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return owned(id, owner);
    },
    createStaff(staffOwner: string, productId: unknown, key: string) {
      if (!/^[a-f0-9-]{16,80}$/i.test(key)) throw new OrderError(400, 'INVALID_IDEMPOTENCY_KEY', '请刷新页面后重新提交。');
      const fingerprint = hash(JSON.stringify(['staff-checkout', productId]));
      const find = () => db.prepare('SELECT * FROM orders WHERE owner_hash = ? AND idempotency_key = ?').get(staffOwner, key);
      const resolve = (row: NonNullable<ReturnType<typeof find>>) => {
        if (row.environment !== environment || row.fingerprint !== fingerprint) throw new OrderError(409, 'IDEMPOTENCY_CONFLICT', '该提交编号已用于其他订单，请刷新后重试。');
        return toView(row);
      };
      const existing = find();
      if (existing) return resolve(existing);
      const product = typeof productId === 'string' ? catalog.findProduct(productId) : null;
      if (!product?.selectable || !product.priceCents) throw new OrderError(409, 'PRODUCT_UNAVAILABLE', '套餐已下架或暂不可购买。');
      const id = `WS${Date.now()}${randomBytes(8).toString('hex')}`;
      const now = new Date().toISOString();
      const snapshot = {
        productId: product.id, productName: product.name, category: product.category, priceCents: 0, originalPriceCents: product.priceCents,
        periodMonths: product.periodMonths, details: product.details, staffCheckout: true,
      };
      // Use the existing redemption-ready state without recording a payment or a referral.
      db.prepare(`INSERT INTO orders (id, owner_hash, email, snapshot, status, created_at, expires_at,
        idempotency_key, fingerprint, environment) VALUES (?, ?, '', ?, 'paid', ?, ?, ?, ?, ?)
        ON CONFLICT(owner_hash, idempotency_key) DO NOTHING`)
        .run(id, staffOwner, JSON.stringify(snapshot), now, now, key, fingerprint, environment);
      return resolve(find()!);
    },
    payment(id: string, owner: string | null) {
      return { paymentHtml: gateway.paymentForm(payable(id, owner)) };
    },
    paymentQr(id: string, owner: string | null) {
      const order = payable(id, owner);
      try {
        return { paymentUrl: gateway.paymentForm(order, true) };
      } catch {
        throw new OrderError(502, 'PAYMENT_QR_FAILED', '暂时无法生成支付宝二维码，可以重试或前往支付宝收银台。');
      }
    },
    notify(params: Record<string, string>) {
      ready();
      if (!gateway.verifyNotification(params)) throw new OrderError(400, 'INVALID_SIGNATURE', '支付通知验签失败。');
      const row = raw(params.out_trade_no || '');
      if (!row) throw new OrderError(404, 'ORDER_NOT_FOUND', '订单不存在。');
      const order = toView(row);
      sameEnvironment(order);
      if (!params.notify_id || !params.trade_no) throw new OrderError(400, 'INVALID_NOTIFICATION', '通知标识缺失。');
      const eventType = params.out_biz_no || params.gmt_refund || params.refund_fee ? 'non-payment' : 'payment';
      const eventKey = hash(JSON.stringify([params.notify_id, order.id, params.trade_no, eventType, params.trade_status]));
      db.exec('BEGIN IMMEDIATE');
      try {
        // Business validation runs even for retries. Event and state changes commit atomically.
        apply(order, params, true);
        db.prepare(`INSERT OR IGNORE INTO alipay_notify_events
          (event_key, order_id, notify_id, trade_no, event_type, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(eventKey, order.id, params.notify_id, params.trade_no, eventType, new Date().toISOString());
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    async close(id: string, owner: string | null, customerCancellation = false) {
      ready();
      const order = owned(id, owner);
      sameEnvironment(order);
      if (customerCancellation && order.cancellation) return order;
      if (order.status !== 'pending') throw new OrderError(409, 'ORDER_NOT_PENDING', '只可关闭未付款订单。');
      const trade = await gateway.query(order);
      if (trade) apply(order, trade, false);
      const current = owned(id, owner);
      if (current.status !== 'pending' && !(customerCancellation && current.status === 'closed')) return current;
      if (current.status === 'pending' && trade && trade.trade_status !== 'WAIT_BUYER_PAY') throw new OrderError(409, 'TRADE_UNCERTAIN', '支付状态未知，请稍后查询。');
      if (current.status === 'pending' && trade) {
        const result = await gateway.close(order);
        if (result.out_trade_no !== order.id) throw new OrderError(400, 'TRADE_MISMATCH', '关单结果不一致。');
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        const changed=db.prepare("UPDATE orders SET status = 'closed' WHERE id = ? AND (status = 'pending' OR (?=1 AND status='closed'))").run(id,Number(customerCancellation));
        if(customerCancellation && changed.changes) {
          const now=new Date().toISOString();
          db.prepare(`INSERT INTO order_cancellations(order_id,state,refund_key,note,created_at,updated_at,cancelled_at,source)
            VALUES (?,'cancelled',?,'未付款订单已取消，无需退款。',?,?,?,'customer_unpaid')
            ON CONFLICT(order_id) DO UPDATE SET state='cancelled',source='customer_unpaid',note=excluded.note,cancelled_at=excluded.cancelled_at,updated_at=excluded.updated_at`)
            .run(id,'unpaid-'+hash(id).slice(0,40),now,now,now);
        }
        db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
      return owned(id, owner);
    },
    async refresh(id: string, owner: string | null) {
      ready();
      const order = owned(id, owner);
      sameEnvironment(order);
      if (order.status !== 'pending') return order;
      const trade = await gateway.query(order);
      if (trade) apply(order, trade, false);
      else if (Date.parse(order.expiresAt) <= Date.now()) {
        db.prepare("UPDATE orders SET status = 'closed' WHERE id = ? AND status = 'pending'").run(order.id);
      }
      return owned(id, owner);
    },
  };
}
