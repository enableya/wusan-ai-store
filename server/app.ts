import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { catalogRepository } from './database.ts';
import { createAlipayGateway } from './alipay.ts';
import type { PaymentGateway } from './alipay.ts';
import { browserOwner, orderRepository, OrderError } from './orders.ts';
import { readBody, readJson } from './http.ts';
import { adminRepository } from './admin.ts';
import { analyticsRepository } from './analytics.ts';

export function createApiServer(db: DatabaseSync, gateway: PaymentGateway = createAlipayGateway(), options: { adminOrigin?: string } = {}) {
  const catalog = catalogRepository(db);
  const orders = orderRepository(db, gateway);
  const admin = adminRepository(db, options.adminOrigin ?? process.env.ADMIN_ORIGIN ?? gateway.origin);
  const analytics = analyticsRepository(db, gateway.status.environment, admin.origin.startsWith('https:'));
  const limits = new Map<string, { count: number; expires: number }>();
  function rateLimit(key: string, max: number) {
    const now = Date.now();
    if (limits.size >= 10000) for (const [id, value] of limits) if (value.expires <= now) limits.delete(id);
    const value = limits.get(key);
    if (value && value.expires > now) {
      if (++value.count > max) throw new OrderError(429, 'TOO_MANY_REQUESTS', '操作过于频繁，请一分钟后重试。');
    } else {
      if (limits.size >= 10000) throw new OrderError(429, 'TOO_MANY_REQUESTS', '请求过多，请稍后重试。');
      limits.set(key, { count: 1, expires: now + 60000 });
    }
  }
  const server = createServer(async (request, response) => {
    const requestId = randomUUID();
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Request-Id', requestId);
    const send = (status: number, body: unknown) => {
      response.writeHead(status);
      response.end(JSON.stringify(body));
    };
    const fail = (status: number, code: string, message: string) => send(status, { error: { code, message, requestId } });
    try {
      const url = new URL(request.url || '/', 'http://localhost');
      if (!url.pathname.startsWith('/api/')) return fail(404, 'NOT_FOUND', '接口不存在。');
      const reading = request.method === 'GET' || request.method === 'HEAD';
      const owner = () => browserOwner(request, response, gateway);
      if (url.pathname === '/api/analytics/product-click' && request.method === 'POST') {
        rateLimit('analytics', 600);
        const input = await readJson(request, admin.origin);
        return send(200, { data: analytics.record(request, response, input, !!admin.current(request) || /bot|spider|crawler/i.test(request.headers['user-agent'] || '')) });
      }
      if (url.pathname.startsWith('/api/admin/')) {
        if (url.pathname === '/api/admin/session' && reading) return send(200, { data: admin.session(request) });
        if (request.method === 'POST' && ['/api/admin/login', '/api/admin/logout'].includes(url.pathname)) {
          rateLimit('admin-login', 12);
          const input = await readJson(request, admin.origin);
          if (request.headers.origin !== (admin.origin || `http://${request.headers.host}`)) return fail(403, 'INVALID_ORIGIN', '请从本站管理页面操作。');
          return send(200, { data: url.pathname.endsWith('/login') ? await admin.login(request, response, input) : admin.logout(request, response) });
        }
        admin.require(request);
        if (url.pathname === '/api/admin/analytics/products' && reading) return send(200, { data: analytics.report(url.searchParams) });
        return fail(404, 'NOT_FOUND', '后台接口不存在。');
      }
      if (url.pathname === '/api/payments/alipay/notify' && request.method === 'POST') {
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        try {
          if (request.headers['content-type']?.split(';')[0].trim() !== 'application/x-www-form-urlencoded') throw new Error();
          const form = new URLSearchParams(await readBody(request));
          if ([...form.keys()].some(key => form.getAll(key).length !== 1)) throw new Error();
          orders.notify(Object.fromEntries(form));
          response.writeHead(200); response.end('success');
        } catch {
          console.warn('Alipay notification rejected; signature or business validation failed.');
          response.writeHead(400); response.end('fail');
        }
        return;
      }
      if (url.pathname === '/api/payments/config' && reading) {
        browserOwner(request, response, gateway, true);
        return send(200, { data: gateway.status });
      }
      if (url.pathname === '/api/orders') {
        if (reading) return send(200, { data: orders.list(owner()) });
        if (request.method === 'POST') {
          rateLimit(`create:${request.socket.remoteAddress}`, 20);
          const input = await readJson(request, gateway.origin);
          const key = request.headers['idempotency-key'];
          if (typeof key !== 'string') return fail(400, 'IDEMPOTENCY_KEY_REQUIRED', '缺少订单提交编号，请刷新后重试。');
          const browser = browserOwner(request, response, gateway, true)!;
          return send(201, { data: orders.create(browser, input, key) });
        }
      }
      const match = url.pathname.match(/^\/api\/orders\/(WS[0-9a-f]{20,60})(?:\/(payment|refresh|close))?$/);
      if (match) {
        const [, id, action] = match;
        if (!action && reading) return send(200, { data: orders.owned(id, owner()) });
        if (action && request.method === 'POST') {
          await readJson(request, gateway.origin);
          const browser = owner();
          orders.owned(id, browser);
          rateLimit(`${action}:${browser}`, action === 'refresh' ? 30 : 20);
          if (action === 'payment') return send(200, { data: orders.payment(id, browser) });
          try { return send(200, { data: action === 'close' ? await orders.close(id, browser) : await orders.refresh(id, browser) }); }
          catch (error) {
            if (error instanceof OrderError) throw error;
            return fail(502, 'PAYMENT_QUERY_FAILED', '暂时无法核实支付宝交易，请稍后查询，勿重复付款。');
          }
        }
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.setHeader('Allow', 'GET, HEAD');
        return fail(405, 'METHOD_NOT_ALLOWED', '该接口只支持读取。');
      }
      if (url.pathname === '/api/health') {
        db.prepare('SELECT 1').get();
        return send(200, { data: { status: 'ok' } });
      }
      if (url.pathname === '/api/home') {
        return send(200, { data: { ...catalog.home(), products: catalog.listProducts(), faqs: catalog.faqs() } });
      }
      if (url.pathname === '/api/products') {
        const category = url.searchParams.get('category') || undefined;
        if (category && !['Plus', 'Pro'].includes(category)) return fail(400, 'INVALID_CATEGORY', '套餐分类无效。');
        if ([...url.searchParams.keys()].some((key) => key !== 'category') || url.searchParams.getAll('category').length > 1) {
          return fail(400, 'INVALID_QUERY', '请求参数无效。');
        }
        return send(200, { data: catalog.listProducts(category) });
      }
      if (url.pathname.startsWith('/api/products/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/products/'.length));
        if (!/^[a-z0-9-]{1,80}$/.test(id)) return fail(400, 'INVALID_PRODUCT_ID', '商品编号无效。');
        const product = catalog.findProduct(id);
        return product ? send(200, { data: product }) : fail(404, 'PRODUCT_NOT_FOUND', '套餐不存在或已下架。');
      }
      if (url.pathname === '/api/content') {
        return send(200, { data: { faqs: catalog.faqs(), articles: catalog.articles() } });
      }
      return fail(404, 'NOT_FOUND', '接口不存在。');
    } catch (error) {
      if (error instanceof OrderError) return fail(error.status, error.code, error.message);
      if (error instanceof URIError) return fail(400, 'INVALID_PATH', '请求路径无效。');
      console.error(`[${requestId}] API request failed`);
      return fail(503, 'SERVICE_UNAVAILABLE', '服务暂不可用，请稍后重试。');
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 50;
  return server;
}
