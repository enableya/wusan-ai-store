import { expect, test } from '@playwright/test';
import type { Order } from '../../src/types/orders';

const example: Order = {
  id: 'WS1234567890123aabbccddeeff0011', productId: 'chatgpt-plus', productName: 'ChatGPT Plus',
  priceCents: 13000, periodMonths: 1, status: 'pending', environment: 'sandbox',
  createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 60000).toISOString(),
  paidAt: null, tradeNo: null,
  details: { entitlements: null, deliveryMethod: null, deliveryTime: null, accountRequirements: null, afterSales: null },
};

for(const width of [390,1440]) {
  test(`${width}px finished account costs 88 yuan and follows information payment card delivery`,async({page})=>{
    await page.setViewportSize({width,height:1000});
    let order:Order={...example,productId:'chatgpt-plus-account',productName:'ChatGPT Plus 成品号',priceCents:8800,deliveryType:'voucher',cardDelivery:{delivered:false}};
    let claims=0,redemptions=0;
    const code='MOCK-FINISHED-ACCOUNT-CARD-1234567890123456';
    await page.route('**/api/payments/config',route=>route.fulfill({json:{data:{enabled:true,environment:'sandbox',message:'沙箱测试'}}}));
    await page.route('**/api/orders',route=>{
      expect(route.request().postDataJSON()).toMatchObject({productId:'chatgpt-plus-account',expectedPriceCents:8800});
      return route.fulfill({status:201,json:{data:order}});
    });
    await page.route('**/api/orders/'+order.id,route=>route.fulfill({json:{data:order}}));
    await page.route('**/api/orders/'+order.id+'/payment-qr',route=>route.fulfill({status:503,json:{error:{message:'测试不打开实际支付网关'}}}));
    await page.route('**/api/orders/'+order.id+'/refresh',route=>{order={...order,status:'paid',cardDelivery:{delivered:true}};return route.fulfill({json:{data:order}});});
    await page.route('**/api/orders/'+order.id+'/card',route=>{
      claims++;return route.fulfill({json:{data:{delivered:true,code,deliveredAt:new Date().toISOString(),usageInstructions:'1. 复制卡密。\n2. 按指引使用。<b>这是普通文本</b>'}}});
    });
    await page.route('**/api/orders/'+order.id+'/redemption**',route=>{redemptions++;return route.abort();});
    await page.goto('/products/chatgpt-plus-account');
    await expect(page.getByRole('heading',{level:1,name:'ChatGPT Plus 成品号'})).toBeVisible();
    await expect(page.locator('.product-buy-price')).toContainText('88');
    await expect(page.locator('.product-buy-price')).toContainText('/ 份');
    await expect(page.locator('.item-details-content')).not.toContainText('30 天质保');
    await page.getByLabel('验证码',{exact:true}).fill(await page.getByRole('button',{name:/点击更换/}).innerText());
    await page.getByRole('button',{name:'立即购买',exact:true}).click();
    const dialog=page.getByRole('dialog');
    await expect(dialog.locator('.purchase-dialog-steps li')).toHaveCount(3);
    await expect(dialog.locator('.purchase-dialog-steps li')).toContainText(['信息确认','确认付款','获取卡密']);
    await dialog.getByLabel(/联系方式/).fill('account-buyer@example.invalid');await dialog.getByLabel(/查询密码/).fill('query888');
    await dialog.getByRole('button',{name:'继续付款',exact:true}).click();
    await expect(dialog.locator('.purchase-dialog-steps [aria-current="step"]')).toContainText('确认付款');
    expect(claims).toBe(0);
    await dialog.getByRole('button',{name:'刷新进度',exact:true}).click();
    await expect(dialog.getByRole('region',{name:'获取卡密'})).toContainText(code);
    await expect(dialog.getByRole('region',{name:'使用说明'})).toContainText('2. 按指引使用。<b>这是普通文本</b>');
    await expect(dialog.locator('.card-usage-instructions b')).toHaveCount(0);
    await expect(dialog.getByLabel('ChatGPT Session')).toHaveCount(0);expect(redemptions).toBe(0);
    await page.context().grantPermissions(['clipboard-read','clipboard-write']);
    await dialog.getByRole('button',{name:'复制卡密',exact:true}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(code);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
    await dialog.screenshot({path:`artifacts/finished-account-dialog-${width}.png`});
    await dialog.getByRole('button',{name:'关闭购买弹窗',exact:true}).click();await page.goto('/orders/'+order.id);
    await expect(page.getByRole('region',{name:'获取卡密'})).toContainText(code);
    await expect(page.locator('.spec-list')).not.toContainText('个月');
    await page.reload();await expect(page.getByRole('region',{name:'获取卡密'})).toContainText(code);expect(redemptions).toBe(0);
  });
}

for (const viewport of [
  { width: 320, height: 568 }, { width: 390, height: 640 },
  { width: 1440, height: 620 }, { width: 1440, height: 1000 },
]) {
  test(`${viewport.width}x${viewport.height} purchase dialog scrolls inside rounded edges with a fixed close button`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route('**/api/payments/config', route => route.fulfill({ json: { data: {
      enabled: false, environment: 'sandbox', message: '本地测试',
    } } }));
    await page.goto('/products/chatgpt-plus');
    await page.getByLabel('验证码', { exact: true }).fill(await page.getByRole('button', { name: /点击更换/ }).innerText());
    await page.getByRole('button', { name: '立即购买', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const body = dialog.locator('.purchase-dialog-body');
    const close = dialog.getByRole('button', { name: '关闭购买弹窗' });
    const closeBefore = await close.boundingBox();
    const layout = await dialog.evaluate(element => {
      const body = element.querySelector('.purchase-dialog-body')!;
      const header = element.querySelector('.purchase-dialog-header')!;
      return {
        overflow: getComputedStyle(element).overflowY,
        scrollbar: getComputedStyle(body).scrollbarWidth,
        dialogHeight: element.clientHeight, dialogContentHeight: element.scrollHeight,
        bodyHeight: body.clientHeight, bodyContentHeight: body.scrollHeight,
        headerBottom: header.getBoundingClientRect().bottom, bodyTop: body.getBoundingClientRect().top,
        bottomInset: element.getBoundingClientRect().bottom - body.getBoundingClientRect().bottom,
        horizontalOverflow: body.scrollWidth > body.clientWidth + 1,
      };
    });
    expect(layout.overflow).toBe('hidden');
    expect(layout.scrollbar).toBe('thin');
    expect(layout.dialogContentHeight).toBeLessThanOrEqual(layout.dialogHeight + 1);
    expect(layout.bodyTop).toBeGreaterThanOrEqual(layout.headerBottom - 1);
    expect(layout.bottomInset).toBeGreaterThanOrEqual(14);
    expect(layout.horizontalOverflow).toBe(false);
    if (viewport.height < 700) expect(layout.bodyContentHeight).toBeGreaterThan(layout.bodyHeight);
    await dialog.screenshot({ path: `artifacts/purchase-scroll-top-${viewport.width}-${viewport.height}.png` });
    await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(dialog.getByRole('button', { name: '联系客服', exact: true })).toBeInViewport();
    await expect(close).toBeInViewport();
    expect((await close.boundingBox())!.y).toBeCloseTo(closeBefore!.y, 1);
    await dialog.screenshot({ path: `artifacts/purchase-scroll-bottom-${viewport.width}-${viewport.height}.png` });
    await close.click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole('button', { name: '立即购买', exact: true }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });
}

for (const width of [390, 1440]) {
  test(`${width}px coupon updates dialog price and preserves original price after creating an order`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const order: Order = { ...example, priceCents: 1, originalPriceCents: 13000 };
    await page.route('**/api/payments/config', route => route.fulfill({ json: { data: { enabled: true, environment: 'sandbox', message: '本地测试' } } }));
    await page.route('**/api/coupons/quote', route => {
      const { code } = route.request().postDataJSON();
      return code === 'MOCK-SAVE' ? route.fulfill({ json: { data: { code, originalCents: 13000, discountCents: 12999, payableCents: 1 } } })
        : route.fulfill({ status: 400, json: { error: { message: '模拟优惠券无效。' } } });
    });
    await page.route('**/api/orders', route => {
      expect(route.request().postDataJSON()).toMatchObject({ expectedPriceCents: 13000, couponCode: 'MOCK-SAVE', expectedDiscountCents: 12999 });
      return route.fulfill({ status: 201, json: { data: order } });
    });
    await page.route('**/api/orders/' + order.id + '/payment-qr', route => route.fulfill({ status: 503, json: { error: { message: '本地测试不打开支付网关。' } } }));
    await page.route('**/api/orders/' + order.id + '/refresh', route => route.fulfill({ json: { data: order } }));
    await page.goto('/products/chatgpt-plus');
    await page.getByLabel('验证码', { exact: true }).fill(await page.getByRole('button', { name: /点击更换/ }).innerText());
    await page.getByRole('button', { name: '立即购买', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const price = dialog.locator('.purchase-dialog-price');
    await expect(price.locator('strong')).toHaveText('¥130');
    await expect(price.locator('del')).toHaveCount(0);
    const coupon = dialog.getByLabel('优惠码（选填）');
    await coupon.fill('MOCK-SAVE'); await coupon.blur();
    await expect(price.locator('strong')).toHaveText('¥0.01');
    await expect(price.locator('del')).toHaveText('¥130');
    await page.screenshot({ path: `artifacts/coupon-dialog-price-${width}.png` });
    await coupon.fill('INVALID');
    await expect(price.locator('strong')).toHaveText('¥130');
    await expect(price.locator('del')).toHaveCount(0);
    await coupon.blur();
    await expect(page.locator('.app-message--error')).toContainText('模拟优惠券无效');
    await coupon.fill('MOCK-SAVE'); await coupon.blur();
    await expect(price.locator('strong')).toHaveText('¥0.01');
    await coupon.clear();
    await expect(price.locator('strong')).toHaveText('¥130');
    await expect(price.locator('del')).toHaveCount(0);
    await coupon.fill('MOCK-SAVE'); await coupon.blur();
    await expect(price.locator('strong')).toHaveText('¥0.01');
    await dialog.getByLabel(/^联系方式/).fill('mock@example.invalid');
    await dialog.getByLabel(/^查询密码/).fill('query123');
    await dialog.getByRole('button', { name: '继续付款', exact: true }).click();
    await expect(dialog.getByText(order.id, { exact: true })).toBeVisible();
    await expect(price.locator('strong')).toHaveText('¥0.01');
    await expect(price.locator('del')).toHaveText('¥130');
    await dialog.getByRole('button', { name: '关闭购买弹窗' }).click();
    await page.getByRole('button', { name: '查看订单进度', exact: true }).click();
    await expect(price.locator('del')).toHaveText('¥130');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  });
}

for (const width of [390, 1440]) {
  test(`${width}px order list displays recharge results separately from payment status`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const states = [
      { state: '', settlement: '', renewal: '', submitted: false, label: '待充值', tone: 'neutral' },
      { state: 'QUEUED', settlement: 'UNKNOWN', renewal: '', submitted: true, label: '已受理，排队中', tone: 'progress' },
      { state: 'FULFILLING', settlement: 'UNKNOWN', renewal: '', submitted: true, label: '处理中', tone: 'progress' },
      { state: 'FULFILLED', settlement: 'UNKNOWN', renewal: '', submitted: true, label: '办理完成，等待结算确认', tone: 'progress' },
      { state: 'FULFILLED', settlement: 'PAID', renewal: '', submitted: true, label: '充值成功', tone: 'success' },
      { state: 'MANUAL_REVIEW', settlement: 'UNKNOWN', renewal: '', submitted: true, label: '待人工确认', tone: 'attention' },
      { state: 'NO_CHARGE', settlement: 'NO_CHARGE', renewal: '', submitted: true, label: '充值未完成，本次未扣款', tone: 'failure' },
      { state: '', settlement: '', renewal: 'ready', submitted: true, label: '续费已设置，等待下个周期扣款', tone: 'progress' },
    ];
    const orders: Order[] = states.map(({ label, tone, ...recharge }, index) => ({ ...example,
      id: `WS1234567890123${index.toString().repeat(16)}`, status: 'paid', recharge,
      ...(index === 4 ? { staffCheckout: true, priceCents: 0, fulfillment: { status: 'succeeded', rechargeEmail: 'recharge@example.invalid' } } : {}),
    }));
    await page.route('**/api/customer/session', route => route.fulfill({ json: { data: { id: 'test', username: 'test', inviteCode: 'test', staffCheckout: true } } }));
    await page.route('**/api/orders', route => route.fulfill({ json: { data: orders } }));
    await page.goto('/orders');
    for (const [index, state] of states.entries()) {
      const row = page.locator('.server-order-row').filter({ hasText: orders[index].id });
      await expect(row.locator('.order-recharge-status')).toHaveText(`充值状态：${state.label}`);
      await expect(row.locator('.order-recharge-status')).toHaveAttribute('data-tone', state.tone);
    }
    const success = page.locator('.server-order-row').filter({ hasText: orders[4].id });
    await expect(success.locator('.order-recharge-email')).toHaveText('充值邮箱：recharge@example.invalid');
    await expect(success.locator('.status-badge')).toHaveText('免付开通');
    await page.reload();
    await expect(success.locator('.order-recharge-status')).toHaveText('充值状态：充值成功');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    await page.screenshot({ path: `artifacts/order-recharge-status-${width}.png`, fullPage: true });
  });
}

for (const width of [390, 1440]) {
  test(`${width}px unavailable cancellation displays its reason in the list and detail`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const reason = '暂无法核实支付状态，当前不能取消订单。';
    const order = { ...example, cancelAction: null, cancelUnavailableReason: reason };
    await page.route('**/api/orders', route => route.fulfill({ json: { data: [order] } }));
    await page.route('**/api/orders/' + order.id, route => route.fulfill({ json: { data: order } }));
    await page.route('**/api/payments/config', route => route.fulfill({ json: { data: { enabled: false, environment: 'sandbox', message: '本地支付关闭' } } }));
    for (const entry of ['/orders', `/orders/${order.id}`]) {
      await page.goto(entry);
      await expect(page.getByRole('button', { name: '取消订单', exact: true })).toBeDisabled();
      await expect(page.getByText(reason, { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    }
  });
}

for (const width of [390, 1440]) {
  test(`${width}px order list shows recharge emails only for successful subscriptions`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const email = 'long-recharge-account-address-for-layout-check@example.invalid';
    const complete: Order = { ...example, status: 'paid', fulfillment: { status: 'succeeded', rechargeEmail: email } };
    const legacy: Order = { ...complete, id: 'WS1234567890123ffffffffffffffff', fulfillment: { status: 'succeeded', rechargeEmail: null } };
    const pending: Order = { ...example, id: 'WS12345678901230000000000000000' };
    const paid: Order = { ...pending, id: 'WS12345678901231111111111111111', status: 'paid' };
    await page.route('**/api/orders', route => route.fulfill({ json: { data: [complete, legacy, pending, paid] } }));
    await page.goto('/orders');
    const completedRow = page.locator('.server-order-row').filter({ hasText: complete.id });
    await expect(completedRow.locator('.order-recharge-email')).toHaveText(`充值邮箱：${email}`);
    await expect(page.locator('.server-order-row').filter({ hasText: legacy.id }).locator('.order-recharge-email')).toHaveText('充值邮箱：未记录');
    for (const order of [pending, paid]) await expect(page.locator('.server-order-row').filter({ hasText: order.id }).locator('.order-recharge-email')).toHaveCount(0);
    await page.reload();
    await expect(completedRow.locator('.order-recharge-email')).toHaveText(`充值邮箱：${email}`);
    const layout = await completedRow.locator('.order-recharge-email').evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth }));
    expect(layout.content).toBeLessThanOrEqual(layout.width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    await page.screenshot({ path: `artifacts/order-list-recharge-email-${width}.png`, fullPage: true });
  });
}

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

for (const width of [390, 1440]) {
  test(`${width}px cancellation follows validation and recharge submission on the same detail page`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const order: Order = { ...example, status: 'paid', cancelAction: 'request_refund' };
    const initial = { enabled: true, submitted: false, account: null, result: null, rechargeEmail: null };
    const path = '**/api/orders/' + order.id;
    let finishPreview: () => void = () => {};
    let finishSubmit: () => void = () => {};
    let submitted = false;
    await page.route('**/api/payments/config', route => route.fulfill({ json: { data: { enabled: false, environment: 'sandbox', message: '本地测试' } } }));
    await page.route('**/api/orders', route => route.fulfill({ json: { data: [{ ...order, cancelAction: submitted ? null : 'request_refund' }] } }));
    await page.route(path, route => route.fulfill({ json: { data: order } }));
    await page.route(path + '/redemption', route => route.fulfill({ json: { data: initial } }));
    await page.route(path + '/redemption/policy', route => route.fulfill({ json: { data: { terms: 'test', privacy: 'test' } } }));
    await page.route(path + '/redemption/preview', async route => {
      await new Promise<void>(resolve => { finishPreview = resolve; });
      await route.fulfill({ json: { data: { ...initial, account: { email: 'buyer@example.invalid', plan: 'free', validation: 'confirmed', confirmationId: 'test' } } } });
    });
    await page.route(path + '/redemption/submit', async route => {
      await new Promise<void>(resolve => { finishSubmit = resolve; });
      submitted = true;
      await route.fulfill({ json: { data: { ...initial, submitted, result: { state: 'QUEUED', settlement: 'UNKNOWN', orderNo: 'TEST', progress: 0, renewal: '' } } } });
    });
    await page.goto(`/orders/${order.id}`);
    const cancel = page.getByRole('button', { name: '取消订单', exact: true });
    await expect(cancel).toBeEnabled();
    await page.getByLabel('ChatGPT Session').fill('{"accessToken":"mock-only"}');
    const previewRequest = page.waitForRequest('**/redemption/preview');
    await page.getByRole('button', { name: '验证账号并继续' }).click();
    await previewRequest;
    await expect(cancel).toBeDisabled();
    finishPreview();
    await expect(page.getByText('账号检测通过', { exact: true })).toBeVisible();
    await expect(cancel).toBeEnabled();
    await page.getByLabel('我已确认以上账号，将为此账号充值').check();
    const submitRequest = page.waitForRequest('**/redemption/submit');
    await page.getByRole('button', { name: '确认并提交充值' }).click();
    await submitRequest;
    await expect(cancel).toBeDisabled();
    finishSubmit();
    await expect(page.locator('.redemption-progress-status')).toContainText('已受理，等待处理');
    await expect(cancel).toHaveCount(0);
    await page.goto('/orders');
    await expect(page.locator('.server-order-row')).toContainText(order.id);
    await expect(cancel).toHaveCount(0);
  });
}

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

for (const width of [320, 390, 1440]) {
test(`${width}px purchase dialog uses the original recharge flow without expanding provider history`, async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width, height: 844 });
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
  const timeline = Array.from({ length: 13 }, (_, index) => ({
    title: '订单处理', detail: index % 2 ? '处理已完成。' : '系统正在处理订单。',
    at: '2026-11-11T01:41:06Z', source: 'provider',
  }));
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
    return route.fulfill({ json: { data: { ...initial, submitted: true, rechargeEmail: 'buyer@example.invalid', result: { orderNo: 'TEST-REDEEM', state: 'QUEUED', settlement: 'UNKNOWN', progress: 0, timeline } } } });
  });
  let refreshCount = 0;
  const states = [
    { state: 'FULFILLING', settlement: 'UNKNOWN', progress: 60 },
    { state: 'FULFILLED', settlement: 'UNKNOWN', progress: 100 },
    { state: 'FULFILLED', settlement: 'PAID', progress: 100 },
  ];
  await page.route(redemptionPath + '/refresh', route => route.fulfill({
    json: { data: { ...initial, submitted: true, rechargeEmail: 'buyer@example.invalid', result: {
      orderNo: 'TEST-REDEEM', ...states[Math.min(refreshCount++, states.length - 1)], timeline,
    } } },
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
  const resultPanel = dialog.getByRole('region',{name:'开通结果'});
  await expect(resultPanel.locator('.redemption-loading-label')).toHaveText('已受理，排队中');
  await expect(resultPanel.getByRole('list', { name: '充值流程' }).locator('[aria-current="step"]')).toContainText('排队受理');
  await expect(resultPanel.getByRole('region', { name: '充值处理记录' })).toHaveCount(0);
  await page.clock.fastForward(5000);
  await expect(resultPanel.getByRole('list', { name: '充值流程' }).locator('[aria-current="step"]')).toContainText('充值处理');
  await page.clock.fastForward(5000);
  await expect(resultPanel.getByRole('list', { name: '充值流程' }).locator('[aria-current="step"]')).toContainText('结果确认');
  await expect(resultPanel.locator('.redemption-result-tag')).not.toHaveText('充值成功');
  await dialog.screenshot({ path: `artifacts/purchase-recharge-processing-${width}.png` });
  await page.clock.fastForward(5000);
  await expect(resultPanel.locator('.redemption-loading')).toHaveCount(0);
  await expect(dialog.locator('.redemption-result-tag')).toHaveText('充值成功');
  await expect(dialog.locator('.redemption-result-email')).toContainText('buyer@example.invalid');
  await expect(resultPanel.getByRole('region', { name: '充值处理记录' })).toHaveCount(0);
  await expect(resultPanel.getByRole('button', { name: /刷新/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '关闭购买弹窗' })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: '联系客服', exact: true })).toBeInViewport();
  const layout = await dialog.evaluate(element => ({
    width: element.clientWidth, contentWidth: element.scrollWidth,
    height: element.clientHeight, contentHeight: element.scrollHeight,
  }));
  expect(layout.contentWidth).toBeLessThanOrEqual(layout.width + 1);
  expect(layout.contentHeight).toBeLessThanOrEqual(layout.height + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  await dialog.screenshot({ path: `artifacts/purchase-recharge-success-${width}.png` });
  await page.clock.fastForward(15000);
  expect(refreshCount).toBe(3);
  await expect(page).toHaveURL(/\/products\/chatgpt-plus$/);
});
}

