import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { once } from 'node:events';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { AlipaySdk } from 'alipay-sdk';
import { openDatabase } from './database.ts';
import { createApiServer } from './app.ts';
import { createAlipayGateway } from './alipay.ts';
import type { PaymentGateway } from './alipay.ts';
import { hashAdminPassword, insertAdminAccount } from './admin.ts';
import { withdrawalRepository } from './withdrawals.ts';
import type { PayoutRequest, PayoutResult, Withdrawal, WithdrawalReport } from '../src/types/withdrawals.ts';

const password = 'withdrawal-test-password';
const input = { amount: '5.00', account: 'payee@example.com', realName: '测试收款人', password };
function earn(db: ReturnType<typeof openDatabase>, customer = 'customer-one', environment = 'sandbox') {
  const id = randomUUID(), now = new Date().toISOString();
  db.prepare(`INSERT INTO orders(id,owner_hash,email,snapshot,status,created_at,expires_at,idempotency_key,fingerprint,environment)
    VALUES (?,?,'',?,'pending',?,?,?,?,?)`).run(id, 'buyer', JSON.stringify({ priceCents: 13000, productId: 'chatgpt-plus', productName: 'ChatGPT Plus' }), now, now, id, 'fixture', environment);
  db.prepare('INSERT INTO referral_orders(order_id,inviter_id,created_at) VALUES (?,?,?)').run(id, customer, now);
  db.prepare("UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ?").run(now, id);
  return id;
}
async function setup(t: TestContext) {
  const db = openDatabase(':memory:');
  const encoded = await hashAdminPassword(password);
  for (const [id, code] of [['customer-one','1234567890abcdef'],['customer-two','2234567890abcdef']]) db.prepare('INSERT INTO customers VALUES (?,?,?,?,?)').run(id,id,encoded,code,new Date().toISOString());
  insertAdminAccount(db, 'admin', encoded, 'super_admin');
  insertAdminAccount(db, 'viewer', encoded, 'admin', ['referrals.view']);
  const sent: PayoutRequest[] = [];
  let transfer = async (request: PayoutRequest): Promise<PayoutResult> => ({ code: '10000', out_biz_no: request.id, order_id: 'transfer-' + request.id, status: 'SUCCESS', trans_amount: (request.amountCents / 100).toFixed(2) });
  let query = transfer;
  const gateway: PaymentGateway = { ...createAlipayGateway({}), appId: 'withdrawal-app', sellerId: 'withdrawal-seller',
    payout: { enabled: true, transfer: request => { sent.push(request); return transfer(request); }, query: request => query(request) } };
  const repository = withdrawalRepository(db, gateway);
  const server = createApiServer(db, gateway);
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeIdleConnections(); }); db.close(); });
  function client() {
    const cookies = new Map<string,string>();
    return async (path: string, body?: unknown, key = randomUUID(), origin = base) => {
      const response = await fetch(base + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join('; '), Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: body === undefined ? undefined : JSON.stringify(body) });
      for (const value of response.headers.getSetCookie()) { const [key,token] = value.split(';')[0].split('='); cookies.set(key,token); }
      const json = await response.json() as { data: Withdrawal & WithdrawalReport; error?: { code: string } };
      return { status: response.status, ...json };
    };
  }
  const user = client(), admin = client(), viewer = client();
  await user('/customer/login', { username: 'customer-one', password });
  await admin('/admin/login', { username: 'admin', password });
  await viewer('/admin/login', { username: 'viewer', password });
  return { db, gateway, repository, user, admin, viewer, client, sent,
    setTransfer: (value: typeof transfer) => { transfer = value; }, setQuery: (value: typeof query) => { query = value; } };
}
const path = '/referrals/withdrawals';
const action = (id: string, verb: string) => '/admin/referrals/withdrawals/' + id + '/' + verb;

test('withdrawal endpoints require ownership, reauthentication, same origin and separate admin permission', async t => {
  const { db, user, admin, viewer, client } = await setup(t);
  earn(db);
  assert.equal((await client()(path)).status,401);
  assert.equal((await client()(path,input)).status,401);
  assert.equal((await viewer('/admin' + path)).status,403);
  assert.equal((await user(path,{ ...input, password: 'incorrect' })).status,403);
  assert.equal((await user(path,input,undefined,'https://evil.example')).status,403);
  for (const values of [{ amount: '0.01' },{ amount: 'NaN' },{ amount: '6.00' },{ account: 'invalid' },{ realName: '' }]) assert.ok((await user(path,{...input,...values})).status >= 400);
  const created = await user(path,input); assert.equal(created.status,201);
  assert.equal(created.data.status,'pending');
  assert.equal((await client()('/admin' + path)).status,401);
  assert.equal((await user(action(created.data.id,'approve'),{})).status,401);
  assert.equal((await viewer(action(created.data.id,'approve'),{})).status,403);
  assert.equal((await admin(action(created.data.id,'approve'),{},undefined,'https://evil.example')).status,403);
  const other = client(); await other('/customer/login', { username: 'customer-two', password });
  assert.equal((await other(path)).data.total,0);
  assert.equal((await user(path)).data.total,1);
  const result = await admin('/admin' + path); assert.equal(result.data.rows[0].account,input.account);
  assert.equal(JSON.stringify(result).includes(password),false);
});

