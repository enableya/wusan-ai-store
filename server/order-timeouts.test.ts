import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './database.ts';
import { createAlipayGateway } from './alipay.ts';
import type { PaymentGateway } from './alipay.ts';
import { redemptionRepository } from './redemptions.ts';
import { orderTimeoutService } from './order-timeouts.ts';
import { orderRepository } from './orders.ts';
import { voucherInventory } from './vouchers.ts';
import { adminOrderRepository } from './admin-orders.ts';
import { refundRepository } from './refunds.ts';

function setup(t:TestContext) {
  const db=openDatabase(':memory:');t.after(()=>db.close());
  const paidAt=Date.now();let time=paidAt;let refundCalls=0,queryCalls=0,providerCalls=0;
  let refund:PaymentGateway['refund']=async (order,amount,key)=>({out_trade_no:order.id,out_request_no:key,refund_fee:amount,fund_change:'Y'});
  let refundQuery:PaymentGateway['refundQuery']=async(order,key)=>({out_trade_no:order.id,out_request_no:key,refund_status:'REFUND_SUCCESS'});
  let upstream:Record<string,unknown>={voucher:{state:'AVAILABLE',product:{id:'chatgpt-plus'}},order:null};
  const gateway:PaymentGateway={...createAlipayGateway({}),appId:'timeout-app',sellerId:'timeout-seller',status:{enabled:true,environment:'sandbox',message:''},
    refund:async(...args)=>{refundCalls++;return refund(...args);},refundQuery:async(...args)=>{queryCalls++;return refundQuery(...args);}};
  const redemptions=redemptionRepository(db,async()=>{providerCalls++;return Response.json({ok:true,...upstream});});
  const service=orderTimeoutService(db,gateway,redemptions,()=>time);
  const add=(environment='sandbox',staff=false)=>{
    const id='WS'+randomUUID().replaceAll('-','');const at=new Date(paidAt).toISOString();
    const snapshot={productId:'chatgpt-plus',productName:'ChatGPT Plus',priceCents:staff?0:13000,periodMonths:1,details:{},payment:{appId:gateway.appId,sellerId:gateway.sellerId},...(staff?{staffCheckout:true}:{})};
    db.prepare(`INSERT INTO orders(id,owner_hash,email,snapshot,status,created_at,expires_at,paid_at,trade_no,idempotency_key,fingerprint,environment)
      VALUES (?,'owner','',?,'paid',?,?,?,?,?,'fixture',?)`).run(id,JSON.stringify(snapshot),at,at,at,'trade-'+id,id,environment);
    return id;
  };
  const reserve=(id:string,submitted=false,result:Record<string,unknown>|null=null)=>{
    const v=db.prepare("INSERT INTO voucher_inventory(product_id,environment,code,priority) VALUES ('chatgpt-plus','sandbox',?,1)").run('CARD-'+id);
    db.prepare('INSERT INTO order_redemptions(order_id,voucher_id,submit_key,submitted,result) VALUES (?,?,?,?,?)').run(id,v.lastInsertRowid,randomUUID(),Number(submitted),result?JSON.stringify(result):null);
    if (submitted && result?.orderNo) db.prepare('UPDATE order_redemptions SET submitted_order_no=? WHERE order_id=?').run(String(result.orderNo),id);
    return Number(v.lastInsertRowid);
  };
  return {db,gateway,redemptions,service,add,reserve,paidAt,orders:orderRepository(db,gateway),inventory:voucherInventory(db,'sandbox'),
    counts:()=>({refundCalls,queryCalls,providerCalls}),advance:(ms:number)=>{time=paidAt+ms;},
    setUpstream:(data:Record<string,unknown>)=>{upstream=data;},setRefund:(next:typeof refund)=>{refund=next;},setQuery:(next:typeof refundQuery)=>{refundQuery=next;}};
}

