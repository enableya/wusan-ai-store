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
  for (const status of ['pending', 'paid'] as const) {
    for (const entry of ['list', 'detail'] as const) {
      test(`${width}px ${entry} can cancel an eligible ${status} order with confirmation`,async({page})=>{
        await page.setViewportSize({width,height:1000});
        let order:Order={...example,status,cancelAction:status==='paid'?'request_refund':'cancel'};
        const ineligible:Order={...example,id:'WS1234567890123ffffffffffffffff',status:'paid',cancelAction:null};
        let requests=0;
        await page.route('**/api/payments/config',route=>route.fulfill({json:{data:{enabled:false,environment:'sandbox',message:'本地测试'}}}));
        await page.route('**/api/orders',route=>route.fulfill({json:{data:[order,ineligible]}}));
        await page.route('**/api/orders/'+example.id,route=>route.fulfill({json:{data:order}}));
        await page.route('**/api/orders/'+example.id+'/redemption',route=>route.fulfill({json:{data:{enabled:false,submitted:false,account:null,result:null,rechargeEmail:null}}}));
        await page.route('**/api/orders/'+example.id+'/cancel',route=>{
          expect(route.request().postDataJSON()).toEqual({expectedAction:status==='paid'?'request_refund':'cancel'});requests++;
          order={...order,status:'cancelled',cancelAction:null,cancellation:{state:status==='paid'?'refund_review':'cancelled',cancelledAt:new Date().toISOString(),message:status==='paid'?'用户申请取消未充值订单，订单已取消，退款待后台审核；款项尚未退回。':'未付款订单已取消，无需退款。'}};
          return route.fulfill({json:{data:order}});
        });
        await page.goto(entry==='list'?'/orders':`/orders/${order.id}`);
        if(entry==='list')await expect(page.locator('.server-order-row').filter({hasText:ineligible.id}).getByRole('button',{name:'取消订单',exact:true})).toHaveCount(0);
        await page.getByRole('button',{name:'取消订单',exact:true}).click();
        const dialog=page.getByRole('dialog',{name:status==='paid'?'申请取消订单':'取消订单',exact:true});
        await expect(dialog).toContainText(order.id);if(status==='paid')await expect(dialog).toContainText('后台审核通过后原路退回');
        await dialog.getByRole('button',{name:'暂不取消',exact:true}).click();expect(requests).toBe(0);
        await page.getByRole('button',{name:'取消订单',exact:true}).click();
        await page.screenshot({path:`artifacts/customer-cancel-${status}-${entry}-${width}.png`,fullPage:true});
        await dialog.getByRole('button',{name:status==='paid'?'提交取消申请':'确认取消订单',exact:true}).click();
        await expect(dialog).toHaveCount(0);expect(requests).toBe(1);
        await expect(page.getByRole('button',{name:'取消订单',exact:true})).toHaveCount(0);
        if(entry==='list')await expect(page.locator('.server-order-row').filter({hasText:order.id})).toContainText(order.cancellation!.message);
        else await expect(page.getByRole('heading',{name:'订单已取消',level:1})).toBeVisible();
        await page.reload();
        await expect(page.getByRole('button',{name:'取消订单',exact:true})).toHaveCount(0);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
      });
    }
  }
}

test('stale cancellation eligibility refreshes the order and does not hide a verified payment',async({page})=>{
  let order:Order={...example,cancelAction:'cancel'};
  await page.route('**/api/payments/config',route=>route.fulfill({json:{data:{enabled:false,environment:'sandbox',message:'本地测试'}}}));
  await page.route('**/api/orders/'+order.id,route=>route.fulfill({json:{data:order}}));
  await page.route('**/api/orders/'+order.id+'/redemption',route=>route.fulfill({json:{data:{enabled:false,submitted:true,account:null,result:{state:'FULFILLED',settlement:'PAID',orderNo:'R-TEST',progress:100,renewal:''}}}}));
  await page.route('**/api/orders/'+order.id+'/cancel',route=>{
    order={...order,status:'paid',cancelAction:null};
    return route.fulfill({status:409,json:{error:{message:'订单已提交充值，不能取消。'}}});
  });
  await page.goto(`/orders/${order.id}`);await page.getByRole('button',{name:'取消订单',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'确认取消订单',exact:true}).click();
  await expect(page.getByRole('heading',{name:'付款已确认',level:1})).toBeVisible();
  await expect(page.getByRole('button',{name:'取消订单',exact:true})).toHaveCount(0);
  await expect(page.locator('.app-message--error')).toContainText('订单已提交充值，不能取消。');
});

