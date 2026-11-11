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
import { hashAdminPassword, insertAdminAccount } from './admin.ts';
import { chinaDay } from './analytics.ts';
import type { AdminAccount, ClickReport, VoucherPage } from '../src/types/admin.ts';

async function setup(t: TestContext, filename = ':memory:', adminOrigin = '') {
  const db = openDatabase(filename);
  insertAdminAccount(db, 'admin', await hashAdminPassword('test-password-very-long'), 'super_admin');
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

test('timeout refund reviews require a separate permission, same origin, current access and matching environment',async t=>{
  const {db,request,login}=await setup(t);
  const at=new Date().toISOString();
  const id='WS'+randomUUID().replaceAll('-','');
  const otherId='WS'+randomUUID().replaceAll('-','');
  for(const [orderId,environment] of [[id,'sandbox'],[otherId,'production']]) {
    db.prepare(`INSERT INTO orders(id,owner_hash,email,snapshot,status,created_at,expires_at,idempotency_key,fingerprint,environment)
      VALUES (?,'owner','',?,'paid',?,?,?,'fixture',?)`).run(orderId,JSON.stringify({productId:'chatgpt-plus',productName:'ChatGPT Plus',priceCents:13000}),at,at,orderId,environment);
    db.prepare("INSERT INTO order_cancellations(order_id,state,refund_key,note,created_at,updated_at,cancelled_at) VALUES (?,'review',?,'退款待后台审核',?,?,?)").run(orderId,'refund-'+orderId,at,at,at);
    db.prepare("INSERT INTO order_refund_reviews(order_id,status,requested_at) VALUES (?,'pending',?)").run(orderId,at);
  }
  insertAdminAccount(db,'refund-viewer',await hashAdminPassword('test-refund-viewer-password'),'admin',['orders.view']);
  const viewer=await request('/api/admin/login',{username:'refund-viewer',password:'test-refund-viewer-password'});
  const admin=await login();
  const path=`/api/admin/orders/${id}/refund/approve`;
  assert.equal((await request('/api/admin/refunds')).response.status,401);
  assert.equal((await request('/api/admin/refunds',undefined,viewer.cookie)).response.status,403);
  assert.equal((await request(path,{reason:''})).response.status,401);
  assert.equal((await request(path,{reason:''},viewer.cookie)).response.status,403);
  assert.equal((await request(path,{reason:''},admin.cookie,'https://evil.example')).response.status,403);
  assert.equal((await request(`/api/admin/orders/${otherId}/refund/approve`,{reason:''},admin.cookie)).response.status,404);
  assert.equal((await request(`/api/admin/orders/${id}/refund/reject`,{reason:' '},admin.cookie)).response.status,400);
  assert.equal(db.prepare('SELECT status FROM order_refund_reviews WHERE order_id=?').get(id)!.status,'pending');
  db.prepare("UPDATE admin_accounts SET permissions='[\"orders.view\",\"orders.refund\"]' WHERE username='refund-viewer'").run();
  const ordinary='WS'+randomUUID().replaceAll('-','');
  db.prepare(`INSERT INTO orders(id,owner_hash,email,snapshot,status,created_at,expires_at,idempotency_key,fingerprint,environment)
    VALUES (?,'owner','',?,'paid',?,?,?,'fixture','sandbox')`).run(ordinary,JSON.stringify({productId:'chatgpt-plus',productName:'ChatGPT Plus',priceCents:13000}),at,at,ordinary);
  db.prepare('INSERT INTO order_fulfillment_details(order_id,voucher_code) VALUES (?,?)').run(id,'PRIVATE-REFUND-CARD');
  const refunds=(await request('/api/admin/refunds',undefined,viewer.cookie)).json.data as unknown as import('../src/types/admin.ts').AdminOrderList;
  assert.equal(refunds.total,1);assert.equal(refunds.orders[0].id,id);assert.equal(refunds.canViewVoucherCodes,false);
  assert.equal(refunds.orders[0].voucherCode,null);assert.doesNotMatch(JSON.stringify(refunds),/PRIVATE-REFUND-CARD/);
  const fullRefunds=(await request('/api/admin/refunds',undefined,admin.cookie)).json.data as unknown as import('../src/types/admin.ts').AdminOrderList;
  assert.equal(fullRefunds.canViewVoucherCodes,true);assert.equal(fullRefunds.orders[0].voucherCode,'PRIVATE-REFUND-CARD');
  db.prepare("UPDATE admin_accounts SET permissions='[\"orders.view\",\"orders.refund\",\"vouchers.codes\"]' WHERE username='refund-viewer'").run();
  const grantedRefunds=(await request('/api/admin/refunds',undefined,viewer.cookie)).json.data as unknown as import('../src/types/admin.ts').AdminOrderList;
  assert.equal(grantedRefunds.canViewVoucherCodes,true);assert.equal(grantedRefunds.orders[0].voucherCode,'PRIVATE-REFUND-CARD');
  db.prepare("UPDATE admin_accounts SET permissions='[\"orders.view\",\"orders.refund\"]' WHERE username='refund-viewer'").run();
  const revokedRefunds=(await request('/api/admin/refunds',undefined,viewer.cookie)).json.data as unknown as import('../src/types/admin.ts').AdminOrderList;
  assert.equal(revokedRefunds.canViewVoucherCodes,false);assert.doesNotMatch(JSON.stringify(revokedRefunds),/PRIVATE-REFUND-CARD/);
  assert.equal((await request('/api/admin/refunds?refundReview=invalid',undefined,viewer.cookie)).response.status,400);
  const list=await request('/api/admin/orders?status=cancelled&refundReview=pending',undefined,viewer.cookie);
  const data=list.json.data as unknown as import('../src/types/admin.ts').AdminOrderList;
  assert.equal(data.canReviewRefunds,true);assert.equal(data.total,1);assert.equal(data.counts.paid,0);
  assert.equal((await request('/api/admin/orders?refundReview=invalid',undefined,viewer.cookie)).response.status,400);
  assert.equal((await request(path,{reason:'核实未充值'},viewer.cookie)).response.status,200);
  const reviewed=db.prepare('SELECT * FROM order_refund_reviews WHERE order_id=?').get(id)!;
  assert.equal(reviewed.status,'approved');assert.equal(reviewed.reviewed_by,'refund-viewer');assert.equal(reviewed.reason,'核实未充值');
  assert.equal((await request(path,{reason:'不能覆盖'},admin.cookie)).response.status,200);
  assert.equal(db.prepare('SELECT reviewed_by FROM order_refund_reviews WHERE order_id=?').get(id)!.reviewed_by,'refund-viewer');
  assert.equal((await request(`/api/admin/orders/${id}/refund/reject`,{reason:'冲突操作'},admin.cookie)).response.status,409);
  db.prepare("UPDATE admin_accounts SET permissions='[\"orders.view\"]' WHERE username='refund-viewer'").run();
  assert.equal((await request(path,{reason:''},viewer.cookie)).response.status,403);
  assert.equal((await request('/api/admin/refunds',undefined,viewer.cookie)).response.status,403);
  assert.equal(db.prepare('SELECT count(*) n FROM payment_refunds').get()!.n,0,'disabled local gateway must not initiate refunds');
});

test('staff voucher reclaim API checks permissions, origin, environment, current card and idempotent retries',async t=>{
  const originalEnabled=process.env.LOVECODEX_ENABLED;process.env.LOVECODEX_ENABLED='true';
  const originalFetch=globalThis.fetch;let queries=0;
  globalThis.fetch=async(url,options)=>{
    if(new URL(String(url)).hostname!=='lovecodex.cn')return originalFetch(url,options);
    queries++;
    return Response.json({ok:true,voucher:{state:'AVAILABLE',product:{id:'chatgpt-plus'}},order:null});
  };
  t.after(()=>{globalThis.fetch=originalFetch;if(originalEnabled===undefined)delete process.env.LOVECODEX_ENABLED;else process.env.LOVECODEX_ENABLED=originalEnabled;});
  const {db,request,login}=await setup(t), admin=await login();
  const id='WS'+randomUUID().replaceAll('-',''),otherId='WS'+randomUUID().replaceAll('-','');
  const now=new Date().toISOString(),code='MOCK-API-RECLAIM-CARD';
  for(const [orderId,environment] of [[id,'sandbox'],[otherId,'production']]) {
    db.prepare(`INSERT INTO orders(id,owner_hash,email,snapshot,status,created_at,expires_at,idempotency_key,fingerprint,environment)
      VALUES (?,'owner','',?,'paid',?,?,?,'fixture',?)`).run(orderId,JSON.stringify({productId:'chatgpt-plus',productName:'ChatGPT Plus',staffCheckout:true,priceCents:0}),now,now,orderId,environment);
  }
  const card=db.prepare("INSERT INTO voucher_inventory(product_id,environment,code,priority) VALUES ('chatgpt-plus','sandbox',?,0)").run(code);
  db.prepare("INSERT INTO order_redemptions(order_id,voucher_id,submit_key) VALUES (?,?,'api-reclaim-key')").run(id,card.lastInsertRowid);
  db.prepare('INSERT INTO order_fulfillment_details(order_id,voucher_id,voucher_code) VALUES (?,?,?)').run(id,card.lastInsertRowid,code);
  insertAdminAccount(db,'reclaim-viewer',await hashAdminPassword('test-reclaim-password'),'admin',['orders.view','vouchers.codes','vouchers.delete']);
  const viewer=await request('/api/admin/login',{username:'reclaim-viewer',password:'test-reclaim-password'});
  const path=`/api/admin/orders/${id}/reclaim-voucher`,input={expectedVoucherCode:code};
  assert.equal((await request(path,input)).response.status,401);
  assert.equal((await request(path,input,viewer.cookie)).response.status,403);
  assert.equal((await request(path,input,admin.cookie,'https://evil.example')).response.status,403);
  assert.equal((await request(`/api/admin/orders/${otherId}/reclaim-voucher`,input,admin.cookie)).response.status,404);
  assert.equal((await request(path,{expectedVoucherCode:'stale'},admin.cookie)).response.status,409);
  assert.equal(queries,0);
  const access=await request('/api/admin/users/reclaim-viewer/access',{role:'admin',permissions:['orders.reclaim']},admin.cookie);
  assert.equal(access.response.status,200);
  const report=(await request('/api/admin/orders',undefined,viewer.cookie)).json.data as unknown as import('../src/types/admin.ts').AdminOrderList;
  assert.equal(report.canViewVoucherCodes,true);assert.equal(report.orders[0].canReclaimVoucher,true);
  assert.equal((await request(path,input,viewer.cookie)).response.status,200);
  assert.equal((await request(path,input,viewer.cookie)).response.status,200);assert.equal(queries,1);
  const updated=(await request('/api/admin/orders?status=cancelled',undefined,viewer.cookie)).json.data as unknown as import('../src/types/admin.ts').AdminOrderList;
  assert.equal(updated.orders[0].cancellation?.voucherReclaimed,true);assert.equal(updated.orders[0].voucherCode,code);
  assert.equal(updated.orders[0].canReclaimVoucher,false);assert.equal(updated.counts.cancelled,1);
  assert.equal(db.prepare('SELECT reclaimed_by FROM order_fulfillment_details WHERE order_id=?').get(id)!.reclaimed_by,'reclaim-viewer');
  assert.equal(db.prepare('SELECT count(*) n FROM payment_refunds').get()!.n,0);
});

test('only super administrators manage accounts and existing sessions enforce updated permissions', async t => {
  const { request, login } = await setup(t);
  const owner = await login();
  const path = '/api/admin/users';
  const input = { username: 'inventory', password: 'test-inventory-password', role: 'admin', permissions: ['vouchers.view'] };
  assert.equal((await request(path)).response.status, 401);
  assert.equal((await request(path, input, owner.cookie, 'https://evil.example')).response.status, 403);
  assert.equal((await request(path, input, owner.cookie)).response.status, 201);
  assert.equal((await request(path, input, owner.cookie)).response.status, 409);
  const list = await request(path, undefined, owner.cookie);
  assert.doesNotMatch(JSON.stringify(list.json), /password|scrypt/);
  const { cookie } = await request('/api/admin/login', { username: input.username, password: input.password });
  assert.ok(cookie);
  assert.equal((await request(path, undefined, cookie)).response.status, 403);
  assert.equal((await request(path, { ...input, username: 'unauthorized', role: 'super_admin' }, cookie)).response.status, 403);
  assert.equal((await request('/api/admin/analytics/products', undefined, cookie)).response.status, 403);
  assert.equal((await request('/api/admin/vouchers', undefined, cookie)).response.status, 200);
  const vouchers = { productId: 'chatgpt-plus', lines: 'TEST-RBAC-CODE', priority: false, skipDuplicates: true };
  assert.equal((await request('/api/admin/vouchers', vouchers, cookie)).response.status, 403);
  const update = { role: 'admin', permissions: ['vouchers.import'] };
  assert.equal((await request(`${path}/admin/access`, update, owner.cookie)).response.status, 409);
  assert.equal((await request(`${path}/inventory/access`, update, cookie)).response.status, 403);
  assert.equal((await request(`${path}/inventory/access`, update, owner.cookie)).response.status, 200);
  assert.equal((await request('/api/admin/vouchers', vouchers, cookie)).response.status, 201);
  assert.equal((await request(`${path}/inventory/access`, { role: 'admin', permissions: [] }, owner.cookie)).response.status, 200);
  assert.equal((await request('/api/admin/vouchers', undefined, cookie)).response.status, 403);
});

test('deleting an administrator revokes their sessions and rejects self-deletion or stale account references', async t => {
  const { request, login } = await setup(t);
  const owner = await login();
  const path = '/api/admin/users';
  const input = { username: 'temporary-admin', password: 'test-deletion-password', role: 'admin', permissions: ['analytics.view'] };
  const added = await request(path, input, owner.cookie);
  const account = added.json.data as unknown as AdminAccount;
  assert.equal(added.response.status, 201);
  const other = await request('/api/admin/login', { username: input.username, password: input.password });
  const remove = `${path}/${account.username}/delete`;
  assert.equal((await request(`${path}/admin/delete`, {}, owner.cookie)).response.status, 409);
  assert.equal((await request(remove, { createdAt: account.createdAt }, other.cookie)).response.status, 403);
  assert.equal((await request(remove, { createdAt: 'stale' }, owner.cookie)).response.status, 409);
  assert.equal((await request(remove, { createdAt: account.createdAt }, owner.cookie, 'https://evil.example')).response.status, 403);
  assert.equal((await request(remove, { createdAt: account.createdAt }, owner.cookie)).response.status, 200);
  assert.equal((await request('/api/admin/analytics/products', undefined, other.cookie)).response.status, 401);
  assert.equal((await request('/api/admin/login', { username: input.username, password: input.password })).response.status, 401);
  assert.equal((await request(remove, { createdAt: account.createdAt }, owner.cookie)).response.status, 404);
});

test('clicks use server environment, reject unknown products, deduplicate event retries and count new visits', async t => {
  const { request, login, db } = await setup(t);
  const event = { productId: 'chatgpt-plus', eventId: randomUUID(), environment: 'production' };
  const first = await request('/api/analytics/product-click', event);
  assert.equal(first.json.data.recorded, true);
  assert.equal((await request('/api/analytics/product-click', event)).json.data.recorded, false);
  assert.equal((await request('/api/analytics/product-click', { ...event, eventId: randomUUID() }, first.cookie)).json.data.recorded, true);
  assert.equal((await request('/api/analytics/product-click', { ...event, productId: 'chatgpt-pro-5x', eventId: randomUUID() }, first.cookie)).json.data.recorded, true);
  assert.equal((await request('/api/analytics/product-click', { ...event, eventId: randomUUID() })).json.data.recorded, true);
  assert.equal((await request('/api/analytics/product-click', { ...event, productId: 'unknown' })).response.status, 404);
  const admin = await login();
  assert.equal((await request('/api/analytics/product-click', { ...event, eventId: randomUUID() }, admin.cookie)).json.data.recorded, true);
  assert.equal(db.prepare('SELECT count(*) AS n FROM product_clicks').get()!.n, 5);
  assert.deepEqual(db.prepare('SELECT DISTINCT environment FROM product_clicks').all().map(row => row.environment), ['sandbox']);
  const stats = await request('/api/admin/analytics/products', undefined, admin.cookie);
  assert.equal(stats.json.data.total, 5); assert.equal(stats.json.data.clickedProducts, 2);
  const plus = stats.json.data.products.find(row => row.id === 'chatgpt-plus');
  assert.ok(plus); assert.equal(plus.clicks, 4);
  assert.equal((await request('/api/admin/analytics/products?environment=production', undefined, admin.cookie)).json.data.total, 5);
});

test('date boundaries use Beijing time, preserve deleted product history and separate environments', async t => {
  const { db, request, login } = await setup(t);
  const insert = db.prepare('INSERT INTO product_clicks(event_id,product_id,product_name,visitor_hash,environment,created_at) VALUES (?,?,?,?,?,?)');
  for (const [time, env] of [['2026-01-01T15:59:59.999Z', 'sandbox'], ['2026-01-01T16:00:00.000Z', 'sandbox'], ['2026-01-02T15:59:59.999Z', 'sandbox'], ['2026-01-02T16:00:00.000Z', 'sandbox'], ['2026-01-01T16:00:00.000Z', 'production']]) insert.run(randomUUID(), 'removed-product', '旧商品', 'visitor', env, time);
  const admin = await login();
  const path = '/api/admin/analytics/products?start=2026-01-02&end=2026-01-02';
  const stats = (await request(path, undefined, admin.cookie)).json.data;
  assert.equal(stats.environment, 'sandbox');
  assert.equal(stats.total, 2); assert.deepEqual(stats.trend, [{ date: '2026-01-02', clicks: 2 }]);
  assert.equal(stats.products[0].name, '旧商品'); assert.equal(stats.products[0].active, false);
  assert.equal((await request(path + '&environment=all', undefined, admin.cookie)).json.data.total, 2);
});

test('invalid filters fail explicitly, zero-count products remain visible and expired sessions fail closed', async t => {
  const { request, login, db } = await setup(t);
  const admin = await login();
  for (const query of ['start=2026-02-30', 'start=2026-01-03&end=2026-01-02', 'environment=invalid', 'environment=all&environment=sandbox', 'extra=1', 'start=2020-01-01']) assert.equal((await request('/api/admin/analytics/products?' + query, undefined, admin.cookie)).response.status, 400, query);
  const empty = (await request('/api/admin/analytics/products', undefined, admin.cookie)).json.data;
  assert.equal(empty.total, 0); assert.equal(empty.products.length, 5); assert.ok(empty.products.every((row: { clicks: number }) => row.clicks === 0));
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
    db.exec(`ALTER TABLE admin_accounts DROP COLUMN role;
      ALTER TABLE admin_accounts DROP COLUMN permissions;
      INSERT INTO admin_accounts VALUES ('legacy', 'existing-password-hash', '2026-01-01');
      PRAGMA user_version = 8;`);
    db.close(); db = openDatabase(filename);
    assert.equal(db.prepare('SELECT count(*) AS n FROM product_clicks').get()!.n, 1);
    assert.equal(db.prepare('SELECT name FROM products WHERE id = ?').get('chatgpt-plus')!.name, '商家自定义名称');
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 25);
    const legacy = db.prepare("SELECT role, permissions, password_hash FROM admin_accounts WHERE username = 'legacy'").get()!;
    assert.equal(legacy.role, 'admin');
    assert.equal(legacy.password_hash, 'existing-password-hash');
    assert.deepEqual(JSON.parse(String(legacy.permissions)), ['analytics.view', 'vouchers.view', 'vouchers.import', 'checkout.test']);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('HTTPS admin cookies are secure and repeated login failures are rate limited', async t => {
  const { request } = await setup(t, ':memory:', 'https://admin.example.com');
  const result = await request('/api/admin/login', { username: 'admin', password: 'test-password-very-long' }, '', 'https://admin.example.com');
  assert.match(result.response.headers.get('set-cookie')!, /^__Host-wusan_admin=.*; Secure$/);
  for (let i = 0; i < 11; i++) await request('/api/admin/login', { username: 'admin', password: 'bad' }, '', 'https://admin.example.com');
  assert.equal((await request('/api/admin/login', { username: 'admin', password: 'bad' }, '', 'https://admin.example.com')).response.status, 429);
});

test('finished-account usage instructions require import permission, validate input and persist per product/environment',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'wusan-instructions-')),filename=join(directory,'store.sqlite');
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const {db,request,login}=await setup(t,filename);
  const path='/api/admin/vouchers/chatgpt-plus-account/instructions';
  const input={usageInstructions:'  第一步：复制卡密\r\n第二步：按指引使用 <b>普通文本</b>  '};
  assert.equal((await request(path,input)).response.status,401);
  const owner=await login();
  insertAdminAccount(db,'instruction-viewer',await hashAdminPassword('instruction-viewer-password'),'admin',['vouchers.view']);
  const viewer=await request('/api/admin/login',{username:'instruction-viewer',password:'instruction-viewer-password'});
  assert.equal((await request(path,input,viewer.cookie)).response.status,403);
  assert.equal((await request(path,input,owner.cookie,'https://evil.example')).response.status,403);
  for(const value of [null,123,'x'.repeat(4001),'invalid\u0000text'])assert.equal((await request(path,{usageInstructions:value},owner.cookie)).response.status,400);
  assert.equal((await request('/api/admin/vouchers/chatgpt-plus/instructions',input,owner.cookie)).response.status,409);
  assert.equal((await request('/api/admin/vouchers/missing/instructions',input,owner.cookie)).response.status,404);
  const normalized='第一步：复制卡密\n第二步：按指引使用 <b>普通文本</b>';
  assert.deepEqual((await request(path,input,owner.cookie)).json.data,{usageInstructions:normalized});
  const {voucherInventory}=await import('./vouchers.ts');
  const sandbox=voucherInventory(db,'sandbox'),production=voucherInventory(db,'production');
  assert.equal(sandbox.list().products.find(p=>p.id==='chatgpt-plus-account')!.usageInstructions,normalized);
  assert.equal(production.list().products.find(p=>p.id==='chatgpt-plus-account')!.usageInstructions,'');
  production.saveInstructions('chatgpt-plus-account',{usageInstructions:'正式环境说明'});
  const reopened=openDatabase(filename);
  try{assert.equal(voucherInventory(reopened,'sandbox').list().products.find(p=>p.id==='chatgpt-plus-account')!.usageInstructions,normalized);}finally{reopened.close();}
  assert.deepEqual((await request(path,{usageInstructions:'   '},owner.cookie)).json.data,{usageInstructions:''});
  assert.equal(production.list().products.find(p=>p.id==='chatgpt-plus-account')!.usageInstructions,'正式环境说明');
  assert.equal(db.prepare('SELECT count(*) n FROM voucher_inventory').get()!.n,0);
});

