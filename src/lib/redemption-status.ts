import type { Order } from '../types/orders';
import type { RedemptionResult } from '../types/redemption';

type ResultTag = { label: string; tone: 'progress' | 'success' | 'attention' | 'failure' };

const resultTags: Record<string, ResultTag> = {
  SESSION_REQUIRED: { label: '等待账号信息', tone: 'attention' },
  QUEUED: { label: '已受理，排队中', tone: 'progress' },
  FULFILLING: { label: '处理中', tone: 'progress' },
  RECONCILE_ONLY: { label: '正在核对充值结果', tone: 'progress' },
  MANUAL_REVIEW: { label: '待人工确认', tone: 'attention' },
  FULFILLED: { label: '办理完成，等待结算确认', tone: 'progress' },
  CANCELED: { label: '办理已取消，结算状态待确认', tone: 'attention' },
};

export function resultTag(result: Pick<RedemptionResult, 'state' | 'settlement' | 'renewal'> | null): ResultTag {
  if (result?.settlement === 'PAID' || result?.renewal === 'paid') return { label: '充值成功', tone: 'success' };
  if (result?.settlement === 'NO_CHARGE' || result?.state === 'NO_CHARGE') return { label: '充值未完成，本次未扣款', tone: 'failure' };
  if (result?.renewal === 'ready') return { label: '续费已设置，等待下个周期扣款', tone: 'progress' };
  if (result?.renewal === 'attention') return { label: '续费设置需要处理，请联系客服', tone: 'attention' };
  return resultTags[result?.state ?? ''] ?? { label: '正在等待兑换结果', tone: 'progress' };
}


export function orderRechargeTag(order: Pick<Order, 'status' | 'cancellation' | 'fulfillment' | 'recharge'>): { label: string; tone: ResultTag['tone'] | 'neutral' } {
  if (order.status === 'cancelled' || order.cancellation?.cancelledAt) return { label: '已停止', tone: 'neutral' };
  if (order.cancellation) return { label: '取消核实中', tone: 'attention' };
  if (order.status !== 'paid') return { label: '未开始', tone: 'neutral' };
  if (order.fulfillment?.status === 'succeeded') return { label: '充值成功', tone: 'success' };
  const recharge = order.recharge;
  if (!recharge) return { label: '状态待查询', tone: 'attention' };
  if (!recharge.submitted && !recharge.state && !recharge.settlement && !recharge.renewal) return { label: '待充值', tone: 'neutral' };
  return resultTag(recharge);
}
