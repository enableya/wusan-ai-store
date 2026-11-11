import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { orderPaymentTypes, orderRefundReviewStatuses } from '../src/types/admin.ts';
import type { AdminOrderList, OrderPaymentType, OrderRefundReview } from '../src/types/admin.ts';
import { chinaDay } from './analytics.ts';
import { OrderError } from './orders.ts';
import { cancellationView } from './order-timeout-state.ts';
import { reclaimableStaffVoucher } from './staff-voucher-reclaim.ts';

const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
// New orders preserve the purchased category; old snapshots fall back to the catalog, including inactive products.
const categorySql = "COALESCE(json_extract(o.snapshot, '$.category'), p.category, 'unknown')";
const paymentTypeSql = "CASE WHEN json_extract(o.snapshot, '$.staffCheckout') = 1 THEN 'free' ELSE 'paid' END";
const statusSql = "CASE WHEN details.reclaimed_at IS NOT NULL OR c.state = 'cancelled' OR (c.cancelled_at IS NOT NULL AND c.state!='fulfilled') THEN 'cancelled' ELSE o.status END";
const joins = "FROM orders o LEFT JOIN order_cancellations c ON c.order_id = o.id LEFT JOIN order_refund_reviews review ON review.order_id=o.id LEFT JOIN order_fulfillment_details details ON details.order_id=o.id LEFT JOIN order_redemptions redemption ON redemption.order_id=o.id LEFT JOIN products p ON p.id = json_extract(o.snapshot, '$.productId')";