test('voucher imports are protected, atomic, and counted by product and environment', async t => {
  const { db, request, login } = await setup(t);
  const path = '/api/admin/vouchers';
  const input = { productId: 'chatgpt-plus', lines: '  TEST-ONE  \r\n\r\nTEST-TWO', priority: true, skipDuplicates: false };
  assert.equal((await request(path)).response.status, 401);
  assert.equal((await request(path, input)).response.status, 401);
  const { cookie } = await login();
  assert.equal((await request(path, input, cookie, 'https://evil.example')).response.status, 403);
  assert.equal((await request(path, input, cookie)).response.status, 201);

  const retry = { ...input, productId: 'chatgpt-pro-5x', lines: 'TEST-THREE\nTEST-ONE' };
  assert.equal((await request(path, retry, cookie)).response.status, 409);
  assert.equal(db.prepare("SELECT count(*) AS total FROM voucher_inventory WHERE product_id = 'chatgpt-pro-5x'").get()!.total, 0);
  const imported = await request(path, { ...retry, priority: false, skipDuplicates: true }, cookie);
  assert.deepEqual(imported.json.data, { added: 1, skipped: 1 });

  db.prepare('INSERT INTO voucher_inventory (product_id, environment, code, priority) VALUES (?, ?, ?, ?)').run('chatgpt-plus', 'production', 'TEST-ONE', 0);
  const report = await request(path, undefined, cookie);
  assert.deepEqual(report.json.data.products.slice(0, 2), [
    { id: 'chatgpt-plus', name: 'ChatGPT Plus', total: 2, priority: 2 },
    { id: 'chatgpt-pro-5x', name: 'ChatGPT Pro 5x', total: 1, priority: 0 },
  ]);
  assert.doesNotMatch(JSON.stringify(report.json), /TEST-ONE|TEST-TWO|TEST-THREE/);
});