test('paid orders cancel at 30 minutes but do not refund until a persisted admin approval',async t=>{
  const f=setup(t);const id=f.add();
  f.advance(30*60000-1);await f.service.run();assert.equal(f.counts().refundCalls,0);
  f.advance(30*60000);await f.service.run();
  const waiting=f.orders.owned(id,'owner');assert.equal(waiting.status,'cancelled');assert.equal(waiting.cancellation?.state,'refund_review');
  assert.equal(f.counts().refundCalls,0);
  await assert.rejects(refundRepository(f.db,f.gateway).request(id,'bypass-attempt','130.00','bypass review'),{code:'REFUND_APPROVAL_REQUIRED'});
  f.advance(40*60000);await f.service.run();assert.equal(f.counts().refundCalls,0);
  await f.service.review(id,true,'reviewer','核实未充值');
  const order=f.orders.owned(id,'owner');assert.equal(order.status,'cancelled');assert.equal(order.cancellation?.state,'cancelled');
  assert.equal(f.counts().refundCalls,1);assert.equal(f.counts().providerCalls,0);
  assert.equal(f.db.prepare('SELECT status FROM orders WHERE id=?').get(id)!.status,'paid');
  await f.service.run();assert.equal(f.counts().refundCalls,1);
  const report=adminOrderRepository(f.db,'sandbox').list(new URLSearchParams('status=cancelled'));
  assert.equal(report.total,1);assert.equal(report.counts.cancelled,1);assert.equal(report.orders[0].status,'cancelled');
});

test('a reusable unused voucher returns to inventory only after refund success and preserves product, environment and priority',async t=>{
  const f=setup(t);const id=f.add();const voucher=f.reserve(id);
  assert.equal(f.inventory.listCards('chatgpt-plus',0).cards.length,0);
  f.advance(31*60000);await f.service.run();
  assert.equal(f.inventory.listCards('chatgpt-plus',0).cards.length,0);
  await f.service.review(id,true,'reviewer','');
  assert.equal(f.orders.owned(id,'owner').status,'cancelled');
  assert.equal(f.db.prepare('SELECT 1 FROM order_redemptions WHERE order_id=?').get(id),undefined);
  const cards=f.inventory.listCards('chatgpt-plus',0).cards;assert.equal(cards.length,1);assert.equal(cards[0].id,voucher);assert.equal(cards[0].priority,1);
  assert.equal(adminOrderRepository(f.db,'sandbox').list(new URLSearchParams(),true).orders[0].voucherCode,cards[0].code);
  f.inventory.removeCard('chatgpt-plus',voucher,{createdAt:cards[0].createdAt});
  assert.equal(adminOrderRepository(f.db,'sandbox').list(new URLSearchParams(),true).orders[0].voucherCode,cards[0].code);
});

