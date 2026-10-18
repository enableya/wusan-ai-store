import { expect, test } from '@playwright/test';
import { openDatabase } from '../../server/database';
import { hashAdminPassword } from '../../server/admin';

test.beforeAll(async () => {
  const db = openDatabase(process.env.E2E_ADMIN_DB!);
  db.prepare('INSERT OR IGNORE INTO admin_accounts VALUES (?,?,?)').run('admin', await hashAdminPassword('isolated-e2e-admin-password'), new Date().toISOString());
  db.close();
});

test('real visitor clicks reach protected admin totals, refresh deduplicates and admin visits are excluded', async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  expect((await page.request.get('/api/admin/analytics/products')).status()).toBe(401);
  const visitor = await browser.newContext({ baseURL: 'http://127.0.0.1:5210' });
  try {
    const shop = await visitor.newPage();
    const first = shop.waitForResponse(response => response.url().endsWith('/api/analytics/product-click') && response.request().method() === 'POST');
    await shop.goto('/products/chatgpt-plus');
    expect((await (await first).json()).data.recorded).toBe(true);
    const repeated = shop.waitForResponse(response => response.url().endsWith('/api/analytics/product-click') && response.request().method() === 'POST');
    await shop.reload(); expect((await (await repeated).json()).data.recorded).toBe(false);
    const second = shop.waitForResponse(response => response.url().endsWith('/api/analytics/product-click') && response.request().method() === 'POST');
    await shop.goto('/products/chatgpt-pro-5x'); expect((await (await second).json()).data.recorded).toBe(true);
    await page.goto('/admin');
    await page.getByLabel('登录密码').fill('isolated-e2e-admin-password');
    await page.getByRole('button', { name: '登录后台' }).click();
    await expect(page.getByRole('heading', { name: '商品点击分析' })).toBeVisible();
    await page.getByLabel('数据环境').selectOption('sandbox');
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await expect(page.locator('.admin-metric').first().locator('strong')).toHaveText('2');
    await expect(page.locator('.admin-table tbody tr')).toHaveCount(4);
    await expect(page.locator('.admin-table tbody')).toContainText('chatgpt-plus');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
      await expect(page.getByRole('heading', { name: '商品点击分析' })).toHaveCount(1);
      await expect(page.getByRole('columnheader', { name: '点击次数' })).toBeVisible();
      await page.screenshot({ path: `artifacts/admin-clicks-${width}.png`, fullPage: true });
    }
    const ignored = page.waitForResponse(response => response.url().endsWith('/api/analytics/product-click') && response.request().method() === 'POST');
    await page.goto('/products/chatgpt-plus'); expect((await (await ignored).json()).data.recorded).toBe(false);
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: '商品点击分析' })).toBeVisible();
    await page.getByLabel('数据环境').selectOption('sandbox'); await page.getByRole('button', { name: '查询', exact: true }).click();
    await expect(page.locator('.admin-metric').first().locator('strong')).toHaveText('2');
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page.getByRole('heading', { name: '登录管理后台' })).toBeVisible();
    expect((await page.request.get('/api/admin/analytics/products')).status()).toBe(401);
    expect(errors).toEqual([]);
  } finally { await visitor.close(); }
});

test('bad password keeps data protected and displays a useful error', async ({ page }) => {
  await page.goto('/admin');
  await page.getByLabel('登录密码').fill('incorrect');
  await page.getByRole('button', { name: '登录后台' }).click();
  await expect(page.getByRole('alert')).toHaveText('账号或密码不正确。');
  expect((await page.request.get('/api/admin/analytics/products')).status()).toBe(401);
});
