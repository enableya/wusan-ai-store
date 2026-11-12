import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { once } from 'node:events';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
const receipt = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const settlement = (overrides: Record<string, unknown> = {}) => ({
  confirmed: true, ...overrides,
});
function legacyProcessing(db: ReturnType<typeof openDatabase>, id: string) {
  db.prepare(`UPDATE referral_withdrawals SET status='processing',payout_method='api',app_id='withdrawal-app',seller_id='withdrawal-seller' WHERE id=?`).run(id);
}
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
  const queried: PayoutRequest[] = [];
  const transfer = async (request: PayoutRequest): Promise<PayoutResult> => ({ code: '10000', out_biz_no: request.id, order_id: 'transfer-' + request.id, status: 'SUCCESS', trans_amount: (request.amountCents / 100).toFixed(2) });
  let query = transfer;
  const gateway: PaymentGateway = { ...createAlipayGateway({}), appId: 'withdrawal-app', sellerId: 'withdrawal-seller',
    payout: { enabled: true, transfer: request => { sent.push(request); return transfer(request); }, query: request => { queried.push(request); return query(request); } } };
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
      if (response.headers.get('content-type')?.startsWith('image/')) {
        return { status: response.status, data: {} as Withdrawal & WithdrawalReport, image: Buffer.from(await response.arrayBuffer()), headers: response.headers };
      }
      const json = await response.json() as { data: Withdrawal & WithdrawalReport; error?: { code: string } };
      return { status: response.status, ...json };
    };
  }
  const user = client(), admin = client(), viewer = client();
  await user('/customer/login', { username: 'customer-one', password });
  await admin('/admin/login', { username: 'admin', password });
  await viewer('/admin/login', { username: 'viewer', password });
  return { db, gateway, repository, user, admin, viewer, client, sent, queried,
    setQuery: (value: typeof query) => { query = value; } };
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
  for (const verb of ['manual-start','manual-complete','manual-release']) {
    assert.equal((await client()(action(created.data.id,verb),{})).status,401);
    assert.equal((await user(action(created.data.id,verb),{})).status,401);
    assert.equal((await viewer(action(created.data.id,verb),{})).status,403);
    assert.equal((await admin(action(created.data.id,verb),{},undefined,'https://evil.example')).status,403);
  }
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

test('manual payout needs approval and a claim, works without gateway access, and retries settle only once', async t => {
  const { db, user, admin, repository, sent, gateway, client, viewer } = await setup(t); earn(db);
  const id = (await user(path,input)).data.id;
  gateway.payout!.enabled = false;
  assert.equal((await admin(action(id,'pay'),{})).status,409); assert.equal(sent.length,0);
  assert.equal((await admin(action(id,'manual-start'),{})).status,409);
  assert.equal((await admin(action(id,'manual-complete'),settlement())).status,409);
  assert.equal((await admin(action(id,'approve'),{})).data.status,'approved'); assert.equal(sent.length,0);
  const started = await Promise.all([admin(action(id,'manual-start'),{}),admin(action(id,'manual-start'),{})]);
  assert.ok(started.every(result => result.data.status === 'processing'));
  assert.equal(started[0].data.manual?.startedBy,'admin');
  assert.equal(repository.balance('customer-one').heldCents,500);
  assert.equal((await admin(action(id,'reject'),{reason:'cannot release in progress'})).status,409);
  const values = settlement();
  const completed = await Promise.all([admin(action(id,'manual-complete'),values),admin(action(id,'manual-complete'),values)]);
  assert.ok(completed.every(result => result.data.status === 'paid'));
  assert.equal(sent.length,0);
  assert.equal(repository.balance('customer-one').paidCents,500);
  assert.equal(repository.balance('customer-one').availableCents,0);
  assert.equal(db.prepare("SELECT count(*) n FROM referral_withdrawal_events WHERE withdrawal_id = ? AND action = 'manual-complete'").get(id)!.n,1);
  assert.equal(db.prepare("SELECT count(*) n FROM referral_withdrawal_events WHERE withdrawal_id = ? AND action = 'manual-start'").get(id)!.n,1);
  const confirmedAt = completed[0].data.paidAt;
  assert.ok(confirmedAt);
  assert.equal(completed[0].data.transferNo,null);
  assert.equal(completed[0].data.manual?.hasReceipt,false);
  assert.equal((await admin(action(id,'manual-complete'),settlement())).data.paidAt,confirmedAt);
  assert.equal((await user(path)).data.rows[0].manual,undefined);
  assert.equal((await admin('/admin'+path)).data.rows[0].manual?.recordedBy,'admin');
  assert.equal((await admin(action(id,'receipt'))).status,404);
  db.prepare('UPDATE referral_manual_payouts SET receipt=?,receipt_type=? WHERE withdrawal_id=?')
    .run(Buffer.from(receipt.split(',')[1],'base64'),'image/png',id);
  const proof = await admin(action(id,'receipt'));
  assert.equal(proof.status,200);
  assert.equal(proof.image?.toString('base64'),receipt.split(',')[1]);
  assert.equal(proof.headers?.get('cache-control'),'no-store');
  assert.equal((await client()(action(id,'receipt'))).status,401);
  assert.equal((await user(action(id,'receipt'))).status,401);
  assert.equal((await viewer(action(id,'receipt'))).status,403);
  await admin('/admin/logout',{});
  assert.equal((await admin(action(id,'receipt'))).status,401);
});

