import { expect, test } from '@playwright/test';

test('catalog categories, search, empty state and product detail entry', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.product-card')).toHaveCount(6);
  await expect(page.locator('.product-card img').first()).toBeVisible();
  await page.locator('[data-category="Plus"]').click();
  await expect(page.locator('.product-card')).toHaveCount(2);
  await page.locator('[data-category="Codex"]').click();
  await expect(page.locator('.product-card')).toHaveCount(1);
  await expect(page.locator('.product-card h3')).toHaveText('Codex 接码');
  await expect(page.locator('.product-card')).toContainText('一次性接码');
  await page.locator('[data-category="Pro"]').click();
  await expect(page.locator('.product-card')).toHaveCount(3);
  await page.getByRole('searchbox', { name: '搜索商品' }).fill('20x');
  await expect(page.locator('.product-card')).toHaveCount(1);
  await expect(page.locator('.product-card h3')).toHaveText('ChatGPT Pro 20x');
  await page.getByRole('searchbox', { name: '搜索商品' }).fill('missing product');
  await expect(page.getByRole('heading', { name: '没有找到相关商品' })).toBeVisible();
  await page.getByRole('button', { name: '清空筛选' }).click();
  await expect(page.locator('.product-card')).toHaveCount(6);
  await expect(page.locator('.product-card .feature-list, .product-card .status-badge')).toHaveCount(0);
  await page.locator('.product-card').first().getByRole('link', { name: '立即购买', exact: true }).click();
  await expect(page).toHaveURL(/\/products\/chatgpt-plus$/);
});

