import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../server/database.ts';
import { createAlipayGateway } from '../../server/alipay.ts';
import { orderRepository } from '../../server/orders.ts';
import { referralRepository } from '../../server/referrals.ts';
import type { Order } from '../../src/types/orders.ts';

// Real repositories and in-memory SQLite, with no network/payment/configuration access.
export async function createReferralScenarios() {
  const db=openDatabase(':memory:');
  try {
    const gateway={...createAlipayGateway({}, {sandboxPath:null}),origin:'http://127.0.0.1:5180',appId:'mock-app',sellerId:'mock-seller',
      status:{enabled:true,environment:'sandbox' as const,message:'仅内存 Mock'},paymentForm:()=>{throw Error('Mock cannot pay');},
      verifyNotification:(params:Record<string,string>)=>params.sign==='mock-valid',query:async()=>null,close:async(order:Order)=>({out_trade_no:order.id})};
    db.prepare('INSERT INTO customers VALUES (?,?,?,?,?)').run('mock-inviter','mock_inviter','unused','a'.repeat(16),new Date().toISOString());
    const referrals=referralRepository(db,gateway.origin,'sandbox');const orders=orderRepository(db,gateway);
    const scenarios:Record<string,string>={};
    const pay=(order:Order)=>orders.notify({out_trade_no:order.id,app_id:gateway.appId,seller_id:gateway.sellerId,
      total_amount:(order.priceCents/100).toFixed(2),trade_no:'20261114'+String(Object.keys(scenarios).length).padStart(18,'0'),
      trade_status:'TRADE_SUCCESS',notify_id:'mock-notify-'+order.id,sign:'mock-valid'});
    for(const kind of ['earned','awaiting_payment','payment_expired','order_closed','full_refund','same_device','self_invite','product_excluded','long_term_invitation','late_device']){
      const owner='mock-owner-'+kind;
      if(kind==='same_device')db.prepare('INSERT INTO customer_browsers VALUES (?,?)').run(owner,'mock-inviter');
      referrals.visit(owner,'a'.repeat(16),kind==='self_invite'?'mock-inviter':undefined);
      if(kind==='long_term_invitation')db.prepare('UPDATE referral_visits SET expires_at=? WHERE owner_hash=?').run(Date.now()-365*86400000,owner);
      const order=await orders.create(owner,{productId:kind==='product_excluded'?'codex-sms':'chatgpt-plus',
        expectedPriceCents:kind==='product_excluded'?300:13000,contact:'mock@example.test',queryPassword:'mock2026'},randomUUID(),
        referrals.orderAttribution(owner,kind==='self_invite'?'mock-inviter':undefined));
      scenarios[kind]=order.id;
      if(kind==='long_term_invitation')db.prepare("UPDATE orders SET snapshot=json_set(snapshot,'$.productName','ChatGPT Plus（长期邀请）') WHERE id=?").run(order.id);
      if(kind==='awaiting_payment'){
        db.prepare('UPDATE orders SET expires_at=? WHERE id=?').run(new Date(Date.now()+365*86400000).toISOString(),order.id);
        continue;
      }
      if(kind==='payment_expired')db.prepare('UPDATE orders SET expires_at=? WHERE id=?').run(new Date(Date.now()-60000).toISOString(),order.id);
      else if(kind==='order_closed')await orders.close(order.id,owner);
      else {
        pay(order);
        if(kind==='full_refund'){
          db.prepare("INSERT INTO payment_refunds(request_no,order_id,amount_cents,reason,status,created_at,updated_at) VALUES (?,?,?,'Mock 全额退款','pending',?,?)")
            .run('mock-refund',order.id,order.priceCents,new Date().toISOString(),new Date().toISOString());
          db.prepare("UPDATE payment_refunds SET status='success' WHERE request_no='mock-refund'").run();
        }
        if(kind==='late_device')db.prepare('INSERT INTO customer_browsers VALUES (?,?)').run(owner,'mock-inviter');
      }
    }
    // Synchronize time-based reasons just as the real report does.
    referrals.report(new URLSearchParams(),'mock-inviter');
    return {db,referrals,scenarios,inviterId:'mock-inviter'};
  } catch(error){db.close();throw error;}
}

export function referralDecisionCounts(db:DatabaseSync){
  return db.prepare('SELECT reason_code AS reason,count(*) AS total FROM referral_report_records GROUP BY reason_code ORDER BY reason_code').all();
}