test('reservations, concurrent applications and retries cannot spend the same rebate twice', async t => {
  const { db, user, repository } = await setup(t); earn(db);
  const key = randomUUID();
  const results = await Promise.all([user(path,input,key), user(path,input,key)]);
  assert.ok(results.every(r => r.status === 201));
  assert.equal(results[0].data.id,results[1].data.id);
  assert.equal(db.prepare('SELECT count(*) AS n FROM referral_withdrawals').get()!.n,1);
  assert.deepEqual(repository.balance('customer-one'), { earnedCents: 500, heldCents: 500, paidCents: 0, availableCents: 0, deficitCents: 0 });
  assert.equal((await user(path,{...input,account:'other@example.com'},key)).status,409);
  assert.equal((await user(path,input)).status,409);
  repository.review(results[0].data.id,false,'admin','资料有误');
  assert.equal(repository.balance('customer-one').availableCents,500);
  const concurrent = await Promise.all([user(path,{...input,amount:'4'}),user(path,{...input,amount:'4'})]);
  assert.deepEqual(concurrent.map(r => r.status).sort(),[201,409]);
});

test('approval is required before payout and duplicate clicks cannot create a second transfer', async t => {
  const { db, user, admin, repository, sent, setTransfer } = await setup(t); earn(db);
  const id = (await user(path,input)).data.id;
  assert.equal((await admin(action(id,'pay'),{})).status,409); assert.equal(sent.length,0);
  assert.equal((await admin(action(id,'approve'),{})).data.status,'approved'); assert.equal(sent.length,0);
  let complete!: (result: PayoutResult) => void;
  setTransfer(() => new Promise(resolve => { complete = resolve; }));
  const payment = repository.pay(id,'admin');
  assert.equal(sent.length,1);
  await assert.rejects(repository.pay(id,'admin'),/正在处理/);
  complete({ code:'10000',out_biz_no:id,order_id:'alipay-confirmed',status:'SUCCESS',trans_amount:'5.00' });
  assert.equal((await payment).status,'paid');
  assert.equal((await repository.pay(id,'admin')).status,'paid'); assert.equal(sent.length,1);
  assert.equal(repository.balance('customer-one').paidCents,500);
  assert.equal(repository.balance('customer-one').availableCents,0);
  assert.equal(db.prepare("SELECT count(*) n FROM referral_withdrawal_events WHERE withdrawal_id = ? AND action = 'pay'").get(id)!.n,1);
});

test('unknown or mismatched payout results stay reserved and only a validated original-order query settles them', async t => {
  const { db, user, repository, gateway, sent, setTransfer, setQuery } = await setup(t); earn(db);
  const id = (await user(path,input)).data.id; repository.review(id,true,'admin','');
  setTransfer(async () => { throw new Error('timeout'); });
  assert.equal((await repository.pay(id,'admin')).status,'processing');
  assert.equal(repository.balance('customer-one').heldCents,500);
  await assert.rejects(repository.pay(id,'admin'),/仅审核通过/); assert.equal(sent.length,1);
  setQuery(async () => ({code:'10000',out_biz_no:id,order_id:'query-result',status:'SUCCESS',trans_amount:'500'}));
  assert.equal((await repository.pay(id,'admin',true)).status,'processing');
  gateway.appId = 'other-merchant';
  await assert.rejects(repository.pay(id,'admin',true),/商户配置已变更/);
  gateway.appId = 'withdrawal-app';
  setQuery(async () => ({code:'10000',out_biz_no:id,order_id:'query-result',status:'SUCCESS',trans_amount:'5.00'}));
  assert.equal((await repository.pay(id,'admin',true)).status,'paid'); assert.equal(sent.length,1);
});

