import { expect, test } from '@playwright/test';
import type { Order } from '../../src/types/orders';

const example: Order = {
  id: 'WS1234567890123aabbccddeeff0011', productId: 'chatgpt-plus', productName: 'ChatGPT Plus',
  priceCents: 13000, periodMonths: 1, status: 'pending', environment: 'sandbox',
  createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 60000).toISOString(),
  paidAt: null, tradeNo: null,
  details: { entitlements: null, deliveryMethod: null, deliveryTime: null, accountRequirements: null, afterSales: null },
};

for (const width of [390, 1440]) {
  test(`${width}px Alipay checkout, trusted status refresh, orders and official redirect`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let order = { ...example };
    let created = false;
    let paid = false;
    await page.route('**/api/payments/config', route => route.fulfill({ json: { data: {
      enabled: true, environment: 'sandbox', message: '支付宝沙箱测试，不会产生真实扣款。',
    } } }));
    await page.route('**/api/orders', async route => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        expect(body).toEqual({ productId: 'chatgpt-plus', expectedPriceCents: 13000, contact: 'buyer@example.com', queryPassword: 'test-query-password', acceptedTerms: true });
        expect(route.request().headers()['idempotency-key']).toBeTruthy();
        created = true;
        return route.fulfill({ status: 201, json: { data: order } });
      }
      return route.fulfill({ json: { data: created ? [order] : [] } });
    });
    await page.route('**/api/orders/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/payment')) return route.fulfill({ json: { data: { paymentHtml: '<form method="post" action="https://openapi-sandbox.dl.alipaydev.com/gateway.do?test=checkout"><input type="hidden" name="biz_content" value="test"></form>' } } });
      if (path.endsWith('/refresh') && paid) order = { ...order, status: 'paid', paidAt: new Date().toISOString(), tradeNo: '2026101722000000000000000001' };
      return route.fulfill({ json: { data: order } });
    });
    await page.goto('/products/chatgpt-plus');
    await expect(page.getByRole('button', { name: '立即购买' })).toBeEnabled();
    await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
    await page.screenshot({ path: `artifacts/product-detail-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: '立即购买' }).click();
    await expect(page.locator('#contact-error')).toContainText('有效');
    await page.locator('#purchase-contact').fill('buyer@example.com');
    await page.locator('#query-password').fill('test-query-password');
    await page.locator('#accept-terms').check();
    await page.getByRole('button', { name: '立即购买' }).click();
    await expect(page).toHaveURL(new RegExp(`/pay/${order.id}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('订单已创建，等待付款');
    await expect(page.locator('.summary-total')).toContainText('130');
    await expect(page.getByRole('button', { name: '前往支付宝付款' })).toBeEnabled();
    await page.screenshot({ path: `artifacts/alipay-pending-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    // A forged browser return query never changes the payment result.
    await page.goto(`/pay/${order.id}?trade_status=TRADE_SUCCESS&total_amount=0.01`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('订单已创建，等待付款');
    await page.route('https://openapi-sandbox.dl.alipaydev.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Test gateway</h1>' }));
    await page.getByRole('button', { name: '前往支付宝付款' }).click();
    await expect(page).toHaveURL(/openapi-sandbox\.dl\.alipaydev\.com/);
    paid = true;
    await page.goto(`/pay/${order.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('付款已确认');
    await expect(page.locator('.spec-list')).toContainText('2026101722000000000000000001');
    await expect(page.getByRole('button', { name: '前往支付宝付款' })).toHaveCount(0);
    await page.screenshot({ path: `artifacts/alipay-paid-${width}.png`, fullPage: true });
    await page.goto('/orders');
    await expect(page.locator('.server-order-row')).toHaveCount(1);
    await page.getByRole('button', { name: '待付款', exact: true }).click();
    await expect(page.locator('.server-order-row')).toHaveCount(0);
    await page.getByRole('button', { name: '已付款', exact: true }).click();
    await expect(page.locator('.server-order-row')).toContainText('已付款');
    await page.locator('#order-search').fill(order.id);
    await expect(page.locator('.server-order-row')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    expect(errors).toEqual([]);
  });
}

test('contact and query password recovery refreshes the order list without storing credentials', async ({ page }) => {
  let recovered = false;
  await page.route('**/api/orders', route => route.fulfill({ json: { data: recovered ? [example] : [] } }));
  await page.route('**/api/orders/lookup', route => {
    expect(route.request().postDataJSON()).toEqual({ contact: 'buyer@example.com', queryPassword: 'test-query-password' });
    recovered = true;
    return route.fulfill({ json: { data: [example] } });
  });
  await page.goto('/orders');
  await expect(page.locator('.server-order-row')).toHaveCount(0);
  await page.getByRole('button', { name: '找回订单', exact: true }).click();
  await page.getByLabel('联系方式', { exact: true }).fill('buyer@example.com');
  await page.getByLabel('查询密码', { exact: true }).fill('test-query-password');
  await page.getByRole('button', { name: '查询订单' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.server-order-row')).toContainText(example.id);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(storage).not.toContain('test-query-password');
  expect(storage).not.toContain('buyer@example.com');
});

for (const environment of ['sandbox', 'production'] as const) {
  test(`${environment} payment rejects a form pointing to the other environment`, async ({ page }) => {
    const order = { ...example, environment };
    await page.route('**/api/payments/config', route => route.fulfill({ json: { data: { enabled: true, environment, message: '支付环境测试' } } }));
    await page.route('**/api/orders/**', route => {
      if (new URL(route.request().url()).pathname.endsWith('/payment')) {
        const wrong = environment === 'sandbox' ? 'openapi.alipay.com' : 'openapi-sandbox.dl.alipaydev.com';
        return route.fulfill({ json: { data: { paymentHtml: `<form method="post" action="https://${wrong}/gateway.do"></form>` } } });
      }
      return route.fulfill({ json: { data: order } });
    });
    await page.goto(`/pay/${order.id}`);
    if (environment === 'production') await expect(page.getByText('这是正式交易订单，付款将产生真实扣款。', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: '前往支付宝付款' }).click();
    await expect(page.getByText('支付环境或地址异常，请联系支持。')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/pay/${order.id}$`));
  });
}
