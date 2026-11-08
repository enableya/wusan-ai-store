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
