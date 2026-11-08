import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
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
      return {status:response.status, json:await response.json() as {data: {id: string; inviteCode: string; accepted: boolean; invitation: { code: string; expiresAt: number } | null; total: number; earnedCents: number; rows: {status: string; orderId: string}[]}}, cookies:response.headers.getSetCookie()};
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
  assert.equal(sandboxReport.total, 2);
  assert.equal(sandboxReport.earnedCents, 0);
  insertAdminAccount(db, 'viewer', await hashAdminPassword('admin-password123'), 'admin', []);
  const staff = client();
  assert.equal((await staff('/admin/login',{username:'viewer',password:'admin-password123'})).status,200);
  assert.equal((await staff('/admin/referrals')).status,403);
  db.prepare("UPDATE admin_accounts SET permissions='[\"referrals.view\"]' WHERE username='viewer'").run();
  assert.equal((await staff('/admin/referrals?environment=all')).json.data.total,2);
  await inviter('/customer/logout',{});
  assert.equal((await inviter('/referrals')).status,401);
  assert.equal((await inviter('/customer/session')).json.data,null);
  db.prepare('UPDATE referral_visits SET expires_at = ?').run(Date.now() - 1);
  assert.equal((await friend('/referrals/invitation')).json.data, null);
  const renewed = await friend('/referrals/visit', { code: second.json.data.inviteCode });
  assert.equal(renewed.json.data.invitation?.code, second.json.data.inviteCode);
  assert.ok(renewed.json.data.invitation!.expiresAt > Date.now());
});
