import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { once } from 'node:events';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createAlipayGateway } from './alipay.ts';
import type { TradeResult } from './alipay.ts';
import { openDatabase } from './database.ts';
import { createApiServer } from './app.ts';
import type { Order, PaymentConfig } from '../src/types/orders.ts';

const merchant = generateKeyPairSync('rsa', { modulusLength: 2048 });
const alipay = generateKeyPairSync('rsa', { modulusLength: 2048 });
const env = {
  ALIPAY_ENABLED: 'true', ALIPAY_ENV: 'sandbox', ALIPAY_APP_ID: '2021000000000001',
  ALIPAY_SELLER_ID: '2088000000000001', PUBLIC_SITE_URL: 'http://localhost:5180',
  ALIPAY_PRIVATE_KEY: merchant.privateKey.export({ type: 'pkcs1', format: 'der' }).toString('base64'),
  ALIPAY_PUBLIC_KEY: alipay.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
};
const gateway = createAlipayGateway(env, { sandboxPath: null });
const key = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const input = { productId: 'chatgpt-plus', expectedPriceCents: 13000, email: 'private@example.com', acceptedTerms: true };

async function setup(t: TestContext, enabled = true) {
  const db = openDatabase(':memory:');
  let trade: TradeResult | null = null;
  let queryError = false;
  const server = createApiServer(db, enabled ? { ...gateway, async query() {
    if (queryError) throw new Error('Network failure');
    return trade;
  } } : createAlipayGateway({}));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeIdleConnections(); });
    db.close();
  });
  let cookie = '';
  async function request<T = Order>(path: string, body?: unknown, options: { cookie?: string; key?: string; origin?: string } = {}) {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: options.cookie ?? cookie, 'Content-Type': 'application/json',
        Origin: options.origin ?? (enabled ? env.PUBLIC_SITE_URL : base), 'Idempotency-Key': options.key || key },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const newCookie = response.headers.get('set-cookie');
    if (newCookie) cookie = newCookie.split(';')[0];
    return { response, body: await response.json() as { data: T; error: { code: string; message: string } } };
  }
  async function notify(params: TradeResult, valid = true) {
    const values: TradeResult = { notify_id: 'notify_test_id', notify_type: 'trade_status_sync', app_id: env.ALIPAY_APP_ID, seller_id: env.ALIPAY_SELLER_ID, total_amount: '130.00',
      trade_no: '2026101722000000000000000001', trade_status: 'TRADE_SUCCESS', ...params };
    const content = Object.keys(values).filter(name => values[name]).sort().map(name => `${name}=${values[name]}`).join('&');
    values.sign = sign('RSA-SHA256', Buffer.from(content), valid ? alipay.privateKey : merchant.privateKey).toString('base64');
    values.sign_type = 'RSA2';
    return fetch(`${base}/api/payments/alipay/notify`, { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values) });
  }
  return { db, request, notify, base, setTrade: (value: TradeResult | null) => { trade = value; }, setQueryError: () => { queryError = true; } };
}

test('unconfigured checkout stays disabled and never persists a payable order', async t => {
  const { request, db } = await setup(t, false);
  const status = await request<PaymentConfig>('/api/payments/config');
  assert.equal(status.body.data.enabled, false);
  assert.match(status.response.headers.get('set-cookie')!, /HttpOnly; SameSite=Lax/);
  const result = await request('/api/orders', input);
  assert.equal(result.response.status, 503);
  assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get()!.n, 0);
  assert.doesNotMatch(JSON.stringify(status.body), /privateKey|sellerId|appId/);
});

test('server prices, product availability, consent and JSON origin are enforced', async t => {
  const { request, db } = await setup(t);
  await request('/api/payments/config');
  for (const body of [{ ...input, expectedPriceCents: 1 }, { ...input, email: 'bad' }, { ...input, acceptedTerms: false }]) {
    assert.ok([400, 409].includes((await request('/api/orders', body)).response.status));
  }
  assert.equal((await request('/api/orders', input, { origin: 'https://evil.example' })).response.status, 403);
  db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(input.productId);
  assert.equal((await request('/api/orders', input)).response.status, 409);
  assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get()!.n, 0);
});

