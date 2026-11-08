import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { openDatabase } from '../../server/database';
import { hashAdminPassword, insertAdminAccount } from '../../server/admin';

test.beforeAll(async () => {
  const db = openDatabase(process.env.E2E_ADMIN_DB!);
  insertAdminAccount(db, 'admin', await hashAdminPassword('isolated-e2e-admin-password'), 'super_admin');
  db.close();
});

test('new product visits update live admin totals, reloads stay deduplicated and date controls align', async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  expect((await page.request.get('/api/admin/analytics/products')).status()).toBe(401);
  const visitor = await browser.newContext({ baseURL: 'http://127.0.0.1:5210' });
  try {
    const shop = await visitor.newPage();
    const first = shop.waitForResponse(response => response.url().endsWith('/api/analytics/product-click') && response.request().method() === 'POST');
    await shop.goto('/products/chatgpt-plus');
    expect((await (await first).json()).data.recorded).toBe(true);
    await shop.reload();
    await expect(shop.getByRole('heading', { name: 'ChatGPT Plus', exact: true })).toBeVisible();
    const second = shop.waitForResponse(response => response.url().endsWith('/api/analytics/product-click') && response.request().method() === 'POST');
    await shop.goto('/products/chatgpt-pro-5x'); expect((await (await second).json()).data.recorded).toBe(true);
    await page.goto('/admin');
    await page.getByLabel('登录密码').fill('isolated-e2e-admin-password');
    await page.getByRole('button', { name: '登录后台' }).click();
    await expect(page.getByRole('heading', { name: '商品点击分析' })).toBeVisible();
    await expect(page.getByLabel('数据环境')).toHaveCount(0);
    await expect(page.getByText('测试数据', { exact: true })).toBeVisible();
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
    await page.setViewportSize({ width: 1440, height: 900 });
    const startDate = page.getByRole('button', { name: /^开始日期，/ });
    const endDate = page.getByRole('button', { name: /^结束日期，/ });
    const query = page.getByRole('button', { name: '查询', exact: true });
    const queryBox = await query.boundingBox();
    for (const control of [startDate, endDate, page.locator('.admin-presets')]) {
      const box = await control.boundingBox();
      expect(box?.height).toBe(queryBox?.height);
      expect(box?.y).toBe(queryBox?.y);
    }
    await startDate.click();
    const calendar = page.getByRole('dialog', { name: '选择开始日期' });
    await expect(calendar.getByRole('grid')).toBeVisible();
    await page.screenshot({ path: '/tmp/wusan-admin-date-picker.png' });
    const day = calendar.locator('[data-day]:not([data-selected]):not([data-hidden]):not([data-disabled])').first();
    const chosen = await day.getAttribute('data-day');
    expect(chosen).toBeTruthy();
    await day.getByRole('button').click();
    await expect(calendar).toHaveCount(0);
    await expect(startDate).toContainText(chosen!.replaceAll('-', '/'));
    const filtered = page.waitForRequest(request => new URL(request.url()).searchParams.get('start') === chosen);
    await query.click();
    await filtered;
    await page.getByRole('button', { name: '近 7 天' }).click();
    await expect(page.locator('.admin-metric').first().locator('strong')).toHaveText('2');

    // Visit twice from the same browser while the analytics page remains open.
    const adminShop = await page.context().newPage();
    try {
      for (const total of ['3', '4']) {
        await adminShop.goto('/');
        const recorded = adminShop.waitForResponse(response => response.url().endsWith('/api/analytics/product-click') && response.request().method() === 'POST');
        await adminShop.getByRole('link', { name: 'ChatGPT Plus', exact: true }).click();
        expect((await (await recorded).json()).data.recorded).toBe(true);
        await expect(page.locator('.admin-metric').first().locator('strong')).toHaveText(total);
      }
    } finally { await adminShop.close(); }
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

test('admin can edit product inventory, copy cards and confirm removal', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin');
  await page.getByLabel('登录密码').fill('isolated-e2e-admin-password');
  await page.getByRole('button', { name: '登录后台' }).click();
  await page.getByRole('link', { name: '卡密管理' }).click();
  const plus = page.getByRole('tab', { name: 'ChatGPT Plus', exact: true });
  const product = page.getByRole('tab', { name: 'ChatGPT Pro 5x', exact: true });
  await expect(plus).toHaveAttribute('aria-selected', 'true');
  const plusPanel = page.getByRole('tabpanel', { name: 'ChatGPT Plus' });
  await expect(plusPanel.getByRole('textbox', { name: '卡密' })).toHaveCount(0);
  await plusPanel.getByRole('button', { name: '编辑', exact: true }).click();
  await plusPanel.getByRole('textbox', { name: '卡密' }).fill('OTHER-PRODUCT-DRAFT');
  await plus.focus();
  await page.keyboard.press('ArrowRight');
  await expect(product).toBeFocused();
  await expect(product).toHaveAttribute('aria-selected', 'true');
  const panel = page.getByRole('tabpanel', { name: 'ChatGPT Pro 5x', exact: true });
  await expect(panel.getByRole('textbox', { name: '卡密' })).toHaveCount(0);
  await panel.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(panel.getByRole('textbox', { name: '卡密' })).toHaveValue('');
  const chooser = page.waitForEvent('filechooser');
  await panel.getByRole('button', { name: 'TXT 导入' }).click();
  await (await chooser).setFiles({ name: 'test.txt', mimeType: 'text/plain', buffer: Buffer.from('TEST-A\nTEST-B\nTEST-A') });
  await panel.getByLabel('标记为优先卡密').check();
  await panel.getByRole('button', { name: '添加卡密' }).click();
  await expect(page.locator('.app-message--success')).toContainText('已添加 2 条，跳过重复卡密 1 条。');
  await expect(panel.locator('.admin-voucher-stock dd')).toHaveText(['2 条', '2 条']);
  await expect(panel.getByRole('textbox', { name: '卡密' })).toHaveValue('');
  await panel.getByRole('button', { name: '退出编辑' }).click();
  const row = panel.getByRole('listitem').filter({ hasText: 'TEST-A' });
  await row.getByRole('button', { name: '复制', exact: true }).click();
  await expect(page.locator('.app-message--success')).toHaveText('已复制卡密。');
  await expect(panel.getByText('已复制卡密。', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('TEST-A');
  await expect(panel.locator('.admin-voucher-stock dd')).toHaveText(['2 条', '2 条']);
  const remove = row.getByRole('button', { name: '复制并删除' });
  const dialog = page.getByRole('dialog', { name: '确认复制并删除' });
  await remove.click();
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(row).toBeVisible();
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', {
    configurable: true, value: async () => { throw new Error('clipboard denied'); },
  }));
  await remove.click();
  await dialog.getByRole('button', { name: '确认复制并删除' }).click();
  await expect(dialog.getByRole('alert')).toContainText('未删除卡密');
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(row).toBeVisible();
  await page.evaluate(() => Reflect.deleteProperty(navigator.clipboard, 'writeText'));
  await remove.click();
  await dialog.getByRole('button', { name: '确认复制并删除' }).click();
  await expect(row).toHaveCount(0);
  await expect(page.locator('.app-message--success')).toHaveText('已复制卡密，并从库存删除。');
  await expect(panel.getByText('已复制卡密，并从库存删除。', { exact: true })).toHaveCount(0);
  await expect(panel.locator('.admin-voucher-stock dd')).toHaveText(['1 条', '1 条']);
  const remaining = panel.getByRole('listitem').filter({ hasText: 'TEST-B' });
  const deleteOnly = remaining.getByRole('button', { name: '删除', exact: true });
  const deleteDialog = page.getByRole('dialog', { name: '删除卡密' });
  await deleteOnly.click();
  await deleteDialog.getByRole('button', { name: '取消' }).click();
  await expect(remaining).toBeVisible();
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', {
    configurable: true, value: async () => { throw new Error('clipboard denied'); },
  }));
  await deleteOnly.click();
  await deleteDialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(remaining).toHaveCount(0);
  await expect(panel.locator('.admin-voucher-stock dd')).toHaveText(['0 条', '0 条']);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('TEST-A');
  await plus.click();
  await expect(plusPanel.locator('.admin-voucher-stock dd')).toHaveText(['0 条', '0 条']);
  await plusPanel.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(plusPanel.getByRole('textbox', { name: '卡密' })).toHaveValue('OTHER-PRODUCT-DRAFT');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
});