test('refunds block uncovered approvals and payouts; confirmed transfer failure releases funds; environments stay isolated', async t => {
  const { db, user, admin, repository, gateway, setTransfer } = await setup(t);
  const orderId = earn(db); earn(db,'customer-one','production');
  const id = (await user(path,input)).data.id;
  assert.equal(repository.balance('customer-one').earnedCents,500);
  repository.review(id,true,'admin','');
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO payment_refunds(request_no,order_id,amount_cents,reason,status,created_at,updated_at) VALUES ('withdrawal-refund',?,13000,'test','pending',?,?)`).run(orderId,now,now);
  db.prepare("UPDATE payment_refunds SET status = 'success' WHERE request_no = 'withdrawal-refund'").run();
  await assert.rejects(repository.pay(id,'admin'),/余额不足/);
  assert.equal((await admin(action(id,'reject'),{})).status,400);
  repository.review(id,false,'admin','订单已退款');
  assert.equal(repository.balance('customer-one').availableCents,0);
  earn(db);
  const second = (await user(path,input)).data.id;
  repository.review(second,true,'admin','');
  setTransfer(async request => ({ code:'10000',out_biz_no:request.id,status:'FAIL' }));
  assert.equal((await repository.pay(second,'admin')).status,'failed');
  assert.equal(repository.balance('customer-one').availableCents,500);
  gateway.payout!.enabled = false;
  const third = (await user(path,input)).data.id; repository.review(third,true,'admin','');
  await assert.rejects(repository.pay(third,'admin'),/暂未启用/);
  assert.equal((await user(path)).data.rows.find(row => row.id === third)!.status,'approved');
  for (const query of ['?environment=production','?status=bad','?page=0','?page=1&page=2']) assert.equal((await user(path+query)).status,400);
});

test('Alipay payout adapter is opt-in, validates scene configuration and uses signed original-number transfer/query calls', async t => {
  const pair = generateKeyPairSync('rsa',{modulusLength:2048});
  const env = { ALIPAY_ENABLED:'true', ALIPAY_ENV:'sandbox', ALIPAY_APP_ID:'2021000000000001', ALIPAY_SELLER_ID:'2088000000000001', PUBLIC_SITE_URL:'http://127.0.0.1:5180',
    ALIPAY_PRIVATE_KEY:pair.privateKey.export({type:'pkcs1',format:'der'}).toString('base64'), ALIPAY_PUBLIC_KEY:pair.publicKey.export({type:'spki',format:'der'}).toString('base64') };
  assert.equal(createAlipayGateway(env,{sandboxPath:null}).payout!.enabled,false);
  assert.throws(()=>createAlipayGateway({...env,ALIPAY_TRANSFER_ENABLED:'true'},{sandboxPath:null}),/scene/);
  assert.throws(()=>createAlipayGateway({...env,ALIPAY_TRANSFER_ENABLED:'yes'},{sandboxPath:null}),/true or false/);
  const configured = {...env, ALIPAY_TRANSFER_ENABLED:'true',ALIPAY_TRANSFER_SCENE_NAME:'佣金报酬',ALIPAY_TRANSFER_SCENE_REPORT_INFOS:JSON.stringify([{info_type:'fixture-type',info_content:'fixture-content'}])};
  assert.throws(()=>createAlipayGateway({...configured,ALIPAY_TRANSFER_APP_CERT_PATH:'/missing-cert'},{sandboxPath:null}),/three/);
  const calls: {method:string;params:Record<string,unknown>;options:unknown}[] = [];
  t.mock.method(AlipaySdk.prototype,'exec',async (method:string,params:Record<string,unknown>,options:unknown)=>{
    calls.push({method,params,options}); return {code:'10000',out_biz_no:'WD-test',order_id:'test-transfer',status:'SUCCESS'};
  });
  const payout = createAlipayGateway(configured,{sandboxPath:null}).payout!;
  const request = {id:'WD-test',amountCents:500,account:'payee@example.com',realName:'测试收款人'};
  await payout.transfer(request); await payout.query(request);
  assert.equal(calls[0].method,'alipay.fund.trans.uni.transfer');
  assert.deepEqual(calls[0].options,{validateSign:true});
  const body = calls[0].params.bizContent as Record<string,unknown>;
  assert.equal(body.out_biz_no,request.id); assert.equal(body.trans_amount,'5.00');
  assert.equal(body.product_code,'TRANS_ACCOUNT_NO_PWD'); assert.equal(body.biz_scene,'DIRECT_TRANSFER');
  assert.deepEqual(body.payee_info,{identity:request.account,identity_type:'ALIPAY_LOGON_ID',name:request.realName});
  assert.equal(calls[1].method,'alipay.fund.trans.common.query');
  assert.equal((calls[1].params.bizContent as Record<string,unknown>).out_biz_no,request.id);
  assert.deepEqual(calls[1].options,{validateSign:true});
});