test('product detail validates the code before opening account confirmation', async ({ page }) => {
  await page.route('**/api/payments/config', route => route.fulfill({ json: { data: { enabled: true, environment: 'sandbox', message: '测试' } } }));
  let calls = 0;
  await page.route('**/api/orders', route => { calls++; return route.fulfill({ status: 503, json: { error: { message: '测试下单失败，请重试。' } } }); });
  await page.goto('/products/chatgpt-plus');
  await expect(page.getByRole('img', { name: 'ChatGPT Plus 商品图片' })).toBeVisible();
  await expect(page.locator('.product-buy-price')).toContainText('130');
  await expect(page.getByRole('heading', { name: '宝贝详情' })).toBeVisible();
  await expect(page.locator('#purchase-contact, #query-password')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('充值地区');
  await expect(page.locator('main')).not.toContainText('本次办理用途');
  await expect(page.locator('main')).not.toContainText('兑换入口');
  await expect(page.getByRole('radio')).toHaveCount(1);
  const buy = page.getByRole('button', { name: '立即购买' });
  await buy.click();
  await expect(page.getByText('请输入正确的四位验证码。')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const code = await page.getByRole('button', { name: /点击更换/ }).innerText();
  await page.getByLabel('验证码', { exact: true }).fill(code);
  await buy.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('信息确认');
  const confirm = dialog.getByRole('button', { name: '继续付款' });
  await confirm.click();
  const message = dialog.locator('.app-message');
  await expect(message).toContainText('联系方式');
  await expect(message).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  expect((await message.boundingBox())?.y).toBeLessThan(40);
  await expect(dialog.locator('#purchase-contact')).toBeFocused();
  await dialog.locator('#purchase-contact').fill('private@example.com');
  await confirm.click();
  await expect(message).toContainText('6–14');
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  expect(calls).toBe(0);
  await dialog.locator('#query-password').fill('query123');
  await confirm.click();
  await expect(dialog.getByRole('alert')).toHaveText('测试下单失败，请重试。');
  expect(calls).toBe(1);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(storage).not.toContain('query123');
  expect(storage).not.toContain('private@example.com');
});

test('sandbox checkout can be previewed before Alipay is enabled and password recovery reports real failures', async ({ page }) => {
  let environment = 'sandbox';
  const message = '支付宝沙箱尚未启用，暂不能创建订单或付款。';
  await page.route('**/api/payments/config', route => route.fulfill({ json: { data: { enabled: false, environment, message } } }));
  let orderAttempts = 0;
  await page.route('**/api/orders', route => {
    if (route.request().method() === 'POST') orderAttempts++;
    return route.continue();
  });
  await page.goto('/products/chatgpt-plus');
  const buy = page.getByRole('button', { name: '立即购买' });
  await expect(buy).toBeEnabled();
  const code = await page.getByRole('button', { name: /点击更换/ }).innerText();
  await page.getByLabel('验证码', { exact: true }).fill(code);
  await buy.click();
  const checkout = page.getByRole('dialog');
  await expect(checkout.getByLabel('优惠码（选填）')).toBeVisible();
  await expect(checkout.getByRole('button', { name: '继续付款' })).toBeDisabled();

  await page.goto('/checkout/chatgpt-pro-5x');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ChatGPT Pro 5x');
  await expect(page.locator('.product-order-total')).toContainText('660');
  await buy.click();
  await expect(page.locator('.app-message')).toContainText(message);
  expect(orderAttempts).toBe(0);

  environment = 'production';
  for (const route of ['/products/chatgpt-plus', '/checkout/chatgpt-plus']) {
    await page.goto(route);
    await expect(page.getByText('支付宝收款暂未开放。')).toBeVisible();
    await expect(buy).toBeDisabled();
  }
  await page.goto('/checkout/unknown');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('无法选择');
  for (const route of ['/orders/unknown', '/pay/example', '/orders/example']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('无法查看');
  }
  await page.goto('/orders');
  await page.getByRole('button', { name: '找回订单', exact: true }).click();
  await page.locator('#recover-contact').fill('someone@example.com');
  await page.locator('#recover-password').fill('wrong-order-password');
  await page.getByRole('button', { name: '查询订单' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('联系方式或查询密码不正确');
});

test('merchant prices agree across catalog, product purchase and checkout', async ({ page }) => {
  const plans = [
    { id: 'chatgpt-plus', price: '130' }, { id: 'chatgpt-pro-5x', price: '660' },
    { id: 'chatgpt-pro-20x', price: '1,150' }, { id: 'chatgpt-pro-50x-ph', price: '3,350' },
  ];
  await page.goto('/');
  for (const [index, plan] of plans.entries()) {
    await page.goto('/');
    await expect(page.locator('.product-card').nth(index).locator('.price')).toContainText(plan.price);
    for (const route of [`/products/${plan.id}`, `/checkout/${plan.id}`]) {
      await page.goto(route);
      await expect(page.locator('.product-buy-price')).toContainText(plan.price);
      await expect(page.locator('.product-order-total strong')).toHaveText(`¥${plan.price}`);
    }
  }
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
  await expect(page.locator('.product-buy-price')).toContainText('130');
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
  await expect(page.locator('.product-card')).toHaveCount(6);
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

test('minimal hero hides the catalog button and retains category filtering', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.locator('.storefront-sidebar')).toBeVisible();
  await expect(page.locator('.service-band, .guide-section, .faq-section, .idea-backdrop')).toHaveCount(0);
  await page.locator('[data-category="Pro"]').click();
  await page.getByRole('searchbox', { name: '搜索商品' }).fill('20x');
  await expect(page.locator('.product-card')).toHaveCount(1);
  await expect(page.getByRole('link', { name: '浏览全部商品' })).toHaveCount(0);
  await page.locator('[data-category="全部"]').click();
  await page.getByRole('button', { name: '清空搜索' }).click();
  await expect(page.locator('.product-card')).toHaveCount(6);
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
    await expect(page.locator('.product-card')).toHaveCount(6);
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
  await expect(page.locator('.product-card')).toHaveCount(6);
});

test('product details distinguish service failure from nonexistent products', async ({ page }) => {
  await page.route('**/api/products/chatgpt-plus', (route) => route.fulfill({
    status: 503, json: { error: { message: '商品服务暂不可用。' } },
  }));
  await page.goto('/products/chatgpt-plus');
  await expect(page.getByRole('heading', { name: '内容加载失败' })).toBeVisible();
  await expect(page.locator('.product-buy-price')).toHaveCount(0);
  await page.unroute('**/api/products/chatgpt-plus');
  await page.getByRole('button', { name: '重新加载' }).click();
  await expect(page.locator('.product-buy-price')).toContainText('130');
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
  expect((await response.json()).data).toHaveLength(5);
});
