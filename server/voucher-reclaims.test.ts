import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './database.ts';
import { createAlipayGateway } from './alipay.ts';
import { redemptionRepository } from './redemptions.ts';
import { orderRepository } from './orders.ts';
import { adminOrderRepository } from './admin-orders.ts';
import { voucherInventory } from './vouchers.ts';
import type { Order } from '../src/types/orders.ts';

function fixture(t: TestContext, inspect?: typeof fetch) {
  const db = openDatabase(':memory:');t.after(()=>db.close());
  const previous = process.env.LOVECODEX_ENABLED;process.env.LOVECODEX_ENABLED='true';
  t.after(()=>{if(previous===undefined)delete process.env.LOVECODEX_ENABLED;else process.env.LOVECODEX_ENABLED=previous;});
  const id='WS1234567890abcdef1234567890abcdef', code='MOCK-RECLAIM-VOUCHER';
  const now=new Date().toISOString(), expiry=new Date(Date.now()+600000).toISOString();
  db.prepare(`INSERT INTO orders(id,owner_hash,email,snapshot,status,created_at,expires_at,idempotency_key,fingerprint,environment)
    VALUES (?,'owner','',?,'paid',?,?,'reclaim-key','fixture','sandbox')`).run(id,JSON.stringify({productId:'chatgpt-plus',productName:'ChatGPT Plus',staffCheckout:true,priceCents:0}),now,expiry);
  const card=db.prepare("INSERT INTO voucher_inventory(product_id,environment,code,priority) VALUES ('chatgpt-plus','sandbox',?,1)").run(code);
  const account={email:'reclaim@example.invalid',confirmationId:'confirmed-account',validation:'confirmed',plan:'free'};
  db.prepare(`INSERT INTO order_redemptions(order_id,voucher_id,submit_key,account,prepared)
    VALUES (?,?,'original-submit-key',?,?)`).run(id,card.lastInsertRowid,JSON.stringify(account),JSON.stringify({id:'prepared-id',token:'private-token',expiresAt:expiry,policy:{terms:'1',privacy:'2'}}));
  db.prepare('INSERT INTO order_fulfillment_details(order_id,voucher_id,voucher_code,recharge_email) VALUES (?,?,?,?)').run(id,card.lastInsertRowid,code,account.email);
  const calls:string[]=[];
  const fetcher:typeof fetch=async(url,options)=>{
    calls.push(String(url));
    if(String(url).endsWith('/bootstrap'))return Response.json({ok:true,policyVersions:{terms:'1',privacy:'2'}});
    assert.ok(String(url).endsWith('/by-voucher'));
    assert.deepEqual(JSON.parse(String(options?.body)),{voucherCode:code});
    return inspect ? inspect(url,options) : Response.json({ok:true,voucher:{state:'AVAILABLE',product:{id:'chatgpt-plus'}},order:null});
  };
  const order={id,productId:'chatgpt-plus',status:'paid',staffCheckout:true,priceCents:0,environment:'sandbox'} as Order;
  const sessionInput=JSON.stringify({user:{email:account.email},accessToken:'mock-session',expires:expiry});
  return {db,order,code,card,account,calls,fetcher,repo:redemptionRepository(db,fetcher),input:{sessionInput,consent:true,termsVersion:'1',privacyVersion:'2'}};
}

