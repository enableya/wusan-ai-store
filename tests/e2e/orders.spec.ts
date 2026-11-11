import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createOrderMock } from '../mocks/orders.ts';

type Mock = ReturnType<typeof createOrderMock>;
async function setup(page: Page, mock: Mock) {
  await page.route('**/api/**', route => {
    const request = route.request();
    const result = mock.respond(new URL(request.url()).pathname, request.method(), request.postData() ? request.postDataJSON() : {});
    return route.fulfill({ status: result.status, json: result.body });
  });
}
const rowFor = (page: Page, id: string) => page.locator('.server-order-row').filter({ hasText: id });
const tab = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

for(const width of [320,390,1440]) {
  test(`${width}px active subscription displays the concrete failure reason and refreshes historical results`,async({page})=>{
    const mock=createOrderMock(),scenario=mock.scenarios.find(s=>s.key==='no_charge')!;
    const reason='已有有效订阅，暂不能重复充值。';
    scenario.order.recharge!.reason=reason;
    await setup(page,mock);await page.setViewportSize({width,height:1000});await page.goto('/orders');
    await expect(rowFor(page,scenario.order.id).locator('.order-recharge-badge')).toHaveText(reason);
    await rowFor(page,scenario.order.id).getByRole('link',{name:'查看订单',exact:false}).click();
    const panel=page.getByRole('region',{name:'开通结果'});
    await expect(panel.getByRole('alert')).toContainText(reason);
    await expect(panel).not.toContainText('充值未完成，本次未扣款');
    await expect(panel.locator('[data-failure="true"] > span')).toHaveText('×');
    await expect(panel.getByRole('list',{name:'充值流程'})).toContainText('充值未完成');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
    await panel.screenshot({path:`artifacts/active-subscription-reason-${width}.png`});
    await page.reload();await expect(panel.getByRole('alert')).toContainText(reason);
    // Historical results without explanations can query the original request,
    // never submit a new recharge to discover the failure reason.
    await page.route(`**/api/orders/${scenario.order.id}/redemption`,route=>route.fulfill({json:{data:{enabled:true,submitted:true,account:null,rechargeEmail:null,result:{...scenario.order.recharge,reason:undefined,orderNo:'MOCK-RECHARGE',progress:0}}}}));
    let refreshes=0;
    await page.route(`**/api/orders/${scenario.order.id}/redemption/refresh`,route=>{
      refreshes++;return route.fulfill({json:{data:{enabled:true,submitted:true,account:null,rechargeEmail:null,result:{...scenario.order.recharge,orderNo:'MOCK-RECHARGE',progress:0}}}});
    });
    await page.reload();await expect(panel.locator('.redemption-result-tag')).toHaveText('充值未完成，本次未扣款');
    await panel.getByRole('button',{name:'刷新充值进度',exact:true}).click();
    await expect(panel.getByRole('alert')).toContainText(reason);expect(refreshes).toBe(1);
  });
}

