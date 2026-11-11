import type { DatabaseSync } from 'node:sqlite';
import type { Order } from '../src/types/orders.ts';

export function cancellationView(db: DatabaseSync, id: string): Order['cancellation'] {
  const reclaimed = db.prepare('SELECT reclaimed_at FROM order_fulfillment_details WHERE order_id=? AND reclaimed_at IS NOT NULL').get(id);
  if (reclaimed) return { state: 'cancelled', message: '卡密已回收，订单已取消。', cancelledAt: String(reclaimed.reclaimed_at), voucherReclaimed: true };
  const row = db.prepare(`SELECT c.state, c.note, c.cancelled_at, r.status AS review_status FROM order_cancellations c
    LEFT JOIN order_refund_reviews r ON r.order_id=c.order_id WHERE c.order_id = ? AND c.state != 'fulfilled'`).get(id);
  if (!row) return undefined;
  const state = row.review_status === 'pending' ? 'refund_review' : row.review_status === 'rejected' ? 'refund_rejected' : row.state;
  return { state: state as NonNullable<Order['cancellation']>['state'], message: String(row.note), cancelledAt: row.cancelled_at ? String(row.cancelled_at) : null };
}
