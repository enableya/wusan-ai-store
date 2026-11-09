import type { Order } from '../../src/types/orders.ts';

type Scenario = { key: string; label: string; tone: string; order: Order };
export function createOrderScenarios(now = Date.now()): Scenario[] {
  const base: Order = {
    id: '', productId: 'chatgpt-plus', productName: 'ChatGPT Plus', priceCents: 13000, periodMonths: 1,
    status: 'paid', environment: 'sandbox', createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 30 * 60000).toISOString(), paidAt: new Date(now).toISOString(), tradeNo: null,
    cancelAction: null, recharge: { submitted: false, state: '', settlement: '', renewal: '' },
    details: { entitlements: null, deliveryMethod: null, deliveryTime: null, accountRequirements: null, afterSales: null },
  };
  const scenarios: Scenario[] = [];
  function add(key: string, label: string, tone: string, overrides: Partial<Order> = {}) {
    scenarios.push({ key, label, tone, order: { ...structuredClone(base), ...overrides,
      id: 'WS1234567890123' + (scenarios.length + 1).toString(16).padStart(16, '0') } });
  }
  function recharge(key: string, label: string, tone: string, state: string, settlement = 'UNKNOWN', renewal = '', overrides: Partial<Order> = {}) {
    add(key, label, tone, { recharge: { submitted: true, state, settlement, renewal }, ...overrides });
  }
  add('pending', '未开始', 'neutral', { status: 'pending', paidAt: null, recharge: undefined, cancelAction: 'cancel' });
  add('closed', '未开始', 'neutral', { status: 'closed', paidAt: null, recharge: undefined });
  add('awaiting_recharge', '待充值', 'neutral', { cancelAction: 'request_refund' });
  add('validating', '待充值', 'neutral');
  recharge('queued', '已受理，排队中', 'progress', 'QUEUED');
  recharge('processing', '处理中', 'progress', 'FULFILLING');
  recharge('settling', '办理完成，等待结算确认', 'progress', 'FULFILLED');
  recharge('success', '充值成功', 'success', 'FULFILLED', 'PAID', '', {
    fulfillment: { status: 'succeeded', rechargeEmail: 'mock-success@example.invalid' },
  });
  recharge('success_missing_email', '充值成功', 'success', 'FULFILLED', 'PAID', '', {
    fulfillment: { status: 'succeeded', rechargeEmail: null },
  });
  recharge('no_charge', '充值未完成，本次未扣款', 'failure', 'NO_CHARGE', 'NO_CHARGE');
  recharge('upstream_cancelled_uncertain', '办理已取消，结算状态待确认', 'attention', 'CANCELED');
  recharge('reconciling', '正在核对充值结果', 'progress', 'RECONCILE_ONLY');
  recharge('manual_review', '待人工确认', 'attention', 'MANUAL_REVIEW');
  recharge('renewal_ready', '续费已设置，等待下个周期扣款', 'progress', '', 'UNKNOWN', 'ready');
  recharge('renewal_attention', '续费设置需要处理，请联系客服', 'attention', '', 'UNKNOWN', 'attention');
  recharge('renewal_paid', '充值成功', 'success', '', 'PAID', 'paid', {
    fulfillment: { status: 'succeeded', rechargeEmail: 'long-recharge-account-address-for-layout-check@example.invalid' },
  });
  recharge('unknown', '正在等待兑换结果', 'progress', 'FUTURE_PROVIDER_STATE');
  add('legacy_unknown', '状态待查询', 'attention', { recharge: undefined });
  add('staff_awaiting', '待充值', 'neutral', { staffCheckout: true, priceCents: 0, paidAt: null });
  recharge('staff_success', '充值成功', 'success', 'FULFILLED', 'PAID', '', {
    staffCheckout: true, priceCents: 0, paidAt: null,
    fulfillment: { status: 'succeeded', rechargeEmail: 'mock-staff@example.invalid' },
  });
  add('cancellation_checking', '取消核实中', 'attention', {
    cancellation: { state: 'checking', message: '模拟：取消申请核实中，未确认前不退款。', cancelledAt: null },
  });
  for (const [key, state, message] of [
    ['refund_review', 'refund_review', '模拟：订单已取消，退款待后台审核；款项尚未退回。'],
    ['refund_rejected', 'refund_rejected', '模拟：退款审核未通过，请联系客服。'],
    ['refund_pending', 'refund_pending', '模拟：原路退款结果确认中，请勿重复申请。'],
    ['refunded', 'cancelled', '模拟：已原路退款，订单已取消。'],
  ] as const) add(key, '已停止', 'neutral', { status: 'cancelled', recharge: undefined,
    cancellation: { state, message, cancelledAt: new Date(now).toISOString() } });
  add('cancelled_unpaid', '已停止', 'neutral', { status: 'cancelled', paidAt: null, recharge: undefined,
    cancellation: { state: 'cancelled', message: '模拟：未付款订单已取消，无需退款。', cancelledAt: new Date(now).toISOString() } });
  add('verification_disabled', '未开始', 'neutral', { status: 'pending', paidAt: null, recharge: undefined,
    cancelUnavailableReason: '暂无法核实支付状态，当前不能取消订单。' });
  return scenarios;
}