test('manual withdrawals never call the transfer or query gateway even when the Alipay adapter is enabled', async t => {
  const { db, user, admin, repository, sent, queried } = await setup(t); earn(db);
  const created = await user(path,input);
  const id = created.data.id;
  assert.equal(created.data.payoutMethod,'manual');
  for (const stage of ['pending','approved','processing','paid']) {
    if (stage === 'approved') repository.review(id,true,'admin','');
    if (stage === 'processing') repository.manualStart(id,'admin');
    if (stage === 'paid') repository.manualComplete(id,'admin',settlement());
    const result = await admin(action(id,'pay'),{});
    assert.equal(result.status,409);
    assert.ok('error' in result);
    assert.equal(result.error?.code,'MANUAL_PAYOUT_REQUIRED');
    assert.equal((await admin(action(id,'query'),{})).status,409);
    assert.equal((await user(path)).data.rows[0].status,stage);
    assert.equal(sent.length,0);
    assert.equal(queried.length,0);
  }
});

test('different authorized administrators cannot claim or settle the same manual withdrawal twice', async t => {
  const { db, user, admin, client, repository, sent } = await setup(t); earn(db);
  insertAdminAccount(db,'operator',await hashAdminPassword(password),'admin',['withdrawals.manage']);
  const operator = client();
  await operator('/admin/login',{username:'operator',password});
  const id = (await user(path,input)).data.id;
  repository.review(id,true,'admin','');
  const results = await Promise.all([admin(action(id,'manual-start'),{}),operator(action(id,'manual-start'),{})]);
  assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
  const winner = results[0].status === 200 ? admin : operator;
  const loser = results[0].status === 200 ? operator : admin;
  assert.equal((await loser(action(id,'manual-complete'),settlement())).status,409);
  assert.equal((await loser(action(id,'manual-release'),{confirmed:true,reason:'Not sent'})).status,409);
  assert.equal(repository.balance('customer-one').heldCents,500);
  assert.equal((await winner(action(id,'manual-complete'),settlement())).data.status,'paid');
  assert.equal(repository.balance('customer-one').paidCents,500);
  assert.equal(db.prepare("SELECT count(*) n FROM referral_withdrawal_events WHERE withdrawal_id=? AND action='manual-start'").get(id)!.n,1);
  assert.equal(db.prepare("SELECT count(*) n FROM referral_withdrawal_events WHERE withdrawal_id=? AND action='manual-complete'").get(id)!.n,1);
  assert.equal(sent.length,0);
});

