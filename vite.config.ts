import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';

export default defineConfig(({ mode, command }) => {
  // The frontend build must not load the API's payment configuration or credentials.
  const port = command === 'serve' ? Number(process.env.API_PORT || loadEnv(mode, process.cwd(), 'API_').API_PORT || 5182) : 5182;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('API_PORT must be between 1 and 65535.');
  return {
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    fs: { deny: ['.env', '.env.*', '**/.alipay-sandbox.json', '**/alipayPublicKey_RSA2.txt', '**/*.{crt,pem,key,p12,pfx}', '**/.git/**', ...(mode === 'test' ? [] : ['**/server/**'])] },
    proxy: { '/api': { target: `http://127.0.0.1:${port}` } },
  },
  preview: { proxy: { '/api': { target: `http://127.0.0.1:${port}` } } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  };
});