test('order creation is idempotent, private and preserves immutable product snapshots', async t => {
  const { request, db } = await setup(t);
  await request('/api/payments/config');
  const first = await request('/api/orders', { ...input, priceCents: 1 });
  const order = first.body.data as Order;
  assert.equal(first.response.status, 201);
  assert.equal(order.priceCents, 13000);
  assert.equal(order.status, 'pending');
  assert.equal((await request('/api/orders', input)).body.data.id, order.id);
  assert.equal((await request('/api/orders', { ...input, email: 'changed@example.com' })).response.status, 409);
  db.prepare('UPDATE products SET price_cents = 13100, name = ? WHERE id = ?').run('Changed', input.productId);
  const detail = await request(`/api/orders/${order.id}`);
  assert.equal(detail.body.data.productName, 'ChatGPT Plus');
  assert.equal(detail.body.data.priceCents, 13000);
  assert.doesNotMatch(JSON.stringify(detail.body), /private@example.com|owner_hash|idempotency/);
  assert.equal((await request(`/api/orders/${order.id}`, undefined, { cookie: '' })).response.status, 404);
  assert.deepEqual((await request('/api/orders', undefined, { cookie: '' })).body.data, []);
  assert.equal((await request(`/api/orders/${order.id}/payment`, {}, { cookie: '' })).response.status, 404);
});

test('desktop and mobile checkout use POST page.pay forms and the server amount', async t => {
  const { request } = await setup(t);
  await request('/api/payments/config');
  const order = (await request('/api/orders', input)).body.data as Order;
  for (const mobile of [false, true]) {
    const result = await request<{ paymentHtml: string }>(`/api/orders/${order.id}/payment`, { mobile, priceCents: 1 });
    assert.equal(result.response.status, 200);
    const html = result.body.data.paymentHtml;
    assert.match(html, /method="post"/i);
    const url = new URL(html.match(/action="([^"]+)"/)![1].replace(/&amp;/g, '&'));
    assert.equal(url.hostname, 'openapi-sandbox.dl.alipaydev.com');
    assert.equal(url.searchParams.get('method'), 'alipay.trade.page.pay');
    assert.match(html, /130.00/);
    assert.match(html, new RegExp(order.id));
    assert.match(html, /FAST_INSTANT_TRADE_PAY/);
    assert.equal(url.searchParams.get('return_url'), `${env.PUBLIC_SITE_URL}/pay/${order.id}`);
    assert.equal(url.searchParams.has('notify_url'), false);
    assert.ok(url.searchParams.get('sign'));
    assert.doesNotMatch(html, /private@example|PRIVATE KEY/);
  }
});

test('signed callbacks verify all merchant fields, are idempotent and never regress paid status', async t => {
  const { request, notify } = await setup(t);
  await request('/api/payments/config');
  const order = (await request('/api/orders', input)).body.data as Order;
  const params = { out_trade_no: order.id };
  assert.equal((await notify(params, false)).status, 400);
  for (const fields of [{ total_amount: '0.01' }, { seller_id: '2088000000000002' }, { app_id: '2021000000000002' }] as TradeResult[]) {
    assert.equal((await notify({ ...params, ...fields })).status, 400);
  }
  assert.equal((await request(`/api/orders/${order.id}`)).body.data.status, 'pending');
  assert.equal(await (await notify(params)).text(), 'success');
  const paid = (await request(`/api/orders/${order.id}`)).body.data as Order;
  assert.equal(paid.status, 'paid');
  assert.ok(paid.paidAt);
  assert.equal(await (await notify(params)).text(), 'success');
  assert.equal(await (await notify({ ...params, trade_status: 'TRADE_CLOSED' })).text(), 'success');
  const repeated = (await request(`/api/orders/${order.id}`)).body.data;
  assert.equal(repeated.status, 'paid');
  assert.equal(repeated.paidAt, paid.paidAt);
  assert.equal((await request(`/api/orders/${order.id}/payment`, {})).response.status, 409);
});

test('active queries recover missed notifications and never accept browser success claims', async t => {
  const { request, setTrade } = await setup(t);
  await request('/api/payments/config');
  const order = (await request('/api/orders', input)).body.data as Order;
  assert.equal((await request(`/api/orders/${order.id}/refresh`, { status: 'paid', trade_status: 'TRADE_SUCCESS' })).body.data.status, 'pending');
  setTrade({ out_trade_no: order.id, total_amount: '130.00', trade_no: '2026101722000000000000000001', trade_status: 'TRADE_SUCCESS' });
  assert.equal((await request(`/api/orders/${order.id}/refresh`, {})).body.data.status, 'paid');
});

test('expired orders cannot reopen checkout and query failures leave status unchanged', async t => {
  const { request, db, setQueryError } = await setup(t);
  await request('/api/payments/config');
  const order = (await request('/api/orders', input)).body.data as Order;
  db.prepare('UPDATE orders SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00Z', order.id);
  assert.equal((await request(`/api/orders/${order.id}/payment`, {})).response.status, 409);
  setQueryError();
  assert.equal((await request(`/api/orders/${order.id}/refresh`, {})).response.status, 502);
  assert.equal((await request(`/api/orders/${order.id}`)).body.data.status, 'pending');
});