test('card listing and removal require separate permissions and cannot touch allocated or other-environment cards', async t => {
  const { db, request, login } = await setup(t);
  const { cookie } = await login();
  const path = '/api/admin/vouchers/chatgpt-plus/cards';
  const insert = db.prepare('INSERT INTO voucher_inventory (product_id, environment, code, priority) VALUES (?, ?, ?, ?)');
  const available = insert.run('chatgpt-plus', 'sandbox', 'AVAILABLE', 1).lastInsertRowid;
  const allocated = insert.run('chatgpt-plus', 'sandbox', 'ALLOCATED', 0).lastInsertRowid;
  const production = insert.run('chatgpt-plus', 'production', 'PRODUCTION', 0).lastInsertRowid;
  insert.run('chatgpt-pro-5x', 'sandbox', 'OTHER-PRODUCT', 0);
  db.exec(`INSERT INTO orders (id, owner_hash, email, snapshot, status, created_at, expires_at, idempotency_key, fingerprint, environment)
    VALUES ('reserved-order', '', '', '{}', 'paid', '', '', '', '', 'sandbox');`);
  db.prepare('INSERT INTO order_redemptions(order_id, voucher_id, submit_key) VALUES (?, ?, ?)').run('reserved-order', allocated, 'reserve');

  assert.equal((await request(path)).response.status, 401);
  const credentials = { username: 'card-viewer', password: 'test-card-viewer-password' };
  const create = { ...credentials, role: 'admin', permissions: ['vouchers.view'] };
  assert.equal((await request('/api/admin/users', create, cookie)).response.status, 201);
  const viewer = await request('/api/admin/login', credentials);
  assert.equal((await request(path, undefined, viewer.cookie)).response.status, 403);
  const access = '/api/admin/users/card-viewer/access';
  await request(access, { role: 'admin', permissions: ['vouchers.codes'] }, cookie);
  const page = await request(path, undefined, viewer.cookie);
  assert.equal(page.response.status, 200);
  const { cards } = page.json.data as unknown as VoucherPage;
  assert.deepEqual(cards.map(card => card.code), ['AVAILABLE']);
  const card = cards[0];
  const remove = (id: number | bigint, createdAt: string, actor = cookie, origin?: string) => request(`${path}/${id}/remove`, { createdAt }, actor, origin);
  assert.equal((await remove(available, card.createdAt, viewer.cookie)).response.status, 403);
  assert.equal((await remove(available, card.createdAt, cookie, 'https://evil.example')).response.status, 403);
  assert.equal((await remove(available, 'stale')).response.status, 409);
  const createdAt = (id: number | bigint) => String(db.prepare('SELECT created_at FROM voucher_inventory WHERE id = ?').get(id)?.created_at);
  assert.equal((await remove(allocated, createdAt(allocated))).response.status, 409);
  assert.equal((await remove(production, createdAt(production))).response.status, 409);
  await request(access, { role: 'admin', permissions: ['vouchers.delete'] }, cookie);
  assert.equal((await remove(available, card.createdAt, viewer.cookie)).response.status, 200);
  assert.equal((await remove(available, card.createdAt, viewer.cookie)).response.status, 409);
  assert.equal(db.prepare('SELECT count(*) AS total FROM voucher_inventory').get()!.total, 3);

  for (let index = 0; index < 51; index++) insert.run('chatgpt-plus', 'sandbox', `PAGE-${index}`, 0);
  const firstPage = (await request(path, undefined, viewer.cookie)).json.data as unknown as VoucherPage;
  assert.equal(firstPage.cards.length, 50);
  assert.equal(firstPage.next, firstPage.cards.at(-1)?.id);
  const lastPage = (await request(`${path}?after=${firstPage.next}`, undefined, viewer.cookie)).json.data as unknown as VoucherPage;
  assert.deepEqual(lastPage.cards.map(row => row.code), ['PAGE-50']);
  assert.equal(lastPage.next, null);
});

