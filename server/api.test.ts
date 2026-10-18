import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { once } from 'node:events';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApiServer } from './app.ts';
import { catalogRepository, openDatabase } from './database.ts';
import * as oldContent from './seed/content-v2.ts';
import type { Article, Faq, HomeData, Product } from '../src/types/catalog.ts';

async function setup(t: TestContext) {
  const db = openDatabase(':memory:');
  const server = createApiServer(db);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeIdleConnections();
    });
    db.close();
  });
  return {
    db,
    get: async <T = Product[]>(path: string) => {
      const response = await fetch(base + path);
      return { response, body: await response.json() as { data: T; error: { code: string; requestId: string } } };
    },
    base,
  };
}

test('health, HEAD and public response headers', async (t) => {
  const { get, base } = await setup(t);
  const { response, body } = await get('/api/health');
  assert.equal(response.status, 200);
  assert.deepEqual(body, { data: { status: 'ok' } });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(response.headers.get('x-request-id'));
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  const head = await fetch(base + '/api/products', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('home, product list and details use the confirmed database prices', async (t) => {
  const { get } = await setup(t);
  const { body: list } = await get('/api/products');
  assert.deepEqual(list.data.map((product) => product.priceCents), [13000, 66000, 115000, 335000]);
  assert.equal(list.data.length, 4);
  assert.equal(list.data[0].mark, 'Plus');
  for (const product of list.data) {
    const { response, body } = await get<Product>(`/api/products/${product.id}`);
    assert.equal(response.status, 200);
    assert.deepEqual(body.data, product);
    assert.equal(product.currency, 'CNY');
    assert.equal(product.periodMonths, 1);
    assert.equal(product.details.deliveryMethod, null);
  }
  const { body: home } = await get<HomeData>('/api/home');
  assert.deepEqual(home.data.products, list.data);
  assert.equal(home.data.hero.title, 'ChatGPT 订阅服务');
  assert.equal(home.data.faqs.length, 4);
  const { body: content } = await get<{ articles: Article[]; faqs: Faq[] }>('/api/content');
  assert.equal(content.data.articles.length, 4);
  assert.deepEqual(content.data.faqs, home.data.faqs);
});

test('category filtering and invalid parameters are handled explicitly', async (t) => {
  const { get } = await setup(t);
  assert.equal((await get('/api/products?category=Plus')).body.data.length, 1);
  assert.equal((await get('/api/products?category=Pro')).body.data.length, 3);
  for (const path of ['/api/products?category=bad', '/api/products?category=Pro&category=Plus', '/api/products?price=1', '/api/products/%27%20OR%201%3D1', '/api/products/%ZZ']) {
    const { response, body } = await get(path);
    assert.equal(response.status, 400, path);
    assert.ok(body.error.code);
    assert.ok(body.error.requestId);
    assert.equal(body.data, undefined);
  }
});

test('missing or unpublished products are not exposed', async (t) => {
  const { db, get } = await setup(t);
  assert.equal((await get('/api/products/unknown')).response.status, 404);
  assert.equal((await get('/api/unknown')).response.status, 404);
  assert.equal((await get('/server/data/store.sqlite')).response.status, 404);
  db.prepare('UPDATE products SET active = 0 WHERE id = ?').run('chatgpt-plus');
  assert.equal((await get('/api/products/chatgpt-plus')).response.status, 404);
  assert.equal((await get('/api/products')).body.data.length, 3);
  assert.equal((await get<HomeData>('/api/home')).body.data.products.length, 3);
});

test('API never accepts public product or unsupported payment writes', async (t) => {
  const { base, get } = await setup(t);
  for (const path of ['/api/products', '/api/products/chatgpt-plus', '/api/payments']) {
    const response = await fetch(base + path, { method: 'POST', body: '{"priceCents":1,"email":"private@example.com"}' });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
    assert.ok(!(await response.text()).includes('private@example.com'));
  }
  assert.equal((await get<Product>('/api/products/chatgpt-plus')).body.data.priceCents, 13000);
});

test('database changes reach every endpoint without a frontend data fallback', async (t) => {
  const { db, get } = await setup(t);
  db.prepare('UPDATE products SET name = ?, price_cents = ? WHERE id = ?').run('Updated Plus', 13100, 'chatgpt-plus');
  const home = catalogRepository(db).home();
  db.prepare('UPDATE content SET value = ? WHERE key = ?').run(JSON.stringify({ ...home, hero: { ...home.hero, title: 'Updated home' } }), 'home');
  const { body: homepage } = await get<HomeData>('/api/home');
  assert.equal(homepage.data.hero.title, 'Updated home');
  for (const product of [
    homepage.data.products[0],
    (await get('/api/products')).body.data[0],
    (await get<Product>('/api/products/chatgpt-plus')).body.data,
  ]) {
    assert.equal(product.name, 'Updated Plus');
    assert.equal(product.priceCents, 13100);
  }
});

test('initialization is persistent and never overwrites edited data or reseeds deleted products', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wusan-api-'));
  const filename = join(directory, 'test.sqlite');
  let db = openDatabase(filename);
  try {
    db.prepare('UPDATE products SET price_cents = ? WHERE id = ?').run(13200, 'chatgpt-plus');
    db.prepare(`UPDATE products SET presentation = json_set(presentation, '$.mark', '+', '$.label', 'Custom label') WHERE id = ?`).run('chatgpt-plus');
    db.prepare('DELETE FROM products WHERE id = ?').run('chatgpt-pro-5x');
    db.exec('PRAGMA user_version = 1');
    db.close();
    db = openDatabase(filename);
    const catalog = catalogRepository(db);
    assert.equal(catalog.findProduct('chatgpt-plus')!.priceCents, 13200);
    assert.equal(catalog.findProduct('chatgpt-plus')!.mark, 'Plus');
    assert.equal(catalog.findProduct('chatgpt-plus')!.label, 'Custom label');
    assert.equal(catalog.findProduct('chatgpt-pro-5x'), undefined);
    assert.equal(catalog.listProducts().length, 3);
  } finally {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(filename + suffix, { force: true });
    rmdirSync(directory);
  }
});

test('database rejects invalid prices and selectable products without a price', async (t) => {
  const { db } = await setup(t);
  for (const price of [-1, 0, 1.5, null]) {
    assert.throws(() => db.prepare('UPDATE products SET price_cents = ? WHERE id = ?').run(price, 'chatgpt-plus'));
  }
});

test('payment migration updates unchanged built-in copy and preserves merchant edits', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wusan-migration-'));
  const filename = join(directory, 'test.sqlite');
  let db = openDatabase(filename);
  try {
    const home = { ...oldContent.home, hero: { ...oldContent.home.hero, title: 'Merchant title' } };
    const faqs = oldContent.faqs.map((faq, index) => index === 0 ? { ...faq, answer: 'Merchant answer' } : faq);
    for (const [key, value] of [['home', home], ['faqs', faqs], ['articles', oldContent.articles]]) {
      db.prepare('UPDATE content SET value = ? WHERE key = ?').run(JSON.stringify(value), key as string);
    }
    db.exec('PRAGMA user_version = 2');
    db.close();
    db = openDatabase(filename);
    const catalog = catalogRepository(db);
    assert.equal(catalog.home().hero.title, 'Merchant title');
    assert.match(catalog.home().steps[2].description, /支付宝/);
    assert.equal(catalog.faqs()[0].answer, 'Merchant answer');
    assert.match(catalog.faqs()[1].answer, /支付宝网站支付/);
    assert.match(catalog.articles()[0].sections[3].text, /支付宝官方收银台/);
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 5);
  } finally {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(filename + suffix, { force: true });
    rmdirSync(directory);
  }
});