test('user management shows the list and supports adding, editing and deleting administrators', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin');
  await page.getByLabel('登录密码').fill('isolated-e2e-admin-password');
  await page.getByRole('button', { name: '登录后台' }).click();
  await page.getByRole('link', { name: '用户管理' }).click();
  await expect(page.getByRole('table', { name: '管理员列表' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '新增管理员' }).click();
  await page.locator('#new-admin-name').fill('limited-admin');
  await page.getByLabel('初始密码').fill('isolated-limited-password');
  await page.getByLabel('查看商品点击分析').check();
  await page.getByRole('button', { name: '创建账号' }).click();
  const row = page.getByRole('row').filter({ hasText: 'limited-admin' });
  await expect(row).toContainText('普通管理员');
  await row.getByRole('button', { name: '编辑 limited-admin 的权限' }).click();
  await page.getByLabel('查看商品点击分析').uncheck();
  await page.getByLabel('查看卡密库存').check();
  await page.getByRole('button', { name: '保存权限' }).click();
  await expect(row).toContainText('查看卡密库存');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('heading', { name: '登录管理后台' })).toBeVisible();
  await page.getByLabel('管理员账号').fill('limited-admin');
  await page.getByLabel('登录密码').fill('isolated-limited-password');
  await page.getByRole('button', { name: '登录后台' }).click();
  await expect(page.getByRole('heading', { name: '卡密管理' })).toBeVisible();
  await expect(page.getByRole('tablist', { name: '商品' })).toBeVisible();
  await expect(page.getByRole('tabpanel')).toContainText('可用库存');
  await expect(page.getByRole('link', { name: '用户管理' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '商品点击分析' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '添加卡密' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '编辑', exact: true })).toHaveCount(0);
  expect((await page.request.get('/api/admin/users')).status()).toBe(403);
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('heading', { name: '登录管理后台' })).toBeVisible();
  await page.getByLabel('登录密码').fill('isolated-e2e-admin-password');
  await page.getByRole('button', { name: '登录后台' }).click();
  const remove = row.getByRole('button', { name: '删除 limited-admin' });
  await remove.click();
  await page.getByRole('dialog', { name: '删除管理员' }).getByRole('button', { name: '取消' }).click();
  await expect(row).toBeVisible();
  await remove.click();
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByText('已删除管理员 limited-admin。', { exact: true })).toBeVisible();
  await expect(page.getByRole('table', { name: '管理员列表' })).toBeVisible();
  await expect(row).toHaveCount(0);
});

