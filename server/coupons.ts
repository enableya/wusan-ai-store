import { randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { OrderError } from './orders.ts';
import { catalogRepository } from './database.ts';

export function couponRepository(db: DatabaseSync, environment: 'sandbox' | 'production') {
  const catalog = catalogRepository(db);
  const normalize = (value: unknown) => typeof value === 'string' ? value.trim().toUpperCase() : '';
  function quote(code: unknown, productId: unknown) {
    const normalized = normalize(code);
    const product = typeof productId === 'string' ? catalog.findProduct(productId) : undefined;
    if (!/^[A-Z0-9_-]{4,40}$/.test(normalized) || !product?.selectable || !product.priceCents) throw new OrderError(400, 'COUPON_INVALID', '优惠码或商品无效。');
    const coupon = db.prepare(`SELECT c.*, (SELECT count(*) FROM coupon_orders co WHERE co.coupon_id=c.id) AS reserved FROM coupons c WHERE c.environment=? AND c.code=? AND c.deleted_at IS NULL`).get(environment, normalized);
    if (!coupon || !coupon.active) throw new OrderError(400, 'COUPON_INVALID', '优惠码不存在或已停用。');
    if (coupon.product_id && coupon.product_id !== product.id) throw new OrderError(400, 'COUPON_PRODUCT', '此优惠券不适用于当前商品。');
    if (product.priceCents < Number(coupon.min_cents)) throw new OrderError(400, 'COUPON_MINIMUM', '订单金额未达到优惠券使用门槛。');
    if (Number(coupon.reserved) >= Number(coupon.usage_limit)) throw new OrderError(409, 'COUPON_EXHAUSTED', '优惠券使用次数已用完。');
    const discountCents = Number(coupon.discount_cents);
    if (discountCents >= product.priceCents) throw new OrderError(400, 'COUPON_AMOUNT', '优惠后金额须大于 0 元。');
    return { id: String(coupon.id), code: normalized, discountCents, originalCents: product.priceCents, payableCents: product.priceCents - discountCents };
  }
  function validated(input: Record<string, unknown>) {
    const productId = input.productId || null;
    if ((productId !== null && (typeof productId !== 'string' || !catalog.findProduct(productId))) ||
        !Number.isSafeInteger(input.minCents) || Number(input.minCents) < 0 ||
        !Number.isSafeInteger(input.discountCents) || Number(input.discountCents) < 1 ||
        !Number.isSafeInteger(input.usageLimit) || Number(input.usageLimit) < 1 || Number(input.usageLimit) > 1000000) {
      throw new OrderError(400, 'INVALID_COUPON', '请检查商品、金额和使用次数。');
    }
    return { productId: productId as string | null, min: Number(input.minCents), discount: Number(input.discountCents), limit: Number(input.usageLimit) };
  }
  return {
    quote,
    list() { return db.prepare(`SELECT c.id,c.code,c.product_id AS productId,c.min_cents AS minCents,c.discount_cents AS discountCents,c.usage_limit AS usageLimit,c.active,c.created_at AS createdAt,
      (SELECT count(*) FROM coupon_orders co WHERE co.coupon_id=c.id) AS reserved,
      (SELECT count(*) FROM coupon_orders co JOIN orders o ON o.id=co.order_id WHERE co.coupon_id=c.id AND o.status='paid') AS paid FROM coupons c WHERE c.environment=? AND c.deleted_at IS NULL ORDER BY c.created_at DESC`).all(environment); },
    create(input: Record<string, unknown>) {
      const { productId, min, discount, limit } = validated(input);
      const id = randomUUID();
      const insert = db.prepare(`
        INSERT INTO coupons (id, code, environment, product_id, min_cents, discount_cents, usage_limit, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (code, environment) DO NOTHING
      `);
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = `WS-${randomBytes(8).toString('hex').toUpperCase()}`;
        if (insert.run(id, code, environment, productId, min, discount, limit, new Date().toISOString()).changes) {
          return { ok: true, id, code };
        }
      }
      throw new OrderError(503, 'COUPON_CODE_UNAVAILABLE', '暂时无法生成优惠码，请重试。');
    },
    update(id: string, input: Record<string, unknown>) {
      const { productId, min, discount, limit } = validated(input);
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = db.prepare(`SELECT (SELECT count(*) FROM coupon_orders co WHERE co.coupon_id=c.id) AS reserved FROM coupons c WHERE c.id=? AND c.environment=? AND c.deleted_at IS NULL`).get(id, environment);
        if (!row) throw new OrderError(404, 'COUPON_NOT_FOUND', '优惠券不存在。');
        if (limit < Number(row.reserved)) throw new OrderError(409, 'COUPON_LIMIT', '使用次数不能少于已占用名额。');
        db.prepare('UPDATE coupons SET product_id=?, min_cents=?, discount_cents=?, usage_limit=? WHERE id=? AND environment=?')
          .run(productId, min, discount, limit, id, environment);
        db.exec('COMMIT'); return { ok: true };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    remove(id: string) {
      const result = db.prepare("UPDATE coupons SET deleted_at=?, active=0 WHERE id=? AND environment=? AND deleted_at IS NULL").run(new Date().toISOString(), id, environment);
      if (!result.changes) throw new OrderError(404, 'COUPON_NOT_FOUND', '优惠券不存在。');
      return { ok: true };
    },
    setActive(id: string, active: unknown) {
      if (typeof active !== 'boolean') throw new OrderError(400,'INVALID_COUPON','优惠券状态无效。');
      const result = db.prepare('UPDATE coupons SET active=? WHERE id=? AND environment=? AND deleted_at IS NULL').run(Number(active),id,environment);
      if (!result.changes) throw new OrderError(404,'COUPON_NOT_FOUND','优惠券不存在。');
      return { ok: true };
    },
  };
}
