import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AlipaySdk } from 'alipay-sdk';
import type { Order, PaymentConfig } from '../src/types/orders.ts';

export type TradeResult = Record<string, string>;
export interface PaymentGateway {
  status: PaymentConfig;
  appId: string;
  sellerId: string;
  origin: string;
  paymentForm(order: Order): string;
  verifyNotification(params: Record<string, string>): boolean;
  query(order: Order): Promise<TradeResult | null>;
  close(order: Order): Promise<TradeResult>;
  refund(order: Order, amount: string, requestNo: string, reason: string): Promise<TradeResult>;
  refundQuery(order: Order, requestNo: string): Promise<TradeResult>;
}

export const sandboxConfigPath = fileURLToPath(new URL('../.alipay-sandbox.json', import.meta.url));
// The default path is anchored to this module, independently of the process working directory.
export function loadSandboxConfig(path = sandboxConfigPath) {
  if (statSync(path).mode & 0o077) throw new Error('Sandbox configuration must be readable only by its owner.');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  const app = config.appIds?.[0];
  if (!app || !['appId', 'alipayPublicKey', 'appPrivatePkcsKey', 'pid'].every(key => typeof app[key] === 'string' && app[key])) {
    throw new Error('Sandbox application configuration is incomplete.');
  }
  return { appId: app.appId as string, sellerId: app.pid as string,
    privateKey: app.appPrivatePkcsKey as string, alipayPublicKey: app.alipayPublicKey as string };
}

export function createAlipayGateway(env: NodeJS.ProcessEnv = process.env, options: { sandboxPath?: string | null } = {}): PaymentGateway {
  if (env.ALIPAY_ENV && !['sandbox', 'production'].includes(env.ALIPAY_ENV)) throw new Error('ALIPAY_ENV must be sandbox or production.');
  if (env.ALIPAY_ENABLED && !['true', 'false'].includes(env.ALIPAY_ENABLED)) throw new Error('ALIPAY_ENABLED must be true or false.');
  if (env.NODE_ENV === 'production' && env.ALIPAY_ENV !== 'production') throw new Error('Production runtime requires ALIPAY_ENV=production.');
  const environment = env.ALIPAY_ENV === 'production' ? 'production' : 'sandbox';
  const enabled = env.ALIPAY_ENABLED === 'true';
  const sandbox = enabled && environment === 'sandbox' && options.sandboxPath !== null
    ? loadSandboxConfig(options.sandboxPath) : null;
  const appId = sandbox?.appId || env.ALIPAY_APP_ID?.trim() || '';
  const sellerId = sandbox?.sellerId || env.ALIPAY_SELLER_ID?.trim() || '';
  let origin = '';
  if (env.PUBLIC_SITE_URL) {
    const site = new URL(env.PUBLIC_SITE_URL);
    if (site.protocol !== 'https:' && !(environment === 'sandbox' && site.protocol === 'http:')) {
      throw new Error('PUBLIC_SITE_URL must use HTTPS (HTTP is allowed only in sandbox).');
    }
    if (site.username || site.password || site.pathname !== '/' || site.search || site.hash) throw new Error('PUBLIC_SITE_URL must be an origin.');
    origin = site.origin;
  }
  let sdk: AlipaySdk | undefined;
  let notifyUrl = '';
  if (enabled) {
    if (!/^\d{16}$/.test(appId) || !/^2088\d{12}$/.test(sellerId) || !origin) throw new Error('Complete Alipay app, seller and site configuration is required.');
    const privateKey = sandbox?.privateKey || (env.ALIPAY_PRIVATE_KEY_PATH ? readFileSync(env.ALIPAY_PRIVATE_KEY_PATH, 'utf8') : env.ALIPAY_PRIVATE_KEY || '');
    const publicKey = sandbox?.alipayPublicKey || (env.ALIPAY_PUBLIC_KEY_PATH ? readFileSync(env.ALIPAY_PUBLIC_KEY_PATH, 'utf8') : env.ALIPAY_PUBLIC_KEY || '');
    // Pass the original raw PKCS#1/public-key strings to the SDK. Never convert or rewrap them.
    if (!/^[A-Za-z0-9+/=]+$/.test(privateKey) || !/^[A-Za-z0-9+/=]+$/.test(publicKey)) throw new Error('Alipay requires raw PKCS#1 private key and raw public key strings.');
    if (env.ALIPAY_NOTIFY_URL) {
      const notify = new URL(env.ALIPAY_NOTIFY_URL);
      if (notify.protocol !== 'https:' || notify.username || notify.password || notify.hash) throw new Error('ALIPAY_NOTIFY_URL must be a public HTTPS notification endpoint.');
      notifyUrl = notify.href;
    }
    if (environment === 'production' && !notifyUrl) throw new Error('Production requires ALIPAY_NOTIFY_URL.');
    sdk = new AlipaySdk({ appId, privateKey, alipayPublicKey: publicKey, keyType: 'PKCS1',
      signType: 'RSA2', camelcase: false, timeout: 7000,
      gateway: environment === 'production' ? 'https://openapi.alipay.com/gateway.do' : 'https://openapi-sandbox.dl.alipaydev.com/gateway.do' });
  }
  async function execute(method: string, bizContent: Record<string, string>) {
    if (!sdk) throw new Error('Alipay is not configured.');
    try {
      return await sdk.exec(method, { bizContent }, { validateSign: true }) as TradeResult;
    } catch { throw new Error('Alipay request failed; reconcile the original request before retrying.'); }
  }
  function accepted(result: TradeResult) {
    if (result.code !== '10000') throw new Error('Alipay did not confirm the request; query before retrying.');
    return result;
  }
  return {
    appId, sellerId, origin,
    status: { enabled, environment, message: enabled
      ? environment === 'sandbox' ? '支付宝沙箱测试，不会产生真实扣款。' : '支付宝安全支付，付款结果由服务端核实。'
      : environment === 'production' ? '支付宝正式收款尚未启用，暂不能创建订单或付款。' : '支付宝沙箱尚未启用，暂不能创建订单或付款。' },
    paymentForm(order) {
      if (!sdk) throw new Error('Alipay is not configured.');
      const timeExpire = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(order.expiresAt));
      return sdk.pageExec('alipay.trade.page.pay', 'POST', {
        ...(notifyUrl ? { notifyUrl } : {}), returnUrl: `${origin}/pay/${order.id}`,
        bizContent: { out_trade_no: order.id, total_amount: (order.priceCents / 100).toFixed(2),
          subject: `${order.productName} · ${order.periodMonths} 个月`, product_code: 'FAST_INSTANT_TRADE_PAY',
          seller_id: sellerId, time_expire: timeExpire },
      });
    },
    verifyNotification(params) {
      try { return !!sdk && params.app_id === appId && params.sign_type === 'RSA2' && sdk.checkNotifySignV2(params); }
      catch { return false; }
    },
    async query(order) {
      const result = await execute('alipay.trade.query', { out_trade_no: order.id });
      if (result.code === '40004' && result.sub_code === 'ACQ.TRADE_NOT_EXIST') return null;
      return accepted(result);
    },
    async close(order) { return accepted(await execute('alipay.trade.close', { out_trade_no: order.id })); },
    async refund(order, amount, requestNo, reason) { return accepted(await execute('alipay.trade.refund', {
      out_trade_no: order.id, refund_amount: amount, out_request_no: requestNo, refund_reason: reason,
    })); },
    async refundQuery(order, requestNo) { return accepted(await execute('alipay.trade.fastpay.refund.query', {
      out_trade_no: order.id, out_request_no: requestNo,
    })); },
  };
}
