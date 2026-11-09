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
import { hashAdminPassword } from './admin.ts';
import { orderRepository } from './orders.ts';

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
const input = { productId: 'chatgpt-plus', expectedPriceCents: 13000, contact: 'private@example.com', queryPassword: 'query6' };

async function setup(t: TestContext, enabled = true, publicCheckoutEnabled = true) {
  const db = openDatabase(':memory:');
  let trade: TradeResult | null = null;
  let queryError = false;
  let closeCalls = 0;
  let closeError = false;
  const server = createApiServer(db, enabled ? { ...gateway, async query() {
    if (queryError) throw new Error('Network failure');
    return trade;
  }, async close(order) { closeCalls++; if(closeError)throw new Error('Close timeout'); return {out_trade_no:order.id}; } } : createAlipayGateway({}), { publicCheckoutEnabled });
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
  return { db, request, notify, base, setTrade: (value: TradeResult | null) => { trade = value; }, setQueryError: () => { queryError = true; },
    closeCalls:()=>closeCalls, setCloseError:()=>{closeError=true;} };
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

test('staff checkout requires both accounts for binding and only the linked customer can redeem', async t => {
  const { db, request } = await setup(t, false, false);
  const customer = { username: 'linzhenglian', password: 'customer-test-password' };
  const adminPassword = 'staff-admin-test-password';
  const payload = { productId: 'chatgpt-plus' };
  const registration = await request('/api/customer/register', customer, { cookie: '' });
  assert.equal(registration.response.status, 200);
  const cookies = registration.response.headers.getSetCookie().map(value => value.split(';')[0]);
  const browserCookie = cookies.find(value => value.startsWith('wusan_browser='))!;
  const customerCookie = cookies.find(value => value.startsWith('wusan_customer='))!;
  assert.equal((await request('/api/orders/staff-checkout', payload, { cookie: customerCookie })).response.status, 403);
  assert.equal((await request('/api/admin/staff-checkout', { linked: true }, { cookie: customerCookie })).response.status, 401);

  db.prepare("INSERT INTO admin_accounts(username,password_hash,created_at,role) VALUES (?,?,?,'super_admin')")
    .run(customer.username, await hashAdminPassword(adminPassword), new Date().toISOString());
  const login = await request('/api/admin/login', { username: customer.username, password: adminPassword });
  const adminCookie = login.response.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await request('/api/admin/staff-checkout', { linked: true }, { cookie: adminCookie })).response.status, 409);
  const linked = await request('/api/admin/staff-checkout', { linked: true }, { cookie: `${adminCookie}; ${customerCookie}` });
  assert.equal(linked.response.status, 200);

  const created = await request('/api/orders/staff-checkout', payload, { cookie: customerCookie });
  assert.equal(created.response.status, 201);
  const order = created.body.data;
  assert.equal(order.staffCheckout, true);
  assert.equal(order.priceCents, 0);
  assert.equal(order.paidAt, null);
  assert.equal(order.tradeNo, null);
  assert.equal((await request('/api/orders/staff-checkout', payload, { cookie: customerCookie })).body.data.id, order.id);
  assert.equal((await request(`/api/orders/${order.id}/redemption`, undefined, { cookie: browserCookie })).response.status, 404);
  assert.equal((await request(`/api/orders/${order.id}/redemption`, undefined, { cookie: customerCookie })).response.status, 200);
  assert.equal((await request(`/api/orders/${order.id}/payment`, {}, { cookie: customerCookie })).response.status, 409);
  assert.equal(db.prepare('SELECT count(*) AS n FROM referral_orders').get()!.n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM coupon_orders').get()!.n, 0);
  const report = await request<{ grossCents: number; paidOrders: number; created: { total: number } }>('/api/admin/revenue', undefined, { cookie: adminCookie });
  assert.equal(report.body.data.grossCents, 0);
  assert.equal(report.body.data.paidOrders, 0);
  assert.equal(report.body.data.created.total, 0);

  assert.equal((await request('/api/admin/staff-checkout', { linked: false }, { cookie: adminCookie })).response.status, 200);
  assert.equal((await request(`/api/orders/${order.id}/redemption`, undefined, { cookie: customerCookie })).response.status, 404);
  assert.equal((await request('/api/orders/staff-checkout', payload, { cookie: customerCookie })).response.status, 403);
});