for(const width of [320,390,1440]) {
  test(`${width}px order recharge keeps progress and results visible without processing history`,async({page})=>{
    await page.clock.install();await page.setViewportSize({width,height:1000});
    let index=0;
    const states=[{state:'QUEUED',settlement:'UNKNOWN',progress:0},{state:'FULFILLING',settlement:'UNKNOWN',progress:60},
      {state:'FULFILLED',settlement:'UNKNOWN',progress:100},{state:'FULFILLED',settlement:'PAID',progress:100}];
    const earlier=Array.from({length:13},()=>({title:'订单处理',detail:'处理已完成。',at:'2026-11-10T23:59:00Z',source:'provider'}));
    const timeline=[
      {title:'排队受理',detail:'充值请求已进入通道队列。',at:'2026-11-11T00:00:00Z',source:'provider'},
      {title:'充值处理',detail:'账号已连接，正在办理充值。',at:'2026-11-11T00:00:05Z',source:'provider'},
      {title:'结果确认',detail:'正在核实订阅开通及结算回执。',at:'2026-11-11T00:00:10Z',source:'provider'},
      {title:'确认完成',detail:'通道已确认充值成功。',at:'2026-11-11T00:00:15Z',source:'provider'},
    ];
    const view=()=>({enabled:true,submitted:true,account:null,rechargeEmail:'history@example.invalid',result:{orderNo:'HISTORY-E2E',renewal:'',...states[index],timeline:[...earlier,...timeline.slice(0,index+1)]}});
    const path='**/api/orders/'+example.id+'/redemption';
    await page.route('**/api/orders/'+example.id,route=>route.fulfill({json:{data:{...example,status:'paid'}}}));
    await page.route(path,route=>route.fulfill({json:{data:view()}}));
    await page.route(path+'/refresh',route=>{index=Math.min(index+1,3);return route.fulfill({json:{data:view()}});});
    await page.goto('/orders/'+example.id);
    const panel=page.getByRole('region',{name:'开通结果'}),history=panel.getByRole('region',{name:'充值处理记录'});
    await expect(panel.locator('.redemption-progress-status')).toContainText('已受理，等待处理');
    await expect(history).toHaveCount(0);
    await expect(panel.locator('.redemption-loading')).toHaveCount(0);
    await panel.getByRole('button',{name:'刷新充值进度',exact:true}).click();
    await expect(panel.locator('.redemption-progress-status')).toContainText('正在充值处理');
    await expect(history).toHaveCount(0);
    await panel.getByRole('button',{name:'刷新充值进度',exact:true}).click();
    await expect(panel.locator('.redemption-progress-status')).toContainText('正在确认充值结果');
    await expect(panel.getByRole('list',{name:'充值流程'}).locator('[aria-current="step"]')).toContainText('结果确认');
    await expect(panel.locator('.redemption-success-banner')).toHaveCount(0);
    await expect(history).toHaveCount(0);
    await panel.screenshot({path:`artifacts/recharge-confirming-${width}.png`});
    await panel.getByRole('button',{name:'刷新充值进度',exact:true}).click();
    await expect(panel.locator('.redemption-success-banner')).toHaveText('充值成功');
    await expect(history).toHaveCount(0);
    await expect(panel.getByRole('button',{name:/刷新/})).toHaveCount(0);
    await expect(panel.locator('.redemption-result-email dd')).toHaveText('history@example.invalid');
    await expect(panel.locator('.redemption-result-order')).toContainText('HISTORY-E2E');
    const banner=await panel.locator('.redemption-success-banner').boundingBox();
    expect(banner!.height).toBeLessThanOrEqual(36);expect(banner!.width).toBeLessThan((await panel.boundingBox())!.width*.75);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
    await panel.screenshot({path:`artifacts/recharge-result-success-${width}.png`});
    await page.reload();
    await expect(panel.locator('.redemption-success-banner')).toHaveText('充值成功');
    await expect(history).toHaveCount(0);
    await expect(panel.getByRole('button',{name:/刷新/})).toHaveCount(0);
    // A missed transient confirmation status must not delay an already confirmed success.
    index=1;await page.reload();await expect(panel.locator('.redemption-progress-status')).toContainText('正在充值处理');
    index=2;await panel.getByRole('button',{name:'刷新充值进度',exact:true}).click();
    await expect(panel.locator('.redemption-success-banner')).toHaveText('充值成功');
    await expect(history).toHaveCount(0);
  });
}

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

