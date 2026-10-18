import type { DatabaseSync } from 'node:sqlite';
import type { Order } from '../src/types/orders.ts';
import type { PaymentGateway, TradeResult } from './alipay.ts';
import { amountCents, OrderError } from './orders.ts';

// Operator-only service: invoked by the local CLI, never exposed as a public customer endpoint.
export function refundRepository(db: DatabaseSync, gateway: PaymentGateway) {
  function order(id: string): Order {
    if (!gateway.status.enabled) throw new Error('Alipay is not configured.');
    const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!row || row.status !== 'paid') throw new OrderError(409, 'ORDER_NOT_PAID', '退款需要已核实付款的订单。');
    const snapshot = JSON.parse(row.snapshot as string);
    if (row.environment !== gateway.status.environment || snapshot.payment?.appId !== gateway.appId || snapshot.payment?.sellerId !== gateway.sellerId) {
      throw new Error('Order payment environment or merchant does not match.');
    }
    return { ...snapshot, id, status: row.status, tradeNo: row.trade_no, createdAt: row.created_at,
      expiresAt: row.expires_at, paidAt: row.paid_at, environment: row.environment };
  }
  function validate(result: TradeResult, current: Order, requestNo: string, cents: number) {
    if (result.out_trade_no !== current.id || (result.trade_no && result.trade_no !== current.tradeNo)
      || (result.out_request_no && result.out_request_no !== requestNo)
      || (result.refund_amount && amountCents(result.refund_amount) !== cents)
      || (result.refund_fee && amountCents(result.refund_fee) !== cents)) throw new Error('Refund response does not match the saved request.');
  }
  return {
    async request(id: string, requestNo: string, amount: string, reason: string) {
      const current = order(id);
      const cents = amountCents(amount);
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestNo) || !cents || !reason || reason.length > 256) throw new Error('A unique request number, positive decimal amount and reason are required.');
      const now = new Date().toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        const existing = db.prepare('SELECT * FROM payment_refunds WHERE request_no = ?').get(requestNo);
        if (existing) {
          if (existing.order_id !== id || existing.amount_cents !== cents || existing.reason !== reason) throw new Error('Refund retry must reuse the original order, amount and reason.');
          if (existing.status === 'success') { db.exec('COMMIT'); return { requestNo, status: 'success' }; }
        } else {
          const reserved = db.prepare('SELECT COALESCE(sum(amount_cents), 0) AS cents FROM payment_refunds WHERE order_id = ?').get(id)!.cents as number;
          if (reserved + cents > current.priceCents) throw new Error('Cumulative refunds exceed the paid amount. Pending refunds remain reserved until reconciled.');
          db.prepare(`INSERT INTO payment_refunds (request_no, order_id, amount_cents, reason, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'pending', ?, ?)`).run(requestNo, id, cents, reason, now, now);
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      // Unknown/network results retain their reservation and original immutable parameters.
      const result = await gateway.refund(current, (cents / 100).toFixed(2), requestNo, reason);
      validate(result, current, requestNo, cents);
      const status = result.fund_change === 'Y' ? 'success' : 'pending';
      db.prepare('UPDATE payment_refunds SET status = ?, updated_at = ? WHERE request_no = ?')
        .run(status, new Date().toISOString(), requestNo);
      return { requestNo, status };
    },
    async query(requestNo: string) {
      const row = db.prepare('SELECT * FROM payment_refunds WHERE request_no = ?').get(requestNo);
      if (!row) throw new Error('Refund request not found.');
      if (Date.now() - Date.parse(row.updated_at as string) < 10000) throw new Error('Wait at least 10 seconds before querying a refund.');
      const current = order(row.order_id as string);
      const result = await gateway.refundQuery(current, requestNo);
      validate(result, current, requestNo, row.amount_cents as number);
      const status = result.refund_status === 'REFUND_SUCCESS' ? 'success' : 'pending';
      db.prepare("UPDATE payment_refunds SET status = CASE WHEN status = 'success' THEN status ELSE ? END, updated_at = ? WHERE request_no = ?")
        .run(status, new Date().toISOString(), requestNo);
      return { requestNo, status: row.status === 'success' ? 'success' : status };
    },
  };
}