test('sandbox and production orders cannot share a payment context', async t => {
  const { request, db } = await setup(t);
  await request('/api/payments/config');
  const order = (await request('/api/orders', input)).body.data as Order;
  db.prepare("UPDATE orders SET environment = 'production' WHERE id = ?").run(order.id);
  assert.equal((await request(`/api/orders/${order.id}/payment`, {})).response.status, 409);
});

test('malformed, oversized and cross-site requests cannot create orders', async t => {
  const { base, request, db } = await setup(t);
  await request('/api/payments/config');
  for (const [body, contentType, status] of [
    ['{', 'application/json', 400],
    ['[]', 'application/json', 400],
    ['{}', 'text/plain', 415],
    [JSON.stringify({ extra: 'x'.repeat(17000) }), 'application/json', 413],
  ] as const) {
    const result = await fetch(`${base}/api/orders`, { method: 'POST', headers: {
      'Content-Type': contentType, Origin: env.PUBLIC_SITE_URL, 'Idempotency-Key': key,
    }, body });
    assert.equal(result.status, status);
    await result.text();
  }
  const result = await fetch(`${base}/api/orders`, { method: 'POST', headers: {
    'Content-Type': 'application/json', Origin: env.PUBLIC_SITE_URL, 'Sec-Fetch-Site': 'cross-site', 'Idempotency-Key': key,
  }, body: JSON.stringify(input) });
  assert.equal(result.status, 403);
  assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get()!.n, 0);
});

test('only confirmed nonexistent expired trades close and late successful payment still wins', async t => {
  const { request, db, notify } = await setup(t);
  await request('/api/payments/config');
  const order = (await request('/api/orders', input)).body.data;
  db.prepare('UPDATE orders SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00Z', order.id);
  assert.equal((await request(`/api/orders/${order.id}/refresh`, {})).body.data.status, 'closed');
  assert.equal(await (await notify({ out_trade_no: order.id })).text(), 'success');
  assert.equal((await request(`/api/orders/${order.id}`)).body.data.status, 'paid');
});

test('production uses secure host cookies and rejects invalid site or key configuration', async t => {
  const db = openDatabase(':memory:');
  const production = createAlipayGateway({ ...env, ALIPAY_ENV: 'production', PUBLIC_SITE_URL: 'https://store.example.com', ALIPAY_NOTIFY_URL: 'https://store.example.com/api/payments/alipay/notify' }, { sandboxPath: null });
  const server = createApiServer(db, production);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  t.after(async () => {
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeIdleConnections(); });
    db.close();
  });
  const response = await fetch(`http://127.0.0.1:${address.port}/api/payments/config`);
  const cookie = response.headers.get('set-cookie')!;
  assert.match(cookie, /^__Host-wusan_browser=/);
  assert.match(cookie, /HttpOnly; SameSite=Lax; Max-Age=31536000; Secure/);
  assert.throws(() => createAlipayGateway({ ...env, ALIPAY_ENV: 'production' }, { sandboxPath: null }), /HTTPS/);
  assert.throws(() => createAlipayGateway({ ...env, ALIPAY_PRIVATE_KEY: 'invalid!' }, { sandboxPath: null }));
  assert.throws(() => createAlipayGateway({ ...env, ALIPAY_PUBLIC_KEY: '' }, { sandboxPath: null }));
});

test('production signs the real gateway form with formal return/notify endpoints and rejects environment mistakes', async t => {
  const { request } = await setup(t);
  const order = (await request('/api/orders', input)).body.data;
  const production = createAlipayGateway({ ...env, NODE_ENV: 'production', ALIPAY_ENV: 'production',
    PUBLIC_SITE_URL: 'https://store.example.com', ALIPAY_NOTIFY_URL: 'https://store.example.com/api/payments/alipay/notify',
  }, { sandboxPath: '/does/not/exist' });
  const html = production.paymentForm({ ...order, environment: 'production' });
  const target = new URL(html.match(/action="([^"]+)"/)![1].replace(/&amp;/g, '&'));
  assert.equal(target.origin, 'https://openapi.alipay.com');
  assert.equal(target.searchParams.get('method'), 'alipay.trade.page.pay');
  assert.equal(target.searchParams.get('return_url'), `https://store.example.com/pay/${order.id}`);
  assert.equal(target.searchParams.get('notify_url'), 'https://store.example.com/api/payments/alipay/notify');
  assert.ok(target.searchParams.get('sign'));
  assert.doesNotMatch(html, /sandbox|PRIVATE KEY/);
  assert.throws(() => createAlipayGateway({ ...env, NODE_ENV: 'production' }), /ALIPAY_ENV=production/);
  assert.throws(() => createAlipayGateway({ ALIPAY_ENABLED: 'TRUE' }), /true or false/);
});

