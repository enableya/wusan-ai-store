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
  assert.deepEqual(list.data.map((product) => product.priceCents), [13000, 8800, 66000, 115000, 335000, 300]);
  assert.equal(list.data.length, 6);
  assert.equal(list.data[0].mark, 'Plus');
  for (const product of list.data) {
    const { response, body } = await get<Product>(`/api/products/${product.id}`);
    assert.equal(response.status, 200);
    assert.deepEqual(body.data, product);
    assert.equal(product.currency, 'CNY');
    assert.equal(product.periodMonths, 1);
    if(product.deliveryType!=='voucher')assert.equal(product.details.deliveryMethod, null);
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
  assert.equal((await get('/api/products?category=Plus')).body.data.length, 2);
  assert.equal((await get('/api/products?category=Pro')).body.data.length, 3);
  assert.equal((await get('/api/products?category=Codex')).body.data[0].id, 'codex-sms');
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
  assert.equal((await get('/api/products')).body.data.length, 5);
  assert.equal((await get<HomeData>('/api/home')).body.data.products.length, 5);
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
    assert.equal(catalog.listProducts().length, 5);
  } finally {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(filename + suffix, { force: true });
    rmdirSync(directory);
  }
});

test('schema 22 adds the finished-account product at 88 yuan once and preserves merchant edits',()=>{
  const directory=mkdtempSync(join(tmpdir(),'wusan-account-migration-')),filename=join(directory,'store.sqlite');
  let db=openDatabase(filename);
  try {
    db.exec("DROP TRIGGER card_delivery_history; DROP TABLE order_card_deliveries; DELETE FROM products WHERE id='chatgpt-plus-account'; PRAGMA user_version=22;");
    db.prepare("UPDATE products SET price_cents=13100 WHERE id='chatgpt-plus'").run();db.close();db=openDatabase(filename);
    assert.equal(catalogRepository(db).findProduct('chatgpt-plus-account')!.priceCents,8800);
    assert.equal(catalogRepository(db).findProduct('chatgpt-plus-account')!.deliveryType,'voucher');
    assert.equal(catalogRepository(db).findProduct('chatgpt-plus')!.priceCents,13100);
    db.prepare("UPDATE products SET price_cents=9900 WHERE id='chatgpt-plus-account'").run();db.close();db=openDatabase(filename);
    assert.equal(catalogRepository(db).findProduct('chatgpt-plus-account')!.priceCents,9900);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
    db.prepare("DELETE FROM products WHERE id='chatgpt-plus-account'").run();db.close();db=openDatabase(filename);
    assert.equal(catalogRepository(db).findProduct('chatgpt-plus-account'),undefined);
  }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});

test('schema 24 updates finished-account default copy while retaining merchant copy, prices and instructions',()=>{
  const directory=mkdtempSync(join(tmpdir(),'wusan-account-copy-')),filename=join(directory,'store.sqlite');
  let db=openDatabase(filename);
  try {
    const id='chatgpt-plus-account';
    const presentation=JSON.parse(String(db.prepare('SELECT presentation FROM products WHERE id=?').get(id)!.presentation));
    presentation.description='确认付款后获取成品号卡密，可在订单中再次查看。';
    presentation.features=['成品号卡密交付','付款确认后获取卡密','支持订单查询与卡密复制'];
    presentation.details.entitlements='成品号通过卡密交付，具体账号信息与使用说明以交付内容为准。';
    presentation.details.afterSales=null;
    db.prepare('UPDATE products SET price_cents=9900,presentation=? WHERE id=?').run(JSON.stringify(presentation),id);
    db.prepare("INSERT INTO product_voucher_instructions VALUES (?,'sandbox','商家填写的登录教程')").run(id);
    db.exec('PRAGMA user_version=24');db.close();db=openDatabase(filename);
    const product=catalogRepository(db).findProduct(id)!;
    assert.deepEqual(product.features.slice(0,2),['提供账号密码直接使用','质保 30 天']);
    assert.equal(product.details.afterSales,'付款后提供 GPT 账号密码，可直接登录使用，并提供登录教程。提供 30 天订阅及封号质保。');
    assert.equal(product.priceCents,9900);
    assert.equal(db.prepare('SELECT instructions FROM product_voucher_instructions').get()!.instructions,'商家填写的登录教程');
    const custom={...presentation,description:'商家自定义介绍',features:['自定义权益','自定义质保'],details:{...presentation.details,afterSales:'商家自定义售后'}};
    db.prepare('UPDATE products SET presentation=? WHERE id=?').run(JSON.stringify(custom),id);
    db.exec('PRAGMA user_version=24');db.close();db=openDatabase(filename);
    const retained=catalogRepository(db).findProduct(id)!;
    assert.equal(retained.description,custom.description);assert.deepEqual(retained.features,custom.features);assert.equal(retained.details.afterSales,custom.details.afterSales);
    assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');
  }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});