test('reclaim returns an unused staff card to the same inventory and atomically cancels its order with a durable audit',async t=>{
  const f=fixture(t), inventory=voucherInventory(f.db,'sandbox');
  assert.equal(inventory.listCards('chatgpt-plus',0).cards.length,0);
  await f.repo.reclaim(f.order,'admin',f.code);
  const cards=inventory.listCards('chatgpt-plus',0).cards;
  assert.equal(cards.length,1);assert.equal(cards[0].id,Number(f.card.lastInsertRowid));assert.equal(cards[0].priority,1);
  const history=f.db.prepare('SELECT * FROM order_fulfillment_details WHERE order_id=?').get(f.order.id)!;
  assert.equal(history.voucher_code,f.code);assert.equal(history.recharge_email,f.account.email);assert.equal(history.reclaimed_by,'admin');assert.ok(history.reclaimed_at);
  assert.equal(f.db.prepare('SELECT count(*) n FROM order_redemptions').get()!.n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM payment_refunds').get()!.n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM order_refund_reviews').get()!.n,0);
  const customer=orderRepository(f.db,createAlipayGateway({ALIPAY_ENV:'sandbox'})).owned(f.order.id,'owner');
  assert.equal(customer.status,'cancelled');assert.equal(customer.cancellation?.voucherReclaimed,true);assert.equal(customer.cancelAction,null);
  const admin=adminOrderRepository(f.db,'sandbox').list(new URLSearchParams({status:'cancelled'}),true,false,'orders',true);
  assert.equal(admin.total,1);assert.equal(admin.counts.cancelled,1);assert.equal(admin.orders[0].canReclaimVoucher,false);assert.equal(admin.orders[0].voucherCode,f.code);
  await redemptionRepository(f.db,f.fetcher).reclaim(customer,'different-admin',f.code);
  assert.equal(f.calls.length,1);assert.equal(f.db.prepare('SELECT reclaimed_by FROM order_fulfillment_details').get()!.reclaimed_by,'admin');
  await assert.rejects(f.repo.preview(f.order,f.input),{code:'VOUCHER_ALREADY_RECLAIMED'});
  await assert.rejects(f.repo.submit(f.order,f.account.confirmationId,f.input.sessionInput),{code:'VOUCHER_ALREADY_RECLAIMED'});
});

test('unused Pro 5x cards with provider route IDs return to inventory without reimporting',async t=>{
  for(const submitted of [false,true]) for(const productId of ['maiofa-gpt-5','chatgpt-pro-5x-new',undefined]) {
    const f=fixture(t,async()=>Response.json({ok:true,voucher:{state:'AVAILABLE',product:{id:productId}},
      order:submitted?{orderNo:'CURRENT',orderState:'NO_CHARGE',settlement:{state:'NO_CHARGE'}}:null}));
    f.db.prepare("UPDATE orders SET snapshot=json_set(snapshot,'$.productId','chatgpt-pro-5x')").run();
    f.db.prepare("UPDATE voucher_inventory SET product_id='chatgpt-pro-5x'").run();
    if(submitted)f.db.prepare("UPDATE order_redemptions SET submitted=1,submitted_order_no='CURRENT'").run();
    const order={...f.order,productId:'chatgpt-pro-5x'};
    const inventory=voucherInventory(f.db,'sandbox');
    assert.equal(inventory.listCards(order.productId,0).cards.length,0);
    await f.repo.reclaim(order,'admin',f.code);
    const cards=inventory.listCards(order.productId,0).cards;
    assert.equal(cards.length,1);assert.equal(cards[0].id,Number(f.card.lastInsertRowid));
    assert.equal(f.db.prepare('SELECT count(*) n FROM voucher_inventory').get()!.n,1);
    await assert.rejects(f.repo.submit(order,f.account.confirmationId),{code:'VOUCHER_ALREADY_RECLAIMED'});
  }
});

test('local product and environment mismatches cannot reclaim even if upstream says available',async t=>{
  for(const change of ["UPDATE voucher_inventory SET product_id='chatgpt-pro-5x'", "UPDATE voucher_inventory SET environment='production'"]) {
    const f=fixture(t);f.db.exec(change);
    await assert.rejects(f.repo.reclaim(f.order,'admin',f.code),{code:'VOUCHER_CANNOT_RECLAIM'});
    assert.equal(f.calls.length,0);
  }
});