test('reordering a closed order opens the same product detail as the homepage', async ({ page }) => {
  await page.route(`**/api/orders/${example.id}`, route => route.fulfill({ json: { data: { ...example, status: 'closed' } } }));
  await page.goto('/');
  const productLink = page.getByRole('link', { name: example.productName, exact: true });
  await expect(productLink).toHaveAttribute('href', `/products/${example.productId}`);

  await page.goto(`/orders/${example.id}`);
  await page.getByRole('link', { name: '重新选择并下单' }).click();
  await expect(page).toHaveURL(new RegExp(`/products/${example.productId}$`));
  await expect(page.getByRole('heading', { level: 1, name: example.productName })).toBeVisible();
  await expect(page.getByRole('heading', { name: '宝贝详情' })).toBeVisible();
});

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
        expect(body).toEqual({ productId: 'chatgpt-plus', expectedPriceCents: 13000, contact: 'buyer@example.com', queryPassword: 'query123' });
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
    await page.goto('/checkout/chatgpt-plus');
    await expect(page.getByRole('button', { name: '立即购买' })).toBeEnabled();
    await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
    await page.screenshot({ path: `artifacts/product-detail-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: '立即购买' }).click();
    await expect(page.locator('.app-message--warning')).toContainText('有效');
    await page.locator('#purchase-contact').fill('buyer@example.com');
    await page.locator('#query-password').fill('query123');
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
    expect(route.request().postDataJSON()).toEqual({ contact: 'buyer@example.com', queryPassword: 'query123' });
    recovered = true;
    return route.fulfill({ json: { data: [example] } });
  });
  await page.goto('/orders');
  await expect(page.locator('.server-order-row')).toHaveCount(0);
  await page.getByRole('button', { name: '找回订单', exact: true }).click();
  await page.getByLabel('联系方式', { exact: true }).fill('buyer@example.com');
  await page.getByLabel('查询密码', { exact: true }).fill('query123');
  await page.getByRole('button', { name: '查询订单' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.server-order-row')).toContainText(example.id);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(storage).not.toContain('query123');
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
    await expect(page.locator('.spec-list')).toContainText('支付方式');
    await expect(page.locator('.spec-list')).not.toContainText(/交付方式|交付时间|售后说明/);
    await expect(page.getByText(/这是正式交易订单|支付宝沙箱订单，仅用于测试/)).toHaveCount(0);
    await page.getByRole('button', { name: '前往支付宝付款' }).click();
    await expect(page.getByText('支付环境或地址异常，请联系支持。')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/pay/${order.id}$`));
  });
}

