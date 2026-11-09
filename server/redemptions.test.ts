import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { Order } from '../src/types/orders.ts';
import { openDatabase } from './database.ts';
import { redemptionRepository } from './redemptions.ts';

async function checkRedemption(t: TestContext, environment: Order['environment']) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const original = process.env.LOVECODEX_ENABLED;
  process.env.LOVECODEX_ENABLED = 'true';
  t.after(() => {
    if (original === undefined) delete process.env.LOVECODEX_ENABLED;
    else process.env.LOVECODEX_ENABLED = original;
  });
  const id = 'order-test';
  db.prepare("INSERT INTO orders (id, owner_hash, email, snapshot, status, created_at, expires_at, idempotency_key, fingerprint, environment) VALUES (?, '', '', '{}', 'paid', '', '', '', '', ?)").run(id, environment);
  const order = { id, productId: 'chatgpt-plus', environment, status: 'paid' } as Order;
  const insert = db.prepare('INSERT INTO voucher_inventory (product_id, environment, code, priority) VALUES (?, ?, ?, ?)');
  insert.run('chatgpt-pro-5x', environment, 'OTHER_PRODUCT', 1);
  insert.run(order.productId, environment === 'production' ? 'sandbox' : 'production', 'OTHER_ENVIRONMENT', 1);
  const expiry = new Date(Date.now() + 600000).toISOString();
  const sessionInput = JSON.stringify({ user: { email: 'buyer@example.invalid' }, accessToken: 'mock-token', expires: expiry });
  const methods: string[] = [];
  const upstream: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    methods.push(path);
    assert.equal(init?.redirect, 'error');
    const success = (data: Record<string, unknown>) => Response.json({ ok: true, ...data });
    if (path.endsWith('/bootstrap')) return success({ policyVersions: { terms: '1', privacy: '2' } });
    if (path.endsWith('/prepare')) {
      assert.deepEqual(body, { voucherCode: 'PRIORITY' });
      return success({ redemptionId: 'abc', redemptionToken: 'private-redemption-token', product: { id: order.productId }, expiresAt: expiry });
    }
    if (path.endsWith('/session')) {
      assert.deepEqual(body, { sessionInput });
      return success({ redemption: { state: 'SESSION_READY', session: { accountHint: 'buyer@example.invalid', planType: 'free' } } });
    }
    if (path.endsWith('/submit')) {
      assert.ok(new Headers(init?.headers).get('Idempotency-Key'));
      assert.deepEqual(body, { termsVersion: '1', privacyVersion: '2' });
      throw new Error('Simulated timeout');
    }
    assert.ok(path.endsWith('/by-voucher'));
    assert.deepEqual(body, { voucherCode: 'PRIORITY' });
    return success({ order: { orderNo: 'R1', orderState: 'FULFILLED', settlement: { state: 'PAID' }, progress: 100 } });
  };
  const repo = redemptionRepository(db, upstream);
  const input = { sessionInput, consent: true, termsVersion: '1', privacyVersion: '2' };
  assert.equal(repo.view(order).enabled, true);
  assert.equal(repo.view(order).rechargeEmail, null);
  await assert.rejects(repo.preview(order, { ...input, consent: false }), { code: 'REDEMPTION_POLICY' });
  await assert.rejects(repo.preview(order, input), { code: 'VOUCHER_UNAVAILABLE' });
  assert.equal(methods.some(path => path.endsWith('/session')), false);
  insert.run(order.productId, environment, 'NORMAL', 0);
  insert.run(order.productId, environment, 'PRIORITY', 1);
  const preview = await repo.preview(order, input);
  assert.equal(preview.account?.email, 'buyer@example.invalid');
  assert.equal(preview.rechargeEmail, 'buyer@example.invalid');
  assert.equal(db.prepare('SELECT recharge_email FROM order_fulfillment_details WHERE order_id=?').get(id)!.recharge_email,'buyer@example.invalid');
  assert.equal(db.prepare('SELECT voucher_code FROM order_fulfillment_details WHERE order_id=?').get(id)!.voucher_code,'PRIORITY');
  assert.doesNotMatch(JSON.stringify(db.prepare('SELECT * FROM order_redemptions').get()), /mock-token|accessToken/);
  await assert.rejects(repo.submit(order, 'stale-confirmation'), { code: 'REDEMPTION_EXPIRED' });
  const submitted = await repo.submit(order, preview.account!.confirmationId);
  assert.equal(submitted.submitted, true);
  assert.equal(submitted.account, null);
  assert.equal(submitted.rechargeEmail, 'buyer@example.invalid');
  assert.equal(db.prepare('SELECT account FROM order_redemptions WHERE order_id=?').get(id)!.account,null);
  assert.equal(db.prepare('SELECT recharge_email FROM order_fulfillment_details WHERE order_id=?').get(id)!.recharge_email,'buyer@example.invalid');
  await repo.submit(order, preview.account!.confirmationId);
  assert.equal(methods.filter(path => path.endsWith('/submit')).length, 1);
  assert.equal((await repo.refresh(order)).result?.settlement, 'PAID');
  // Reloading the result must retain the recharge account after the session is cleared.
  const reloaded = redemptionRepository(db, upstream).view(order);
  assert.equal(reloaded.account, null);
  assert.equal(reloaded.rechargeEmail, 'buyer@example.invalid');
  assert.doesNotMatch(JSON.stringify(repo.view(order)), /mock-token|PRIORITY|private-redemption-token/);
}

