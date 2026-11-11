import { createOrderScenarios } from '../fixtures/orders.ts';

export function createOrderMock() {
  const scenarios = createOrderScenarios();
  const state = { orders: scenarios.map(item => item.order), staff: true, failList: false, failCancellation: false, cancellationWrites: 0 };
  function respond(path: string, method = 'GET', input: Record<string, unknown> = {}) {
    const ok = (data: unknown) => ({ status: 200, body: { data } });
    const fail = (status: number, message: string) => ({ status, body: { error: { message, code: 'ORDER_MOCK' } } });
    if (path === '/api/orders' && method === 'GET') return state.failList
      ? fail(503, '模拟：订单服务暂不可用，请重试。') : ok(state.orders);
    if (path === '/api/customer/session' && method === 'GET') return ok(state.staff
      ? { id: 'mock-customer', username: 'mock-orders', inviteCode: 'mock', staffCheckout: true } : null);
    if (path === '/api/referrals/invitation' && method === 'GET') return ok(null);
    if (path === '/api/payments/config' && method === 'GET') return ok({ enabled: false, environment: 'sandbox', message: '本地模拟订单，支付与充值均关闭。' });
    const match = /^\/api\/orders\/(WS[0-9a-f]{20,60})(?:\/(cancel|refresh|redemption|card))?$/.exec(path);
    if (!match) return fail(404, '此入口仅用于本地订单场景预览。');
    const order = state.orders.find(order => order.id === match[1]);
    if (!order || (order.staffCheckout && !state.staff)) return fail(404, '模拟订单不存在或无权访问。');
    const action = match[2];
    if (method === 'GET' && !action) return ok(order);
    if (method === 'POST' && action === 'card') {
      if (order.deliveryType !== 'voucher' || order.status !== 'paid' || order.cancellation) return fail(409, '模拟订单尚未付款或不支持卡密交付。');
      order.cardDelivery = {delivered:true};
      return ok({delivered:true,code:'MOCK-PLUS-ACCOUNT-88-TEST-ONLY',deliveredAt:order.paidAt,
        usageInstructions:'1. 复制上方卡密，并按商家提供的兑换指引使用。\n2. 请妥善保管卡密与账号信息，不要公开分享。\n3. 如遇使用问题，请提供订单号联系客服。\n（以上为 Mock 使用说明，仅供页面预览。）'});
    }
    if (method === 'GET' && action === 'redemption') return ok({ enabled: false,
      submitted: order.recharge?.submitted ?? false, account: null, rechargeEmail: order.fulfillment?.rechargeEmail ?? null,
      result: order.recharge?.submitted ? { ...order.recharge, orderNo: 'MOCK-RECHARGE', progress: order.fulfillment ? 100 : 0 } : null,
      cancellation: order.cancellation });
    if (method === 'POST' && action === 'refresh') return ok(order);
    if (method !== 'POST' || action !== 'cancel') return fail(405, '模拟环境不支持真实付款或充值。');
    if (order.cancellation) return ok(order);
    if (!order.cancelAction || order.staffCheckout) return fail(409, '该订单不符合取消条件。');
    if (input.expectedAction !== order.cancelAction) return fail(409, '订单状态已变更，请重新确认。');
    if (state.failCancellation) return fail(502, '模拟：支付查询超时，尚未确认取消。');
    const paid = order.cancelAction === 'request_refund';
    order.status = 'cancelled'; order.cancelAction = null; delete order.recharge;
    order.cancellation = { state: paid ? 'refund_review' : 'cancelled', cancelledAt: new Date().toISOString(),
      message: paid ? '模拟：订单已取消，退款待后台审核；款项尚未退回。' : '模拟：未付款订单已取消，无需退款。' };
    state.cancellationWrites++;
    return ok(order);
  }
  return { scenarios, state, respond };
}