export function adminOrderRepository(db: DatabaseSync, environment: AdminOrderList['environment']) {
  return {
    list(params: URLSearchParams, canViewVoucherCodes = false, canReviewRefunds = false, scope: 'orders' | 'refunds' = 'orders', canReclaimVouchers = false): AdminOrderList {
      const invalid = () => new OrderError(400, 'INVALID_FILTER', '筛选条件无效，请检查订单号、状态和日期范围。');
      if ([...params.keys()].some(key => !['orderNo', 'status', 'start', 'end', 'category', 'productId', 'paymentType', 'refundReview', 'page'].includes(key) || params.getAll(key).length !== 1)) throw invalid();
      const orderNo = (params.get('orderNo') || '').trim();
      const status = params.get('status') || '';
      const paymentType = params.get('paymentType') || '';
      const refundReview = params.get('refundReview') || '';
      const category = params.get('category') || '';
      const productId = params.get('productId') || '';
      const start = params.get('start') || '';
      const end = params.get('end') || '';
      const pageText = params.get('page') || '1';
      const page = Number(pageText);
      if ((refundReview && !Object.hasOwn(orderRefundReviewStatuses, refundReview)) || (paymentType && !Object.hasOwn(orderPaymentTypes, paymentType)) || orderNo.length > 80 || (status && !['pending', 'paid', 'closed', 'cancelled'].includes(status))
        || (category && !['Plus', 'Pro', 'unknown'].includes(category)) || productId.length > 80
        || (start && (!validDay(start) || start > chinaDay())) || (end && (!validDay(end) || end > chinaDay()))
        || (start && end && start > end) || !/^[1-9]\d*$/.test(pageText) || !Number.isSafeInteger(page) || page > 100000) throw invalid();
      const where = ['o.environment = ?'];
      if (scope === 'refunds') where.push('review.order_id IS NOT NULL');
      const args: SQLInputValue[] = [environment];
      if (orderNo) { where.push("o.id LIKE ? ESCAPE '\\'"); args.push(`%${orderNo.replace(/[\\%_]/g, '\\$&')}%`); }
      if (status) { where.push(`${statusSql} = ?`); args.push(status); }
      if (paymentType) { where.push(`${paymentTypeSql} = ?`); args.push(paymentType); }
      if (refundReview) { where.push('review.status = ?'); args.push(refundReview); }
      if (category) { where.push(`${categorySql} = ?`); args.push(category); }
      if (productId) { where.push("json_extract(o.snapshot, '$.productId') = ?"); args.push(productId); }
      if (start) { where.push('o.created_at >= ?'); args.push(new Date(`${start}T00:00:00+08:00`).toISOString()); }
      if (end) { where.push('o.created_at < ?'); args.push(new Date(Date.parse(`${end}T00:00:00+08:00`) + 86400000).toISOString()); }
      const clause = where.join(' AND ');
      const summary = db.prepare(`SELECT count(*) AS total,
        COALESCE(sum((${statusSql}) = 'pending'), 0) AS pending, COALESCE(sum((${statusSql}) = 'paid'), 0) AS paid,
        COALESCE(sum((${statusSql}) = 'closed'), 0) AS closed, COALESCE(sum((${statusSql}) = 'cancelled'), 0) AS cancelled ${joins} WHERE ${clause}`).get(...args)!;
      const total = Number(summary.total);
      const pageSize = 20;
      const currentPage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
      const rows = db.prepare(`SELECT ${canViewVoucherCodes ? 'details.voucher_code' : 'NULL'} AS voucherCode, details.recharge_email AS rechargeEmail, o.id, ${statusSql} AS status, c.note AS cancellationMessage, o.created_at, o.paid_at, o.expires_at, o.trade_no,
        redemption.submitted AS rechargeSubmitted, json_extract(redemption.result, '$.state') AS rechargeState,
        json_extract(redemption.result, '$.settlement') AS rechargeSettlement, json_extract(redemption.result, '$.renewal') AS rechargeRenewal, json_extract(redemption.result, '$.reason') AS rechargeReason,
        review.status AS reviewStatus,review.requested_at,review.reviewed_at,review.reviewed_by,review.reason AS reviewReason,
        json_extract(o.snapshot, '$.productId') AS productId, json_extract(o.snapshot, '$.productName') AS productName,
        json_extract(o.snapshot, '$.priceCents') AS priceCents, json_extract(o.snapshot, '$.staffCheckout') AS staffCheckout,
        ${categorySql} AS category, ${paymentTypeSql} AS paymentType,
        COALESCE((SELECT sum(r.amount_cents) FROM payment_refunds r WHERE r.order_id = o.id AND r.status = 'success'), 0) AS refundedCents
        ${joins} WHERE ${clause} ORDER BY ${scope === 'refunds' ? 'review.requested_at' : 'o.created_at'} DESC, o.id DESC LIMIT ? OFFSET ?`).all(...args, pageSize, (currentPage - 1) * pageSize);
      const products = db.prepare(`SELECT json_extract(snapshot, '$.productId') AS id, max(json_extract(snapshot, '$.productName')) AS name
        FROM orders WHERE environment = ? GROUP BY id ORDER BY name, id`).all(environment);
      return {
        environment, canViewVoucherCodes, canReviewRefunds, updatedAt: new Date().toISOString(), page: currentPage, pageSize, total,
        counts: { pending: Number(summary.pending), paid: Number(summary.paid), closed: Number(summary.closed), cancelled: Number(summary.cancelled) },
        products: products.map(row => ({ id: String(row.id), name: String(row.name) })),
        orders: rows.map(row => ({
          voucherCode: row.voucherCode ? String(row.voucherCode) : null, rechargeEmail: row.rechargeEmail ? String(row.rechargeEmail) : null,
          id: String(row.id), productId: String(row.productId), productName: String(row.productName), category: String(row.category),
          status: row.status as 'pending' | 'paid' | 'closed' | 'cancelled', cancellationMessage: String(row.cancellationMessage || ''), priceCents: Number(row.priceCents),
          cancellation: cancellationView(db, String(row.id)),
          canReclaimVoucher: canReclaimVouchers && canViewVoucherCodes && !!reclaimableStaffVoucher(db,String(row.id),environment),
          recharge: row.status === 'paid' ? { submitted: Boolean(row.rechargeSubmitted), state: String(row.rechargeState || ''),
            settlement: String(row.rechargeSettlement || ''), renewal: String(row.rechargeRenewal || ''), ...(row.rechargeReason ? { reason: String(row.rechargeReason) } : {}) } : undefined,
          createdAt: String(row.created_at), paidAt: row.paid_at ? String(row.paid_at) : null,
          expiresAt: String(row.expires_at), tradeNo: row.trade_no ? String(row.trade_no) : null,
          staffCheckout: row.paymentType === 'free', paymentType: row.paymentType as OrderPaymentType, refundedCents: Number(row.refundedCents),
          refundReview: row.reviewStatus ? { status: row.reviewStatus as OrderRefundReview['status'], requestedAt: String(row.requested_at),
            reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null, reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null, reason: String(row.reviewReason || '') } : null,
        })),
      };
    },
  };
}