test('revenue dashboard shows paid and refunded amounts with responsive filters', async ({ page }) => {
  const db = openDatabase(process.env.E2E_ADMIN_DB!);
  const now = new Date().toISOString();
  const snapshot = JSON.stringify({ productId: 'chatgpt-plus', productName: 'ChatGPT Plus', priceCents: 13000 });
  db.prepare(`INSERT INTO orders (id,owner_hash,email,snapshot,status,created_at,expires_at,paid_at,trade_no,idempotency_key,fingerprint,environment)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('WS1234567890abcdef1234567890abcdef', 'revenue-test', '', snapshot, 'paid', now, now, now, 'trade-revenue-test', 'revenue-key', 'fingerprint', 'sandbox');
  db.prepare(`INSERT INTO payment_refunds (request_no,order_id,amount_cents,reason,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)`).run('revenue-refund', 'WS1234567890abcdef1234567890abcdef', 3000, 'test', 'success', now, now);
  db.close();

  await page.goto('/admin');
  await page.getByLabel('登录密码').fill('isolated-e2e-admin-password');
  await page.getByRole('button', { name: '登录后台' }).click();
  await page.getByRole('link', { name: '营业额统计' }).click();
  await expect(page.getByRole('heading', { name: '营业额统计' })).toBeVisible();
  await expect(page.locator('.revenue-metrics')).toContainText('¥130');
  await expect(page.locator('.revenue-metrics')).toContainText('¥30');
  await expect(page.locator('.revenue-metrics')).toContainText('¥100');
  await expect(page.getByRole('heading', { name: '付款明细' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '商品销售排行' })).toBeVisible();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: /^开始日期/ })).toBeVisible();
  }
  await page.screenshot({ path: '/tmp/wusan-revenue-dashboard.png', fullPage: true });
});

test('coupon management creates a product-specific offer and allows it to be disabled', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin?tab=coupons');
  await page.getByLabel('登录密码').fill('isolated-e2e-admin-password');
  await page.getByRole('button', { name: '登录后台' }).click();
  await expect(page.getByRole('heading', { name: '优惠券管理' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '新增优惠券' }).click();
  await expect(page.getByRole('dialog').getByText('优惠码将在创建后自动生成。')).toBeVisible();
  await expect(page.getByRole('dialog').getByLabel('优惠码')).toHaveCount(0);
  await page.getByRole('combobox', { name: '适用商品' }).click();
  await page.getByRole('option', { name: 'ChatGPT Plus', exact: true }).click();
  await page.getByLabel('满额（元）').fill('100');
  await page.getByLabel('优惠金额（元）').fill('5');
  await page.getByLabel('使用次数').fill('10');
  await page.getByRole('button', { name: '创建优惠券' }).click();
  const codeCell = page.locator('.coupon-table tbody code').filter({ hasText: /^WS-[A-F0-9]{16}$/ });
  await expect(codeCell).toBeVisible();
  const code = await codeCell.innerText();
  const row = page.getByRole('row').filter({ hasText: code });
  await expect(row).toContainText('ChatGPT Plus');
  await expect(row).toContainText('0 / 10');
  const heights = await page.locator('.coupon-table').evaluate(table => [table.querySelector('thead tr')!.getBoundingClientRect().height, table.querySelector('tbody tr')!.getBoundingClientRect().height]);
  expect(heights[0]).toBe(heights[1]);
  await page.setViewportSize({ width: 390, height: 900 });
  const details = row.locator('.coupon-compact-details');
  await expect(details).toBeVisible();
  await expect(details).toContainText('满 ¥100 可用');
  await expect(details).toContainText('已付款 0 笔');
  expect(await page.locator('.coupon-table').evaluate(table => table.scrollWidth <= table.parentElement!.clientWidth)).toBe(true);
  await row.getByRole('button', { name: `编辑 ${code}` }).click();
  await expect(page.getByLabel('优惠码')).toHaveValue(code);
  await expect(page.getByLabel('优惠码')).toHaveJSProperty('readOnly', true);
  await page.getByLabel('使用次数').fill('15');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(row).toContainText('0 / 15');
  await row.getByRole('button', { name: '停用' }).click();
  await expect(row).toContainText('停用');
  await row.getByRole('button', { name: `删除 ${code}` }).click();
  await expect(page.getByRole('dialog', { name: '删除优惠券' })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: `删除 ${code}` }).click();
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(row).toHaveCount(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  }
});

test('linked super admin can start account redemption directly with sandbox payments disabled', async ({ page }) => {
  const db = openDatabase(process.env.E2E_ADMIN_DB!);
  const adminPassword = 'staff-e2e-admin-password';
  insertAdminAccount(db, 'linzhenglian', await hashAdminPassword(adminPassword), 'super_admin');
  db.close();

  await page.goto('/products/chatgpt-plus');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('button', { name: '没有账号？立即注册' }).click();
  await page.getByLabel('账号', { exact: true }).fill('linzhenglian');
  await page.getByLabel('登录密码').fill('staff-e2e-customer-password');
  await page.getByRole('button', { name: '注册并登录' }).click();
  await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
  await expect(page.locator('.product-buy-price')).not.toContainText('免付开通');

  await page.goto('/admin?tab=users');
  await page.getByLabel('管理员账号').fill('linzhenglian');
  await page.getByLabel('登录密码').fill(adminPassword);
  await page.getByRole('button', { name: '登录后台' }).click();
  await page.getByRole('button', { name: '绑定商城账号' }).click();
  await expect(page.getByRole('button', { name: '解除绑定' })).toBeVisible();

  // Render the existing connection form without sending requests to a fulfillment provider.
  await page.route('**/api/orders/*/redemption', route => route.fulfill({ json: { data: { enabled: true, submitted: false } } }));
  await page.route('**/api/orders/*/redemption/policy', route => route.fulfill({ json: { data: { terms: 'test', privacy: 'test' } } }));
  await page.goto('/');
  const plusCard = page.locator('.storefront-card').filter({ has: page.getByRole('heading', { name: 'ChatGPT Plus', exact: true }) });
  await expect(plusCard.locator('.card-price')).toHaveText('¥0.00免付开通');
  await page.goto('/checkout/chatgpt-plus');
  await expect(page.locator('.product-buy-price')).toContainText('免付开通¥0');
  await page.goto('/');
  await plusCard.getByRole('link', { name: '立即购买' }).click();
  await expect(page.locator('.product-buy-price')).toContainText('免付开通¥0');
  await expect(page.getByText('超级管理员免付开通')).toBeVisible();
  await expect(page.getByLabel('验证码', { exact: true })).toHaveCount(0);
  const created = page.waitForResponse(response => response.url().endsWith('/api/orders/staff-checkout') && response.status() === 201);
  await page.getByRole('button', { name: '立即购买' }).click();
  const order = (await (await created).json()).data;
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('ChatGPT Session')).toBeVisible();
  await expect(dialog.locator('[aria-current="step"]')).toHaveText('1连接账号');
  await expect(dialog.getByText('确认付款', { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel('联系方式')).toHaveCount(0);
  expect(order.priceCents).toBe(0);
  await dialog.getByRole('button', { name: '关闭购买弹窗' }).click();
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  expect((await page.request.get(`/api/orders/${order.id}`)).status()).toBe(404);
});

test('order management filters orders, refreshes status manually and fits mobile screens', async ({ page }) => {
  test.setTimeout(60000);
  const now = new Date().toISOString();
  const db = openDatabase(process.env.E2E_ADMIN_DB!);
  const add = db.prepare(`INSERT INTO orders(id,owner_hash,email,snapshot,status,created_at,expires_at,idempotency_key,fingerprint,environment)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  for (let i = 0; i < 23; i++) {
    add.run(`WS-MANAGE-${String(i).padStart(2, '0')}`, 'order-management-test', '', JSON.stringify({ productId: i === 22 ? 'chatgpt-pro-5x' : 'chatgpt-plus', productName: i === 22 ? 'ChatGPT Pro' : 'ChatGPT Plus', category: i === 22 ? 'Pro' : 'Plus', priceCents: i === 21 ? 0 : 13000, ...(i === 21 ? { staffCheckout: true } : {}) }), i === 21 ? 'paid' : 'pending', now, now, `manage-${i}`, 'test', 'sandbox');
  }
  // Other cases cover login; seed this session to keep the suite below the shared login rate limit.
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO admin_sessions(token_hash,username,expires_at) VALUES (?,?,?)').run(
    createHash('sha256').update(token).digest('hex'), 'admin', new Date(Date.now() + 3600000).toISOString());
  db.close();
  await page.context().addCookies([{ name: 'wusan_admin', value: token, url: 'http://127.0.0.1:5210', httpOnly: true, sameSite: 'Strict' }]);
  await page.goto('/admin?tab=orders');
  await expect(page.getByRole('heading', { name: '订单管理', exact: true })).toBeVisible();
  await page.getByLabel('订单号', { exact: true }).fill('WS-MANAGE-');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.locator('.order-table tbody tr')).toHaveCount(20);
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.locator('.order-table tbody tr')).toHaveCount(3);
  await page.getByLabel('订单号', { exact: true }).fill('WS-MANAGE-22');
  await page.getByLabel('商品分类', { exact: true }).click();
  await page.getByRole('option', { name: 'Pro', exact: true }).click();
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.locator('.order-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.order-table tbody')).toContainText('待付款');
  await expect(page.getByLabel('自动刷新（每 10 秒）')).toHaveCount(0);
  await page.clock.install();
  let automaticRequests = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/admin/orders') automaticRequests++; });
  const update = openDatabase(process.env.E2E_ADMIN_DB!);
  update.prepare("UPDATE orders SET status = 'paid', paid_at = ? WHERE id = 'WS-MANAGE-22'").run(now);
  update.prepare('INSERT INTO order_fulfillment_details(order_id,voucher_code,recharge_email) VALUES (?,?,?)').run('WS-MANAGE-22','ORDER-MANAGE-CARD-22','recharge@example.invalid');
  update.close();
  await page.clock.fastForward(11000);
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
  expect(automaticRequests).toBe(0);
  await expect(page.locator('.order-table tbody')).toContainText('待付款');
  await page.getByRole('button', { name: '刷新订单' }).click();
  await expect(page.locator('.order-table tbody')).toContainText('已付款');
  await expect(page.locator('.order-table tbody')).toContainText('ORDER-MANAGE-CARD-22');
  await expect(page.locator('.order-table tbody')).toContainText('recharge@example.invalid');
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await page.getByRole('button',{name:'复制订单 WS-MANAGE-22 的卡密',exact:true}).click();
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('ORDER-MANAGE-CARD-22');
  await page.getByLabel('订单状态', { exact: true }).click();
  await page.getByRole('option', { name: '已关闭', exact: true }).click();
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByText('暂无符合筛选条件的订单，可调整条件或重置筛选。')).toBeVisible();
  await page.getByRole('button', { name: '重置筛选' }).click();
  await expect(page.getByText('当前查询全部时间 · 北京时间')).toBeVisible();
  await expect(page.getByRole('button', { name: '下单开始日期，不限' })).toBeVisible();
  await page.getByLabel('订单号', { exact: true }).fill('WS-MANAGE-');
  await page.getByLabel('付费类别', { exact: true }).click();
  await page.getByRole('option', { name: '免付开通', exact: true }).click();
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.locator('.order-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.order-table tbody')).toContainText('WS-MANAGE-21');
  await expect(page.locator('.order-table tbody')).toContainText('免付开通');
  await page.getByLabel('付费类别', { exact: true }).click();
  await page.getByRole('option', { name: '付费开通', exact: true }).click();
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.locator('.order-table tbody tr')).toHaveCount(20);
  await expect(page.locator('.order-table tbody')).not.toContainText('WS-MANAGE-21');
  await expect(page.locator('.order-table tbody')).toContainText('付费开通');
  await page.getByRole('button', { name: '重置筛选' }).click();
  await expect(page.getByLabel('付费类别', { exact: true })).toHaveText('全部类别');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    await page.screenshot({ path: `artifacts/admin-orders-${width}.png`, fullPage: true });
  }
});