test('unknown or mismatched payout results stay reserved and only a validated original-order query settles them', async t => {
  const { db, user, repository, gateway, sent, setQuery } = await setup(t); earn(db);
  const id = (await user(path,input)).data.id; repository.review(id,true,'admin','');
  legacyProcessing(db,id);
  setQuery(async () => { throw new Error('timeout'); });
  assert.equal((await repository.pay(id,'admin',true)).status,'processing');
  assert.equal(repository.balance('customer-one').heldCents,500);
  await assert.rejects(repository.pay(id,'admin'),/人工打款/); assert.equal(sent.length,0);
  assert.throws(()=>repository.manualStart(id,'admin'),/仅审核通过/);
  assert.throws(()=>repository.manualComplete(id,'admin',settlement()),/领取/);
  setQuery(async () => ({code:'10000',out_biz_no:id,order_id:'query-result',status:'SUCCESS',trans_amount:'500'}));
  assert.equal((await repository.pay(id,'admin',true)).status,'processing');
  gateway.appId = 'other-merchant';
  await assert.rejects(repository.pay(id,'admin',true),/商户配置已变更/);
  gateway.appId = 'withdrawal-app';
  setQuery(async () => ({code:'10000',out_biz_no:id,order_id:'query-result',status:'SUCCESS',trans_amount:'5.00'}));
  assert.equal((await repository.pay(id,'admin',true)).status,'paid'); assert.equal(sent.length,0);
});

