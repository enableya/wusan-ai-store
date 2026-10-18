import { defineConfig } from '@playwright/test';

if (!process.env.E2E_ADMIN_DB) throw new Error('E2E_ADMIN_DB must point to an isolated test database.');
const env = {
  NODE_ENV: 'test', ALIPAY_ENV: 'sandbox', ALIPAY_ENABLED: 'false',
  API_HOST: '127.0.0.1', API_PORT: '5212', DATABASE_PATH: process.env.E2E_ADMIN_DB,
  PUBLIC_SITE_URL: 'http://127.0.0.1:5210', ADMIN_ORIGIN: 'http://127.0.0.1:5210',
};
export default defineConfig({
  testDir: './tests/e2e', testMatch: 'admin.spec.ts', workers: 1, fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:5210', channel: 'chrome', headless: true },
  webServer: [
    { command: `"${process.execPath}" server/index.ts`, url: 'http://127.0.0.1:5212/api/health', reuseExistingServer: false, env },
    { command: `"${process.execPath}" node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5210 --strictPort`, url: 'http://127.0.0.1:5210', reuseExistingServer: false, env },
  ],
});
