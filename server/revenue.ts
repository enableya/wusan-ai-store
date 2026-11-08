import type { DatabaseSync } from 'node:sqlite';
import type { PaymentConfig } from '../src/types/orders.ts';
import { chinaDay } from './analytics.ts';
import { OrderError } from './orders.ts';

const boundary = (day: string) => new Date(`${day}T00:00:00+08:00`).toISOString();
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;

export function revenueRepository(db: DatabaseSync, environment: PaymentConfig['environment']) {
  return {
    report(params: URLSearchParams) {
      if ([...params.keys()].some(key => !['start', 'end', 'page'].includes(key) || params.getAll(key).length !== 1)) throw new OrderError(400, 'INVALID_FILTER', '筛选条件无效。');
      const today = chinaDay();
      const start = params.get('start') || chinaDay(Date.now() - 6 * 86400000);
      const end = params.get('end') || today;
      const page = Number(params.get('page') || 1);
      if (!validDay(start) || !validDay(end) || start > end || end > today || Date.parse(end) - Date.parse(start) > 365 * 86400000 || !Number.isSafeInteger(page) || page < 1 || page > 100000) {
        throw new OrderError(400, 'INVALID_FILTER', '请选择有效日期，时间范围最多 366 天。');
      }
      const from = boundary(start);
      const until = boundary(nextDay(end));
      const paidArgs = [environment, from, until];
      const paidWhere = "o.environment = ? AND o.status = 'paid' AND o.paid_at >= ? AND o.paid_at < ?";
      const refundsWhere = "o.environment = ? AND r.status = 'success' AND r.confirmed_at >= ? AND r.confirmed_at < ?";
      // Refunds and receipts are grouped by their own confirmed timestamps.
      const receipts = db.prepare(`SELECT count(*) AS orders, COALESCE(sum(json_extract(o.snapshot, '$.priceCents')), 0) AS cents FROM orders o WHERE ${paidWhere}`).get(...paidArgs)!;
      const refunded = db.prepare(`SELECT count(*) AS count, COALESCE(sum(r.amount_cents), 0) AS cents FROM payment_refunds r JOIN orders o ON o.id = r.order_id WHERE ${refundsWhere}`).get(...paidArgs)!;
      const created = db.prepare(`SELECT count(*) AS total, sum(CASE WHEN o.status = 'paid' AND COALESCE(c.state,'') != 'cancelled' THEN 1 ELSE 0 END) AS paid,
        sum(CASE WHEN o.status = 'pending' THEN 1 ELSE 0 END) AS pending,
        sum(CASE WHEN o.status = 'closed' THEN 1 ELSE 0 END) AS closed, sum(CASE WHEN c.state = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
        FROM orders o LEFT JOIN order_cancellations c ON c.order_id = o.id WHERE o.environment = ? AND o.created_at >= ? AND o.created_at < ?
          AND COALESCE(json_extract(o.snapshot, '$.staffCheckout'), 0) = 0`).get(...paidArgs)!;
      const pendingRefunds = db.prepare(`SELECT count(*) AS count, COALESCE(sum(r.amount_cents), 0) AS cents FROM payment_refunds r JOIN orders o ON o.id = r.order_id
        WHERE o.environment = ? AND r.status = 'pending' AND r.created_at >= ? AND r.created_at < ?`).get(...paidArgs)!;
      const byDate = db.prepare(`SELECT date(o.paid_at, '+8 hours') AS day, count(*) AS orders,
        sum(json_extract(o.snapshot, '$.priceCents')) AS cents FROM orders o WHERE ${paidWhere} GROUP BY day`).all(...paidArgs);
      const refundsByDate = db.prepare(`SELECT date(r.confirmed_at, '+8 hours') AS day, sum(r.amount_cents) AS cents
        FROM payment_refunds r JOIN orders o ON o.id = r.order_id WHERE ${refundsWhere} GROUP BY day`).all(...paidArgs);
      const paidDays = new Map(byDate.map(row => [String(row.day), row]));
      const refundDays = new Map(refundsByDate.map(row => [String(row.day), Number(row.cents)]));
      const trend = [];
      for (let date = start; date <= end; date = nextDay(date)) {
        const row = paidDays.get(date);
        const grossCents = Number(row?.cents || 0);
        const refundCents = refundDays.get(date) || 0;
        trend.push({ date, orders: Number(row?.orders || 0), grossCents, refundCents, netCents: grossCents - refundCents });
      }
      const products = db.prepare(`SELECT id, name, sum(orders) AS orders, sum(grossCents) AS grossCents,
        sum(refundCents) AS refundCents, sum(grossCents) - sum(refundCents) AS netCents
        FROM (
          SELECT json_extract(o.snapshot, '$.productId') AS id, json_extract(o.snapshot, '$.productName') AS name,
            1 AS orders, json_extract(o.snapshot, '$.priceCents') AS grossCents, 0 AS refundCents
          FROM orders o WHERE ${paidWhere}
          UNION ALL
          SELECT json_extract(o.snapshot, '$.productId'), json_extract(o.snapshot, '$.productName'),
            0, 0, r.amount_cents FROM payment_refunds r JOIN orders o ON o.id = r.order_id
          WHERE ${refundsWhere}
        ) GROUP BY id, name ORDER BY grossCents DESC, name ASC`).all(...paidArgs, ...paidArgs);
      const recent = db.prepare(`SELECT o.id, json_extract(o.snapshot, '$.productName') AS productName,
        json_extract(o.snapshot, '$.priceCents') AS amountCents, o.created_at AS createdAt, o.paid_at AS paidAt,
        COALESCE((SELECT sum(r.amount_cents) FROM payment_refunds r WHERE r.order_id = o.id AND r.status = 'success'), 0) AS refundedCents
        FROM orders o WHERE ${paidWhere} ORDER BY o.paid_at DESC, o.id DESC LIMIT 20 OFFSET ?`).all(...paidArgs, (page - 1) * 20);
      return {
        start, end, environment, page, pageSize: 20,
        grossCents: Number(receipts.cents), paidOrders: Number(receipts.orders),
        refundCents: Number(refunded.cents), refundCount: Number(refunded.count),
        netCents: Number(receipts.cents) - Number(refunded.cents),
        created: { total: Number(created.total), paid: Number(created.paid || 0), pending: Number(created.pending || 0), closed: Number(created.closed || 0), cancelled: Number(created.cancelled || 0) },
        pendingRefunds: { count: Number(pendingRefunds.count), cents: Number(pendingRefunds.cents) },
        trend, products, recent,
      };
    },
  };
}