test('closed public checkout permits authenticated acceptance tests and still processes signed notifications', async t => {
  const { request, db, notify } = await setup(t, true, false);
  const status = await request<PaymentConfig>('/api/payments/config');
  assert.equal(status.body.data.enabled, false);
  const ownerCookie = status.response.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await request('/api/orders', input)).response.status, 503);
  assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get()!.n, 0);
  db.prepare("INSERT INTO admin_accounts(username,password_hash,created_at,permissions) VALUES (?,?,?,'[\"checkout.test\"]')").run('admin', await hashAdminPassword('acceptance-admin-password'), new Date().toISOString());
  const login = await request('/api/admin/login', { username: 'admin', password: 'acceptance-admin-password' });
  assert.equal(login.response.status, 200);
  const adminCookie = login.response.headers.get('set-cookie')!.split(';')[0];
  const cookie = `${ownerCookie}; ${adminCookie}`;
  db.prepare("UPDATE admin_accounts SET permissions = '[]' WHERE username = 'admin'").run();
  assert.equal((await request<PaymentConfig>('/api/payments/config', undefined, { cookie })).body.data.enabled, false);
  assert.equal((await request('/api/orders', input, { cookie })).response.status, 503);
  db.prepare("UPDATE admin_accounts SET permissions = '[\"checkout.test\"]' WHERE username = 'admin'").run();
  assert.equal((await request<PaymentConfig>('/api/payments/config', undefined, { cookie })).body.data.enabled, true);
  const created = await request('/api/orders', input, { cookie });
  assert.equal(created.response.status, 201);
  const id = created.body.data.id;
  assert.equal((await request(`/api/orders/${id}/payment`, {}, { cookie })).response.status, 200);
  assert.equal((await request(`/api/orders/${id}/payment`, {}, { cookie: ownerCookie })).response.status, 503);
  assert.equal((await notify({ out_trade_no: id })).status, 200);
  assert.equal((await request(`/api/orders/${id}`, undefined, { cookie: ownerCookie })).body.data.status, 'paid');
  await request('/api/admin/logout', {}, { cookie });
  assert.equal((await request<PaymentConfig>('/api/payments/config', undefined, { cookie })).body.data.enabled, false);
  assert.equal((await request('/api/orders', input, { cookie, key: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff' })).response.status, 503);
});

test('server prices, product availability and JSON origin are enforced', async t => {
  const { request, db } = await setup(t);
  await request('/api/payments/config');
  for (const body of [{ ...input, expectedPriceCents: 1 }, { ...input, contact: 'bad' }, { ...input, queryPassword: 'short' }, { ...input, queryPassword: '123456789012345' }, { ...input, queryPassword: '        ' }, { ...input, queryPassword: undefined }]) {
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
  assert.equal(db.prepare('SELECT terms_version FROM orders WHERE id = ?').get(order.id)!.terms_version, '2026-10-21');
  assert.equal((await request('/api/orders', input)).body.data.id, order.id);
  assert.equal((await request('/api/orders', { ...input, contact: 'changed@example.com' })).response.status, 409);
  assert.equal((await request('/api/orders', { ...input, queryPassword: 'different123' })).response.status, 409);
  db.prepare('UPDATE products SET price_cents = 13100, name = ? WHERE id = ?').run('Changed', input.productId);
  const detail = await request(`/api/orders/${order.id}`);
  assert.equal(detail.body.data.productName, 'ChatGPT Plus');
  assert.equal(detail.body.data.priceCents, 13000);
  assert.doesNotMatch(JSON.stringify(detail.body), /private@example.com|owner_hash|idempotency/);
  assert.equal((await request(`/api/orders/${order.id}`, undefined, { cookie: '' })).response.status, 404);
  assert.deepEqual((await request('/api/orders', undefined, { cookie: '' })).body.data, []);
  assert.equal((await request(`/api/orders/${order.id}/payment`, {}, { cookie: '' })).response.status, 404);
});

test('contact and password lookup grants only matching orders and expires without changing original ownership', async t => {
  const { request, db } = await setup(t);
  const config = await request('/api/payments/config');
  const originalCookie = config.response.headers.get('set-cookie')!.split(';')[0];
  const first = (await request('/api/orders', input)).body.data;
  const second = (await request('/api/orders', { ...input, queryPassword: 'another123' }, { key: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee' })).body.data;
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(first.id)!;
  assert.match(String(row.query_password_hash), /^scrypt:/);
  assert.notEqual(row.query_password_hash, input.queryPassword);
  assert.doesNotMatch(JSON.stringify(first), /queryPassword|query_password|contact|private@example/);
  assert.equal((await request(`/api/orders/${first.id}`, undefined, { cookie: '' })).response.status, 404);
  assert.equal((await request('/api/orders/lookup', { contact: input.contact, queryPassword: 'wrong-password' }, { cookie: '' })).response.status, 401);
  const found = await request<Order[]>('/api/orders/lookup', { contact: 'PRIVATE@example.com', queryPassword: input.queryPassword }, { cookie: '' });
  assert.equal(found.response.status, 200);
  assert.deepEqual(found.body.data.map(order => order.id), [first.id]);
  assert.equal((await request(`/api/orders/${first.id}`)).response.status, 200);
  assert.equal((await request(`/api/orders/${second.id}`)).response.status, 404);
  assert.deepEqual((await request<Order[]>('/api/orders')).body.data.map(order => order.id), [first.id]);
  db.prepare("UPDATE order_access SET expires_at = '2000-01-01T00:00:00Z'").run();
  assert.equal((await request(`/api/orders/${first.id}`)).response.status, 404);
  assert.equal((await request(`/api/orders/${first.id}`, undefined, { cookie: originalCookie })).response.status, 200);
});

test('lookup rejects missing passwords, cross-site requests and repeated guesses, including legacy orders', async t => {
  const { request, db } = await setup(t);
  const order = (await request('/api/orders', input)).body.data;
  db.prepare('UPDATE orders SET query_password_hash = NULL, contact = NULL WHERE id = ?').run(order.id);
  assert.equal((await request('/api/orders/lookup', { contact: input.contact }, { cookie: '' })).response.status, 400);
  assert.equal((await request('/api/orders/lookup', input, { origin: 'https://evil.example' })).response.status, 403);
  for (let i = 0; i < 7; i++) assert.equal((await request('/api/orders/lookup', input, { cookie: '' })).response.status, 401);
  assert.equal((await request('/api/orders/lookup', input, { cookie: '' })).response.status, 429);
  assert.equal(db.prepare('SELECT count(*) AS n FROM order_access').get()!.n, 0);
});

test('concurrent idempotent purchase retries produce one order and accept non-email contact', async t => {
  const { request, db } = await setup(t);
  await request('/api/payments/config');
  const body = { ...input, contact: '13800138000' };
  const results = await Promise.all([request('/api/orders', body), request('/api/orders', body)]);
  assert.ok(results.every(result => result.response.status === 201));
  assert.equal(results[0].body.data.id, results[1].body.data.id);
  assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get()!.n, 1);
  assert.equal((await request<Order[]>('/api/orders/lookup', body, { cookie: '' })).body.data[0].id, results[0].body.data.id);
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
  assert.deepEqual((await request('/api/orders')).body.data, []);
  assert.equal((await request(`/api/orders/${order.id}`)).response.status, 404);
  assert.equal((await request(`/api/orders/${order.id}/payment`, {})).response.status, 404);
  assert.equal((await request('/api/orders/lookup', input)).response.status, 401);
  assert.equal((await request('/api/orders', input)).response.status, 409);
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

test('customer cancellation checks ownership and origin, closes unpaid trades, persists cancellation and accepts retries',async t=>{
  const {request,db,setTrade,closeCalls}=await setup(t);
  const order=(await request('/api/orders',input)).body.data;
  assert.equal(order.cancelAction,'cancel');
  const path=`/api/orders/${order.id}/cancel`;
  assert.equal((await request(path,{expectedAction:'cancel'},{cookie:''})).response.status,404);
  assert.equal((await request(path,{expectedAction:'cancel'},{origin:'https://evil.example'})).response.status,403);
  assert.equal((await request(path,{expectedAction:'request_refund'})).response.status,409);
  setTrade({out_trade_no:order.id,total_amount:'130.00',trade_status:'WAIT_BUYER_PAY'});
  const cancelled=await request(path,{expectedAction:'cancel'});
  assert.equal(cancelled.response.status,200);assert.equal(cancelled.body.data.status,'cancelled');assert.equal(cancelled.body.data.cancelAction,null);
  assert.equal(cancelled.body.data.cancellation?.message,'未付款订单已取消，无需退款。');assert.equal(closeCalls(),1);
  assert.equal((await request(path,{expectedAction:'cancel'})).body.data.status,'cancelled');assert.equal(closeCalls(),1);
  assert.equal((await request<Order[]>('/api/orders')).body.data[0].status,'cancelled');
  assert.equal((await request(`/api/orders/${order.id}/payment`,{})).response.status,409);
  assert.equal(db.prepare('SELECT count(*) n FROM payment_refunds').get()!.n,0);
});

test('unavailable payment verification explains disabled cancellation without allowing an unsafe write', async t => {
  const { request, notify, db } = await setup(t);
  const order = (await request('/api/orders', input)).body.data;
  const disabled = orderRepository(db, { ...gateway, status: { ...gateway.status, enabled: false } });
  const owner = String(db.prepare('SELECT owner_hash FROM orders WHERE id=?').get(order.id)!.owner_hash);
  for (const paid of [false, true]) {
    if (paid) await notify({ out_trade_no: order.id });
    const current = disabled.owned(order.id, owner);
    assert.equal(current.cancelAction, null);
    assert.match(current.cancelUnavailableReason!, /暂无法核实支付状态/);
    assert.throws(() => disabled.cancellationEligible(order.id, owner), { code: 'PAYMENT_NOT_CONFIGURED' });
  }
  db.prepare("UPDATE orders SET status='closed' WHERE id=?").run(order.id);
  assert.equal(disabled.owned(order.id, owner).cancelUnavailableReason, undefined);
  assert.equal(db.prepare('SELECT count(*) n FROM order_cancellations').get()!.n, 0);
});

test('a payment found while canceling or arriving after cancellation is preserved and never silently refunded',async t=>{
  const {request,setTrade,notify,db,closeCalls}=await setup(t);
  const order=(await request('/api/orders',input)).body.data;
  const path=`/api/orders/${order.id}/cancel`;
  setTrade({out_trade_no:order.id,total_amount:'130.00',trade_no:'2026101722000000000000000001',trade_status:'TRADE_SUCCESS'});
  assert.equal((await request(path,{expectedAction:'cancel'})).body.data.status,'paid');assert.equal(closeCalls(),0);
  assert.equal(db.prepare('SELECT count(*) n FROM order_refund_reviews').get()!.n,0);
  assert.equal((await request(path,{expectedAction:'cancel'})).response.status,409);
  const second=(await request('/api/orders',{...input,contact:'second@example.invalid'},{key:'bbbbbbbb-cccc-dddd-eeee-ffffffffffff'})).body.data;
  setTrade(null);assert.equal((await request(`/api/orders/${second.id}/cancel`,{expectedAction:'cancel'})).body.data.status,'cancelled');
  assert.equal((await notify({out_trade_no:second.id,trade_no:'2026101722000000000000000002'})).status,200);
  const late=(await request(`/api/orders/${second.id}`)).body.data;
  assert.equal(late.status,'paid');assert.equal(late.cancellation,undefined);assert.equal(late.cancelAction,'request_refund');
  assert.equal(db.prepare('SELECT count(*) n FROM payment_refunds').get()!.n,0);
});

test('uncertain payment queries and failed close calls cannot mark a customer order canceled',async t=>{
  const first=await setup(t);const order=(await first.request('/api/orders',input)).body.data;
  first.setQueryError();assert.equal((await first.request(`/api/orders/${order.id}/cancel`,{expectedAction:'cancel'})).response.status,502);
  assert.equal((await first.request(`/api/orders/${order.id}`)).body.data.status,'pending');
  const second=await setup(t);const other=(await second.request('/api/orders',input)).body.data;
  second.setTrade({out_trade_no:other.id,total_amount:'130.00',trade_status:'WAIT_BUYER_PAY'});second.setCloseError();
  assert.equal((await second.request(`/api/orders/${other.id}/cancel`,{expectedAction:'cancel'})).response.status,502);
  assert.equal(second.db.prepare('SELECT count(*) n FROM order_cancellations').get()!.n,0);
});

test('an owned paid order can request cancellation before timeout and creates exactly one pending refund review',async t=>{
  const {request,notify,db}=await setup(t);const order=(await request('/api/orders',input)).body.data;
  await notify({out_trade_no:order.id});
  assert.equal((await request(`/api/orders/${order.id}`)).body.data.cancelAction,'request_refund');
  const path=`/api/orders/${order.id}/cancel`;
  assert.equal((await request(path,{expectedAction:'request_refund'},{cookie:''})).response.status,404);
  const result=await request(path,{expectedAction:'request_refund'});
  assert.equal(result.response.status,200);assert.equal(result.body.data.status,'cancelled');assert.equal(result.body.data.cancellation?.state,'refund_review');
  assert.match(result.body.data.cancellation!.message,/用户申请取消/);
  await request(path,{expectedAction:'request_refund'});
  assert.equal(db.prepare('SELECT count(*) n FROM order_refund_reviews').get()!.n,1);assert.equal(db.prepare('SELECT count(*) n FROM payment_refunds').get()!.n,0);
});

test('order reads expose the actual recharge email only after subscription succeeds and retain ownership checks', async t => {
  const { request, notify, db } = await setup(t);
  const order = (await request('/api/orders', input)).body.data;
  await notify({ out_trade_no: order.id });
  assert.deepEqual((await request(`/api/orders/${order.id}`)).body.data.recharge,
    { submitted: false, state: '', settlement: '', renewal: '' });
  const voucher = db.prepare("INSERT INTO voucher_inventory(product_id,environment,code,priority) VALUES ('chatgpt-plus','sandbox','PRIVATE-VOUCHER',0)").run();
  db.prepare('INSERT INTO order_redemptions(order_id,voucher_id,submit_key,submitted) VALUES (?,?,?,1)').run(order.id, voucher.lastInsertRowid, 'private-submit-key');
  db.prepare('INSERT INTO order_fulfillment_details(order_id,recharge_email) VALUES (?,?)').run(order.id, 'recharge@example.invalid');
  for (const [result, succeeded] of [
    [null, false], [{ state: 'QUEUED' }, false], [{ state: 'FULFILLED', settlement: 'UNKNOWN' }, false],
    [{ renewal: 'ready' }, false], [{ state: 'NO_CHARGE', settlement: 'NO_CHARGE' }, false],
    [{ state: 'FULFILLED', settlement: 'PAID' }, true], [{ renewal: 'paid' }, true],
  ] as const) {
    db.prepare('UPDATE order_redemptions SET result=? WHERE order_id=?').run(JSON.stringify(result), order.id);
    const list = (await request<Order[]>('/api/orders')).body.data;
    const detail = (await request(`/api/orders/${order.id}`)).body.data;
    const expected = succeeded ? { status: 'succeeded', rechargeEmail: 'recharge@example.invalid' } : undefined;
    assert.deepEqual(list[0].fulfillment, expected);
    assert.deepEqual(detail.fulfillment, expected);
    const recharge = { submitted: true, state: result && 'state' in result ? result.state : '',
      settlement: result && 'settlement' in result ? result.settlement : '', renewal: result && 'renewal' in result ? result.renewal : '' };
    assert.deepEqual(list[0].recharge, recharge);
    assert.deepEqual(detail.recharge, recharge);
    assert.doesNotMatch(JSON.stringify(list), /PRIVATE-VOUCHER|private-submit-key|private@example.com/);
  }
  assert.deepEqual((await request<Order[]>('/api/orders', undefined, { cookie: '' })).body.data, []);
  assert.equal((await request(`/api/orders/${order.id}`, undefined, { cookie: '' })).response.status, 404);
  db.prepare('UPDATE order_fulfillment_details SET recharge_email=NULL WHERE order_id=?').run(order.id);
  assert.deepEqual((await request<Order[]>('/api/orders')).body.data[0].fulfillment, { status: 'succeeded', rechargeEmail: null });
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

test('coupons validate product, threshold and environment; orders reserve limited uses and pay the discounted amount', async t => {
  const { db, request, notify } = await setup(t);
  db.prepare(`INSERT INTO coupons(id,code,environment,product_id,min_cents,discount_cents,usage_limit,created_at) VALUES (?,?,?,?,?,?,?,?)`).run('coupon-1','SAVE5','sandbox','chatgpt-plus',10000,500,1,new Date().toISOString());
  await request('/api/payments/config');
  assert.equal((await request('/api/coupons/quote', { code: 'save5', productId: 'chatgpt-pro-5x' })).response.status, 400);
  const quote = await request<{ payableCents: number }>('/api/coupons/quote', { code: 'save5', productId: 'chatgpt-plus' });
  assert.equal(quote.body.data.payableCents, 12500);
  const order = await request('/api/orders', { ...input, couponCode: 'save5', expectedDiscountCents: 500, priceCents: 1 });
  assert.equal(order.response.status, 201);
  assert.equal(order.body.data.priceCents, 12500);
  assert.equal((await request('/api/orders', { ...input, couponCode: 'save5', expectedDiscountCents: 500 })).body.data.id, order.body.data.id);
  assert.equal((await request('/api/orders', { ...input, couponCode: 'SAVE5', expectedDiscountCents: 500 }, { key: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff' })).response.status, 409);
  assert.equal((await notify({ out_trade_no: order.body.data.id, total_amount: '130.00' })).status, 400);
  assert.equal((await notify({ out_trade_no: order.body.data.id, total_amount: '125.00' })).status, 200);
  assert.equal(db.prepare('SELECT count(*) AS n FROM coupon_orders').get()!.n, 1);
});

test('coupon management requires permission and validates restrictions', async t => {
  const { db, request } = await setup(t);
  assert.equal((await request('/api/admin/coupons')).response.status, 401);
  db.prepare("INSERT INTO admin_accounts(username,password_hash,created_at,permissions) VALUES (?,?,?,'[]')").run('couponadmin', await hashAdminPassword('coupon-password-123'), new Date().toISOString());
  const login = await request('/api/admin/login', { username: 'couponadmin', password: 'coupon-password-123' });
  const cookie = login.response.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await request('/api/admin/coupons', undefined, { cookie })).response.status, 403);
  db.prepare(`UPDATE admin_accounts SET permissions='["coupons.manage"]' WHERE username='couponadmin'`).run();
  const coupon = { productId: null, minCents: 1000, discountCents: 500, usageLimit: 10 };
  assert.equal((await request('/api/admin/coupons', { ...coupon, usageLimit: 0 }, { cookie })).response.status, 400);
  const created = await request<{ id: string; code: string }>('/api/admin/coupons', coupon, { cookie });
  assert.equal(created.response.status, 201);
  const { id, code } = created.body.data;
  assert.match(code, /^WS-[A-F0-9]{16}$/);
  const second = await request<{ code: string }>('/api/admin/coupons', { ...coupon, code }, { cookie });
  assert.equal(second.response.status, 201);
  assert.notEqual(second.body.data.code, code);
  assert.equal((await request('/api/coupons/quote', { code: code.toLowerCase(), productId: 'chatgpt-plus' })).response.status, 200);
  const edited = { ...coupon, code: 'REPLACEMENT', discountCents: 600 };
  assert.equal((await request(`/api/admin/coupons/${id}/update`, edited, { cookie })).response.status, 200);
  assert.equal(db.prepare('SELECT code FROM coupons WHERE id=?').get(id)?.code, code);
  assert.equal((await request('/api/orders', { ...input, couponCode: code, expectedDiscountCents: 500 })).body.error.code, 'COUPON_CHANGED');
  const order = await request('/api/orders', { ...input, couponCode: code, expectedDiscountCents: 600 });
  assert.equal(order.body.data.priceCents, 12400);
  assert.equal(order.body.data.originalPriceCents, 13000);
  assert.equal((await request(`/api/orders/${order.body.data.id}`)).body.data.originalPriceCents, 13000);
  assert.equal((await request(`/api/admin/coupons/${id}/update`, { ...edited, usageLimit: 0 }, { cookie })).response.status, 400);
  assert.equal((await request(`/api/admin/coupons/${id}/delete`, {}, { cookie })).response.status, 200);
  assert.equal((await request('/api/coupons/quote', { code, productId: 'chatgpt-plus' })).response.status, 400);
  assert.equal(db.prepare('SELECT count(*) AS n FROM coupon_orders WHERE coupon_id=?').get(id)!.n, 1);
});