test('referral code survives navigation, reload and a new browsing session without replacing first attribution', async ({ page, browser }) => {
  const firstCode = 'b123456789abcdef';
  const secondCode = 'c123456789abcdef';
  const db = openDatabase(process.env.E2E_ADMIN_DB!);
  const password = await hashAdminPassword('referral-fixture-password');
  const add = db.prepare('INSERT INTO customers(id,username,password_hash,invite_code,created_at) VALUES (?,?,?,?,?)');
  add.run('referral-first', 'referral-first', password, firstCode, new Date().toISOString());
  add.run('referral-second', 'referral-second', password, secondCode, new Date().toISOString());
  db.close();
  await page.goto(`/?ref=${firstCode}`);
  await expect(page).toHaveURL(new RegExp(`ref=${firstCode}`));
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await page.goto(`/products/chatgpt-plus?from=invite&ref=${firstCode}#details`);
  await expect(page.getByRole('heading', { name: 'ChatGPT Plus', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'ChatGPT Plus', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '首页', exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`^http://127.0.0.1:5210/\\?ref=${firstCode}$`));
  await page.goto('/products/chatgpt-plus?source=return#details');
  await expect(page).toHaveURL(new RegExp(`source=return&ref=${firstCode}#details$`));
  await page.goto(`/?ref=${secondCode}`);
  await expect(page).toHaveURL(new RegExp(`ref=${firstCode}$`));
  const invitation = (await (await page.request.get('/api/referrals/invitation')).json()).data;
  expect(invitation.code).toBe(firstCode);
  const state = await page.context().storageState();
  const reopened = await browser.newContext({ storageState: state });
  try {
    const newPage = await reopened.newPage();
    await newPage.goto('http://127.0.0.1:5210/');
    await expect(newPage).toHaveURL(new RegExp(`ref=${firstCode}$`));
    expect((await (await newPage.request.get('http://127.0.0.1:5210/api/referrals/invitation')).json()).data).toEqual(invitation);
  } finally { await reopened.close(); }
  const clean = await browser.newContext();
  try {
    const newPage = await clean.newPage();
    await newPage.goto('http://127.0.0.1:5210/');
    await expect(newPage.getByRole('navigation', { name: '主导航' })).toBeVisible();
    await expect(newPage).toHaveURL('http://127.0.0.1:5210/');
  } finally { await clean.close(); }
});

test('rebate withdrawals reserve the balance, require admin approval and release funds on rejection', async ({ page }) => {
  const db = openDatabase(process.env.E2E_ADMIN_DB!);
  const now = new Date().toISOString();
  const password = 'withdrawal-e2e-password';
  const userId = 'withdrawal-e2e-customer';
  db.prepare('INSERT INTO customers VALUES (?,?,?,?,?)').run(userId,'withdrawal-e2e',await hashAdminPassword(password),'d123456789abcdef',now);
  for (let index = 0; index < 2; index++) {
    const id = `WS-WITHDRAWAL-E2E-${index}`;
    db.prepare(`INSERT INTO orders(id,owner_hash,email,snapshot,status,created_at,expires_at,idempotency_key,fingerprint,environment)
      VALUES (?,?,'',?,'pending',?,?,?,?,?)`).run(id,'withdrawal-buyer',JSON.stringify({productId:'chatgpt-plus',productName:'ChatGPT Plus',priceCents:13000}),now,now,id,'fixture','sandbox');
    db.prepare('INSERT INTO referral_orders(order_id,inviter_id,created_at) VALUES (?,?,?)').run(id,userId,now);
    db.prepare("UPDATE orders SET status = 'paid',paid_at = ? WHERE id = ?").run(now,id);
  }
  const customerToken = randomBytes(32).toString('hex'), adminToken = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO customer_sessions VALUES (?,?,?)').run(createHash('sha256').update(customerToken).digest('hex'),userId,Date.now()+3600000);
  db.prepare('INSERT INTO admin_sessions VALUES (?,?,?)').run(createHash('sha256').update(adminToken).digest('hex'),'admin',new Date(Date.now()+3600000).toISOString());
  db.close();
  await page.context().addCookies([{name:'wusan_customer',value:customerToken,url:'http://127.0.0.1:5210',httpOnly:true,sameSite:'Lax'},{name:'wusan_admin',value:adminToken,url:'http://127.0.0.1:5210',httpOnly:true,sameSite:'Strict'}]);
  await page.goto('/referrals');
  await expect(page.locator('.withdrawal-balances').getByText('¥10',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'申请提现',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'申请提现至支付宝'});
  await dialog.getByLabel('提现金额（元）').fill('5');
  await dialog.getByLabel('支付宝账号',{exact:true}).fill('withdrawal@example.com');
  await dialog.getByLabel('支付宝实名姓名').fill('提现测试用户');
  await dialog.getByLabel('商城登录密码').fill('wrong-password');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button',{name:'提交提现申请'}).click();
  await expect(page.getByText('商城登录密码不正确。',{exact:true})).toBeVisible();
  await expect(dialog.getByLabel('支付宝账号',{exact:true})).toHaveValue('withdrawal@example.com');
  await dialog.getByLabel('商城登录密码').fill(password);
  await dialog.getByRole('button',{name:'提交提现申请'}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.withdrawal-table tbody')).toContainText('待审核');
  await expect(page.locator('.withdrawal-balances').getByText('¥5',{exact:true})).toHaveCount(2);
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
    await page.screenshot({path:`artifacts/withdrawal-customer-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('/admin?tab=referrals');
  await expect(page.getByRole('heading',{name:'提现审核与打款'})).toBeVisible();
  const row = page.locator('.withdrawal-table tbody tr').filter({hasText:'withdrawal@example.com'});
  await row.getByRole('button',{name:'同意提现'}).click();
  await page.getByRole('dialog',{name:'同意提现'}).getByRole('button',{name:'同意提现'}).click();
  await expect(row).toContainText('审核通过 · 待打款');
  await expect(row.getByRole('button',{name:'打款至支付宝'})).toBeDisabled();
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
    await page.screenshot({path:`artifacts/withdrawal-admin-${width}.png`,fullPage:true});
  }
  await row.getByRole('button',{name:'驳回',exact:true}).click();
  const reject = page.getByRole('dialog',{name:'驳回申请'});
  await reject.getByLabel('驳回原因').fill('请核对收款账号后重新申请');
  await reject.getByRole('button',{name:'驳回申请'}).click();
  await expect(row).toContainText('已驳回');
  await page.goto('/referrals');
  await expect(page.locator('.withdrawal-balances').getByText('¥10',{exact:true})).toBeVisible();
  await expect(page.locator('.withdrawal-table tbody')).toContainText('请核对收款账号后重新申请');
});

test('a refunded timeout order is shown as canceled in the customer account and admin filters', async ({ page }) => {
  const db=openDatabase(process.env.E2E_ADMIN_DB!);
  const id='WS1234567890123deadbeef11223344';
  const now=new Date().toISOString();
  const snapshot=JSON.stringify({productId:'chatgpt-plus',productName:'ChatGPT Plus',priceCents:13000,periodMonths:1,details:{},payment:{appId:'timeout-app',sellerId:'timeout-seller'}});
  const browserToken=randomBytes(32).toString('hex');
  const owner=createHash('sha256').update(browserToken).digest('hex');
  db.prepare(`INSERT INTO orders(id,owner_hash,email,snapshot,status,created_at,expires_at,paid_at,trade_no,idempotency_key,fingerprint,environment)
    VALUES (?,?,'',?,'paid',?,?,?,'timeout-trade','timeout-key','fixture','sandbox')`).run(id,owner,snapshot,now,now,now);
  db.prepare("INSERT INTO order_cancellations(order_id,state,refund_key,note,created_at,updated_at,cancelled_at) VALUES (?,'cancelled','timeout-refund','超过30分钟未开通会员，已原路退款，订单已取消。',?,?,?)").run(id,now,now,now);
  const token=randomBytes(32).toString('hex');
  db.prepare('INSERT INTO admin_sessions VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'),'admin',new Date(Date.now()+3600000).toISOString());db.close();
  await page.context().addCookies([{name:'wusan_browser',value:browserToken,url:'http://127.0.0.1:5210',httpOnly:true,sameSite:'Lax'},{name:'wusan_admin',value:token,url:'http://127.0.0.1:5210',httpOnly:true,sameSite:'Strict'}]);
  await page.goto('/orders');
  await page.getByRole('button',{name:'订单已取消',exact:true}).click();
  await expect(page.locator('.server-order-row')).toContainText(id);
  await page.getByRole('link',{name:'查看订单'}).click();
  await expect(page.getByRole('heading',{name:'订单已取消',level:1})).toBeVisible();
  await expect(page.getByText('超过30分钟未开通会员，已原路退款，订单已取消。',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'验证账号并继续'})).toHaveCount(0);
  await page.goto('/admin?tab=orders');
  await page.getByLabel('订单状态',{exact:true}).click();
  await page.getByRole('option',{name:'订单已取消',exact:true}).click();
  await page.getByRole('button',{name:'查询',exact:true}).click();
  await expect(page.locator('.order-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.order-table tbody')).toContainText(id);
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
  }
});

test('separate refund menu defaults to pending reviews and supports approval and rejection',async({page})=>{
  const db=openDatabase(process.env.E2E_ADMIN_DB!);
  const ids=['WS1234567890123aaaaaaaaaabbbbbb','WS1234567890123aaaaaaaaaacccccc'];
  const now=new Date().toISOString();
  const browserToken=randomBytes(32).toString('hex');
  const owner=createHash('sha256').update(browserToken).digest('hex');
  for(const id of ids) {
    const snapshot=JSON.stringify({productId:'chatgpt-plus',productName:'ChatGPT Plus',priceCents:13000,periodMonths:1,details:{}});
    db.prepare(`INSERT INTO orders(id,owner_hash,email,snapshot,status,created_at,expires_at,paid_at,idempotency_key,fingerprint,environment)
      VALUES (?,?,'',?,'paid',?,?,?,?,'fixture','sandbox')`).run(id,owner,snapshot,now,now,now,id);
    db.prepare("INSERT INTO order_cancellations(order_id,state,refund_key,note,created_at,updated_at,cancelled_at) VALUES (?,'review',?,'超过30分钟未开通会员，订单已取消，退款待后台审核；款项尚未退回。',?,?,?)").run(id,'review-'+id,now,now,now);
    db.prepare("INSERT INTO order_refund_reviews(order_id,status,requested_at) VALUES (?,'pending',?)").run(id,now);
  }
  const token=randomBytes(32).toString('hex');
  db.prepare('INSERT INTO admin_sessions VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'),'admin',new Date(Date.now()+3600000).toISOString());db.close();
  await page.context().addCookies([{name:'wusan_browser',value:browserToken,url:'http://127.0.0.1:5210',httpOnly:true,sameSite:'Lax'},{name:'wusan_admin',value:token,url:'http://127.0.0.1:5210',httpOnly:true,sameSite:'Strict'}]);
  await page.goto(`/orders/${ids[0]}`);
  await expect(page.getByRole('heading',{level:1,name:'订单已取消'})).toBeVisible();
  await expect(page.getByText('超过30分钟未开通会员，订单已取消，退款待后台审核；款项尚未退回。',{exact:true})).toBeVisible();
  await page.goto('/admin?tab=orders');
  await expect(page.getByRole('button',{name:'同意退款',exact:true})).toHaveCount(0);
  await page.getByRole('link',{name:'退款审核',exact:true}).click();
  await expect(page).toHaveURL(/tab=refunds$/);
  await expect(page.getByRole('heading',{level:1,name:'退款审核'})).toBeVisible();
  await expect(page.getByLabel('审核状态',{exact:true})).toContainText('退款待审核');
  await expect(page.locator('.order-table tbody tr')).toHaveCount(2);
  const first=page.locator('.order-table tbody tr').filter({hasText:ids[0]});
  await first.getByRole('button',{name:'同意退款',exact:true}).click();
  const approval=page.getByRole('dialog',{name:'同意原路退款'});
  await expect(approval).toContainText('¥130');
  await expect(approval.getByRole('button',{name:'同意原路退款',exact:true})).toBeDisabled();
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
    await page.screenshot({path:`artifacts/order-refund-review-${width}.png`,fullPage:true});
  }
  await approval.getByLabel('审核备注（选填）').fill('人工核实未充值');
  await approval.getByRole('checkbox').check();
  await approval.getByRole('button',{name:'同意原路退款',exact:true}).click();
  await expect(approval).toHaveCount(0);
  await expect(page.locator('.order-table tbody tr')).toHaveCount(1);
  const second=page.locator('.order-table tbody tr').filter({hasText:ids[1]});
  await second.getByRole('button',{name:'驳回退款',exact:true}).click();
  const rejection=page.getByRole('dialog',{name:'驳回退款'});
  await rejection.getByLabel('驳回原因').fill('请联系支持核实订单信息');
  await rejection.getByRole('button',{name:'驳回退款',exact:true}).click();
  await expect(rejection).toHaveCount(0);
  await expect(page.getByText('暂无符合条件的退款审核记录。')).toBeVisible();
  await page.getByLabel('审核状态',{exact:true}).click();
  await page.getByRole('option',{name:'已驳回',exact:true}).click();
  await page.getByRole('button',{name:'查询',exact:true}).click();
  await expect(second).toContainText('请联系支持核实订单信息');
  await expect(second.getByRole('button',{name:'同意退款',exact:true})).toHaveCount(0);
  await page.getByLabel('审核状态',{exact:true}).click();
  await page.getByRole('option',{name:'审核通过',exact:true}).click();
  await page.getByRole('button',{name:'查询',exact:true}).click();
  await expect(first).toContainText('人工核实未充值');
  await page.getByLabel('订单号',{exact:true}).fill(ids[1]);
  await page.getByRole('button',{name:'查询',exact:true}).click();
  await expect(page.getByText('暂无符合条件的退款审核记录。')).toBeVisible();
  await page.getByRole('button',{name:'重置筛选',exact:true}).click();
  await expect(page.getByLabel('审核状态',{exact:true})).toContainText('退款待审核');
  await page.getByRole('link',{name:'订单管理',exact:true}).click();
  await expect(page.getByRole('button',{name:'同意退款',exact:true})).toHaveCount(0);
  const check=openDatabase(process.env.E2E_ADMIN_DB!);
  expect(check.prepare('SELECT count(*) n FROM payment_refunds WHERE order_id IN (?,?)').get(...ids)!.n).toBe(0);
  expect(check.prepare('SELECT reviewed_by FROM order_refund_reviews WHERE order_id=?').get(ids[0])!.reviewed_by).toBe('admin');
  check.close();
});