test('revenue report isolates environments, uses payment and refund confirmation dates, and requires its own permission', async t => {
  const { db, request, login } = await setup(t);
  const admin = await login();
  const date = chinaDay();
  const paidAt = new Date(`${date}T10:00:00+08:00`).toISOString();
  const snapshot = JSON.stringify({ productId: 'chatgpt-plus', productName: 'ChatGPT Plus', priceCents: 13000 });
  const addOrder = db.prepare(`INSERT INTO orders (id,owner_hash,email,snapshot,status,created_at,expires_at,paid_at,trade_no,idempotency_key,fingerprint,environment)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  addOrder.run('paid-test', 'owner', '', snapshot, 'paid', paidAt, paidAt, paidAt, 'trade-test', 'key-test', 'fingerprint', 'sandbox');
  addOrder.run('paid-production', 'owner', '', snapshot, 'paid', paidAt, paidAt, paidAt, 'trade-production', 'key-production', 'fingerprint', 'production');
  addOrder.run('pending-test', 'owner', '', snapshot, 'pending', paidAt, paidAt, null, null, 'key-pending', 'fingerprint', 'sandbox');
  const addRefund = db.prepare(`INSERT INTO payment_refunds (request_no,order_id,amount_cents,reason,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`);
  addRefund.run('refund-one', 'paid-test', 2000, 'test', 'success', paidAt, paidAt);
  addRefund.run('refund-two', 'paid-test', 1000, 'test', 'success', paidAt, paidAt);
  addRefund.run('refund-pending', 'paid-test', 500, 'test', 'pending', paidAt, paidAt);
  addRefund.run('refund-other', 'paid-production', 12000, 'test', 'success', paidAt, paidAt);
  // A later reconciliation updates updated_at, but must not move the original refund date.
  db.prepare("UPDATE payment_refunds SET updated_at = '2000-01-01T00:00:00.000Z' WHERE request_no = 'refund-one'").run();
  const path = `/api/admin/revenue?start=${date}&end=${date}`;
  assert.equal((await request(path)).response.status, 401);
  const result = await request(path, undefined, admin.cookie);
  assert.equal(result.response.status, 200);
  const report = result.json.data as unknown as {
    grossCents: number; refundCents: number; netCents: number; paidOrders: number;
    refundCount: number; pendingRefunds: { count: number; cents: number };
    created: { total: number; paid: number; pending: number };
    products: { grossCents: number; orders: number }[];
    recent: { id: string; refundedCents: number }[];
    trend: { grossCents: number; refundCents: number; netCents: number }[];
  };
  assert.equal(report.grossCents, 13000);
  assert.equal(report.refundCents, 3000);
  assert.equal(report.netCents, 10000);
  assert.equal(report.paidOrders, 1);
  assert.equal(report.refundCount, 2);
  assert.deepEqual(report.pendingRefunds, { count: 1, cents: 500 });
  assert.equal(report.created.total, 2);
  assert.equal(report.created.paid, 1);
  assert.equal(report.created.pending, 1);
  assert.equal(report.products[0].grossCents, 13000);
  assert.equal(report.products[0].orders, 1);
  assert.equal(report.recent[0].id, 'paid-test');
  assert.equal(report.recent[0].refundedCents, 3000);
  assert.equal(report.trend[0].netCents, 10000);
  assert.equal(db.prepare("SELECT confirmed_at FROM payment_refunds WHERE request_no = 'refund-one'").get()!.confirmed_at, paidAt);
  assert.equal((await request(path + '&environment=production', undefined, admin.cookie)).response.status, 400);
  assert.equal((await request('/api/admin/revenue?start=2026-02-30', undefined, admin.cookie)).response.status, 400);

  insertAdminAccount(db, 'revenue-viewer', await hashAdminPassword('test-revenue-password'), 'admin', []);
  const viewer = await request('/api/admin/login', { username: 'revenue-viewer', password: 'test-revenue-password' });
  assert.equal((await request(path, undefined, viewer.cookie)).response.status, 403);
  db.prepare("UPDATE admin_accounts SET permissions = '[\"revenue.view\"]' WHERE username = 'revenue-viewer'").run();
  assert.equal((await request(path, undefined, viewer.cookie)).response.status, 200);
});

test('admin orders enforce permissions, isolate environments, combine filters and paginate safely', async t => {
  const { request, login, db } = await setup(t);
  const { cookie } = await login();
  const insert = db.prepare(`INSERT INTO orders(id,owner_hash,email,snapshot,status,created_at,expires_at,paid_at,idempotency_key,fingerprint,environment,contact,query_password_hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const add = (id: string, status = 'pending', productId = 'chatgpt-plus', at = '2026-01-01T16:00:00.000Z', environment = 'sandbox', category?: string) =>
    insert.run(id, 'secret-owner', 'private@example.com', JSON.stringify({ productId, productName: 'Purchased name', priceCents: 13000, ...(category ? { category } : {}) }), status, at, at, status === 'paid' ? at : null, id, 'secret-fingerprint', environment, 'secret-contact', 'secret-password');
  add('WS-paid', 'paid'); add('WS-closed', 'closed', 'chatgpt-pro-5x');
  add('WS-snapshot', 'pending', 'chatgpt-plus', undefined, undefined, 'Pro');
  add('WS-before', 'pending', undefined, '2026-01-01T15:59:59.999Z');
  add('WS-after', 'pending', undefined, '2026-01-02T16:00:00.000Z');
  add('WS-production', 'paid', undefined, undefined, 'production');
  add('WS-missing', 'pending', 'removed-product');
  for (let i = 0; i < 25; i++) add(`PAGE-${String(i).padStart(2, '0')}`);
  const path = '/api/admin/orders';
  assert.equal((await request(path)).response.status, 401);
  insertAdminAccount(db, 'order-viewer', await hashAdminPassword('test-orders-password'), 'admin', ['revenue.view']);
  const viewer = await request('/api/admin/login', { username: 'order-viewer', password: 'test-orders-password' });
  assert.equal((await request(path, undefined, viewer.cookie)).response.status, 403);
  db.prepare("UPDATE admin_accounts SET permissions = '[\"orders.view\"]' WHERE username = 'order-viewer'").run();
  assert.equal((await request(path, undefined, viewer.cookie)).response.status, 200);
  const read = async (query = '') => {
    const result = await request(path + query, undefined, cookie);
    assert.equal(result.response.status, 200);
    const json = JSON.stringify(result.json);
    for (const secret of ['secret-owner', 'private@example.com', 'secret-fingerprint', 'secret-contact', 'secret-password']) assert.equal(json.includes(secret), false);
    return result.json.data as unknown as import('../src/types/admin.ts').AdminOrderList;
  };
  const all = await read(); assert.equal(all.total, 31); assert.equal(all.orders.length, 20);
  assert.equal(all.environment, 'sandbox'); assert.equal(all.orders.some(o => o.id === 'WS-production'), false);
  const combined = await read('?orderNo=WS-&status=paid&category=Plus&productId=chatgpt-plus&start=2026-01-02&end=2026-01-02');
  assert.deepEqual(combined.orders.map(o => o.id), ['WS-paid']);
  assert.equal(combined.counts.paid, 1);
  const pro = await read('?category=Pro'); assert.deepEqual(pro.orders.map(o => o.id), ['WS-snapshot', 'WS-closed']);
  assert.deepEqual((await read('?category=unknown')).orders.map(o => o.id), ['WS-missing']);
  assert.equal((await read('?orderNo=WS-&start=2026-01-02&end=2026-01-02')).total, 4);
  assert.equal((await read('?orderNo=%25')).total, 0);
  const first = await read('?orderNo=PAGE-'); const second = await read('?orderNo=PAGE-&page=2');
  assert.equal(first.orders.length, 20); assert.equal(second.orders.length, 5);
  assert.equal(new Set([...first.orders, ...second.orders].map(o => o.id)).size, 25);
  assert.equal((await read('?orderNo=PAGE-&page=999')).page, 2);
  db.prepare("UPDATE orders SET status = 'paid' WHERE id = 'PAGE-00'").run();
  assert.equal((await read('?orderNo=PAGE-00')).orders[0].status, 'paid');
  for (const query of ['?status=bad', '?category=bad', '?start=2026-02-30', '?start=2026-01-03&end=2026-01-02', '?page=0', '?page=1.5', '?status=paid&status=closed', '?environment=production', '?end=9999-01-01']) {
    assert.equal((await request(path + query, undefined, cookie)).response.status, 400, query);
  }
});

test('order fulfillment details keep recharge email and protect voucher codes with the existing code permission',async t=>{
  const {db,request,login}=await setup(t);
  const {cookie}=await login();
  const now=new Date().toISOString();
  const code='PRIVATE-ORDER-VOUCHER-123';
  const email='recharge-only@example.invalid';
  const id='WS-FULFILLMENT-DETAILS';
  db.prepare(`INSERT INTO orders(id,owner_hash,email,snapshot,status,created_at,expires_at,paid_at,idempotency_key,fingerprint,environment)
    VALUES (?,'owner','contact-not-recharge@example.invalid',?,'paid',?,?,?,'details-key','fingerprint','sandbox')`).run(id,JSON.stringify({productId:'chatgpt-plus',productName:'ChatGPT Plus',priceCents:13000}),now,now,now);
  const voucher=db.prepare("INSERT INTO voucher_inventory(product_id,environment,code,priority) VALUES ('chatgpt-plus','sandbox',?,0)").run(code);
  db.prepare('INSERT INTO order_fulfillment_details(order_id,voucher_id,voucher_code,recharge_email) VALUES (?,?,?,?)').run(id,voucher.lastInsertRowid,code,email);
  const path='/api/admin/orders';
  const report=(await request(path,undefined,cookie)).json.data as unknown as import('../src/types/admin.ts').AdminOrderList;
  assert.equal(report.orders[0].voucherCode,code);assert.equal(report.orders[0].rechargeEmail,email);assert.equal(report.canViewVoucherCodes,true);
  insertAdminAccount(db,'order-details-viewer',await hashAdminPassword('test-details-password'),'admin',['orders.view']);
  const viewer=await request('/api/admin/login',{username:'order-details-viewer',password:'test-details-password'});
  const limited=(await request(path,undefined,viewer.cookie)).json.data as unknown as import('../src/types/admin.ts').AdminOrderList;
  assert.equal(limited.canViewVoucherCodes,false);assert.equal(limited.orders[0].voucherCode,null);assert.equal(limited.orders[0].rechargeEmail,email);
  assert.equal(JSON.stringify(limited).includes(code),false);
  assert.equal(JSON.stringify(report).includes('contact-not-recharge'),false);
  db.prepare(`INSERT INTO order_redemptions(order_id,voucher_id,submit_key,submitted,prepared,claim_token)
    VALUES (?,?,?,1,?,?)`).run(id,voucher.lastInsertRowid,'private-submit-key',JSON.stringify({token:'private-prepared-token'}),'private-claim-token');
  for (const result of [
    {state:'QUEUED',settlement:'UNKNOWN',renewal:''},
    {state:'FULFILLED',settlement:'UNKNOWN',renewal:''},
    {state:'FULFILLED',settlement:'PAID',renewal:''},
    {state:'NO_CHARGE',settlement:'NO_CHARGE',renewal:''},
    {state:'NO_CHARGE',settlement:'NO_CHARGE',renewal:'',reason:'已有有效订阅，暂不能重复充值。'},
    {state:'',settlement:'UNKNOWN',renewal:'ready'},
    {state:'',settlement:'PAID',renewal:'paid'},
    {state:'FUTURE_STATE',settlement:'UNKNOWN',renewal:''},
  ]) {
    db.prepare('UPDATE order_redemptions SET result=? WHERE order_id=?').run(JSON.stringify(result),id);
    const updated=(await request(path,undefined,viewer.cookie)).json.data as unknown as import('../src/types/admin.ts').AdminOrderList;
    assert.deepEqual(updated.orders[0].recharge,{submitted:true,...result});
    for(const secret of [code,'private-submit-key','private-prepared-token','private-claim-token']) assert.equal(JSON.stringify(updated).includes(secret),false);
    assert.equal(updated.orders[0].voucherCode,null);
  }
  db.prepare("UPDATE admin_accounts SET permissions='[\"orders.view\",\"vouchers.codes\"]' WHERE username='order-details-viewer'").run();
  const granted=(await request(path,undefined,viewer.cookie)).json.data as unknown as import('../src/types/admin.ts').AdminOrderList;
  assert.equal(granted.orders[0].voucherCode,code);
  assert.equal((await request('/api/orders')).json.data instanceof Array,true);
});

test('payment category filters combine with status and classify exemptions by the stored flag rather than amount',async t=>{
  const {db,request,login}=await setup(t);const {cookie}=await login();const now=new Date().toISOString();
  const insert=db.prepare(`INSERT INTO orders(id,owner_hash,email,snapshot,status,created_at,expires_at,idempotency_key,fingerprint,environment)
    VALUES (?,'category-owner','',?,?,?,?,?,'fixture',?)`);
  const add=(id:string,status:string,priceCents:number,exempt=false,environment='sandbox')=>insert.run(id,JSON.stringify({productId:'chatgpt-plus',productName:'ChatGPT Plus',priceCents,...(exempt?{staffCheckout:true}:{})}),status,now,now,id,environment);
  add('CATEGORY-LEGACY','pending',13000);add('CATEGORY-FREE','paid',0,true);add('CATEGORY-ZERO','closed',0);add('CATEGORY-CANCELLED','paid',13000);add('CATEGORY-OTHER-ENV','paid',0,true,'production');
  db.prepare("INSERT INTO order_cancellations(order_id,state,refund_key,created_at,updated_at) VALUES ('CATEGORY-CANCELLED','cancelled','category-refund',?,?)").run(now,now);
  const read=async(query:string)=>{
    const result=await request('/api/admin/orders?'+query,undefined,cookie);assert.equal(result.response.status,200);
    return result.json.data as unknown as import('../src/types/admin.ts').AdminOrderList;
  };
  const free=await read('paymentType=free');assert.equal(free.total,1);assert.equal(free.orders[0].id,'CATEGORY-FREE');assert.equal(free.orders[0].paymentType,'free');
  const paid=await read('paymentType=paid');assert.equal(paid.total,3);assert.ok(paid.orders.every(order=>order.paymentType==='paid'&&!order.staffCheckout));
  assert.ok(paid.orders.some(order=>order.id==='CATEGORY-ZERO'));
  const combined=await read('paymentType=paid&status=cancelled&category=Plus&orderNo=CATEGORY-&productId=chatgpt-plus');
  assert.deepEqual(combined.orders.map(order=>order.id),['CATEGORY-CANCELLED']);assert.equal(combined.counts.cancelled,1);
  assert.equal((await read('paymentType=')).total,4);
  for(const query of ['paymentType=invalid','paymentType=free&paymentType=paid']) assert.equal((await request('/api/admin/orders?'+query,undefined,cookie)).response.status,400);
});