test('paid production orders redeem production vouchers and reconcile without resubmitting', t => checkRedemption(t, 'production'));
test('paid sandbox orders redeem sandbox vouchers and reconcile without resubmitting', t => checkRedemption(t, 'sandbox'));

function failureFixture(t: TestContext, sessionResponse: typeof fetch) {
  const db = openDatabase(':memory:'); t.after(() => db.close());
  const original = process.env.LOVECODEX_ENABLED; process.env.LOVECODEX_ENABLED = 'true';
  t.after(() => { if (original === undefined) delete process.env.LOVECODEX_ENABLED; else process.env.LOVECODEX_ENABLED = original; });
  db.prepare("INSERT INTO orders(id,owner_hash,email,snapshot,status,created_at,expires_at,idempotency_key,fingerprint,environment) VALUES ('failure-order','','','{}','paid','','','failure','failure','sandbox')").run();
  db.prepare("INSERT INTO voucher_inventory(product_id,environment,code,priority) VALUES ('chatgpt-plus','sandbox','PRIVATE-FAILURE-CARD',0)").run();
  const order = {id:'failure-order',productId:'chatgpt-plus',status:'paid',environment:'sandbox'} as Order;
  const expires = new Date(Date.now()+600000).toISOString();
  const session = {user:{email:'mock@example.invalid'},accessToken:'private-session-token',expires};
  const input = {sessionInput:JSON.stringify(session),consent:true,termsVersion:'1',privacyVersion:'2'};
  let calls = 0, prepares = 0;
  const repo = redemptionRepository(db,async(url,options)=>{
    calls++;
    if(String(url).endsWith('/bootstrap')) return Response.json({ok:true,policyVersions:{terms:'1',privacy:'2'}});
    if(String(url).endsWith('/prepare')) {prepares++;return Response.json({ok:true,redemptionId:'failure-session',redemptionToken:'private-redemption-token',product:{id:'chatgpt-plus'},expiresAt:expires});}
    return sessionResponse(url,options);
  });
  return {db,repo,order,input,session,counts:()=>({calls,prepares})};
}