test('purchase dialog displays the order QR and confirms payment from the server', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/payments/config', route => route.fulfill({ json: { data: {
    enabled: true, environment: 'sandbox', message: '测试',
  } } }));
  await page.route('**/api/orders', route => route.fulfill({ status: 201, json: { data: example } }));
  const qrUrl = 'https://openapi-sandbox.dl.alipaydev.com/gateway.do?test=qr';
  await page.route(qrUrl, route => route.fulfill({ contentType: 'text/html', body: '<p>支付宝扫码页</p>' }));
  await page.route('**/api/orders/' + example.id + '/payment-qr', route => route.fulfill({
    json: { data: { paymentUrl: qrUrl } },
  }));
  await page.route(`**/api/orders/${example.id}/refresh`, route => route.fulfill({
    json: { data: { ...example, status: 'paid' } },
  }));

  const redemptionPath = '**/api/orders/' + example.id + '/redemption';
  const initial = { enabled: true, submitted: false, account: null, result: null };
  await page.route(redemptionPath, route => route.fulfill({ json: { data: initial } }));
  await page.route(redemptionPath + '/policy', route => route.fulfill({ json: { data: { terms: 'test-1', privacy: 'test-2' } } }));
  let previewAttempts = 0;
  await page.route(redemptionPath + '/preview', route => {
    expect(route.request().postDataJSON()).toMatchObject({ consent: true, termsVersion: 'test-1' });
    if (++previewAttempts === 1) return route.fulfill({ status: 400, json: { error: { code: 'INVALID_SESSION', message: 'Session 无效或已过期，请重新获取。' } } });
    return route.fulfill({ json: { data: { ...initial, account: {
      email: 'buyer@example.invalid', plan: 'free', validation: 'confirmed', confirmationId: 'test-confirmation',
    } } } });
  });
  await page.route(redemptionPath + '/submit', route => {
    expect(route.request().postDataJSON()).toEqual({ confirmationId: 'test-confirmation' });
    return route.fulfill({ json: { data: { ...initial, submitted: true, rechargeEmail: 'buyer@example.invalid', result: { orderNo: 'TEST-REDEEM', state: 'QUEUED', settlement: 'UNKNOWN', progress: 0 } } } });
  });
  await page.route(redemptionPath + '/refresh', route => route.fulfill({
    json: { data: { ...initial, submitted: true, rechargeEmail: 'buyer@example.invalid', result: { orderNo: 'TEST-REDEEM', state: 'FULFILLED', settlement: 'PAID', progress: 100 } } },
  }));

  await page.goto('/products/chatgpt-plus');
  const code = await page.getByRole('button', { name: /点击更换/ }).innerText();
  await page.getByLabel('验证码', { exact: true }).fill(code);
  await page.getByRole('button', { name: '立即购买' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/联系方式/).fill('buyer@example.com');
  await dialog.getByLabel(/查询密码/).fill('query123');
  await dialog.getByRole('button', { name: '继续付款' }).click();
  await expect(dialog.getByText(example.id)).toBeVisible();
  await expect(dialog.getByTitle('支付宝付款二维码')).toBeVisible();
  await expect(dialog.locator('[aria-current="step"]')).toContainText('确认付款');
  await expect(dialog).toContainText('¥130');
  await dialog.getByRole('button', { name: '刷新进度' }).click();
  await expect(dialog.getByText('付款已确认', { exact: true })).toBeVisible();
  await expect(dialog.locator('[aria-current="step"]')).toContainText('连接账号');
  await expect(dialog.getByTitle('支付宝付款二维码')).toHaveCount(0);
  await dialog.getByLabel('ChatGPT Session').fill('{"accessToken":"mock-only"}');
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await dialog.getByRole('button', { name: '验证账号并继续' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Session 已失效');
  await expect(dialog.getByLabel('ChatGPT Session')).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.getByLabel('ChatGPT Session')).toHaveValue('{"accessToken":"mock-only"}');
  await dialog.getByRole('button', { name: '重新检测账号' }).click();
  await expect(dialog.getByText('buyer@example.invalid')).toBeVisible();
  await expect(dialog.locator('.redemption-account-card')).toContainText('Plus');
  await expect(dialog.locator('.redemption-account-card')).not.toContainText('free');
  await expect(dialog.getByText('账号检测通过', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '确认并提交充值' })).toBeDisabled();
  await dialog.getByLabel('我已确认以上账号，将为此账号充值').check();
  await dialog.getByRole('button', { name: '确认并提交充值' }).click();
  await expect(dialog.locator('.purchase-dialog-steps [aria-current="step"]')).toContainText('开通结果');
  const loading = dialog.locator('.redemption-loading');
  await expect(loading.getByText('已受理，排队中')).toBeVisible();
  await expect(loading.getByRole('list', { name: '充值流程' }).locator('[aria-current="step"]')).toContainText('排队受理');
  await expect(loading).toHaveCount(0, { timeout: 15000 });
  await expect(dialog.locator('.redemption-result-tag')).toHaveText('充值成功');
  await expect(dialog.locator('.redemption-result-email')).toContainText('buyer@example.invalid');
  await expect(page).toHaveURL(/\/products\/chatgpt-plus$/);
});

for (const width of [390, 1440]) {
  test(`${width}px completed order shows its recharge email after reload`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const email = 'long-recharge-account-address-for-layout-check@example.invalid';
    let rechargeEmail: string | null = email;
    await page.route('**/api/orders/' + example.id, route => route.fulfill({ json: { data: {
      ...example, status: 'paid', staffCheckout: true, priceCents: 0,
    } } }));
    await page.route('**/api/orders/' + example.id + '/redemption', route => route.fulfill({ json: { data: {
      enabled: true, submitted: true, account: null, rechargeEmail,
      result: { orderNo: 'TEST-REDEEM', state: 'FULFILLED', settlement: 'PAID', progress: 100, renewal: '' },
    } } }));
    await page.goto(`/orders/${example.id}`);
    const result = page.getByRole('region', { name: '开通结果' });
    await expect(result.locator('.redemption-result-tag')).toHaveText('充值成功');
    await expect(result.locator('.redemption-result-email dt')).toHaveText('开通邮箱');
    await expect(result.locator('.redemption-result-email dd')).toHaveText(email);
    await page.reload();
    await expect(result.locator('.redemption-result-email dd')).toHaveText(email);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    const emailLayout = await result.locator('.redemption-result-email').evaluate(element => ({
      width: element.clientWidth, contentWidth: element.scrollWidth,
    }));
    expect(emailLayout.contentWidth).toBeLessThanOrEqual(emailLayout.width + 1);
    await result.screenshot({ path: `artifacts/order-recharge-email-${width}.png` });
    // Old records without a recharge email must not imply a different contact account.
    rechargeEmail = null;
    await page.reload();
    await expect(result.locator('.redemption-result-email dd')).toHaveText('未记录');
  });
}

