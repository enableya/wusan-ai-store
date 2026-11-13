import type { ReferralReason } from '../src/types/referrals.ts';

export const referralReasonMessages: Record<ReferralReason, string> = {
  earned: '有效付款已确认，返利已计入商城余额；提现打款进度请查看提现记录。',
  awaiting_payment: '订单尚未付款，好友完成有效付款后，返利会自动计入商城余额。',
  same_device: '根据浏览器标识及账号使用记录，识别为同设备邀请，不计返利。',
  self_invite: '邀请人与下单账号相同，属于本人邀请，不计返利。',
  product_excluded: 'Codex 接码不参与邀请返利，本笔订单不计返利。',
  invitation_expired: '此历史记录按当时的邀请有效期规则判定未入账；目前已取消邀请有效期限制。',
  payment_expired: '订单已超过支付有效期，尚未完成付款，不计返利。',
  order_closed: '订单已关闭，未完成有效付款，不计返利。',
  full_refund: '订单已全额退款，原返利已失效，不计入可提现余额。',
  ineligible: '本笔返利已失效，暂不计入余额。如有疑问，请提供订单号联系客服核实。',
};

// Only trusted server SQL identifiers may be passed here.
export function referralReasonSql(record: string) {
  return `CASE WHEN ${record}.blocked_reason IS NOT NULL THEN ${record}.blocked_reason
    WHEN (SELECT coalesce(sum(amount_cents),0) FROM payment_refunds WHERE order_id=${record}.order_id AND status='success') >=
      (SELECT json_extract(snapshot,'$.priceCents') FROM orders WHERE id=${record}.order_id) THEN 'full_refund'
    WHEN ${record}.status='earned' THEN 'earned'
    WHEN (SELECT status FROM orders WHERE id=${record}.order_id)='closed' THEN 'order_closed'
    WHEN ${record}.status='pending' AND (SELECT expires_at FROM orders WHERE id=${record}.order_id)<=strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 'payment_expired'
    WHEN ${record}.status='pending' THEN 'awaiting_payment' ELSE 'ineligible' END`;
}