test('reimporting a reserved failed card explains the reservation and never duplicates or releases it',async t=>{
  const f=fixture(t),inventory=voucherInventory(f.db,'sandbox');
  const input={productId:'chatgpt-plus',lines:f.code,priority:false,skipDuplicates:false};
  assert.throws(()=>inventory.importBatch(input),{code:'DUPLICATE_VOUCHER',message:/订单占用.*回收/});
  assert.deepEqual(inventory.importBatch({...input,skipDuplicates:true}),{added:0,skipped:1,reserved:1});
  assert.equal(f.db.prepare('SELECT count(*) n FROM order_redemptions').get()!.n,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM voucher_inventory').get()!.n,1);
  await f.repo.reclaim(f.order,'admin',f.code);
  assert.equal(inventory.listCards(input.productId,0).cards.length,1);
  assert.deepEqual(inventory.importBatch({...input,skipDuplicates:true}),{added:0,skipped:1});
});

test('submitted staff cards reclaim only a matching terminal order explicitly confirmed not charged',async t=>{
  const f=fixture(t,async()=>Response.json({ok:true,voucher:{state:'AVAILABLE',product:{id:'chatgpt-plus'}},order:{orderNo:'CURRENT',orderState:'CANCELED',settlement:{state:'NO_CHARGE'}}}));
  f.db.prepare("UPDATE order_redemptions SET submitted=1,submitted_order_no='CURRENT'").run();
  await f.repo.reclaim(f.order,'admin',f.code);
  assert.equal(f.db.prepare('SELECT count(*) n FROM order_redemptions').get()!.n,0);
});

test('used, processing, successful and ambiguous provider responses never release a voucher',async t=>{
  const variants=[
    {voucher:{state:'CONSUMED',product:{id:'chatgpt-plus'}},order:null},
    ...[
      {orderState:'QUEUED'}, {orderState:'FULFILLING'}, {orderState:'FULFILLED'},
      {orderState:'CANCELED',settlement:{state:'UNKNOWN'}}, {orderState:'CANCELED',settlement:{state:'PAID'}},
      {orderState:'CANCELED',settlement:{state:'NO_CHARGE'},renewalSetup:{state:'ready'}},
      {orderState:'CANCELED',settlement:{state:'NO_CHARGE'},renewalSetup:{state:'paid'}},
    ].map(order=>({voucher:{state:'AVAILABLE',product:{id:'chatgpt-plus'}},order})),
    {},
  ];
  for(const response of variants) {
    const f=fixture(t,async()=>Response.json({ok:true,...response}));
    await assert.rejects(f.repo.reclaim(f.order,'admin',f.code),{code:'VOUCHER_NOT_UNUSED'});
    assert.equal(f.db.prepare('SELECT preview_until FROM order_redemptions').get()!.preview_until,0);
    assert.equal(f.db.prepare('SELECT status FROM orders').get()!.status,'paid');
    assert.equal(f.db.prepare('SELECT reclaimed_at FROM order_fulfillment_details').get()!.reclaimed_at,null);
  }
  for(const upstreamOrder of [null,{orderNo:'OLDER',orderState:'CANCELED',settlement:{state:'NO_CHARGE'}}]) {
    const f=fixture(t,async()=>Response.json({ok:true,voucher:{state:'AVAILABLE',product:{id:'chatgpt-plus'}},order:upstreamOrder}));
    f.db.prepare("UPDATE order_redemptions SET submitted=1,submitted_order_no='CURRENT'").run();
    await assert.rejects(f.repo.reclaim(f.order,'admin',f.code),{code:'VOUCHER_NOT_UNUSED'});
  }
});

test('paid coupons, ordinary orders, finished memberships, active leases, changed references and other environments cannot reclaim',async t=>{
  const changes=[
    "UPDATE orders SET snapshot=json_set(snapshot,'$.staffCheckout',0)",
    "UPDATE orders SET snapshot=json_set(snapshot,'$.priceCents',1)",
    "UPDATE orders SET status='closed'",
    "UPDATE orders SET environment='production'",
    "UPDATE order_redemptions SET result='{\"settlement\":\"PAID\"}'",
    "UPDATE order_redemptions SET result='{\"state\":\"FULFILLED\"}'",
    "UPDATE order_redemptions SET result='{\"renewal\":\"ready\"}'",
    "UPDATE order_redemptions SET preview_until=9999999999999",
    `INSERT INTO staff_redemption_previews(order_id,account,session_hash,policy,expires_at,lease_until)
      SELECT id,'{}','hash','{}','2099-01-01T00:00:00Z',9999999999999 FROM orders`,
  ];
  for(const change of changes) {
    const f=fixture(t);f.db.exec(change);
    await assert.rejects(f.repo.reclaim(f.order,'admin',f.code),{code:'VOUCHER_CANNOT_RECLAIM'});
    assert.equal(f.calls.length,0);assert.equal(f.db.prepare('SELECT reclaimed_at FROM order_fulfillment_details').get()!.reclaimed_at,null);
  }
  const f=fixture(t);
  await assert.rejects(f.repo.reclaim(f.order,'admin','stale-card'),{code:'VOUCHER_REFERENCE_CHANGED'});
  process.env.LOVECODEX_ENABLED='false';
  await assert.rejects(f.repo.reclaim(f.order,'admin',f.code),{code:'REDEMPTION_DISABLED'});
});

test('reclaim leases exclude concurrent submissions, previews and reclaim workers across repository instances',async t=>{
  let release!:()=>void,entered!:()=>void;
  const wait=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
  const f=fixture(t,async()=>{entered();await wait;return Response.json({ok:true,voucher:{state:'AVAILABLE',product:{id:'chatgpt-plus'}},order:null});});
  const other=redemptionRepository(f.db,f.fetcher);
  const working=f.repo.reclaim(f.order,'admin',f.code);
  await started;
  try {
    await assert.rejects(other.preview(f.order,f.input),{code:'REDEMPTION_BUSY'});
    await assert.rejects(other.submit(f.order,f.account.confirmationId,f.input.sessionInput),{code:'REDEMPTION_BUSY'});
    await assert.rejects(other.reclaim(f.order,'admin',f.code),{code:'VOUCHER_CANNOT_RECLAIM'});
  } finally {release();}
  await working;
  assert.equal(f.calls.filter(url=>url.endsWith('/by-voucher')).length,1);
});

test('connection failure, lost authorization and a late success keep the voucher and original order',async t=>{
  for(const variant of ['connection','authorization','late-success','lease-lost']) {
    let checks=0;
    const f=fixture(t,async()=>{
      if(variant==='connection')throw Error('network failure');
      if(variant==='late-success')f.db.prepare("UPDATE order_redemptions SET result='{\"settlement\":\"PAID\"}'").run();
      if(variant==='lease-lost')f.db.prepare('UPDATE order_redemptions SET preview_until=0').run();
      return Response.json({ok:true,voucher:{state:'AVAILABLE',product:{id:'chatgpt-plus'}},order:null});
    });
    await assert.rejects(f.repo.reclaim(f.order,'admin',f.code,()=>{if(++checks===2&&variant==='authorization')throw Error('permission revoked');}));
    assert.equal(f.db.prepare('SELECT status FROM orders').get()!.status,'paid');
    assert.equal(f.db.prepare('SELECT count(*) n FROM order_redemptions').get()!.n,1);
    assert.equal(f.db.prepare('SELECT preview_until FROM order_redemptions').get()!.preview_until,0);
    assert.equal(f.db.prepare('SELECT reclaimed_at FROM order_fulfillment_details').get()!.reclaimed_at,null);
  }
});

test('schema 21 migrates without changing existing fulfillment records and reclaim audit survives reopening',t=>{
  const directory=mkdtempSync(join(tmpdir(),'wusan-reclaim-migrate-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const path=join(directory,'store.sqlite');let db=openDatabase(path);
  db.exec(`INSERT INTO orders(id,owner_hash,email,snapshot,status,created_at,expires_at,idempotency_key,fingerprint,environment)
    VALUES ('migration-order','owner','','{}','paid','','','migration','fixture','sandbox');
    INSERT INTO order_fulfillment_details(order_id,voucher_code,recharge_email) VALUES ('migration-order','HISTORICAL-CARD','historical@example.invalid');`);
  db.exec("ALTER TABLE order_fulfillment_details DROP COLUMN reclaimed_at; ALTER TABLE order_fulfillment_details DROP COLUMN reclaimed_by; PRAGMA user_version=21;");
  db.close();db=openDatabase(path);
  assert.equal(db.prepare('PRAGMA user_version').get()!.user_version,31);
  const history=db.prepare('SELECT * FROM order_fulfillment_details').get()!;
  assert.equal(history.voucher_code,'HISTORICAL-CARD');assert.equal(history.recharge_email,'historical@example.invalid');assert.equal(history.reclaimed_at,null);
  db.prepare("UPDATE order_fulfillment_details SET reclaimed_at='2026-11-11T00:00:00Z',reclaimed_by='historical-admin'").run();
  db.close();db=openDatabase(path);
  assert.equal(db.prepare('SELECT reclaimed_by FROM order_fulfillment_details').get()!.reclaimed_by,'historical-admin');
  assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);db.close();
});
