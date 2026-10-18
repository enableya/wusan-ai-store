import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApiServer } from './app.ts';
import { openDatabase } from './database.ts';
import { createAlipayGateway } from './alipay.ts';
import { hashAdminPassword } from './admin.ts';
import { chinaDay } from './analytics.ts';
import type { ClickReport } from '../src/types/admin.ts';

async function setup(t: TestContext, filename = ':memory:', adminOrigin = '') {
  const db = openDatabase(filename);
  db.prepare('INSERT INTO admin_accounts VALUES (?,?,?)').run('admin', await hashAdminPassword('test-password-very-long'), new Date().toISOString());
  const server = createApiServer(db, createAlipayGateway({ ALIPAY_ENV: 'sandbox' }), { adminOrigin });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeIdleConnections(); }); db.close(); });
  async function request(path: string, body?: unknown, cookie = '', origin = base) {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { response, json: await response.json() as { data: ClickReport & { authenticated: boolean; recorded: boolean } }, cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
  }
  const login = () => request('/api/admin/login', { username: 'admin', password: 'test-password-very-long' });
  return { db, request, login };
}

test('admin data requires login; login rejects bad passwords and cross-origin requests; logout revokes sessions', async t => {
  const { request, login, db } = await setup(t);
  assert.equal((await request('/api/admin/analytics/products')).response.status, 401);
  assert.equal((await request('/api/admin/session')).json.data.authenticated, false);
  assert.equal((await request('/api/admin/login', { username: 'admin', password: 'bad' })).response.status, 401);
  assert.equal((await request('/api/admin/login', { username: 'admin', password: 'test-password-very-long' }, '', 'https://evil.example')).response.status, 403);
  const session = await login(); assert.equal(session.response.status, 200);
  assert.match(session.response.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/);
  const stored = String(db.prepare('SELECT token_hash FROM admin_sessions').get()!.token_hash);
  assert.notEqual(stored, session.cookie.split('=')[1]);
  assert.equal((await request('/api/admin/analytics/products', undefined, session.cookie)).response.status, 200);
  assert.equal((await request('/api/admin/logout', {}, session.cookie)).response.status, 200);
  assert.equal((await request('/api/admin/analytics/products', undefined, session.cookie)).response.status, 401);
});

test('clicks use server environment, reject unknown products, deduplicate refreshes and exclude administrators', async t => {
  const { request, login, db } = await setup(t);
  const event = { productId: 'chatgpt-plus', eventId: randomUUID(), environment: 'production' };
  const first = await request('/api/analytics/product-click', event);
  assert.equal(first.json.data.recorded, true);
  assert.equal((await request('/api/analytics/product-click', event)).json.data.recorded, false);
  assert.equal((await request('/api/analytics/product-click', { ...event, eventId: randomUUID() }, first.cookie)).json.data.recorded, false);
  assert.equal((await request('/api/analytics/product-click', { ...event, productId: 'chatgpt-pro-5x', eventId: randomUUID() }, first.cookie)).json.data.recorded, true);
  assert.equal((await request('/api/analytics/product-click', { ...event, eventId: randomUUID() })).json.data.recorded, true);
  assert.equal((await request('/api/analytics/product-click', { ...event, productId: 'unknown' })).response.status, 404);
  const admin = await login();
  assert.equal((await request('/api/analytics/product-click', { ...event, eventId: randomUUID() }, admin.cookie)).json.data.recorded, false);
  assert.equal(db.prepare('SELECT count(*) AS n FROM product_clicks').get()!.n, 3);
  assert.deepEqual(db.prepare('SELECT DISTINCT environment FROM product_clicks').all().map(row => row.environment), ['sandbox']);
  const stats = await request('/api/admin/analytics/products?environment=sandbox', undefined, admin.cookie);
  assert.equal(stats.json.data.total, 3); assert.equal(stats.json.data.clickedProducts, 2);
  const plus = stats.json.data.products.find(row => row.id === 'chatgpt-plus');
  assert.ok(plus); assert.equal(plus.clicks, 2);
  assert.equal((await request('/api/admin/analytics/products?environment=production', undefined, admin.cookie)).json.data.total, 0);
});

