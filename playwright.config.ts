import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:5180',
    headless: true,
    ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {}),
  },
  webServer: [
    {
      command: `"${process.execPath}" server/index.ts`,
      url: 'http://127.0.0.1:5182/api/health',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `"${process.execPath}" node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5180 --strictPort`,
      url: 'http://127.0.0.1:5180',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