test('guest sharing, registration, personal invitation and mobile referral layout', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/products/chatgpt-plus');
  await page.getByRole('button', {name: '分享给好友', exact: true}).click();
  await expect(page.getByRole('dialog', {name:'分享给好友'})).toBeVisible();
  await page.getByRole('button', {name:'不登录，直接复制链接'}).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('http://127.0.0.1:5220/products/chatgpt-plus');
  await page.getByRole('button', {name:'分享给好友',exact:true}).click();
  await page.getByRole('button', {name:'前往登录'}).click();
  await page.getByRole('button', {name:'没有账号？立即注册'}).click();
  await page.getByLabel('账号', {exact:true}).fill(`invite_${Date.now()}`);
  await page.getByLabel('登录密码', {exact:true}).fill('test-invite-1234');
  await page.getByRole('button', {name:'注册并登录'}).click();
  await expect(page.getByRole('dialog', {name:'分享链接'})).toBeVisible();
  const link = await page.getByRole('textbox', {name:'分享链接'}).inputValue();
  expect(link).toMatch(/\/products\/chatgpt-plus\?ref=[a-f0-9]{16}$/);
  await page.getByRole('button', {name:'关闭弹窗'}).click();
  await page.getByRole('link', {name:'邀请返利',exact:true}).first().click();
  await expect(page.getByText('暂无邀请返利记录')).toBeVisible();
  await page.screenshot({path:'/tmp/wusan-referrals-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'/tmp/wusan-referrals-mobile.png',fullPage:true});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('admin referral module displays attribution, amounts, status and filters', async ({page}) => {
  await page.route('**/api/admin/session', route => route.fulfill({json:{data:{configured:true, authenticated:true, username:'admin',role:'super_admin',permissions:[]}}}));
  await page.route('**/api/admin/referrals?**', route => route.fulfill({json:{data:{total:1,earnedCents:500,page:1,pageSize:20,rows:[{
    orderId:'WS1234567890123aabbccddeeff0011',displayOrderId:'WS1234567890123aabbccddeeff0011',inviter:'example_user',inviteCode:'abc123def4567890',productName:'ChatGPT Plus',orderCents:10,amountCents:500,environment:'production',status:'earned',createdAt:'2026-11-08T08:00:00Z',earnedAt:'2026-11-08T08:01:00Z',
  }]}}}));
  await page.goto('/admin?tab=referrals');
  await expect(page.getByRole('heading',{name:'邀请返利',exact:true})).toBeVisible();
  await expect(page.getByRole('cell',{name:'example_user abc123def4567890'})).toBeVisible();
  await expect(page.getByRole('cell',{name:'¥5',exact:true})).toBeVisible();
  await expect(page.getByLabel('数据环境')).toHaveCount(0);
  const status = page.getByLabel('返利状态');
  const refresh = page.getByRole('button', { name: '刷新', exact: true });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const selectBox = await status.boundingBox();
    const refreshBox = await refresh.boundingBox();
    expect(selectBox?.height).toBe(44);
    expect(refreshBox?.height).toBe(44);
    expect(selectBox?.y).toBe(refreshBox?.y);
  }
  await status.click();
  const menu = page.getByRole('listbox');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('option', { name: '全部状态' })).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: '/tmp/wusan-referral-select.png' });
  const filtered = page.waitForRequest(request => new URL(request.url()).searchParams.get('status') === 'earned');
  await menu.getByRole('option', { name: '已获得 · 待结算' }).click();
  await filtered;
  await expect(status).toHaveText('已获得 · 待结算');
  await status.press('ArrowDown');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(status).toBeFocused();
  await expect(page.getByText('已获得 · 待结算',{exact:true}).last()).toBeVisible();
  await page.screenshot({path:'/tmp/wusan-admin-referrals.png',fullPage:true});
});