test('schema 25 adds Codex once and preserves existing products and referenced card history',()=>{
  const directory=mkdtempSync(join(tmpdir(),'wusan-codex-migration-')),filename=join(directory,'store.sqlite');
  let db=openDatabase(filename);
  try {
    db.prepare("DELETE FROM products WHERE id='codex-sms'").run();
    db.prepare("UPDATE products SET price_cents=9900 WHERE id='chatgpt-plus-account'").run();
    const oldSchema=String(db.prepare("SELECT sql FROM sqlite_master WHERE name='products'").get()!.sql)
      .replace(/CREATE TABLE (?:"products"|products)/,'CREATE TABLE products_v25')
      .replace("'Plus', 'Pro', 'Codex'","'Plus', 'Pro'");
    db.exec('PRAGMA foreign_keys=OFF;');
    db.exec(oldSchema);
    db.exec('INSERT INTO products_v25 SELECT * FROM products; DROP TABLE products; ALTER TABLE products_v25 RENAME TO products; PRAGMA foreign_keys=ON;');
    const voucher=db.prepare("INSERT INTO voucher_inventory(product_id,environment,code,priority) VALUES ('chatgpt-plus-account','sandbox','EXISTING-CARD',1)").run();
    db.prepare("INSERT INTO product_voucher_instructions VALUES ('chatgpt-plus-account','sandbox','商家自定义说明')").run();
    db.prepare(`INSERT INTO orders(id,owner_hash,email,snapshot,status,created_at,expires_at,idempotency_key,fingerprint,environment)
      VALUES ('existing-order','owner','','{}','paid','','','existing-key','existing-fingerprint','sandbox')`).run();
    db.prepare("INSERT INTO order_card_deliveries VALUES ('existing-order',?,'EXISTING-CARD','2026-11-12T00:00:00Z')").run(voucher.lastInsertRowid);
    const existing=db.prepare('SELECT * FROM products ORDER BY id').all();
    db.exec('PRAGMA user_version=25;');db.close();db=openDatabase(filename);
    const product=catalogRepository(db).findProduct('codex-sms')!;
    assert.equal(product.name,'Codex 接码');assert.equal(product.category,'Codex');assert.equal(product.priceCents,300);
    assert.equal(product.selectable,true);assert.equal(product.deliveryType,'voucher');assert.equal(product.unitLabel,'次');
    assert.deepEqual(db.prepare("SELECT * FROM products WHERE id!='codex-sms' ORDER BY id").all(),existing);
    assert.equal(db.prepare('SELECT instructions FROM product_voucher_instructions').get()!.instructions,'商家自定义说明');
    assert.equal(db.prepare('SELECT voucher_id FROM order_card_deliveries').get()!.voucher_id,Number(voucher.lastInsertRowid));
    assert.equal(db.prepare('SELECT voucher_code FROM order_fulfillment_details').get()!.voucher_code,'EXISTING-CARD');
    assert.equal(db.prepare('PRAGMA foreign_keys').get()!.foreign_keys,1);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
    assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');
    db.prepare("UPDATE products SET price_cents=500 WHERE id='codex-sms'").run();db.close();db=openDatabase(filename);
    assert.equal(catalogRepository(db).findProduct('codex-sms')!.priceCents,500);
    db.prepare("DELETE FROM products WHERE id='codex-sms'").run();db.close();db=openDatabase(filename);
    assert.equal(catalogRepository(db).findProduct('codex-sms'),undefined);
  }finally{db.close();rmSync(directory,{recursive:true,force:true});}
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
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 31);
  } finally {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(filename + suffix, { force: true });
    rmdirSync(directory);
  }
});

test('schema 26 introduces enabled payment controls without changing existing data and preserves switches on restart',async()=>{
  const {paymentControls}=await import('./payment-controls.ts');
  const directory=mkdtempSync(join(tmpdir(),'wusan-payment-switches-')),file=join(directory,'store.sqlite');
  let db=openDatabase(file);
  try{
    const products=db.prepare('SELECT * FROM products ORDER BY id').all();
    db.exec('DROP TABLE payment_control_events; DROP TABLE product_payment_controls; DROP TABLE payment_controls; PRAGMA user_version=26;');
    db.close();db=openDatabase(file);
    const controls=paymentControls(db,'sandbox');
    assert.equal(controls.list().enabled,true);assert.ok(controls.list().products.every(p=>p.enabled));
    assert.deepEqual(db.prepare('SELECT * FROM products ORDER BY id').all(),products);
    controls.update({productId:'codex-sms',enabled:false,version:0},'admin');
    controls.update({productId:null,enabled:false,version:1},'admin');
    db.close();db=openDatabase(file);
    assert.equal(paymentControls(db,'sandbox').list().enabled,false);
    assert.equal(paymentControls(db,'sandbox').list().products.find(p=>p.id==='codex-sms')!.enabled,false);
    assert.equal(paymentControls(db,'production').list().enabled,true);
    assert.equal(db.prepare('SELECT count(*) n FROM payment_control_events').get()!.n,2);
    assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');
  }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});
