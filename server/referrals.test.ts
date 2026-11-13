import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './database.ts';
import { createApiServer } from './app.ts';
import { createAlipayGateway } from './alipay.ts';
import { insertAdminAccount, hashAdminPassword } from './admin.ts';
import type { PaymentGateway, TradeResult } from './alipay.ts';
import { orderRepository } from './orders.ts';

const origin = 'http://localhost:5180';
const gateway: PaymentGateway = {
  ...createAlipayGateway({}),
  origin, appId: 'test-app', sellerId: 'test-seller',
  status: {enabled:true, environment:'sandbox', message:''},
  paymentForm: () => '', verifyNotification: values => values.sign === 'valid',
  query: async () => null, close: async order => ({out_trade_no: order.id}),
};
const input = {productId:'chatgpt-plus', expectedPriceCents:13000, contact:'buyer@example.com', queryPassword:'12345678'};

test('customer login, referral ownership, payment idempotence, environment separation and permissions', async t => {
  const db = openDatabase(':memory:');
  const server = createApiServer(db, gateway);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {await new Promise<void>(resolve => {server.close(() => resolve());server.closeIdleConnections();});db.close();});
  function client() {
    const cookies = new Map<string,string>();
    return async (path: string, body?: unknown, key = randomUUID(), customOrigin = origin) => {
      const response = await fetch(base + '/api' + path, {method: body === undefined ? 'GET':'POST',
        headers:{Origin:customOrigin, 'Content-Type':'application/json',Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '), 'Idempotency-Key':key}, body:body === undefined ? undefined : JSON.stringify(body)});
      for (const cookie of response.headers.getSetCookie()) {const [k,v] = cookie.split(';')[0].split('=');cookies.set(k,v);}
      return {status:response.status, json:await response.json() as {data: {id: string; inviteCode: string; accepted: boolean; invitation: { code: string; expiresAt: number | null } | null; total: number; earnedCents: number; rows: {status: string; orderId: string}[]}}, cookies:response.headers.getSetCookie()};
    };
  }
  const inviter = client(); const friend = client(); const outsider = client();
  assert.equal((await outsider('/referrals')).status,401);
  assert.equal((await inviter('/customer/register',{username:'inviter',password:'password123'},undefined,'https://evil.test')).status,403);
  const registration = await inviter('/customer/register',{username:'inviter',password:'password123'});
  assert.equal(registration.status,200);
  assert.equal(registration.cookies.length,2); // Both anonymous-order and customer session cookies survive.
  assert.ok(registration.cookies.every((s:string)=>s.includes('HttpOnly') && s.includes('SameSite=Lax')));
  const account = registration.json.data;
  assert.match(account.inviteCode,/^[0-9a-f]{16}$/);
  assert.equal((await inviter('/customer/session')).json.data.id,account.id);
  assert.equal((await outsider('/customer/login',{username:'inviter',password:'wrongpassword'})).status,401);
  assert.equal((await outsider('/admin/referrals')).status,401);
  assert.equal((await friend('/referrals/visit',{code:'bad'})).json.data.accepted,false);
  assert.equal((await friend('/referrals/invitation')).json.data, null);
  const firstVisit = await friend('/referrals/visit',{code:account.inviteCode});
  const savedInvitation = firstVisit.json.data.invitation;
  assert.equal(savedInvitation?.code, account.inviteCode);
  assert.deepEqual((await friend('/referrals/invitation')).json.data, savedInvitation);
  assert.equal((await client()('/referrals/invitation')).json.data, null);
  const second = await outsider('/customer/register',{username:'second',password:'password123'});
  const otherVisit = await friend('/referrals/visit',{code:second.json.data.inviteCode}); // first touch wins
  assert.deepEqual(otherVisit.json.data.invitation, savedInvitation);
  assert.deepEqual((await friend('/referrals/visit',{code:'invalid'})).json.data.invitation, savedInvitation);
  assert.deepEqual((await friend('/referrals/invitation')).json.data, savedInvitation);
  const key = randomUUID();
  const created = await friend('/orders',input,key); assert.equal(created.status,201);
  const id = created.json.data.id;
  await friend('/orders',input,key);
  assert.equal(db.prepare('SELECT count(*) n FROM referral_orders').get()!.n,1);
  assert.equal(db.prepare('SELECT inviter_id FROM referral_orders').get()!.inviter_id,account.id);
  const trade: TradeResult = {out_trade_no:id, app_id:gateway.appId, seller_id:gateway.sellerId, total_amount:'130.00',trade_no:'202611081234567890123456',trade_status:'TRADE_SUCCESS',notify_id:'test-notify',sign:'valid'};
  const orders = orderRepository(db,gateway);
  assert.throws(()=>orders.notify({...trade,sign:'bad'}));
  assert.equal(db.prepare('SELECT status FROM referral_orders').get()!.status,'pending');
  orders.notify(trade); orders.notify(trade);
  const report = (await inviter('/referrals')).json.data;
  assert.equal(report.total,1); assert.equal(report.earnedCents,500); assert.equal(report.rows[0].status,'earned');
  assert.notEqual(report.rows[0].orderId,id); assert.ok(!JSON.stringify(report).includes(input.contact));
  assert.equal((await inviter('/referrals?environment=production')).json.data.total,1);
  assert.equal((await outsider('/referrals')).json.data.total,0);
  await inviter('/referrals/visit',{code:account.inviteCode});
  await inviter('/orders',input);
  assert.equal(db.prepare('SELECT count(*) n FROM referral_orders').get()!.n,1);
  const selfOtherBrowser = client();
  await selfOtherBrowser('/referrals/visit',{code:account.inviteCode});
  await selfOtherBrowser('/customer/login',{username:'inviter',password:'password123'});
  assert.equal((await selfOtherBrowser('/referrals/invitation')).json.data, null);
  await selfOtherBrowser('/orders',input);
  assert.equal(db.prepare('SELECT count(*) n FROM referral_orders').get()!.n,1);
  const closed = await friend('/orders',input);
  await friend(`/orders/${closed.json.data.id}/close`,{});
  assert.equal(db.prepare('SELECT status FROM referral_orders WHERE order_id=?').get(closed.json.data.id)!.status,'cancelled');
  db.prepare("INSERT INTO payment_refunds (request_no,order_id,amount_cents,reason,status,created_at,updated_at) VALUES ('refund-test', ?, 13000, 'test', 'pending', ?, ?)").run(id, new Date().toISOString(), new Date().toISOString());
  db.prepare("UPDATE payment_refunds SET status='success' WHERE request_no='refund-test'").run();
  orders.notify(trade);
  assert.equal((await inviter('/referrals')).json.data.earnedCents,0);
  // Even if both environments exist in one fixture, neither report may combine them.
  const productionOrders = orderRepository(db, { ...gateway, status: { ...gateway.status, environment: 'production' } });
  const productionOrder = await productionOrders.create('production-buyer', input, randomUUID(), { inviterId: account.id, buyerId: null });
  productionOrders.notify({ ...trade, out_trade_no: productionOrder.id, trade_no: '202611081234567890123457' });
  const sandboxReport = (await inviter('/referrals?environment=all')).json.data;
  assert.equal(sandboxReport.total, 4);
  assert.equal(sandboxReport.earnedCents, 0);
  insertAdminAccount(db, 'viewer', await hashAdminPassword('admin-password123'), 'admin', []);
  const staff = client();
  assert.equal((await staff('/admin/login',{username:'viewer',password:'admin-password123'})).status,200);
  assert.equal((await staff('/admin/referrals')).status,403);
  db.prepare("UPDATE admin_accounts SET permissions='[\"referrals.view\"]' WHERE username='viewer'").run();
  assert.equal((await staff('/admin/referrals?environment=all')).json.data.total,4);
  await inviter('/customer/logout',{});
  assert.equal((await inviter('/referrals')).status,401);
  assert.equal((await inviter('/customer/session')).json.data,null);
  db.prepare('UPDATE referral_visits SET expires_at = ?').run(Date.now() - 1);
  assert.deepEqual((await friend('/referrals/invitation')).json.data,savedInvitation);
  const unchanged = await friend('/referrals/visit', { code: second.json.data.inviteCode });
  assert.equal(unchanged.json.data.invitation?.code,account.inviteCode);
  assert.equal(unchanged.json.data.invitation!.expiresAt,null);
});

function deviceFixture(t:import('node:test').TestContext,filename=':memory:'){
  const db=openDatabase(filename);t.after(()=>{if(db.isOpen)db.close();});
  const add=db.prepare('INSERT INTO customers(id,username,password_hash,invite_code,created_at) VALUES (?,?,?,?,?)');
  for(const [id,name,code] of [['a','inviter','a'.repeat(16)],['b','buyer','b'.repeat(16)],['c','friend','c'.repeat(16)]])add.run(id,name,'test-password-hash',code,new Date().toISOString());
  const link=(browser:string,customer:string)=>db.prepare('INSERT OR IGNORE INTO customer_browsers VALUES (?,?)').run(browser,customer);
  const orders=orderRepository(db,gateway);
  const tradeNumbers=new Map<string,string>();
  const pay=(order:import('../src/types/orders.ts').Order)=>{
    if(!tradeNumbers.has(order.id))tradeNumbers.set(order.id,'20261113'+String(tradeNumbers.size+1).padStart(18,'0'));
    return orders.notify({out_trade_no:order.id,app_id:gateway.appId,seller_id:gateway.sellerId,total_amount:(order.priceCents/100).toFixed(2),trade_no:tradeNumbers.get(order.id)!,trade_status:'TRADE_SUCCESS',notify_id:'N-'+order.id,sign:'valid'});
  };
  return {db,link,orders,pay};
}

test('a shared device and account history block logged-out self-referrals and changing buyer accounts',async t=>{
  const f=deviceFixture(t);const {referralRepository}=await import('./referrals.ts');
  const referrals=referralRepository(f.db,origin,'sandbox');
  f.link('shared-computer','a');f.link('shared-computer','b');f.link('buyer-other-browser','b');
  assert.equal(referrals.visit('shared-computer','a'.repeat(16)).accepted,false);
  assert.equal(referrals.visit('buyer-other-browser','a'.repeat(16),'b').accepted,false);
  // Even a renewed browser cookie cannot hide a logged-in buyer's prior shared-device history.
  assert.equal(referrals.visit('renewed-cookie','a'.repeat(16),'b').accepted,false);
  assert.equal(referrals.attribution('buyer-other-browser','b'),undefined);
  await f.orders.create('buyer-other-browser',input,randomUUID(),{inviterId:'a',buyerId:'b'});
  assert.equal(f.db.prepare('SELECT count(*) n FROM referral_orders').get()!.n,0);
  assert.equal(referrals.visit('independent-friend','a'.repeat(16),'c').accepted,true);
  const order=await f.orders.create('independent-friend',input,randomUUID(),referrals.attribution('independent-friend','c'));
  f.pay(order);assert.equal(f.db.prepare('SELECT status FROM referral_orders').get()!.status,'earned');
});

test('device checks repeat after password hashing and at settlement; login after payment cannot keep a new self-referral bonus',async t=>{
  for(const stage of ['creating','pending','earned'] as const){
    const f=deviceFixture(t);
    const creating=f.orders.create('buying-browser',input,randomUUID(),{inviterId:'a',buyerId:'b'});
    if(stage==='creating')f.link('buying-browser','a');
    const order=await creating;
    if(stage==='creating'){assert.equal(f.db.prepare('SELECT count(*) n FROM referral_orders').get()!.n,0);continue;}
    if(stage==='earned')f.pay(order);
    f.link('buying-browser','a');
    f.pay(order);f.pay(order);
    const record=f.db.prepare('SELECT status,blocked_reason,earned_at FROM referral_orders WHERE order_id=?').get(order.id)!;
    assert.equal(record.status,'cancelled');assert.equal(record.blocked_reason,'same_device');assert.equal(record.earned_at,null);
    assert.equal(f.db.prepare('SELECT status FROM orders WHERE id=?').get(order.id)!.status,'paid');
    const {referralRepository}=await import('./referrals.ts');
    const report=referralRepository(f.db,origin,'sandbox').report(new URLSearchParams(),'a');
    assert.equal(report.earnedCents,0);assert.equal(report.rows[0].amountCents,0);assert.equal(report.rows[0].ineligibleReason,'同设备邀请，不计返利');
  }
});

test('previously settled historical bonuses are preserved while new qualifying referrals still earn normally',async t=>{
  const f=deviceFixture(t);
  const historical=await f.orders.create('historical-browser',input,randomUUID(),{inviterId:'a',buyerId:'b'});
  f.pay(historical);f.db.prepare('UPDATE referral_orders SET device_check_enabled=0 WHERE order_id=?').run(historical.id);
  f.link('historical-browser','a');f.pay(historical);
  assert.equal(f.db.prepare('SELECT status FROM referral_orders WHERE order_id=?').get(historical.id)!.status,'earned');
  const order=await f.orders.create('independent-browser',input,randomUUID(),{inviterId:'a',buyerId:'c'});
  f.pay(order);assert.equal(f.db.prepare('SELECT status FROM referral_orders WHERE order_id=?').get(order.id)!.status,'earned');
});


test('Codex SMS orders never earn referrals, including stale attributed records and repeated payment notifications',async t=>{
  const f=deviceFixture(t);
  const excluded=await f.orders.create('independent-browser',{...input,productId:'codex-sms',expectedPriceCents:300},randomUUID(),{inviterId:'a',buyerId:'c'});
  assert.equal(f.db.prepare('SELECT reason_code FROM referral_order_exclusions WHERE order_id=?').get(excluded.id)!.reason_code,'product_excluded');
  const order=await f.orders.create('legacy-browser',{...input,productId:'codex-sms',expectedPriceCents:300},randomUUID());
  assert.equal(f.db.prepare('SELECT count(*) n FROM referral_orders').get()!.n,0);
  // Simulate an attributed order created by an older server before the eligibility rule.
  f.db.prepare('INSERT INTO referral_orders(order_id,inviter_id,buyer_id,created_at) VALUES (?,?,?,?)').run(order.id,'a','c',new Date().toISOString());
  f.pay(order);f.pay(order);
  const record=f.db.prepare('SELECT status,blocked_reason,earned_at FROM referral_orders WHERE order_id=?').get(order.id)!;
  assert.equal(record.status,'cancelled');assert.equal(record.blocked_reason,'product_excluded');assert.equal(record.earned_at,null);
  assert.equal(f.db.prepare('SELECT status FROM orders WHERE id=?').get(order.id)!.status,'paid');
  const {referralRepository}=await import('./referrals.ts');
  const report=referralRepository(f.db,origin,'sandbox').report(new URLSearchParams(),'a');
  assert.equal(report.earnedCents,0);assert.equal(report.rows[0].amountCents,0);assert.equal(report.rows[0].ineligibleReason,'该商品不参与返利');
});

test('Codex SMS eligibility migration cancels unsettled rewards while preserving already settled history',async t=>{
  const folder=mkdtempSync(join(tmpdir(),'wusan-referral-products-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const filename=join(folder,'store.sqlite');const f=deviceFixture(t,filename);
  const pending=await f.orders.create('pending-buyer',{...input,productId:'codex-sms',expectedPriceCents:300},randomUUID());
  const earned=await f.orders.create('earned-buyer',{...input,productId:'codex-sms',expectedPriceCents:300},randomUUID());
  f.pay(earned);
  f.db.prepare("INSERT INTO referral_orders(order_id,inviter_id,buyer_id,created_at,status,earned_at) VALUES (?,?,?,?,'earned',?)").run(earned.id,'a','c',new Date().toISOString(),new Date().toISOString());
  f.db.prepare('INSERT INTO referral_orders(order_id,inviter_id,buyer_id,created_at) VALUES (?,?,?,?)').run(pending.id,'a','c',new Date().toISOString());
  f.db.exec('DROP TRIGGER referral_payment; ALTER TABLE referral_orders DROP COLUMN product_check_enabled; PRAGMA user_version=29;');f.db.close();
  const db=openDatabase(filename);t.after(()=>db.close());
  assert.equal(db.prepare('PRAGMA user_version').get()!.user_version,31);
  assert.equal(db.prepare('SELECT status FROM referral_orders WHERE order_id=?').get(pending.id)!.status,'cancelled');
  assert.equal(db.prepare('SELECT status FROM referral_orders WHERE order_id=?').get(earned.id)!.status,'earned');
  const orders=orderRepository(db,gateway);
  for(const [index,order] of [pending,earned].entries()){
    const notification={out_trade_no:order.id,app_id:gateway.appId,seller_id:gateway.sellerId,total_amount:'3.00',trade_no:'20261113'+String(index===0?2:1).padStart(18,'0'),trade_status:'TRADE_SUCCESS',notify_id:'migration-'+order.id,sign:'valid'};
    orders.notify(notification);orders.notify({...notification,notify_id:notification.notify_id+'-repeat'});
  }
  assert.equal(db.prepare('SELECT status FROM referral_orders WHERE order_id=?').get(pending.id)!.status,'cancelled');
  assert.equal(db.prepare('SELECT status FROM referral_orders WHERE order_id=?').get(earned.id)!.status,'earned');
  assert.equal(db.prepare("SELECT count(*) n FROM orders WHERE status='paid'").get()!.n,2);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('an invitation rejected before checkout is recorded with its reason, stays zero after payment and cannot be duplicated',async t=>{
  const f=deviceFixture(t);const {referralRepository}=await import('./referrals.ts');
  const referrals=referralRepository(f.db,origin,'sandbox');
  f.link('rejected-before-order','a');
  assert.equal(referrals.visit('rejected-before-order','a'.repeat(16)).accepted,false);
  assert.equal(referrals.invitation('rejected-before-order'),null);
  const key=randomUUID(),attribution=referrals.orderAttribution('rejected-before-order');
  assert.equal(attribution?.inviterId,'a');
  const order=await f.orders.create('rejected-before-order',input,key,attribution);
  await f.orders.create('rejected-before-order',input,key,attribution);
  f.pay(order);f.pay(order);
  assert.equal(f.db.prepare('SELECT count(*) n FROM referral_order_exclusions').get()!.n,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM referral_orders').get()!.n,0);
  const report=referrals.report(new URLSearchParams(),'a');
  assert.equal(report.total,1);assert.equal(report.earnedCents,0);
  assert.equal(report.rows[0].reasonCode,'same_device');assert.match(report.rows[0].reasonMessage,/同设备/);
  assert.equal(report.rows[0].amountCents,0);assert.equal(report.rows[0].expectedAmountCents,0);
  assert.ok(report.rows[0].reasonUpdatedAt);assert.ok(!JSON.stringify(report).includes('rejected-before-order'));
  assert.equal(referrals.report(new URLSearchParams(),'c').total,0);
  assert.equal(referralRepository(f.db,origin,'production').report(new URLSearchParams(),'a').total,0);
  assert.throws(()=>f.db.prepare('INSERT INTO referral_orders(order_id,inviter_id,created_at) VALUES (?,?,?)').run(order.id,'a',new Date().toISOString()),/already excluded/);
});

test('legacy expired invitation bindings remain valid, earn on new orders and cannot be replaced',async t=>{
  const f=deviceFixture(t);const {referralRepository}=await import('./referrals.ts');
  const referrals=referralRepository(f.db,origin,'sandbox');
  referrals.visit('long-term-buyer','a'.repeat(16),'c');
  const oldExpiry=Date.now()-365*86400000;
  f.db.prepare('UPDATE referral_visits SET expires_at=? WHERE owner_hash=?').run(oldExpiry,'long-term-buyer');
  assert.deepEqual(referrals.invitation('long-term-buyer','c'),{code:'a'.repeat(16),expiresAt:null});
  assert.equal(referrals.attribution('long-term-buyer','c')?.inviterId,'a');
  referrals.visit('long-term-buyer','b'.repeat(16),'c');
  assert.equal(referrals.orderAttribution('long-term-buyer','c')?.inviterId,'a');
  const order=await f.orders.create('long-term-buyer',input,randomUUID(),referrals.orderAttribution('long-term-buyer','c'));
  f.pay(order);f.pay(order);
  assert.equal(f.db.prepare('SELECT status FROM referral_orders WHERE order_id=?').get(order.id)!.status,'earned');
  assert.equal(f.db.prepare('SELECT count(*) n FROM referral_order_exclusions').get()!.n,0);
  assert.equal(referrals.report(new URLSearchParams(),'a').earnedCents,500);
  assert.equal(f.db.prepare('SELECT expires_at FROM referral_visits WHERE owner_hash=?').get('long-term-buyer')!.expires_at,oldExpiry);
});

test('an old rejected invitation still records the same-device reason instead of an expiry reason',async t=>{
  const f=deviceFixture(t);const {referralRepository}=await import('./referrals.ts');
  const referrals=referralRepository(f.db,origin,'sandbox');f.link('old-rejected','a');
  referrals.visit('old-rejected','a'.repeat(16));
  f.db.prepare('UPDATE referral_rejected_visits SET expires_at=? WHERE owner_hash=?').run(Date.now()-365*86400000,'old-rejected');
  const order=await f.orders.create('old-rejected',input,randomUUID(),referrals.orderAttribution('old-rejected'));
  f.pay(order);
  assert.equal(f.db.prepare('SELECT reason_code FROM referral_order_exclusions WHERE order_id=?').get(order.id)!.reason_code,'same_device');
});

test('mock scenarios persist clear reasons through checkout, payment, expiry, refund and late device evidence',async t=>{
  const {createReferralScenarios}=await import('../tests/fixtures/referrals.ts');
  const mock=await createReferralScenarios();t.after(()=>mock.db.close());
  const report=mock.referrals.report(new URLSearchParams(),mock.inviterId);
  assert.equal(report.total,10);assert.equal(report.earnedCents,1000);
  const admin=mock.referrals.report(new URLSearchParams());
  for(const [scenario,id] of Object.entries(mock.scenarios)){
    const row=admin.rows.find(row=>row.orderId===id)!;
    const reason=scenario==='late_device'?'same_device':scenario==='long_term_invitation'?'earned':scenario;
    assert.equal(row.reasonCode,reason);assert.ok(row.reasonMessage.length>10);assert.ok(row.reasonUpdatedAt);
    assert.equal(row.amountCents,reason==='earned'?500:0);
    assert.equal(row.expectedAmountCents,scenario==='awaiting_payment'?500:0);
    assert.equal(mock.db.prepare('SELECT reason_code FROM referral_report_records WHERE order_id=?').get(id)!.reason_code,reason);
    assert.equal(row.status,reason==='earned'?'earned':scenario==='awaiting_payment'?'pending':'cancelled');
  }
  assert.equal(mock.referrals.report(new URLSearchParams('status=cancelled'),mock.inviterId).total,7);
  const before=admin.rows.map(row=>[row.orderId,row.reasonCode,row.reasonUpdatedAt]);
  const after=mock.referrals.report(new URLSearchParams()).rows.map(row=>[row.orderId,row.reasonCode,row.reasonUpdatedAt]);
  assert.deepEqual(after,before);
});