for (const width of [390, 1440]) {
  test(`${width}px mock matrix: all recharge states, emails, counts and cancel eligibility`, async ({ page }) => {
    const mock = createOrderMock();
    await setup(page, mock); await page.setViewportSize({ width, height: 1000 }); await page.goto('/orders');
    await expect(page.locator('.server-order-row')).toHaveCount(27);
    for (const scenario of mock.scenarios) {
      const row = rowFor(page, scenario.order.id);
      await expect(row.locator('.order-recharge-status')).toHaveText('充值状态：' + scenario.label);
      await expect(row.locator('.order-recharge-status')).toHaveAttribute('data-tone', scenario.tone);
      if (scenario.order.fulfillment) await expect(row.locator('.order-recharge-email')).toHaveText('充值邮箱：' + (scenario.order.fulfillment.rechargeEmail || '未记录'));
      else await expect(row.locator('.order-recharge-email')).toHaveCount(0);
      const cancel = row.getByRole('button', { name: '取消订单', exact: true });
      if (scenario.order.cancelAction) await expect(cancel).toBeEnabled();
      else if (scenario.order.cancelUnavailableReason) await expect(cancel).toBeDisabled();
      else await expect(cancel).toHaveCount(0);
    }
    for (const [label, count] of Object.entries({ 全部: 27, 待付款: 2, 已付款: 17, 已关闭: 1, 订单已取消: 5, 免付开通: 2 })) {
      await expect(tab(page, label).locator('.count-label')).toHaveText(String(count));
      await tab(page, label).click();
      await expect(page.locator('.server-order-row')).toHaveCount(count);
    }
    await tab(page, '已付款').click();
    await expect(page.locator('.server-order-row .status-badge').filter({ hasText: '免付开通' })).toHaveCount(0);
    await tab(page, '全部').click();
    await page.locator('#order-search').fill('no-such-order');
    await expect(page.locator('.server-order-row')).toHaveCount(0);
    await expect(tab(page, '全部').locator('.count-label')).toHaveText('27');
    const success = mock.scenarios.find(s => s.key === 'success')!;
    await page.locator('#order-search').fill(success.order.id.toLowerCase());
    await expect(page.locator('.server-order-row')).toHaveCount(1);
    await expect(page.locator('.order-recharge-status')).toHaveText('充值状态：充值成功');
    await page.locator('#order-search').fill('chatgpt plus');
    await expect(page.locator('.server-order-row')).toHaveCount(27);
    await page.locator('#order-search').clear();
    await page.screenshot({ path: `artifacts/orders-mock-matrix-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  });

  test(`${width}px refresh hides zero badges, preserves tabs and handles empty and failed reads`, async ({ page }) => {
    const mock = createOrderMock(); mock.state.orders = [mock.scenarios.find(s => s.key === 'success')!.order];
    await setup(page, mock); await page.setViewportSize({ width, height: 1000 }); await page.goto('/orders');
    await expect(page.locator('.server-order-row')).toHaveCount(1);
    for (const label of ['待付款', '已关闭', '订单已取消', '免付开通']) {
      await expect(tab(page, label)).toBeVisible(); await expect(tab(page, label).locator('.count-label')).toHaveCount(0);
    }
    mock.state.orders = [];
    await tab(page, '刷新订单').click();
    await expect(page.getByRole('heading', { name: '还没有订单', exact: true })).toBeVisible();
    await expect(page.locator('[data-order-filter] .count-label')).toHaveCount(0);
    mock.state.failList = true; await tab(page, '刷新订单').click();
    await expect(page.getByRole('heading', { name: '内容加载失败', exact: true })).toBeVisible();
    mock.state.failList = false; mock.state.orders = mock.scenarios.map(s => s.order);
    await tab(page, '重新加载').click(); await expect(page.locator('.server-order-row')).toHaveCount(27);
  });

  for (const entry of ['list', 'detail']) for (const key of ['pending', 'awaiting_recharge']) {
    test(`${width}px ${entry} mock cancellation ${key} updates counts and survives navigation`, async ({ page }) => {
      const mock = createOrderMock(); const order = mock.scenarios.find(s => s.key === key)!.order;
      await setup(page, mock); await page.setViewportSize({ width, height: 1000 });
      await page.goto(entry === 'list' ? '/orders' : `/orders/${order.id}`);
      const area = entry === 'list' ? rowFor(page, order.id) : page.locator('.order-summary');
      await area.getByRole('button', { name: '取消订单', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: '暂不取消', exact: true }).click();
      expect(mock.state.cancellationWrites).toBe(0);
      await area.getByRole('button', { name: '取消订单', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: key === 'pending' ? '确认取消订单' : '提交取消申请', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(mock.state.cancellationWrites).toBe(1);
      await page.goto('/orders');
      await expect(rowFor(page, order.id).locator('.order-recharge-status')).toHaveText('充值状态：已停止');
      await expect(rowFor(page, order.id).getByRole('button', { name: '取消订单', exact: true })).toHaveCount(0);
      await expect(tab(page, '订单已取消').locator('.count-label')).toHaveText('6');
      await expect(tab(page, key === 'pending' ? '待付款' : '已付款').locator('.count-label')).toHaveText(key === 'pending' ? '1' : '16');
      await page.reload(); await expect(rowFor(page, order.id)).toContainText(order.cancellation!.message);
      const retry = await page.evaluate(async ({ id, action }) => {
        const response = await fetch(`/api/orders/${id}/cancel`, { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedAction: action }) });
        return response.status;
      }, { id: order.id, action: key === 'pending' ? 'cancel' : 'request_refund' });
      expect(retry).toBe(200);
      expect(mock.state.cancellationWrites).toBe(1);
    });
  }
}

test('regular customers cannot see staff orders or their counts', async ({ page }) => {
  const mock = createOrderMock(); mock.state.staff = false; await setup(page, mock); await page.goto('/orders');
  await expect(page.locator('.server-order-row')).toHaveCount(25);
  await expect(tab(page, '全部').locator('.count-label')).toHaveText('25');
  await expect(tab(page, '已付款').locator('.count-label')).toHaveText('17');
  await expect(tab(page, '免付开通')).toHaveCount(0);
});

test('failed cancellation and stale confirmation preserve the order and allow a later retry', async ({ page }) => {
  const mock = createOrderMock(); const order = mock.scenarios.find(s => s.key === 'pending')!.order;
  mock.state.failCancellation = true; await setup(page, mock); await page.goto('/orders');
  const row = rowFor(page, order.id);
  await row.getByRole('button', { name: '取消订单', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认取消订单', exact: true }).click();
  await expect(page.locator('.app-message--error')).toContainText('支付查询超时');
  await expect(row.locator('.status-badge')).toHaveText('待付款');
  expect(mock.state.cancellationWrites).toBe(0);
  mock.state.failCancellation = false;
  const stale = await page.evaluate(async id => (await fetch(`/api/orders/${id}/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedAction: 'request_refund' }),
  })).status, order.id);
  expect(stale).toBe(409); expect(mock.state.cancellationWrites).toBe(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await row.getByRole('button', { name: '取消订单', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认取消订单', exact: true }).click();
  await expect(row.locator('.status-badge')).toHaveText('订单已取消');
  expect(mock.state.cancellationWrites).toBe(1);
});

test('local package drafts do not inflate server order counts', async ({ page }) => {
  const mock = createOrderMock(); await setup(page, mock);
  await page.addInitScript(() => localStorage.setItem('wusan-ai:selections:v1', JSON.stringify([
    { id: 'mock-draft', productId: 'chatgpt-plus', productName: '模拟套餐草稿', priceCents: 13000, createdAt: new Date().toISOString() },
  ])));
  await page.goto('/orders');
  await expect(page.locator('.draft-section')).toContainText('模拟套餐草稿');
  await expect(tab(page, '全部').locator('.count-label')).toHaveText('27');
});