test('refunds block uncovered approvals and payouts; confirmed transfer failure releases funds; environments stay isolated', async t => {
  const { db, user, admin, repository, gateway, setQuery } = await setup(t);
  const orderId = earn(db); earn(db,'customer-one','production');
  const id = (await user(path,input)).data.id;
  assert.equal(repository.balance('customer-one').earnedCents,500);
  repository.review(id,true,'admin','');
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO payment_refunds(request_no,order_id,amount_cents,reason,status,created_at,updated_at) VALUES ('withdrawal-refund',?,13000,'test','pending',?,?)`).run(orderId,now,now);
  db.prepare("UPDATE payment_refunds SET status = 'success' WHERE request_no = 'withdrawal-refund'").run();
  assert.throws(()=>repository.manualStart(id,'admin'),/余额不足/);
  assert.equal((await admin(action(id,'reject'),{})).status,400);
  repository.review(id,false,'admin','订单已退款');
  assert.equal(repository.balance('customer-one').availableCents,0);
  earn(db);
  const second = (await user(path,input)).data.id;
  repository.review(second,true,'admin','');
  legacyProcessing(db,second);
  setQuery(async request => ({ code:'10000',out_biz_no:request.id,status:'FAIL' }));
  assert.equal((await repository.pay(second,'admin',true)).status,'failed');
  assert.equal(repository.balance('customer-one').availableCents,500);
  gateway.payout!.enabled = false;
  const third = (await user(path,input)).data.id; repository.review(third,true,'admin','');
  await assert.rejects(repository.pay(third,'admin',true),/暂未启用/);
  assert.equal((await user(path)).data.rows.find(row => row.id === third)!.status,'approved');
  for (const query of ['?environment=production','?status=bad','?page=0','?page=1&page=2']) assert.equal((await user(path+query)).status,400);
});

test('manual settlement requires explicit confirmation and records the server time without payout fields or evidence', async t => {
  const { db, user, admin, repository } = await setup(t); earn(db);
  const id = (await user(path,input)).data.id; repository.review(id,true,'admin',''); repository.manualStart(id,'admin');
  for (const confirmed of [undefined,false,null,'true',1]) {
    assert.equal((await admin(action(id,'manual-complete'),{confirmed})).status,400);
  }
  assert.equal((await admin(action(id,'manual-complete'),{...settlement(),padding:'x'.repeat(720000)})).status,413);
  assert.equal((await user(path)).data.rows[0].status,'processing');
  assert.equal(repository.balance('customer-one').heldCents,500);
  assert.equal((await admin(action(id,'receipt'))).status,404);
  assert.throws(()=>repository.manualStart(id,'other-admin'),/仅审核通过/);
  assert.throws(()=>repository.manualComplete(id,'other-admin',settlement()),/领取/);
  assert.equal(db.prepare("SELECT count(*) n FROM referral_withdrawal_events WHERE action='manual-complete'").get()!.n,0);
  const before = Date.now();
  const completed = await admin(action(id,'manual-complete'),settlement({
    amount:'0.01',paidAt:'2020-01-01T00:00:00.000Z',transferNo:'untrusted',receipt:'untrusted',
  }));
  assert.equal(completed.status,200);
  assert.equal(completed.data.amountCents,500);
  assert.equal(completed.data.transferNo,null);
  assert.equal(completed.data.manual?.hasReceipt,false);
  assert.equal(completed.data.manual?.recordedBy,'admin');
  assert.equal(completed.data.manual?.recordedAt,completed.data.paidAt);
  assert.ok(Date.parse(completed.data.paidAt!) >= before && Date.parse(completed.data.paidAt!) <= Date.now());
  assert.equal(repository.balance('customer-one').heldCents,0);
  assert.equal(repository.balance('customer-one').paidCents,500);
});

test('manual release needs no-transfer attestation and preserves the hold; separate withdrawals settle independently', async t => {
  const { db, user, repository, gateway } = await setup(t); earn(db); earn(db);
  const first = (await user(path,input)).data.id; repository.review(first,true,'admin',''); repository.manualStart(first,'admin');
  assert.throws(()=>repository.manualRelease(first,'admin',{confirmed:false,reason:'not sent'}),/确认/);
  assert.throws(()=>repository.manualRelease(first,'admin',{confirmed:true,reason:''}),/原因/);
  assert.throws(()=>repository.manualRelease(first,'other',{confirmed:true,reason:'not sent'}),/经办人/);
  assert.equal(repository.manualRelease(first,'admin',{confirmed:true,reason:'核实尚未转账'}).status,'approved');
  assert.equal(repository.balance('customer-one').heldCents,500);
  repository.manualStart(first,'second-admin');
  assert.throws(()=>repository.manualComplete(first,'admin',settlement()),/领取/);
  const values = settlement();
  assert.equal(repository.manualComplete(first,'second-admin',values).status,'paid');
  assert.throws(()=>repository.manualRelease(first,'second-admin',{confirmed:true,reason:'not sent'}),/经办人/);
  const second = (await user(path,input)).data.id; repository.review(second,true,'admin',''); repository.manualStart(second,'admin');
  assert.equal(repository.manualComplete(second,'admin',settlement()).status,'paid');
  assert.equal(repository.balance('customer-one').heldCents,0);
  assert.equal(repository.balance('customer-one').paidCents,1000);
  await assert.rejects(repository.pay(second,'admin',true),/人工打款/);
  const production = withdrawalRepository(db,{...gateway,status:{...gateway.status,environment:'production'}});
  assert.throws(()=>production.receipt(first),/不存在/);
});

test('a refund after manual transfer started does not prevent recording the actual successful transfer', async t => {
  const { db, user, repository } = await setup(t);
  const orderId=earn(db);
  const id=(await user(path,input)).data.id;repository.review(id,true,'admin','');repository.manualStart(id,'admin');
  const now=new Date().toISOString();
  db.prepare("INSERT INTO payment_refunds(request_no,order_id,amount_cents,reason,status,created_at,updated_at) VALUES ('late-refund',?,13000,'test','success',?,?)").run(orderId,now,now);
  db.prepare("UPDATE payment_refunds SET status='success' WHERE request_no='late-refund'").run();
  assert.equal(repository.balance('customer-one').deficitCents,500);
  assert.equal(repository.manualComplete(id,'admin',settlement()).status,'paid');
  assert.deepEqual(repository.balance('customer-one'),{earnedCents:0,heldCents:0,paidCents:500,availableCents:0,deficitCents:500});
});

test('schema 20 preserves historical withdrawals and audit rows; confirmation keeps historical private receipts intact', async () => {
  const root=mkdtempSync(join(tmpdir(),'wusan-manual-migration-'));
  let db: ReturnType<typeof openDatabase> | undefined;
  try {
    const filename=join(root,'store.sqlite');
    db=openDatabase(filename);
    const now=new Date().toISOString(),id='WD'+'a'.repeat(32);
    db.prepare('INSERT INTO customers VALUES (?,?,?,?,?)').run('customer-one','migration-user',await hashAdminPassword(password),'a'.repeat(16),now);
    earn(db);
    db.prepare(`INSERT INTO referral_withdrawals(id,customer_id,environment,amount_cents,payee_account,payee_name,status,idempotency_key,created_at,app_id,seller_id)
      VALUES (?,'customer-one','sandbox',500,'old@example.com','历史用户','processing','migration-key',?,'withdrawal-app','withdrawal-seller')`).run(id,now);
    db.prepare("INSERT INTO referral_withdrawal_events(withdrawal_id,actor,action,status,note,created_at) VALUES (?,'old-admin','pay','processing','historical',?)").run(id,now);
    db.exec('DROP TABLE referral_manual_payouts; ALTER TABLE referral_withdrawals DROP COLUMN payout_method; PRAGMA user_version=19;');
    const oldWithdrawal=db.prepare('SELECT * FROM referral_withdrawals').get()!;
    const oldEvents=db.prepare('SELECT * FROM referral_withdrawal_events').all();
    const oldOrders=db.prepare('SELECT * FROM orders').all();
    db.close();db=openDatabase(filename);
    const migrated=db.prepare('SELECT * FROM referral_withdrawals').get()!;
    const {payout_method,...preserved}=migrated;
    assert.equal(payout_method,'api');
    assert.deepEqual(preserved,{...oldWithdrawal});
    assert.deepEqual(db.prepare('SELECT * FROM referral_withdrawal_events').all(),oldEvents);
    assert.deepEqual(db.prepare('SELECT * FROM orders').all(),oldOrders);
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version,26);
    const gateway=createAlipayGateway({});
    const repository=withdrawalRepository(db,gateway);
    assert.throws(()=>repository.manualStart(id,'admin'),/仅审核通过/);
    db.prepare("UPDATE referral_withdrawals SET status='rejected' WHERE id=?").run(id);
    const created=await repository.request('customer-one',input,randomUUID(),()=>{});
    assert.equal(created.payoutMethod,'manual');
    repository.review(created.id,true,'admin','');repository.manualStart(created.id,'admin');
    repository.manualComplete(created.id,'admin',settlement());
    db.prepare('UPDATE referral_manual_payouts SET receipt=?,receipt_type=? WHERE withdrawal_id=?')
      .run(Buffer.from(receipt.split(',')[1],'base64'),'image/png',created.id);
    db.prepare('UPDATE referral_withdrawals SET transfer_no=? WHERE id=?').run('202611090000000000000001',created.id);
    db.close();db=openDatabase(filename);
    const reopened=withdrawalRepository(db,gateway);
    const original = db.prepare('SELECT * FROM referral_withdrawals WHERE id=?').get(created.id);
    const originalRecord = db.prepare('SELECT * FROM referral_manual_payouts WHERE withdrawal_id=?').get(created.id);
    reopened.manualComplete(created.id,'admin',settlement());
    assert.deepEqual(db.prepare('SELECT * FROM referral_withdrawals WHERE id=?').get(created.id),original);
    assert.deepEqual(db.prepare('SELECT * FROM referral_manual_payouts WHERE withdrawal_id=?').get(created.id),originalRecord);
    assert.equal(reopened.receipt(created.id).type,'image/png');
    assert.equal(Buffer.from(reopened.receipt(created.id).bytes).toString('base64'),receipt.split(',')[1]);
    assert.equal(reopened.balance('customer-one').paidCents,500);
    assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  } finally {
    db?.close();
    rmSync(root,{recursive:true,force:true});
  }
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
