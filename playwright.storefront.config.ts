import { defineConfig } from '@playwright/test';
import base from './playwright.config';

if (!process.env.E2E_DATABASE_PATH) throw new Error('E2E_DATABASE_PATH must point to an isolated database.');
const env = {
  NODE_ENV: 'test', ALIPAY_ENV: 'sandbox', ALIPAY_ENABLED: 'false',
  API_HOST: '127.0.0.1', API_PORT: '5222', DATABASE_PATH: process.env.E2E_DATABASE_PATH,
  PUBLIC_SITE_URL: 'http://127.0.0.1:5220', ADMIN_ORIGIN: 'http://127.0.0.1:5220',
};
export default defineConfig({
  ...base, workers: 4, testMatch: 'store.spec.ts',
  use: { ...base.use, baseURL: 'http://127.0.0.1:5220', channel: 'chrome' },
  webServer: [
    { command: `"${process.execPath}" server/index.ts`, url: 'http://127.0.0.1:5222/api/health', reuseExistingServer: false, env },
    { command: `"${process.execPath}" node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5220 --strictPort`, url: 'http://127.0.0.1:5220', reuseExistingServer: false, env },
  ],
});
