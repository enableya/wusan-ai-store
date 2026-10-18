import { randomBytes, createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import type { Order } from '../src/types/orders.ts';
import { catalogRepository } from './database.ts';
import type { PaymentGateway, TradeResult } from './alipay.ts';

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
  };
}

export function orderRepository(db: DatabaseSync, gateway: PaymentGateway) {
  const catalog = catalogRepository(db);
  const raw = (id: string) => db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  function owned(id: string, owner: string | null) {
    const row = owner ? db.prepare('SELECT * FROM orders WHERE id = ? AND owner_hash = ?').get(id, owner) : undefined;
    if (!row) throw new OrderError(404, 'ORDER_NOT_FOUND', '订单不存在或当前浏览器无权访问。');
    return view(row);
  }
  function ready() {
    if (!gateway.status.enabled) throw new OrderError(503, 'PAYMENT_NOT_CONFIGURED', gateway.status.message);
  }
  function sameEnvironment(order: Order) {
    if (order.environment !== gateway.status.environment) throw new OrderError(409, 'PAYMENT_ENVIRONMENT_CHANGED', '该订单属于另一个支付环境，请重新下单。');
    const context = JSON.parse(raw(order.id)!.snapshot as string).payment;
    if (context?.appId !== gateway.appId || context?.sellerId !== gateway.sellerId) {
      throw new OrderError(409, 'PAYMENT_MERCHANT_CHANGED', '该订单的收款配置已变更，请联系经营方核实原交易。');
    }
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
    } else if (trade.trade_status === 'TRADE_CLOSED') {
      db.prepare("UPDATE orders SET status = 'closed' WHERE id = ? AND status = 'pending'").run(order.id);
    } // Pending, unknown and non-payment events never imply payment success.
  }
  return {
    list(owner: string | null) {
      return owner ? db.prepare('SELECT * FROM orders WHERE owner_hash = ? ORDER BY created_at DESC LIMIT 200').all(owner).map(view) : [];
    },
    owned,
    create(owner: string, input: Record<string, unknown>, key: string) {
      ready();
      if (!/^[a-f0-9-]{16,80}$/i.test(key)) throw new OrderError(400, 'INVALID_IDEMPOTENCY_KEY', '请刷新页面后重新提交。');
      if (typeof input.productId !== 'string' || typeof input.email !== 'string' || input.email.length > 254
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()) || input.acceptedTerms !== true) {
        throw new OrderError(400, 'INVALID_ORDER', '请填写有效邮箱并确认服务须知与隐私说明。');
      }
      const fingerprint = hash(JSON.stringify([input.productId, input.email.trim(), input.expectedPriceCents]));
      const existing = db.prepare('SELECT * FROM orders WHERE owner_hash = ? AND idempotency_key = ?').get(owner, key);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new OrderError(409, 'IDEMPOTENCY_CONFLICT', '该提交编号已用于其他订单，请刷新后重试。');
        return view(existing);
      }
      const product = catalog.findProduct(input.productId);
      if (!product?.selectable || !product.priceCents || product.priceCents > 10000000000) {
        throw new OrderError(409, 'PRODUCT_UNAVAILABLE', '套餐已下架或暂不可购买。');
      }
      if (input.expectedPriceCents !== product.priceCents) throw new OrderError(409, 'PRICE_CHANGED', '套餐价格已更新，请刷新页面后确认新价格。');
      const id = `WS${Date.now()}${randomBytes(8).toString('hex')}`;
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const snapshot = { productId: product.id, productName: product.name, priceCents: product.priceCents,
        periodMonths: product.periodMonths, details: product.details, payment: { appId: gateway.appId, sellerId: gateway.sellerId } };
      db.prepare(`INSERT INTO orders (id, owner_hash, email, snapshot, status, created_at, expires_at,
        idempotency_key, fingerprint, environment) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`).run(
        id, owner, input.email.trim(), JSON.stringify(snapshot), createdAt, expiresAt, key, fingerprint, gateway.status.environment);
      return owned(id, owner);
    },
    payment(id: string, owner: string | null) {
      ready();
      const order = owned(id, owner);
      sameEnvironment(order);
      if (order.status !== 'pending') throw new OrderError(409, 'ORDER_NOT_PENDING', '订单已付款或已关闭，请查看订单状态。');
      if (Date.parse(order.expiresAt) <= Date.now()) throw new OrderError(409, 'ORDER_EXPIRED', '付款时间已结束，请先查询支付结果；确认未付款后可重新下单。');
      return { paymentHtml: gateway.paymentForm(order) };
    },
    notify(params: Record<string, string>) {
      ready();
      if (!gateway.verifyNotification(params)) throw new OrderError(400, 'INVALID_SIGNATURE', '支付通知验签失败。');
      const row = raw(params.out_trade_no || '');
      if (!row) throw new OrderError(404, 'ORDER_NOT_FOUND', '订单不存在。');
      const order = view(row);
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
    async close(id: string, owner: string | null) {
      ready();
      const order = owned(id, owner);
      sameEnvironment(order);
      if (order.status !== 'pending') throw new OrderError(409, 'ORDER_NOT_PENDING', '只可关闭未付款订单。');
      const trade = await gateway.query(order);
      if (trade) apply(order, trade, false);
      const current = owned(id, owner);
      if (current.status !== 'pending') return current;
      if (trade && trade.trade_status !== 'WAIT_BUYER_PAY') throw new OrderError(409, 'TRADE_UNCERTAIN', '支付状态未知，请稍后查询。');
      if (trade) {
        const result = await gateway.close(order);
        if (result.out_trade_no !== order.id) throw new OrderError(400, 'TRADE_MISMATCH', '关单结果不一致。');
      }
      db.prepare("UPDATE orders SET status = 'closed' WHERE id = ? AND status = 'pending'").run(id);
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
