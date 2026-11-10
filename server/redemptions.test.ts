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

function staffFixture(t: TestContext, overrides: { session?: typeof fetch; submit?: typeof fetch; environment?: Order['environment'] } = {}) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const original = process.env.LOVECODEX_ENABLED;
  process.env.LOVECODEX_ENABLED = 'true';
  t.after(() => {
    if (original === undefined) delete process.env.LOVECODEX_ENABLED;
    else process.env.LOVECODEX_ENABLED = original;
  });
  const environment = overrides.environment ?? 'sandbox';
  db.prepare(`INSERT INTO orders(id,owner_hash,email,snapshot,status,created_at,expires_at,idempotency_key,fingerprint,environment)
    VALUES ('staff-order','','','{"staffCheckout":true}','paid','','','staff','staff',?)`).run(environment);
  const order = { id: 'staff-order', productId: 'chatgpt-plus', environment, status: 'paid', staffCheckout: true } as Order;
  const expires = new Date(Date.now() + 600000).toISOString();
  const session = { user: { email: 'staff@example.invalid' }, accessToken: 'private-staff-session-token', expires };
  const input = { sessionInput: JSON.stringify(session), consent: true, termsVersion: '1', privacyVersion: '2' };
  const calls: string[] = [], cards: string[] = [];
  const policy = { terms: '1', privacy: '2' };
  const fetcher: typeof fetch = async (url, options) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    const success = (data: Record<string, unknown>) => Response.json({ ok: true, ...data });
    if (path.endsWith('/bootstrap')) return success({ policyVersions: policy });
    if (path.endsWith('/prepare')) {
      cards.push(JSON.parse(String(options?.body)).voucherCode);
      return success({ redemptionId: 'staff-redemption', redemptionToken: 'private-staff-redemption-token', product: { id: order.productId }, expiresAt: expires });
    }
    if (path.endsWith('/session')) {
      if (overrides.session) return overrides.session(url, options);
      return success({ redemption: { state: 'SESSION_READY', session: { accountDisplay: session.user.email, validation: 'confirmed' } } });
    }
    assert.ok(path.endsWith('/submit'));
    assert.ok(new Headers(options?.headers).get('Idempotency-Key'));
    if (overrides.submit) return overrides.submit(url, options);
    return success({ order: { orderNo: 'STAFF-R1', orderState: 'QUEUED' } });
  };
  const addCard = (code: string, priority = 0, productId = order.productId, env = environment) => {
    db.prepare('INSERT INTO voucher_inventory(product_id,environment,code,priority) VALUES (?,?,?,?)').run(productId, env, code, priority);
  };
  return { db, order, input, session, calls, cards, policy, addCard, fetcher, repo: redemptionRepository(db, fetcher) };
}

