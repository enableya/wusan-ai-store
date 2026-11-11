import type { RedemptionResult } from '../types/redemption.ts';

export function redemptionProgress(result: RedemptionResult | null) {
  if (result?.settlement === 'PAID' || result?.renewal === 'paid') return {
    stage: 4, title: '结果确认完成', detail: '充值通道已确认充值成功。',
  };
  if (result?.settlement === 'NO_CHARGE' || result?.state === 'NO_CHARGE') return {
    stage: 2, title: '充值未完成', detail: result.reason || '充值通道已确认本次未扣款，请查看处理原因。',
  };
  if (result?.renewal === 'ready') return {
    stage: 2, title: '续费设置已确认', detail: '续费已设置，等待下个周期扣款；本期尚未确认充值扣款。',
  };
  if (result?.renewal === 'attention') return {
    stage: 2, title: '续费设置需要处理', detail: result.reason || '续费设置需要人工核实，请联系支持。',
  };
  if (result?.state === 'FULFILLED' || result?.state === 'RECONCILE_ONLY') return {
    stage: 2, title: '正在确认充值结果', detail: result.processMessage || '充值处理已结束，正在核实通道回执与结算结果，确认前不会显示充值成功。',
  };
  if (result?.state === 'MANUAL_REVIEW') return {
    stage: 2, title: '等待人工确认', detail: result.processMessage || result.reason || '充值结果需要人工核实，请保留订单并等待确认。',
  };
  if (result?.state === 'CANCELED') return {
    stage: 2, title: '办理已停止，待确认结果', detail: result.reason || '通道已结束本次办理，结算结果尚未确认，请查询原单。',
  };
  if (result?.state === 'FULFILLING') return {
    stage: 1, title: '正在充值处理', detail: result.processMessage || '充值通道正在处理账号充值，处理完成后还需确认最终结果。',
  };
  if (result?.state === 'QUEUED') return {
    stage: 0, title: '已受理，等待处理', detail: result.processMessage || '充值请求已进入通道队列，等待开始处理。',
  };
  return {stage: -1, title: '正在等待通道结果', detail: result?.processMessage || '请求结果尚未确认，系统将继续查询原单。'};
}
