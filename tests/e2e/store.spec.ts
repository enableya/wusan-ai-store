import { expect, test } from '@playwright/test';

test('catalog categories, search, empty state and product detail entry', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.product-card')).toHaveCount(4);
  await expect(page.locator('.product-card img').first()).toBeVisible();
  await page.locator('[data-category="Plus"]').click();
  await expect(page.locator('.product-card')).toHaveCount(1);
  await page.locator('[data-category="Pro"]').click();
  await expect(page.locator('.product-card')).toHaveCount(3);
  await page.getByRole('searchbox', { name: '搜索商品' }).fill('20x');
  await expect(page.locator('.product-card')).toHaveCount(1);
  await expect(page.locator('.product-card h3')).toHaveText('ChatGPT Pro 20x');
  await page.getByRole('searchbox', { name: '搜索商品' }).fill('missing product');
  await expect(page.getByRole('heading', { name: '没有找到相关商品' })).toBeVisible();
  await page.getByRole('button', { name: '清空筛选' }).click();
  await expect(page.locator('.product-card')).toHaveCount(4);
  await expect(page.locator('.product-card .feature-list, .product-card .status-badge')).toHaveCount(0);
  await page.locator('.product-card').first().getByRole('link', { name: '查看详情', exact: true }).click();
  await expect(page).toHaveURL(/\/products\/chatgpt-plus$/);
});

test('checkout validation, privacy and idempotent local selections', async ({ page }) => {
  await page.goto('/products/chatgpt-plus');
  await expect(page.locator('.product-art .art-symbol')).toHaveText('Plus');
  await expect(page.locator('.purchase-price')).toContainText('130');
  await page.getByRole('tab', { name: '购买指南' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('订阅流程');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '服务须知' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('link', { name: '核对订阅信息' }).click();
  await expect(page).toHaveURL(/\/checkout\/chatgpt-plus$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: '核对订阅信息' })).toBeVisible();
  await page.getByRole('button', { name: '保存本机套餐清单' }).click();
  await expect(page.locator('#email-error')).toContainText('有效');
  await expect(page.locator('#terms-error')).toContainText('勾选');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await page.goto('/checkout/chatgpt-plus');
    await page.locator('#contact-email').fill('private@example.com');
    await page.locator('#accept-terms').check();
    await page.getByRole('button', { name: '保存本机套餐清单' }).click();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.locator('.draft-row')).toHaveCount(1);
  }
  await expect(page.locator('#order-results')).toContainText('还没有订单');
  const stored = await page.evaluate(() => localStorage.getItem('wusan-ai:selections:v1'));
  expect(stored).not.toContain('private@example.com');
  expect(stored).not.toContain('email');
  await page.locator('#order-search').fill('unknown');
  await expect(page.locator('.draft-row')).toHaveCount(0);
  await page.locator('#order-search').fill('');
  await page.getByRole('button', { name: '已付款', exact: true }).click();
  await expect(page.locator('#order-results')).toContainText('暂无已付款订单');
  await page.locator('[data-order-filter="全部"]').click();
  await page.locator('.draft-row .icon-button').click();
  await page.getByRole('button', { name: '删除草稿', exact: true }).click();
  await expect(page.locator('.draft-row')).toHaveCount(0);
});

test('unconfigured Alipay disables checkout and email recovery remains honest', async ({ page }) => {
  await page.goto('/checkout/chatgpt-pro-5x');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('核对订阅信息');
  await expect(page.locator('.summary-total')).toContainText('660');
  await expect(page.getByRole('button', { name: '支付宝待配置' })).toBeDisabled();
  await page.goto('/checkout/unknown');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('无法选择');
  await page.goto('/orders/unknown');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('无法查看');
  await page.goto('/pay/example');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('无法查看');
  await page.goto('/orders/example');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('无法查看');
  await page.goto('/orders');
  await page.getByRole('button', { name: '通过邮箱找回' }).click();
  await page.locator('#recover-email').fill('someone@example.com');
  await page.getByRole('button', { name: '获取验证码' }).click();
  await expect(page.locator('#recover-error')).toContainText('未发送');
});