for (const environment of ['sandbox', 'production'] as const) {
  test(`staff ${environment} preview leaves inventory untouched until final confirmation`, async t => {
    const f = staffFixture(t, { environment });
    f.addCard('OTHER-PRODUCT', 1, 'chatgpt-pro-5x');
    f.addCard('OTHER-ENV', 1, f.order.productId, environment === 'sandbox' ? 'production' : 'sandbox');
    const first = await f.repo.preview(f.order, f.input);
    assert.equal(first.account?.email, f.session.user.email);
    assert.equal(first.account?.validation, 'identified');
    assert.equal(first.requiresSession, true);
    assert.equal(f.db.prepare('SELECT count(*) n FROM order_redemptions').get()!.n, 0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM order_fulfillment_details').get()!.n, 0);
    assert.ok(f.calls.every(path => path.endsWith('/bootstrap')));
    const reloaded = redemptionRepository(f.db, f.fetcher);
    assert.equal(reloaded.view(f.order).account?.confirmationId, first.account?.confirmationId);
    await assert.rejects(reloaded.submit(f.order, first.account!.confirmationId, f.input.sessionInput), { code: 'VOUCHER_UNAVAILABLE' });
    f.addCard('NORMAL');
    // Stock and priorities are evaluated at confirmation time, not preview time.
    f.addCard('LATE-PRIORITY', 1);
    const next = await reloaded.submit(f.order, first.account!.confirmationId, f.input.sessionInput);
    assert.equal(next.submitted, true);
    assert.equal(next.account, null);
    assert.equal(next.rechargeEmail, f.session.user.email);
    assert.deepEqual(f.cards, ['LATE-PRIORITY']);
    assert.equal(f.db.prepare('SELECT voucher_code FROM order_fulfillment_details').get()!.voucher_code, 'LATE-PRIORITY');
    await f.repo.submit(f.order, first.account!.confirmationId);
    assert.equal(f.calls.filter(path => path.endsWith('/submit')).length, 1);
    assert.equal(f.db.prepare('SELECT count(*) n FROM staff_redemption_previews').get()!.n, 0);
    assert.doesNotMatch(JSON.stringify(next), /private-staff|LATE-PRIORITY/);
  });
}

test('staff confirmations are bound to the exact Session and expire without allocating a voucher', async t => {
  const f = staffFixture(t);
  f.addCard('UNUSED');
  const first = await f.repo.preview(f.order, f.input);
  const next = await f.repo.preview(f.order, f.input);
  await assert.rejects(f.repo.submit(f.order, first.account!.confirmationId, f.input.sessionInput), { code: 'REDEMPTION_EXPIRED' });
  const altered = JSON.stringify({ ...f.session, accessToken: 'changed-token' });
  await assert.rejects(f.repo.submit(f.order, next.account!.confirmationId, altered), { code: 'REDEMPTION_EXPIRED' });
  await assert.rejects(f.repo.submit(f.order, next.account!.confirmationId), { code: 'SESSION_INVALID_JSON' });
  assert.doesNotMatch(JSON.stringify(f.db.prepare('SELECT * FROM staff_redemption_previews').all()), /private-staff-session-token|accessToken/);
  f.db.prepare("UPDATE staff_redemption_previews SET expires_at='2020-01-01T00:00:00.000Z'").run();
  assert.equal(f.repo.view(f.order).account, null);
  await assert.rejects(f.repo.submit(f.order, next.account!.confirmationId, f.input.sessionInput), { code: 'REDEMPTION_EXPIRED' });
  assert.equal(f.db.prepare('SELECT count(*) n FROM order_redemptions').get()!.n, 0);
  assert.deepEqual(f.cards, []);
});

test('staff confirmation rechecks policy before allocating a voucher', async t => {
  const f = staffFixture(t);
  f.addCard('UNUSED');
  const preview = await f.repo.preview(f.order, f.input);
  f.policy.terms = 'new-policy';
  await assert.rejects(f.repo.submit(f.order, preview.account!.confirmationId, f.input.sessionInput), { code: 'REDEMPTION_POLICY' });
  assert.equal(f.db.prepare('SELECT count(*) n FROM order_redemptions').get()!.n, 0);
  assert.equal(f.db.prepare('SELECT lease_until FROM staff_redemption_previews').get()!.lease_until, 0);
});

test('staff final confirmation serializes previews and submissions across repository instances', async t => {
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const f = staffFixture(t, { session: async () => {
    entered();
    await waiting;
    return Response.json({ ok: true, redemption: { state: 'SESSION_READY', session: { accountDisplay: 'staff@example.invalid' } } });
  } });
  f.addCard('ONLY-ONE');
  f.addCard('SPARE');
  const preview = await f.repo.preview(f.order, f.input);
  const second = redemptionRepository(f.db, f.fetcher);
  const submitting = f.repo.submit(f.order, preview.account!.confirmationId, f.input.sessionInput);
  try {
    await started;
    await assert.rejects(second.submit(f.order, preview.account!.confirmationId, f.input.sessionInput), { code: 'REDEMPTION_BUSY' });
    await assert.rejects(second.preview(f.order, f.input), { code: 'REDEMPTION_BUSY' });
  } finally { release(); }
  assert.equal((await submitting).submitted, true);
  assert.deepEqual(f.cards, ['ONLY-ONE']);
  assert.equal(f.calls.filter(path => path.endsWith('/submit')).length, 1);
});

test('staff upstream validation failure never submits and retry reuses its reserved voucher', async t => {
  let attempts = 0;
  const f = staffFixture(t, { session: async () => ++attempts === 1
    ? Response.json({ ok: false, error: 'SESSION_EXPIRED' }, { status: 400 })
    : Response.json({ ok: true, redemption: { state: 'SESSION_READY', session: { accountDisplay: 'staff@example.invalid' } } }) });
  f.addCard('RETRY-CARD');
  f.addCard('SPARE');
  const preview = await f.repo.preview(f.order, f.input);
  await assert.rejects(f.repo.submit(f.order, preview.account!.confirmationId, f.input.sessionInput), { code: 'SESSION_EXPIRED' });
  assert.equal(f.repo.view(f.order).submitted, false);
  assert.equal(f.calls.filter(path => path.endsWith('/submit')).length, 0);
  const identified = await f.repo.preview(f.order, f.input);
  assert.equal(f.calls.filter(path => path.endsWith('/session')).length, 1);
  assert.equal((await f.repo.submit(f.order, identified.account!.confirmationId, f.input.sessionInput)).submitted, true);
  assert.deepEqual(f.cards, ['RETRY-CARD']);
  assert.equal(f.db.prepare('SELECT count(*) n FROM order_redemptions').get()!.n, 1);
});

test('staff upstream account mismatch cannot recharge an unconfirmed email', async t => {
  const f = staffFixture(t, { session: async () => Response.json({
    ok: true, redemption: { state: 'SESSION_READY', session: { accountDisplay: 'different@example.invalid' } },
  }) });
  f.addCard('MISMATCH-CARD');
  const preview = await f.repo.preview(f.order, f.input);
  await assert.rejects(f.repo.submit(f.order, preview.account!.confirmationId, f.input.sessionInput), { code: 'REDEMPTION_ACCOUNT_CHANGED' });
  assert.equal(f.repo.view(f.order).submitted, false);
  assert.equal(f.calls.filter(path => path.endsWith('/submit')).length, 0);
});

test('staff ambiguous submission stays submitted and never sends another recharge', async t => {
  const f = staffFixture(t, { submit: async () => { throw new Error('ambiguous response'); } });
  f.addCard('AMBIGUOUS-CARD');
  const preview = await f.repo.preview(f.order, f.input);
  assert.equal((await f.repo.submit(f.order, preview.account!.confirmationId, f.input.sessionInput)).submitted, true);
  assert.equal((await redemptionRepository(f.db, f.fetcher).submit(f.order, preview.account!.confirmationId, f.input.sessionInput)).submitted, true);
  assert.equal(f.calls.filter(path => path.endsWith('/submit')).length, 1);
});

test('historical staff reservations keep their voucher when a new confirmation is requested', async t => {
  const f = staffFixture(t);
  f.addCard('HISTORICAL-CARD');
  const legacy = await f.repo.preview({ ...f.order, staffCheckout: undefined }, f.input);
  const historicalVoucher = f.db.prepare('SELECT voucher_id FROM order_redemptions').get()!.voucher_id;
  f.addCard('NEW-PRIORITY', 1);
  const deferred = await f.repo.preview(f.order, f.input);
  assert.equal(f.calls.filter(path => path.endsWith('/prepare')).length, 1);
  await assert.rejects(f.repo.submit(f.order, legacy.account!.confirmationId), { code: 'REDEMPTION_EXPIRED' });
  assert.equal((await f.repo.submit(f.order, deferred.account!.confirmationId, f.input.sessionInput)).submitted, true);
  assert.equal(f.db.prepare('SELECT voucher_id FROM order_redemptions').get()!.voucher_id, historicalVoucher);
  assert.deepEqual(f.cards, ['HISTORICAL-CARD']);
});

test('a historical staff confirmation can finish without resupplying the Session', async t => {
  const f = staffFixture(t);
  f.addCard('LEGACY-CARD');
  const legacy = await f.repo.preview({ ...f.order, staffCheckout: undefined }, f.input);
  assert.equal((await redemptionRepository(f.db, f.fetcher).submit(f.order, legacy.account!.confirmationId)).submitted, true);
  assert.equal(f.calls.filter(path => path.endsWith('/session')).length, 1);
  assert.equal(f.calls.filter(path => path.endsWith('/submit')).length, 1);
});

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