test('local Session validation identifies expiry and missing fields without contacting the recharge service', async t => {
  const f=failureFixture(t,async()=>{throw Error('must not contact service');});
  const cases: [unknown,string][] = [
    ['{invalid','SESSION_INVALID_JSON'], [JSON.stringify({}),'SESSION_MISSING_TOKEN'],
    [JSON.stringify({...f.session,user:{}}),'SESSION_INVALID_ACCOUNT'],
    [JSON.stringify({...f.session,expires:'not-a-date'}),'SESSION_INVALID_EXPIRY'],
    [JSON.stringify({...f.session,expires:'2020-01-01T00:00:00Z'}),'SESSION_EXPIRED'],
    ['x'.repeat(512001),'SESSION_TOO_LARGE'],
  ];
  for(const [sessionInput,code] of cases) await assert.rejects(f.repo.preview(f.order,{...f.input,sessionInput}),{code});
  assert.equal(f.counts().calls,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM order_redemptions').get()!.n,0);
});

for (const [name, response, expected] of [
  ['expired Session',async()=>Response.json({ok:false,error:'SESSION_EXPIRED',detail:'expired'},{status:400}),'SESSION_EXPIRED'],
  ['invalid Session',async()=>Response.json({ok:false,code:'SESSION_INVALID'},{status:422}),'SESSION_INVALID'],
  ['precheck expiry',async()=>Response.json({ok:false,error:'REDEMPTION_EXPIRED'},{status:410}),'REDEMPTION_EXPIRED'],
  ['business detail',async()=>Response.json({ok:false,error:'PORTAL_PRECHECK_FAILED',detail:'当前账号订阅状态暂不支持此套餐。'},{status:409}),'PORTAL_PRECHECK_FAILED'],
  ['expiry in precheck detail',async()=>Response.json({ok:false,error:'PORTAL_PRECHECK_FAILED',detail:'ChatGPT Session 已过期。'},{status:409}),'SESSION_EXPIRED'],
  ['ambiguous precheck',async()=>Response.json({ok:false,error:'PORTAL_PRECHECK_FAILED',detail:'Session invalid or expired'},{status:409}),'PORTAL_PRECHECK_FAILED'],
  ['network failure',async()=>{throw new TypeError('private-session-token');},'REDEMPTION_CONNECTION_FAILED'],
  ['timeout',async()=>{throw new DOMException('upstream timed out','TimeoutError');},'REDEMPTION_TIMEOUT'],
  ['invalid response',async()=>new Response('<html>private-redemption-token</html>',{status:502}),'REDEMPTION_INVALID_RESPONSE'],
  ['rate limit',async()=>new Response('',{status:429}),'REDEMPTION_RATE_LIMITED'],
  ['service outage',async()=>Response.json({ok:false},{status:503}),'REDEMPTION_UNAVAILABLE'],
  ['unrecognized error',async()=>Response.json({ok:false,error:'FUTURE_ERROR',detail:'账号资格暂不支持，请联系客服。'},{status:400}),'REDEMPTION_REJECTED'],
  ['sensitive explanation',async()=>Response.json({ok:false,error:'FUTURE_ERROR',detail:'private-session-token PRIVATE-FAILURE-CARD private-redemption-token'},{status:400}),'REDEMPTION_REJECTED'],
  ['voucher in explanation',async()=>Response.json({ok:false,error:'FUTURE_ERROR',detail:'卡密 PRIVATE-FAILURE-CARD 暂不可用。'},{status:400}),'REDEMPTION_REJECTED'],
] as const) {
  test(`upstream ${name} is explained without leaking Session or credentials`,async t=>{
    const f=failureFixture(t,response);
    await assert.rejects(f.repo.preview(f.order,f.input),error=>{
      const value=error as Error & {code:string}; assert.equal(value.code,expected);
      assert.doesNotMatch(value.message,/private-session-token|PRIVATE-FAILURE-CARD|private-redemption-token|<html>/);
      if(name==='business detail')assert.match(value.message,/当前账号订阅状态暂不支持/);
      if(name==='unrecognized error')assert.match(value.message,/账号资格暂不支持/);
      return true;
    });
    const stored=f.db.prepare('SELECT account,submitted,preview_until,prepared FROM order_redemptions WHERE order_id=?').get(f.order.id)!;
    assert.equal(stored.account,null);assert.equal(stored.submitted,0);assert.equal(stored.preview_until,0);
    assert.doesNotMatch(JSON.stringify(stored),/private-session-token/);
    if(expected==='REDEMPTION_EXPIRED') {
      assert.equal(stored.prepared,null);
      await assert.rejects(f.repo.preview(f.order,f.input));assert.equal(f.counts().prepares,2);
    }
  });
}
