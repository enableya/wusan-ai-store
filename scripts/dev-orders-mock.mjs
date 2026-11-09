import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createOrderMock } from '../tests/mocks/orders.ts';

const mock = createOrderMock();
const server = await createServer({
  configFile: false,
  plugins: [react(), { name: 'local-order-scenarios', configureServer(vite) {
    vite.middlewares.use(async (request, response, next) => {
      const path = new URL(request.url || '/', 'http://127.0.0.1').pathname;
      if (!path.startsWith('/api/')) return next();
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      try {
        let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 32768) throw Error('请求过大'); }
        const input = body ? JSON.parse(body) : {};
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('请求格式无效');
        const result = mock.respond(path, request.method, input);
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
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
