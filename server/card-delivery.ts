import type { DatabaseSync } from 'node:sqlite';

// One SQLite statement reserves and delivers at most one card per verified
// order. The audit trigger saves its historical code in the same transaction.
export function deliverOrderCard(db: DatabaseSync, id: string, environment: string) {
  db.prepare(`INSERT OR IGNORE INTO order_card_deliveries(order_id,voucher_id,voucher_code,delivered_at)
    SELECT o.id,v.id,v.code,? FROM orders o JOIN voucher_inventory v
      ON v.product_id=json_extract(o.snapshot,'$.productId') AND v.environment=o.environment
    WHERE o.id=? AND o.environment=? AND o.status='paid' AND json_extract(o.snapshot,'$.deliveryType')='voucher'
      AND NOT EXISTS (SELECT 1 FROM order_cancellations c WHERE c.order_id=o.id AND c.state!='fulfilled')
      AND NOT EXISTS (SELECT 1 FROM payment_refunds p WHERE p.order_id=o.id)
      AND NOT EXISTS (SELECT 1 FROM order_redemptions r WHERE r.voucher_id=v.id)
      AND NOT EXISTS (SELECT 1 FROM order_card_deliveries d WHERE d.voucher_id=v.id OR d.order_id=o.id)
    ORDER BY v.priority DESC,v.id LIMIT 1`).run(new Date().toISOString(),id,environment);
  const row = db.prepare(`SELECT d.voucher_code,d.delivered_at,coalesce(i.instructions,'') AS usage_instructions
    FROM order_card_deliveries d JOIN orders o ON o.id=d.order_id
    LEFT JOIN product_voucher_instructions i ON i.product_id=json_extract(o.snapshot,'$.productId') AND i.environment=o.environment
    WHERE d.order_id=? AND o.environment=? AND o.status='paid' AND json_extract(o.snapshot,'$.deliveryType')='voucher'
      AND NOT EXISTS (SELECT 1 FROM order_cancellations c WHERE c.order_id=o.id AND c.state!='fulfilled')
      AND NOT EXISTS (SELECT 1 FROM payment_refunds p WHERE p.order_id=o.id)`).get(id,environment);
  return row ? { delivered: true as const, code: String(row.voucher_code), deliveredAt: String(row.delivered_at), usageInstructions:String(row.usage_instructions) } : { delivered: false as const };
}
