import type { DatabaseSync } from 'node:sqlite';

// This is only a local candidate check. Reclaim must also verify the live
// provider response while holding the redemption's shared database lease.
export function reclaimableStaffVoucher(db: DatabaseSync, id: string, environment: string) {
  return db.prepare(`SELECT v.id AS voucher_id,v.code,r.submitted,r.submitted_order_no,r.result
    FROM orders o JOIN order_redemptions r ON r.order_id=o.id
    JOIN voucher_inventory v ON v.id=r.voucher_id
    LEFT JOIN order_fulfillment_details f ON f.order_id=o.id
    WHERE o.id=? AND o.environment=? AND o.status='paid'
      AND json_extract(o.snapshot,'$.staffCheckout')=1 AND json_extract(o.snapshot,'$.priceCents')=0
      AND v.environment=o.environment AND v.product_id=json_extract(o.snapshot,'$.productId')
      AND f.reclaimed_at IS NULL AND r.preview_until<=?
      AND COALESCE(json_extract(r.result,'$.state'),'')!='FULFILLED'
      AND COALESCE(json_extract(r.result,'$.settlement'),'')!='PAID'
      AND COALESCE(json_extract(r.result,'$.renewal'),'') NOT IN ('paid','ready')
      AND NOT EXISTS (SELECT 1 FROM staff_redemption_previews s WHERE s.order_id=o.id AND s.lease_until>?)
      AND NOT EXISTS (SELECT 1 FROM order_cancellations c WHERE c.order_id=o.id)
      AND NOT EXISTS (SELECT 1 FROM payment_refunds p WHERE p.order_id=o.id)`)
    .get(id,environment,Date.now(),Date.now());
}