test('date boundaries use Beijing time, preserve deleted product history and separate environments', async t => {
  const { db, request, login } = await setup(t);
  const insert = db.prepare('INSERT INTO product_clicks(event_id,product_id,product_name,visitor_hash,environment,created_at) VALUES (?,?,?,?,?,?)');
  for (const [time, env] of [['2026-01-01T15:59:59.999Z', 'production'], ['2026-01-01T16:00:00.000Z', 'production'], ['2026-01-02T15:59:59.999Z', 'production'], ['2026-01-02T16:00:00.000Z', 'production'], ['2026-01-01T16:00:00.000Z', 'sandbox']]) insert.run(randomUUID(), 'removed-product', '旧商品', 'visitor', env, time);
  const admin = await login();
  const path = '/api/admin/analytics/products?start=2026-01-02&end=2026-01-02';
  const stats = (await request(path + '&environment=production', undefined, admin.cookie)).json.data;
  assert.equal(stats.total, 2); assert.deepEqual(stats.trend, [{ date: '2026-01-02', clicks: 2 }]);
  assert.equal(stats.products[0].name, '旧商品'); assert.equal(stats.products[0].active, false);
  assert.equal((await request(path + '&environment=all', undefined, admin.cookie)).json.data.total, 3);
});

test('invalid filters fail explicitly, zero-count products remain visible and expired sessions fail closed', async t => {
  const { request, login, db } = await setup(t);
  const admin = await login();
  for (const query of ['start=2026-02-30', 'start=2026-01-03&end=2026-01-02', 'environment=invalid', 'environment=all&environment=sandbox', 'extra=1', 'start=2020-01-01']) assert.equal((await request('/api/admin/analytics/products?' + query, undefined, admin.cookie)).response.status, 400, query);
  const empty = (await request('/api/admin/analytics/products', undefined, admin.cookie)).json.data;
  assert.equal(empty.total, 0); assert.equal(empty.products.length, 4); assert.ok(empty.products.every((row: { clicks: number }) => row.clicks === 0));
  db.prepare("UPDATE admin_sessions SET expires_at = '2000-01-01T00:00:00Z'").run();
  assert.equal((await request('/api/admin/analytics/products', undefined, admin.cookie)).response.status, 401);
  assert.equal(chinaDay(Date.parse('2026-01-01T16:00:00Z')), '2026-01-02');
});

test('new schema and click records survive reopening without changing existing catalog data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wusan-admin-persist-'));
  const filename = join(directory, 'store.sqlite');
  let db = openDatabase(filename);
  try {
    db.prepare('UPDATE products SET name = ? WHERE id = ?').run('商家自定义名称', 'chatgpt-plus');
    db.prepare('INSERT INTO product_clicks(event_id,product_id,product_name,visitor_hash,environment,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), 'chatgpt-plus', '名称', 'visitor', 'sandbox', new Date().toISOString());
    db.close(); db = openDatabase(filename);
    assert.equal(db.prepare('SELECT count(*) AS n FROM product_clicks').get()!.n, 1);
    assert.equal(db.prepare('SELECT name FROM products WHERE id = ?').get('chatgpt-plus')!.name, '商家自定义名称');
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 5);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('HTTPS admin cookies are secure and repeated login failures are rate limited', async t => {
  const { request } = await setup(t, ':memory:', 'https://admin.example.com');
  const result = await request('/api/admin/login', { username: 'admin', password: 'test-password-very-long' }, '', 'https://admin.example.com');
  assert.match(result.response.headers.get('set-cookie')!, /^__Host-wusan_admin=.*; Secure$/);
  for (let i = 0; i < 11; i++) await request('/api/admin/login', { username: 'admin', password: 'bad' }, '', 'https://admin.example.com');
  assert.equal((await request('/api/admin/login', { username: 'admin', password: 'bad' }, '', 'https://admin.example.com')).response.status, 429);
});