test('merchant prices agree across catalog, details, checkout and saved selections', async ({ page }) => {
  const plans = [
    { id: 'chatgpt-plus', price: '130', cents: 13000 },
    { id: 'chatgpt-pro-5x', price: '660', cents: 66000 },
    { id: 'chatgpt-pro-20x', price: '1,150', cents: 115000 },
    { id: 'chatgpt-pro-50x-ph', price: '3,350', cents: 335000 },
  ];
  await page.goto('/');
  for (const [index, plan] of plans.entries()) {
    const card = page.locator('.product-card').nth(index);
    await expect(card.locator('.price')).toContainText(plan.price);
    await expect(card.getByRole('link', { name: '查看详情', exact: true })).toBeVisible();
  }
  await expect(page.locator('main')).not.toContainText('示例价格');
  for (const plan of plans) {
    await page.goto(`/products/${plan.id}`);
    await expect(page.locator('.purchase-price .price')).toContainText(plan.price);
    await page.getByRole('link', { name: '核对订阅信息' }).click();
    await expect(page.locator('.summary-total strong')).toHaveText(`¥${plan.price}`);
    await page.locator('#contact-email').fill('private@example.com');
    await page.locator('#accept-terms').check();
    await page.getByRole('button', { name: '保存本机套餐清单' }).click();
    await expect(page).toHaveURL(/\/orders$/);
    await page.locator('.draft-row').first().getByRole('link', { name: '查看', exact: true }).click();
    await expect(page.locator('.spec-list')).toContainText(`¥${plan.price}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('套餐草稿详情');
  }
  const selections = await page.evaluate(() => JSON.parse(localStorage.getItem('wusan-ai:selections:v1') || '[]'));
  expect(selections).toHaveLength(4);
  for (const plan of plans) {
    expect(selections.find((item: { productId: string }) => item.productId === plan.id)).toMatchObject({ priceCents: plan.cents });
  }
  expect(JSON.stringify(selections)).not.toContain('private@example.com');
});

test('historical selections retain saved amounts and show the current merchant price', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('wusan-ai:selections:v1', JSON.stringify([{
    id: 'legacy-plus', productId: 'chatgpt-plus', productName: 'ChatGPT Plus',
    priceCents: 12000, createdAt: '2026-10-14T08:00:00Z',
  }])));
  await page.goto('/orders/legacy-plus');
  await expect(page.locator('.spec-list')).toContainText('¥120');
  await expect(page.locator('main')).toContainText('当前本站售价为 ¥130');
  await page.getByRole('link', { name: '查看当前套餐' }).click();
  await expect(page.locator('.purchase-price .price')).toContainText('130');
});

test('help full-text search, categories and reset', async ({ page }) => {
  await page.goto('/help');
  await page.locator('#help-search').fill('账号密码');
  await expect(page.locator('.article-card').first()).toBeVisible();
  await page.locator('#help-search').fill('unfindable-query');
  await expect(page.locator('#help-results')).toContainText('没有找到相关内容');
  await page.getByRole('button', { name: '查看全部文章' }).click();
  await expect(page.locator('.article-card')).toHaveCount(4);
  await page.getByRole('button', { name: '购买指南', exact: true }).click();
  await expect(page.locator('.article-card')).toHaveCount(1);
});

test('theme preference persists', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.getByRole('heading', { level: 1 }).waitFor();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(247, 249, 252)');
  await expect(page.locator('.storefront-hero')).toBeVisible();
  await expect(page.locator('.product-card').first()).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.getByRole('button', { name: '切换外观' }).click();
  await page.getByRole('menuitemradio', { name: '深色' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.product-card')).toHaveCount(4);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.screenshot({ path: 'artifacts/react-home-dark.png', fullPage: true });
});

test('mobile navigation closes with Escape and restores focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '打开导航' }).click();
  await expect(page.locator('#mobile-nav a[aria-current="page"]')).toHaveText('订阅套餐');
  await expect(page.getByRole('button', { name: '关闭导航' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#mobile-nav')).toBeHidden();
  await expect(page.getByRole('button', { name: '打开导航' })).toBeFocused();
});

test('minimal hero returns to the full catalog without decorative content', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.locator('.storefront-sidebar')).toBeVisible();
  await expect(page.locator('.service-band, .guide-section, .faq-section, .idea-backdrop')).toHaveCount(0);
  await page.locator('[data-category="Pro"]').click();
  await page.getByRole('searchbox', { name: '搜索商品' }).fill('20x');
  await expect(page.locator('.product-card')).toHaveCount(1);
  await page.getByRole('link', { name: '浏览全部商品' }).click();
  await expect(page.locator('.product-card')).toHaveCount(4);
  await expect(page.getByRole('searchbox', { name: '搜索商品' })).toHaveValue('');
  await page.goto('/');
  await page.screenshot({ path: 'artifacts/storefront-desktop.png', fullPage: true });
});

const routes = ['/', '/products/chatgpt-plus', '/products/chatgpt-pro-5x', '/products/chatgpt-pro-20x', '/products/chatgpt-pro-50x-ph', '/checkout/chatgpt-plus', '/checkout/chatgpt-pro-5x', '/checkout/chatgpt-pro-20x', '/checkout/chatgpt-pro-50x-ph', '/orders', '/orders/example', '/help', '/help/getting-started', '/support', '/terms', '/privacy', '/missing'];
for (const width of [320, 360, 390, 768, 1024, 1440, 1920]) {
  test(`${width}px responsive layout and asset checks`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('requestfailed', (request) => {
      if (request.failure()?.errorText !== 'net::ERR_ABORTED') errors.push(request.url());
    });
    await page.setViewportSize({ width, height: width < 680 ? 844 : 1000 });
    for (const route of routes) {
      await page.goto(route);
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.locator('.api-state[data-state="loading"]')).toHaveCount(0);
      await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0));
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        clipped: [...document.querySelectorAll<HTMLElement>('h1, h2, h3, .button, .price, .brand-name')].filter((node) => node.scrollWidth > node.clientWidth + 1).map((node) => node.textContent),
        images: [...document.images].every((image) => image.complete && image.naturalWidth > 0),
      }));
      expect(layout.overflow, route).toBe(false);
      expect(layout.clipped, route).toEqual([]);
      expect(layout.images, route).toBe(true);
      if (width === 1440 && ['/products/chatgpt-plus', '/checkout/chatgpt-plus', '/orders', '/help'].includes(route)) {
        await page.screenshot({ path: `artifacts/refined-${route.split('/').filter(Boolean).join('-')}.png`, fullPage: true });
      }
    }
    await page.goto('/');
    await expect(page.locator('.product-card')).toHaveCount(4);
    const cards = await page.locator('.product-card').evaluateAll((nodes) => nodes.map((node) => ({
      left: node.getBoundingClientRect().left,
      top: node.getBoundingClientRect().top,
      height: node.getBoundingClientRect().height,
      buttonTop: node.querySelector('.button')!.getBoundingClientRect().top,
    })));
    if (width < 360) expect(new Set(cards.map((card) => card.left)).size).toBe(1);
    if (width >= 360 && width <= 680) expect(new Set(cards.map((card) => card.left)).size).toBe(2);
    for (const top of new Set(cards.map(card => card.top))) expect(new Set(cards.filter(card => card.top === top).map(card => card.buttonTop)).size).toBe(1);
    if (width === 1440) expect(Math.max(...cards.map((card) => card.height))).toBeLessThan(500);
    await page.screenshot({ path: `artifacts/react-home-${width}.png`, fullPage: true });
    if (width === 390) await page.screenshot({ path: 'artifacts/refined-mobile-viewport.png' });
    if (width < 680) {
      await page.getByRole('button', { name: '打开导航' }).click();
      await expect(page.locator('#mobile-nav')).toBeVisible();
      await page.locator('#mobile-nav').getByRole('link', { name: '我的订单' }).click();
      await expect(page.locator('#mobile-nav')).toBeHidden();
    }
    expect(errors).toEqual([]);
  });
}

test('homepage renders the API response instead of a bundled catalog', async ({ page }) => {
  await page.route('**/api/home', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.data.products[0].name = '接口商品验证';
    body.data.products[0].priceCents = 13100;
    body.data.hero.title = '接口首页验证';
    await route.fulfill({ response, json: body });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('接口首页验证');
  await expect(page.locator('.product-card').first()).toContainText('接口商品验证');
  await expect(page.locator('.product-card .price').first()).toContainText('131');
});

test('homepage API failure has no local fallback and supports retry', async ({ page }) => {
  let failing = true;
  await page.route('**/api/home', (route) => failing
    ? route.fulfill({ status: 503, json: { error: { message: '商品服务暂不可用。' } } })
    : route.continue());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '内容加载失败' })).toBeVisible();
  await expect(page.locator('.product-card')).toHaveCount(0);
  failing = false;
  await page.getByRole('button', { name: '重新加载' }).click();
  await expect(page.locator('.product-card')).toHaveCount(4);
});

test('product details distinguish service failure from nonexistent products', async ({ page }) => {
  await page.route('**/api/products/chatgpt-plus', (route) => route.fulfill({
    status: 503, json: { error: { message: '商品服务暂不可用。' } },
  }));
  await page.goto('/products/chatgpt-plus');
  await expect(page.getByRole('heading', { name: '内容加载失败' })).toBeVisible();
  await expect(page.locator('.purchase-price')).toHaveCount(0);
  await page.unroute('**/api/products/chatgpt-plus');
  await page.getByRole('button', { name: '重新加载' }).click();
  await expect(page.locator('.purchase-price')).toContainText('130');
  await page.goto('/products/no-such-product');
  await expect(page.getByRole('heading', { name: '套餐不存在或已下架' })).toBeVisible();
});

test('empty catalog is an actual empty state without seeded product fallback', async ({ page }) => {
  await page.route('**/api/home', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.data.products = [];
    await route.fulfill({ response, json: body });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '暂无可选套餐' })).toBeVisible();
  await expect(page.locator('.product-card')).toHaveCount(0);
});

test('database and server sources cannot be downloaded through the frontend server', async ({ request }) => {
  for (const path of ['/server/data/store.sqlite', '/server/index.ts', '/server/seed/catalog.ts', '/.env.example']) {
    const response = await request.get(path);
    expect([403, 404]).toContain(response.status());
  }
  const response = await request.get('/api/products');
  expect(response.ok()).toBe(true);
  expect((await response.json()).data).toHaveLength(4);
});
