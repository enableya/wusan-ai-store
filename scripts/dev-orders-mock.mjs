import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createOrderMock } from '../tests/mocks/orders.ts';
import { products } from '../server/seed/catalog.ts';

const mock = createOrderMock();
const product = products.find(item => item.id === 'chatgpt-plus-account');
mock.state.orders.unshift({
  id:'WS12345678901230000000000000088', productId:product.id, productName:product.name,
  priceCents:8800, periodMonths:1, details:product.details, deliveryType:'voucher',cardDelivery:{delivered:true},
  status:'paid',environment:'sandbox',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+1800000).toISOString(),
  paidAt:new Date().toISOString(),tradeNo:null,cancelAction:null,
});
const server = await createServer({
  configFile: false,
  plugins: [react(), { name: 'local-order-scenarios', configureServer(vite) {
    vite.middlewares.use(async (request, response, next) => {
      const path = new URL(request.url || '/', 'http://127.0.0.1').pathname;
      if (path === '/mock/card-delivery') {
        const html = await vite.transformIndexHtml(path, '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>获取卡密 · 本地 Mock</title></head><body><div id="root"></div><script type="module" src="/src/dev/CardDeliveryPreview.tsx"></script></body></html>');
        response.setHeader('Content-Type','text/html; charset=utf-8');response.end(html);return;
      }
      if (!path.startsWith('/api/')) return next();
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      try {
        let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 32768) throw Error('请求过大'); }
        const input = body ? JSON.parse(body) : {};
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('请求格式无效');
        const result = request.method === 'GET' && path === '/api/products/chatgpt-plus-account'
          ? {status:200,body:{data:product}} : mock.respond(path, request.method, input);
        response.statusCode = result.status; response.end(JSON.stringify(result.body));
      } catch {
        response.statusCode = 400; response.end(JSON.stringify({ error: { message: '模拟请求无效。' } }));
      }
    });
  } }],
  server: { host: '127.0.0.1', port: 5230, strictPort: true,
    fs: { deny: ['.env', '.env.*', '**/.git/**', '**/server/**', '**/tests/**', '**/scripts/**', '**/*.{crt,pem,key,p12,pfx}', '**/.alipay-sandbox.json', '**/alipayPublicKey_RSA2.txt'] } },
});
await server.listen();
console.log(`本地模拟订单：${mock.state.orders.length} 条，仅保存在内存，付款与充值关闭。`);
console.log('预览地址：http://127.0.0.1:5230/orders（重启恢复全部场景）');
console.log('获取卡密步骤：http://127.0.0.1:5230/mock/card-delivery（自动打开已付款弹窗）');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
