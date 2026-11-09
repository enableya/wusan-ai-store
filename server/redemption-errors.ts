import { OrderError } from './orders.ts';

const known: Record<string, [number, string]> = {
  SESSION_REQUIRED: [400, '未提供登录信息，请粘贴完整的 ChatGPT Session JSON。'],
  SESSION_INVALID: [400, '充值服务未通过 Session 校验，请重新登录 ChatGPT 并获取最新登录信息。'],
  SESSION_EXPIRED: [400, 'ChatGPT Session 已过期，请重新登录 ChatGPT 后获取最新登录信息。'],
  SESSION_PLAN_UNCONFIRMED: [409, '充值服务无法确认账号当前的订阅状态，请重新获取 Session 后验证；仍失败请联系客服。'],
  PORTAL_SESSION_INVALID: [400, '充值通道未通过 Session 校验，请重新登录 ChatGPT 并获取最新登录信息。'],
  PORTAL_PRECHECK_FAILED: [409, '充值通道的账号预检未通过，请重新获取 Session 后验证；仍失败请联系客服。'],
  PORTAL_PRECHECK_EXPIRED: [409, '账号预检结果已过期，请重新验证账号后再提交。'],
  REDEMPTION_EXPIRED: [409, '本次账号确认会话已过期，请重新验证账号。'],
  REDEMPTION_NOT_FOUND: [409, '本次账号确认会话已失效，请重新验证账号。'],
  REDEMPTION_STATE_INVALID: [409, '账号确认会话状态已变化，请刷新订单后重新核对。'],
  VOUCHER_NOT_FOUND: [409, '当前订单分配的卡密不存在，请联系客服处理。'],
  VOUCHER_USED: [409, '当前订单分配的卡密已被使用，请联系客服核实。'],
  VOUCHER_DISABLED: [409, '当前订单分配的卡密已停用，请联系客服处理。'],
  VOUCHER_IN_USE: [409, '当前订单分配的卡密正在处理中，请稍后查询订单进度。'],
  PRODUCT_UNAVAILABLE: [409, '充值服务暂不支持该套餐，请联系客服处理。'],
};
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

// Business explanations may be shown; request credentials and raw upstream bodies must not be echoed.
function readableDetail(value: unknown, secrets: string[]) {
  const detail = text(value);
  if (!detail || detail.length > 300 || /[{}<>\[\]\r\n]|https?:\/\/|bearer\s|access[_-]?token|redemption[_-]?token|claim[_-]?token|sessionInput|voucherCode|eyJ[\w-]+\.|[A-Za-z0-9_-]{40,}/i.test(detail)
    || secrets.some(secret => secret.length > 2 && detail.includes(secret))) return '';
  return detail;
}
export function redemptionUpstreamError(body: Record<string, unknown>, status: number, sessionCheck: boolean, secrets: string[] = []) {
  const nested = body.error && typeof body.error === 'object' ? body.error as Record<string, unknown> : {};
  const rawCode = text(body.error) || text(body.code) || text(nested.code);
  const code = /^[A-Z][A-Z0-9_]{0,79}$/.test(rawCode) ? rawCode : '';
  const detail = readableDetail(body.detail || body.message || nested.message, secrets);
  // Only an explicit Session expiry response can classify an upstream precheck as expired.
  if (sessionCheck && detail && /(?:session|access token)\s*(?:(?:has|is)\s+)?(?:expired|已过期)|登录(?:信息|状态|态)已过期/i.test(detail)) {
    return new OrderError(400, 'SESSION_EXPIRED', known.SESSION_EXPIRED[1]);
  }
  if (known[code]) {
    const [http, message] = known[code];
    return new OrderError(http, code, code === 'PORTAL_PRECHECK_FAILED' && detail ? `账号预检未通过：${detail}` : message);
  }
  if (status === 429) return new OrderError(429, 'REDEMPTION_RATE_LIMITED', '充值服务请求较多，请稍后再试。');
  if (status === 410) return new OrderError(409, 'REDEMPTION_EXPIRED', known.REDEMPTION_EXPIRED[1]);
  if (status >= 500) return new OrderError(502, 'REDEMPTION_UNAVAILABLE', '充值服务暂时不可用，请稍后重试；当前无法确定是否为 Session 问题。');
  return new OrderError(502, 'REDEMPTION_REJECTED', detail ? `充值服务未通过本次请求：${detail}` : '充值服务未返回可识别的失败原因，请稍后重试或联系客服。');
}