for (const width of [390, 1440]) {
  test(`${width}px account validation shows specific causes and keeps Session input for retry`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const path = '**/api/orders/' + example.id;
    const view = { enabled: true, submitted: false, account: null, result: null, rechargeEmail: null };
    const failures = [
      {status:400,code:'SESSION_INVALID_JSON',message:'Session JSON 格式不正确或复制不完整，请重新复制页面全部内容。',title:'登录信息不完整或格式有误'},
      {status:400,code:'SESSION_EXPIRED',message:'ChatGPT Session 已过期，请重新登录 ChatGPT 后获取最新登录信息。',title:'Session 已过期'},
      {status:409,code:'REDEMPTION_EXPIRED',message:'本次账号确认会话已过期，请重新验证账号。',title:'账号确认已过期'},
      {status:502,code:'REDEMPTION_CONNECTION_FAILED',message:'暂时无法连接充值服务，请稍后重试；当前无法确定是否为 Session 问题。',title:'暂时无法验证账号'},
      {status:409,code:'PORTAL_PRECHECK_FAILED',message:'账号预检未通过：当前账号订阅状态暂不支持此套餐。',title:'账号验证未通过'},
    ];
    let attempts=0;
    await page.route('**/api/payments/config',route=>route.fulfill({json:{data:{enabled:false,environment:'sandbox',message:'本地测试'}}}));
    await page.route(path,route=>route.fulfill({json:{data:{...example,status:'paid'}}}));
    await page.route(path+'/redemption',route=>route.fulfill({json:{data:view}}));
    await page.route(path+'/redemption/policy',route=>route.fulfill({json:{data:{terms:'test',privacy:'test'}}}));
    await page.route(path+'/redemption/preview',route=>{
      const index=attempts++;
      if(index<failures.length){const failure=failures[index];return route.fulfill({status:failure.status,json:{error:{code:failure.code,message:failure.message}}});}
      return route.fulfill({json:{data:{...view,account:{email:'mock@example.invalid',plan:'free',validation:index===failures.length?'local_only':'confirmed',confirmationId:'test-confirmation'}}}});
    });
    await page.goto(`/orders/${example.id}`);
    const input=page.getByLabel('ChatGPT Session');
    const value=JSON.stringify({user:{email:'mock@example.invalid'},accessToken:'mock-only',expires:'2099-01-01T00:00:00Z'});
    await input.fill(value);
    for(const failure of failures){
      await page.getByRole('button',{name:attempts===0?'验证账号并继续':'重新检测账号',exact:true}).click();
      await expect(page.locator('.redemption-validation-error h4')).toHaveText(failure.title);
      await expect(page.locator('.redemption-validation-error')).toContainText(failure.message);
      await expect(input).toHaveValue(value);
      if(failure.code==='SESSION_EXPIRED')await page.screenshot({path:`artifacts/session-expired-${width}.png`});
      if(failure.code==='REDEMPTION_CONNECTION_FAILED')await expect(page.locator('.redemption-validation-error h4')).not.toContainText('Session 已失效');
    }
    await page.getByRole('button',{name:'重新检测账号',exact:true}).click();
    await expect(page.getByText('账号信息已识别',{exact:true})).toBeVisible();
    await expect(page.locator('.redemption-account-eligibility')).toHaveCount(0);
    await expect(page.getByText('待通道确认',{exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'更换账号',exact:true}).click();
    await input.fill(value);
    await page.getByRole('button',{name:'验证账号并继续',exact:true}).click();
    await expect(page.locator('.redemption-account-eligibility')).toHaveText('可以开通');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
  });
}