test('fulfilled memberships and ready renewals remain paid and never refund or release the voucher',async t=>{
  const f=setup(t);
  for(const result of [{state:'FULFILLED',settlement:'PAID'},{state:'FULFILLING',settlement:'UNKNOWN',renewal:'ready'}]) {
    const id=f.add();f.reserve(id,true,{orderNo:'provider-order',...result});
  }
  f.advance(31*60000);await f.service.run();assert.equal(f.counts().refundCalls,0);assert.equal(f.inventory.listCards('chatgpt-plus',0).cards.length,0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM order_cancellations WHERE state='fulfilled'").get()!.n,2);
});

test('processing, canceled-with-unknown-settlement and uncertain provider responses cannot release cards or refund',async t=>{
  const f=setup(t);const id=f.add();f.reserve(id,true,{orderNo:'provider-order',state:'QUEUED',settlement:'UNKNOWN'});
  for(const result of [
    {voucher:{state:'RESERVED'},order:{orderNo:'provider-order',orderState:'FULFILLING',settlement:{state:'UNKNOWN'}}},
    {voucher:{state:'AVAILABLE'},order:{orderNo:'provider-order',orderState:'CANCELED',settlement:{state:'UNKNOWN'}}},
    {voucher:{state:'AVAILABLE'},order:null},
    {voucher:{state:'AVAILABLE'},order:{orderNo:'other-order',orderState:'NO_CHARGE',settlement:{state:'NO_CHARGE'}}},
  ]) {
    f.setUpstream(result);f.advance(31*60000+f.counts().providerCalls*60000);await f.service.run();
    assert.equal(f.orders.owned(id,'owner').status,'paid');assert.equal(f.orders.owned(id,'owner').cancellation?.state,'review');
  }
  assert.equal(f.counts().refundCalls,0);assert.equal(f.inventory.listCards('chatgpt-plus',0).cards.length,0);
  f.setUpstream({voucher:{state:'AVAILABLE'},order:{orderNo:'provider-order',orderState:'NO_CHARGE',settlement:{state:'NO_CHARGE'}}});
  f.advance(40*60000);await f.service.run();assert.equal(f.orders.owned(id,'owner').cancellation?.state,'refund_review');
  assert.equal(f.counts().refundCalls,0);await f.service.review(id,true,'reviewer','');
  assert.equal(f.orders.owned(id,'owner').status,'cancelled');assert.equal(f.inventory.listCards('chatgpt-plus',0).cards.length,1);
});

test('unknown refunds stay reserved across retries and are queried by the original request number without a second refund',async t=>{
  const f=setup(t);const id=f.add();f.reserve(id);
  f.setRefund(async()=>{throw Error('timeout');});f.advance(31*60000);await f.service.run();
  await f.service.review(id,true,'reviewer','');
  assert.equal(f.counts().refundCalls,1);assert.equal(f.inventory.listCards('chatgpt-plus',0).cards.length,0);
  assert.equal(f.orders.owned(id,'owner').cancellation?.state,'refund_pending');
  f.db.prepare("UPDATE payment_refunds SET updated_at=? WHERE order_id=?").run(new Date(Date.now()-11000).toISOString(),id);
  f.advance(32*60000);await f.service.run();
  assert.equal(f.counts().queryCalls,1);assert.equal(f.counts().refundCalls,1);assert.equal(f.orders.owned(id,'owner').status,'cancelled');
  assert.equal(f.inventory.listCards('chatgpt-plus',0).cards.length,1);
});

test('refund response mismatch cannot finish cancellation and partial prior refunds only refund the remaining amount',async t=>{
  const f=setup(t);const id=f.add();
  const at=new Date(Date.now()-20000).toISOString();
  f.db.prepare("INSERT INTO payment_refunds(request_no,order_id,amount_cents,reason,status,created_at,updated_at) VALUES ('partial',?,2000,'fixture','success',?,?)").run(id,at,at);
  f.setRefund(async(order,amount,key)=>{assert.equal(amount,'110.00');return {out_trade_no:'wrong-order',out_request_no:key,fund_change:'Y'};});
  f.advance(31*60000);await f.service.run();await f.service.review(id,true,'reviewer','');
  assert.equal(f.orders.owned(id,'owner').status,'cancelled');
  assert.equal(f.orders.owned(id,'owner').cancellation?.state,'refund_pending');
  f.db.prepare("UPDATE payment_refunds SET updated_at=? WHERE order_id=?").run(at,id);
  f.setQuery(async(order,key)=>({out_trade_no:order.id,out_request_no:key,refund_status:'REFUND_SUCCESS',refund_amount:'110.00'}));
  f.advance(32*60000);await f.service.run();assert.equal(f.orders.owned(id,'owner').status,'cancelled');assert.equal(f.counts().refundCalls,1);
});

test('independent workers share a durable lease and do not refund twice; other environments and exempt orders are skipped',async t=>{
  const f=setup(t);const id=f.add();f.add('production');f.add('sandbox',true);
  let finish!:(value:Record<string,string>)=>void;
  f.setRefund(()=>new Promise(resolve=>{finish=resolve;}));f.advance(31*60000);
  await f.service.run();assert.equal(f.counts().refundCalls,0);
  const first=f.service.review(id,true,'reviewer','');
  // timeoutCheck is async, allow it to enter the refund request.
  await new Promise(resolve=>setImmediate(resolve));
  const second=orderTimeoutService(f.db,f.gateway,f.redemptions,()=>f.paidAt+31*60000);
  await second.run();assert.equal(f.counts().refundCalls,1);
  const key=f.db.prepare('SELECT refund_key FROM order_cancellations WHERE order_id=?').get(id)!.refund_key as string;
  finish({out_trade_no:id,out_request_no:key,fund_change:'Y'});await first;
  assert.equal(f.db.prepare('SELECT count(*) n FROM order_cancellations').get()!.n,1);
});

test('overdue preview or submit cannot start another membership charge and active preview leases hold their cards',async t=>{
  const f=setup(t);const id=f.add();f.reserve(id);
  f.db.prepare('UPDATE order_fulfillment_deadlines SET due_at=? WHERE order_id=?').run(new Date(Date.now()-1).toISOString(),id);
  const old=process.env.LOVECODEX_ENABLED;process.env.LOVECODEX_ENABLED='true';t.after(()=>{if(old===undefined)delete process.env.LOVECODEX_ENABLED;else process.env.LOVECODEX_ENABLED=old;});
  const order=f.orders.owned(id,'owner');
  await assert.rejects(f.redemptions.preview(order,{}),{code:'ORDER_FULFILLMENT_TIMEOUT'});
  await assert.rejects(f.redemptions.submit(order,'old-confirmation'),{code:'ORDER_FULFILLMENT_TIMEOUT'});
  f.db.prepare('UPDATE order_redemptions SET preview_until=? WHERE order_id=?').run(Date.now()+90000,id);
  f.advance(31*60000);await f.service.run();assert.equal(f.counts().refundCalls,0);assert.equal(f.counts().providerCalls,0);
});

test('migration preserves already-paid historical orders without scheduling retroactive refunds',t=>{
  const dir=mkdtempSync(join(tmpdir(),'wusan-timeout-migration-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'store.sqlite');let db=openDatabase(path);
  db.exec('DROP TRIGGER fulfillment_deadline_insert; DROP TRIGGER fulfillment_deadline_payment; DROP TABLE order_fulfillment_deadlines; DROP TABLE order_cancellations; PRAGMA user_version=15;');
  db.prepare("INSERT INTO orders(id,owner_hash,email,snapshot,status,created_at,expires_at,paid_at,idempotency_key,fingerprint,environment) VALUES ('historical','','','{}','paid','','','2020-01-01T00:00:00.000Z','','','production')").run();
  db.close();db=openDatabase(path);
  try {assert.equal(db.prepare('SELECT count(*) n FROM order_fulfillment_deadlines').get()!.n,0);assert.equal(db.prepare('PRAGMA user_version').get()!.user_version,19);}finally{db.close();}
});

test('a submitted request with no known order number never treats an older voucher order as proof of no charge',async t=>{
  const f=setup(t);const id=f.add();f.reserve(id,true);
  f.setUpstream({voucher:{state:'AVAILABLE'},order:{orderNo:'unrelated-old-order',orderState:'NO_CHARGE',settlement:{state:'NO_CHARGE'}}});
  f.advance(31*60000);await f.service.run();
  f.advance(32*60000);await f.service.run();
  assert.equal(f.orders.owned(id,'owner').status,'paid');assert.equal(f.counts().refundCalls,0);assert.equal(f.inventory.listCards('chatgpt-plus',0).cards.length,0);
});

test('pending and rejected reviews survive workers restarting and never refund or release their vouchers',async t=>{
  const f=setup(t);const id=f.add();f.reserve(id);
  f.advance(31*60000);await f.service.run();
  const restarted=orderTimeoutService(f.db,f.gateway,f.redemptions,()=>f.paidAt+60*60000);
  await restarted.run();assert.equal(f.counts().refundCalls,0);
  await assert.rejects(restarted.review(id,false,'reviewer','  '),{code:'INVALID_REFUND_REVIEW'});
  await restarted.review(id,false,'reviewer','客户已确认暂不退款');
  await restarted.review(id,false,'other-reviewer','重复请求不能覆盖原审核');
  assert.equal(f.db.prepare('SELECT reviewed_by FROM order_refund_reviews WHERE order_id=?').get(id)!.reviewed_by,'reviewer');
  await assert.rejects(restarted.review(id,true,'other-reviewer',''),{code:'REFUND_REVIEW_CHANGED'});
  await restarted.run();assert.equal(f.orders.owned(id,'owner').cancellation?.state,'refund_rejected');
  assert.equal(f.counts().refundCalls,0);assert.equal(f.inventory.listCards('chatgpt-plus',0).cards.length,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM payment_refunds').get()!.n,0);
  const list=adminOrderRepository(f.db,'sandbox').list(new URLSearchParams('status=cancelled&refundReview=rejected&paymentType=paid'));
  assert.equal(list.total,1);assert.equal(list.counts.cancelled,1);assert.equal(list.counts.paid,0);
  assert.equal(list.orders[0].refundReview?.reason,'客户已确认暂不退款');
});

test('approval rechecks recharge status and cannot refund a membership that opened while waiting',async t=>{
  const f=setup(t);const id=f.add();f.reserve(id);
  f.advance(31*60000);await f.service.run();assert.equal(f.counts().providerCalls,1);
  f.setUpstream({voucher:{state:'CONSUMED'},order:{orderNo:'late-opening',orderState:'FULFILLED',settlement:{state:'PAID'}}});
  await f.service.review(id,true,'reviewer','核对后处理');
  assert.equal(f.counts().providerCalls,2);assert.equal(f.counts().refundCalls,0);
  assert.equal(f.orders.owned(id,'owner').status,'paid');assert.equal(f.orders.owned(id,'owner').cancellation,undefined);
  assert.equal(f.inventory.listCards('chatgpt-plus',0).cards.length,0);
});

test('duplicate approvals keep their original audit and cannot initiate a second refund',async t=>{
  const f=setup(t);const id=f.add();f.advance(31*60000);await f.service.run();
  await f.service.review(id,true,'original-reviewer','已核实');
  await f.service.review(id,true,'another-reviewer','another note');
  assert.equal(f.counts().refundCalls,1);
  const review=f.db.prepare('SELECT reviewed_by,reason FROM order_refund_reviews WHERE order_id=?').get(id)!;
  assert.equal(review.reviewed_by,'original-reviewer');assert.equal(review.reason,'已核实');
});

test('schema 18 only reconciles already issued timeout refunds and puts unsent refunds back behind review',t=>{
  const dir=mkdtempSync(join(tmpdir(),'wusan-refund-review-migration-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'store.sqlite');let db=openDatabase(path);
  const at=new Date().toISOString();
  for(const id of ['issued','unsent']) {
    db.prepare("INSERT INTO orders(id,owner_hash,email,snapshot,status,created_at,expires_at,idempotency_key,fingerprint,environment) VALUES (?,'','','{}','paid',?,?,?,'','sandbox')").run(id,at,at,id);
    db.prepare("INSERT INTO order_cancellations(order_id,state,refund_key,created_at,updated_at) VALUES (?,'refund_pending',?,?,?)").run(id,'timeout-'+id,at,at);
  }
  db.prepare("INSERT INTO payment_refunds(request_no,order_id,amount_cents,reason,status,created_at,updated_at) VALUES ('timeout-issued','issued',13000,'old request','pending',?,?)").run(at,at);
  db.exec('DROP TABLE order_refund_reviews; PRAGMA user_version=17;');db.close();db=openDatabase(path);
  try {
    assert.equal(db.prepare("SELECT status FROM order_refund_reviews WHERE order_id='issued'").get()!.status,'approved');
    assert.equal(db.prepare("SELECT reviewed_by FROM order_refund_reviews WHERE order_id='issued'").get()!.reviewed_by,'system:migration');
    assert.equal(db.prepare("SELECT state FROM order_cancellations WHERE order_id='issued'").get()!.state,'refund_pending');
    assert.equal(db.prepare("SELECT state FROM order_cancellations WHERE order_id='unsent'").get()!.state,'checking');
    assert.equal(db.prepare('SELECT count(*) n FROM order_refund_reviews').get()!.n,1);
    assert.equal(db.prepare('SELECT count(*) n FROM payment_refunds').get()!.n,1);
    assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');
  }finally{db.close();}
});

test('a customer can cancel an unsubmitted paid order before its deadline, but refund and voucher release still require approval',async t=>{
  const f=setup(t);const id=f.add();f.reserve(id);
  assert.equal(f.orders.owned(id,'owner').cancelAction,'request_refund');
  await f.service.requestCancellation(()=>f.orders.cancellationEligible(id,'owner'));
  assert.equal(f.orders.owned(id,'owner').status,'cancelled');
  assert.equal(f.orders.owned(id,'owner').cancellation?.state,'refund_review');
  assert.equal(f.orders.owned(id,'owner').cancelAction,null);
  assert.equal(f.db.prepare('SELECT source FROM order_cancellations WHERE order_id=?').get(id)!.source,'customer_paid');
  assert.equal(f.counts().refundCalls,0);assert.equal(f.inventory.listCards('chatgpt-plus',0).cards.length,0);
  await f.service.review(id,true,'reviewer','未充值，同意取消');
  assert.equal(f.orders.owned(id,'owner').cancellation?.state,'cancelled');
  assert.equal(f.counts().refundCalls,1);assert.equal(f.inventory.listCards('chatgpt-plus',0).cards.length,1);
});

test('submitted, processing, fulfilled, exempt and actively validating orders cannot request customer cancellation',async t=>{
  const f=setup(t);
  for(const result of [null,{state:'QUEUED'},{state:'FULFILLED',settlement:'PAID'}]) {
    const id=f.add();f.reserve(id,true,result);
    assert.equal(f.orders.owned(id,'owner').cancelAction,null);
    await assert.rejects(f.service.requestCancellation(()=>f.orders.cancellationEligible(id,'owner')),{code:'ORDER_CANNOT_CANCEL'});
  }
  const validating=f.add();f.reserve(validating);f.db.prepare('UPDATE order_redemptions SET preview_until=? WHERE order_id=?').run(Date.now()+90000,validating);
  assert.equal(f.orders.owned(validating,'owner').cancelAction,null);
  const exempt=f.add('sandbox',true);assert.equal(f.orders.owned(exempt,'owner').cancelAction,null);
  assert.equal(f.db.prepare('SELECT count(*) n FROM order_cancellations').get()!.n,0);
  assert.equal(f.counts().providerCalls,0);assert.equal(f.counts().refundCalls,0);
});

test('uncertain manual cancellations stay blocked and reconcile before 30 minutes without creating an unapproved refund',async t=>{
  const f=setup(t);const id=f.add();f.reserve(id);
  f.setUpstream({voucher:{state:'RESERVED'},order:null});
  await f.service.requestCancellation(()=>f.orders.cancellationEligible(id,'owner'));
  assert.equal(f.orders.owned(id,'owner').status,'paid');assert.equal(f.orders.owned(id,'owner').cancellation?.state,'review');
  assert.equal(f.db.prepare('SELECT count(*) n FROM order_refund_reviews').get()!.n,0);
  f.setUpstream({voucher:{state:'AVAILABLE'},order:null});f.advance(31000);await f.service.run();
  assert.equal(f.orders.owned(id,'owner').cancellation?.state,'refund_review');assert.equal(f.counts().refundCalls,0);
});

test('a manual cancellation freezes recharge submission and works for an owned historical paid order without an automatic deadline',async t=>{
  const f=setup(t);const id=f.add();f.reserve(id);
  f.db.prepare('DELETE FROM order_fulfillment_deadlines WHERE order_id=?').run(id);
  const old=process.env.LOVECODEX_ENABLED;process.env.LOVECODEX_ENABLED='true';t.after(()=>{if(old===undefined)delete process.env.LOVECODEX_ENABLED;else process.env.LOVECODEX_ENABLED=old;});
  const request=f.service.requestCancellation(()=>f.orders.cancellationEligible(id,'owner'));
  await assert.rejects(f.redemptions.submit(f.orders.owned(id,'owner'),'old-confirmation'),{code:'ORDER_FULFILLMENT_TIMEOUT'});
  await request;assert.equal(f.orders.owned(id,'owner').cancellation?.state,'refund_review');
  await f.service.review(id,true,'reviewer','');assert.equal(f.counts().refundCalls,1);
});

test('a verified payment after unpaid cancellation can still reach the normal fulfillment deadline',async t=>{
  const f=setup(t);const id=f.add();const now=new Date().toISOString();
  f.db.prepare(`INSERT INTO order_cancellations(order_id,state,refund_key,note,created_at,updated_at,cancelled_at,source)
    VALUES (?,'fulfilled',?,'已核实到账，保留已付款订单。',?,?,?,'customer_unpaid')`).run(id,'unpaid-'+id,now,now,now);
  assert.equal(f.orders.owned(id,'owner').status,'paid');assert.equal(f.orders.owned(id,'owner').cancelAction,'request_refund');
  f.advance(31*60000);await f.service.run();
  assert.equal(f.orders.owned(id,'owner').cancellation?.state,'refund_review');assert.equal(f.counts().refundCalls,0);
  assert.equal(f.db.prepare('SELECT source FROM order_cancellations WHERE order_id=?').get(id)!.source,'timeout');
});
