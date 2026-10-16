import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { catalogRepository } from './database.ts';

export function createApiServer(db: DatabaseSync) {
  const catalog = catalogRepository(db);
  const server = createServer((request, response) => {
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
      // Only public catalog reads are exposed; no unauthenticated mutation endpoints.
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
      if (error instanceof URIError) return fail(400, 'INVALID_PATH', '请求路径无效。');
      console.error(`[${requestId}] API request failed`, error);
      return fail(503, 'SERVICE_UNAVAILABLE', '服务暂不可用，请稍后重试。');
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 50;
  return server;
}
