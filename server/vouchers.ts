import type { DatabaseSync } from 'node:sqlite';
import type { PaymentConfig } from '../src/types/orders.ts';
import type { VoucherCard, VoucherPage } from '../src/types/admin.ts';
import { OrderError } from './orders.ts';

const available = `NOT EXISTS (SELECT 1 FROM order_redemptions r WHERE r.voucher_id = voucher_inventory.id)`;
const pageSize = 50;

export function voucherInventory(db: DatabaseSync, environment: PaymentConfig['environment']) {
  return {
    list() {
      const products = db.prepare(`
        SELECT p.id, p.name, count(v.id) AS total, coalesce(sum(v.priority), 0) AS priority
        FROM products p LEFT JOIN voucher_inventory v ON v.product_id = p.id AND v.environment = ?
          AND NOT EXISTS (SELECT 1 FROM order_redemptions r WHERE r.voucher_id = v.id)
        WHERE p.active = 1 GROUP BY p.id ORDER BY p.sort_order, p.id
      `).all(environment);
      return { environment, products };
    },
    listCards(productId: string, after: number): VoucherPage {
      const rows = db.prepare(`SELECT voucher_inventory.id, code, priority, created_at AS createdAt
        FROM voucher_inventory JOIN products p ON p.id = product_id AND p.active = 1
        WHERE environment = ? AND product_id = ? AND voucher_inventory.id > ? AND ${available}
        ORDER BY voucher_inventory.id LIMIT ?`).all(environment, productId, after, pageSize + 1) as VoucherCard[];
      const cards = rows.slice(0, pageSize);
      return { cards, next: rows.length > pageSize ? cards.at(-1)!.id : null };
    },
    removeCard(productId: string, id: number, input: Record<string, unknown>) {
      if (typeof input.createdAt !== 'string' || !input.createdAt || input.createdAt.length > 40) {
        throw new OrderError(400, 'INVALID_VOUCHER_REFERENCE', '卡密信息无效，请刷新后重试。');
      }
      const result = db.prepare(`DELETE FROM voucher_inventory
        WHERE id = ? AND environment = ? AND product_id = ? AND created_at = ? AND ${available}
          AND EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND p.active = 1)`)
        .run(id, environment, productId, input.createdAt);
      if (!result.changes) throw new OrderError(409, 'VOUCHER_UNAVAILABLE', '这张卡密已被订单占用、已删除或发生变更。');
      return { deleted: true };
    },
    importBatch(input: Record<string, unknown>) {
      const { productId, lines, priority, skipDuplicates } = input;
      if (typeof productId !== 'string' || typeof lines !== 'string' ||
        typeof priority !== 'boolean' || typeof skipDuplicates !== 'boolean') {
        throw new OrderError(400, 'INVALID_VOUCHER_IMPORT', '请选择商品并填写卡密。');
      }
      const codes = lines.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      if (!codes.length || codes.length > 200 || codes.some(code => code.length > 512 || /[\x00-\x1f\x7f]/.test(code))) {
        throw new OrderError(400, 'INVALID_VOUCHER_LINES', '每批可导入 1–200 条卡密，每行最多 512 个字符。');
      }

      db.exec('BEGIN IMMEDIATE');
      try {
        if (!db.prepare('SELECT 1 FROM products WHERE id = ? AND active = 1').get(productId)) {
          throw new OrderError(404, 'PRODUCT_NOT_FOUND', '该商品不存在或已下架。');
        }
        const insert = db.prepare(`
          INSERT INTO voucher_inventory (product_id, environment, code, priority)
          VALUES (?, ?, ?, ?) ON CONFLICT(environment, code) DO NOTHING
        `);
        let added = 0;
        for (const code of codes) {
          const inserted = insert.run(productId, environment, code, Number(priority)).changes;
          if (!inserted && !skipDuplicates) {
            throw new OrderError(409, 'DUPLICATE_VOUCHER', '发现重复卡密。可勾选「跳过重复卡密」后重新导入。');
          }
          added += Number(inserted);
        }
        db.exec('COMMIT');
        return { added, skipped: codes.length - added };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