test('changing merchant identity cannot move an existing order to a new recipient', async t => {
  const { request, db } = await setup(t);
  await request('/api/payments/config');
  const order = (await request('/api/orders', input)).body.data;
  db.prepare("UPDATE orders SET snapshot = json_set(snapshot, '$.payment.sellerId', '2088000000000002') WHERE id = ?").run(order.id);
  assert.equal((await request(`/api/orders/${order.id}/payment`, {})).response.status, 409);
  assert.equal((await request(`/api/orders/${order.id}/refresh`, {})).response.status, 409);
  assert.doesNotMatch(JSON.stringify((await request(`/api/orders/${order.id}`)).body), /appId|sellerId/);
});

test('refund events and unknown states never mark an unpaid order paid', async t => {
  const { request, notify, setTrade, db } = await setup(t);
  await request('/api/payments/config');
  const order = (await request('/api/orders', input)).body.data;
  for (const fields of [{ out_biz_no: 'refund-001' }, { gmt_refund: '2026-10-18 12:00:00' }, { refund_fee: '130.00' }] as TradeResult[]) {
    assert.equal(await (await notify({ out_trade_no: order.id, ...fields })).text(), 'success');
  }
  assert.equal((await request(`/api/orders/${order.id}`)).body.data.status, 'pending');
  setTrade({ out_trade_no: order.id, total_amount: '130.00', trade_status: 'UNKNOWN' });
  assert.equal((await request(`/api/orders/${order.id}/refresh`, {})).body.data.status, 'pending');
  await notify({ out_trade_no: order.id });
  await notify({ out_trade_no: order.id });
  assert.equal(db.prepare("SELECT count(*) AS n FROM alipay_notify_events WHERE event_type = 'payment'").get()!.n, 1);
});

test('closing queries first and never closes an already paid trade', async t => {
  const { request, setTrade } = await setup(t);
  await request('/api/payments/config');
  const order = (await request('/api/orders', input)).body.data;
  setTrade({ out_trade_no: order.id, total_amount: '130.00', trade_no: '2026101722000000000000000001', trade_status: 'TRADE_SUCCESS' });
  assert.equal((await request(`/api/orders/${order.id}/close`, {})).body.data.status, 'paid');
});

test('refund reservations survive unknown results, enforce limits and immutable retries', async t => {
  const { request, notify, db } = await setup(t);
  await request('/api/payments/config');
  const order = (await request('/api/orders', input)).body.data;
  await notify({ out_trade_no: order.id });
  const { refundRepository } = await import('./refunds.ts');
  let calls = 0;
  let fail = true;
  const refundGateway = { ...gateway, async refund(current: Order, amount: string, requestNo: string) {
    calls++;
    if (fail) throw new Error('Network timeout');
    return { code: '10000', out_trade_no: current.id, out_request_no: requestNo, refund_fee: amount, fund_change: 'N' };
  }, async refundQuery(current: Order, requestNo: string) {
    return { code: '10000', out_trade_no: current.id, out_request_no: requestNo, refund_amount: '80.00', refund_status: 'REFUND_SUCCESS' };
  } };
  const refunds = refundRepository(db, refundGateway);
  await assert.rejects(refunds.request(order.id, 'refund-001', '80.00', 'Customer request'), /timeout/);
  assert.equal(db.prepare('SELECT amount_cents FROM payment_refunds').get()!.amount_cents, 8000);
  await assert.rejects(refunds.request(order.id, 'refund-002', '60.00', 'Customer request'), /exceed/);
  await assert.rejects(refunds.request(order.id, 'refund-001', '70.00', 'Customer request'), /original/);
  fail = false;
  assert.equal((await refunds.request(order.id, 'refund-001', '80.00', 'Customer request')).status, 'pending');
  await assert.rejects(refunds.query('refund-001'), /10 seconds/);
  db.prepare("UPDATE payment_refunds SET updated_at = '2020-01-01T00:00:00Z'").run();
  assert.equal((await refunds.query('refund-001')).status, 'success');
  assert.equal((await refunds.request(order.id, 'refund-001', '80.00', 'Customer request')).status, 'success');
  assert.equal(calls, 2);
});
