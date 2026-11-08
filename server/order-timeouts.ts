import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { PaymentGateway } from './alipay.ts';
import type { Order } from '../src/types/orders.ts';
import type { redemptionRepository } from './redemptions.ts';
import { refundRepository } from './refunds.ts';
import { OrderError } from './orders.ts';

// Runs independently of customer visits. Each environment only handles its own newly paid orders.
export function orderTimeoutService(db: DatabaseSync, gateway: PaymentGateway, redemptions: ReturnType<typeof redemptionRepository>, clock = Date.now) {
  const refunds = refundRepository(db,gateway);
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const iso = () => new Date(clock()).toISOString();
  const update = (id: string,state: string,note: string) => db.prepare('UPDATE order_cancellations SET state = ?,note = ?,updated_at = ?,retry_at = ?,lease_until = 0 WHERE order_id = ?').run(state,note,iso(),clock()+30000,id);
  function transaction<T>(action:()=>T) {
    db.exec('BEGIN IMMEDIATE');
    try {const value=action();db.exec('COMMIT');return value;} catch(error) {db.exec('ROLLBACK');throw error;}
  }
  async function process(id: string) {
    if (!gateway.status.enabled) return;
    const locked=transaction(()=>{
      const raw=db.prepare(`SELECT o.* FROM orders o LEFT JOIN order_fulfillment_deadlines d ON d.order_id = o.id
        LEFT JOIN order_cancellations c ON c.order_id=o.id WHERE o.id = ? AND o.environment = ? AND o.status = 'paid'
        AND (d.due_at <= ? OR c.source='customer_paid')`).get(id,gateway.status.environment,iso());
      if(!raw)return null;
      const snapshot=JSON.parse(String(raw.snapshot));
      if(snapshot.staffCheckout)return null;
      const key='timeout-'+createHash('sha256').update(id).digest('hex').slice(0,40);
      db.prepare("INSERT OR IGNORE INTO order_cancellations(order_id,state,refund_key,note,created_at,updated_at) VALUES (?,'checking',?,'订单已超过开通时限，正在核实开通状态，退款需后台审核。',?,?)").run(id,key,iso(),iso());
      db.prepare(`UPDATE order_cancellations SET state='checking',source='timeout',refund_key=?,cancelled_at=NULL,retry_at=0,lease_until=0
        WHERE order_id=? AND source='customer_unpaid' AND state='fulfilled'`).run(key,id);
      const changed=db.prepare(`UPDATE order_cancellations SET lease_until = ?,updated_at = ? WHERE order_id = ?
        AND state IN ('checking','review','refund_pending') AND lease_until <= ? AND retry_at <= ?
        AND NOT EXISTS (SELECT 1 FROM order_refund_reviews r WHERE r.order_id=order_cancellations.order_id AND r.status!='approved')`).run(clock()+300000,iso(),id,clock(),clock());
      if(!changed.changes)return null;
      return {order:{...snapshot,id,status:'paid',createdAt:String(raw.created_at),paidAt:raw.paid_at,expiresAt:raw.expires_at,tradeNo:raw.trade_no,environment:raw.environment} as Order,cancellation:db.prepare('SELECT * FROM order_cancellations WHERE order_id = ?').get(id)!};
    });
    if(!locked)return;
    const {order,cancellation}=locked;
    const customerCancellation=cancellation.source==='customer_paid';
    const reason=customerCancellation?'用户申请取消未充值订单':'超过30分钟未开通会员';
    try {
      let voucherId: number | null = cancellation.voucher_id === null ? null : Number(cancellation.voucher_id);
      // Once refunding starts, retries only reconcile money, never re-submit membership or replace its voucher.
      if(cancellation.state !== 'refund_pending') {
        const check=await redemptions.timeoutCheck(order);
        if(check.state==='fulfilled') {update(id,'fulfilled','会员已开通，保留订单。');return;}
        if(check.state!=='safe') {update(id,'review',customerCancellation?'取消申请核实中，上游充值或卡密状态尚未确认，暂未取消、退款或释放卡密。':'已超过开通时限，上游充值结果或卡密状态仍待核实，暂未退款或释放卡密。');return;}
        voucherId=check.voucherId;
        const approved = transaction(() => {
          db.prepare("INSERT OR IGNORE INTO order_refund_reviews(order_id,status,requested_at) VALUES (?,'pending',?)").run(id,iso());
          const status=db.prepare('SELECT status FROM order_refund_reviews WHERE order_id=?').get(id)!.status;
          if(status!=='approved') db.prepare(`UPDATE order_cancellations SET state='review',voucher_id=?,
            note=?,cancelled_at=COALESCE(cancelled_at,?),updated_at=?,lease_until=0 WHERE order_id=?`).run(voucherId,reason+'，订单已取消，退款待后台审核；款项尚未退回。',iso(),iso(),id);
          return status==='approved';
        });
        if(!approved)return;
        db.prepare("UPDATE order_cancellations SET state = 'refund_pending',voucher_id = ?,note = '退款审核通过，正在原路退款。',updated_at = ? WHERE order_id = ?").run(voucherId,iso(),id);
      }
      // Every new timeout refund requires a durable approval, including retries after a restart.
      if(db.prepare('SELECT status FROM order_refund_reviews WHERE order_id=?').get(id)?.status!=='approved') {
        update(id,'checking','退款尚未审核，等待后台确认。');return;
      }
      const pending=db.prepare("SELECT request_no,updated_at FROM payment_refunds WHERE order_id = ? AND status = 'pending'").all(id);
      for(const item of pending) {
        if(Date.now()-Date.parse(String(item.updated_at))>=10000) await refunds.query(String(item.request_no));
      }
      if(db.prepare("SELECT 1 FROM payment_refunds WHERE order_id = ? AND status = 'pending'").get(id)) {update(id,'refund_pending','原路退款结果确认中，请勿重复申请。');return;}
      const returned=Number(db.prepare("SELECT COALESCE(sum(amount_cents),0) n FROM payment_refunds WHERE order_id = ? AND status = 'success'").get(id)!.n);
      const remaining=order.priceCents-returned;
      if(remaining>0) {
        const existing=db.prepare('SELECT status FROM payment_refunds WHERE request_no = ?').get(cancellation.refund_key);
        if(existing) {update(id,'refund_pending','退款金额仍待核对，请联系客服。');return;}
        await refunds.request(id,String(cancellation.refund_key),(remaining/100).toFixed(2),customerCancellation?'用户申请取消未充值订单，后台审核通过后退款':'支付后30分钟内未开通会员，后台审核通过后退款');
      }
      const total=Number(db.prepare("SELECT COALESCE(sum(amount_cents),0) n FROM payment_refunds WHERE order_id = ? AND status = 'success'").get(id)!.n);
      if(total<order.priceCents) {update(id,'refund_pending','原路退款结果确认中，请勿重复申请。');return;}
      transaction(()=>{
        if(voucherId !== null) {
          db.prepare(`INSERT OR IGNORE INTO order_fulfillment_details(order_id,voucher_id,voucher_code,recharge_email)
            SELECT r.order_id,r.voucher_id,v.code,json_extract(r.account,'$.email') FROM order_redemptions r JOIN voucher_inventory v ON v.id=r.voucher_id WHERE r.order_id=? AND r.voucher_id=?`).run(id,voucherId);
          db.prepare('DELETE FROM order_redemptions WHERE order_id = ? AND voucher_id = ?').run(id,voucherId);
        }
        db.prepare("UPDATE order_cancellations SET state = 'cancelled',note = ?,cancelled_at = COALESCE(cancelled_at,?),updated_at = ?,lease_until = 0 WHERE order_id = ?").run(reason+'，已原路退款，订单已取消。',iso(),iso(),id);
      });
    } catch {
      const state=db.prepare('SELECT state FROM order_cancellations WHERE order_id = ?').get(id)?.state;
      if(state==='refund_pending') update(id,'refund_pending','原路退款结果暂未确认，系统会继续查询原退款单。');
      else update(id,'review',customerCancellation?'取消申请核实中，充值状态暂未确认；暂不退款或释放卡密。':'已超过开通时限，正在核实开通状态；未确认可回收前保留卡密。');
    }
  }
  async function sweep() {
    if(!gateway.status.enabled)return;
    const candidates=db.prepare(`SELECT o.id FROM orders o LEFT JOIN order_fulfillment_deadlines d ON d.order_id=o.id
      LEFT JOIN order_cancellations c ON c.order_id=o.id LEFT JOIN order_refund_reviews r ON r.order_id=o.id
      WHERE o.status='paid' AND o.environment=? AND (d.due_at<=? OR c.source='customer_paid') AND (r.status IS NULL OR r.status='approved')
      AND (c.order_id IS NULL OR ((c.state IN ('checking','review','refund_pending') OR (c.state='fulfilled' AND c.source='customer_unpaid')) AND c.retry_at<=? AND c.lease_until<=?)) ORDER BY COALESCE(d.due_at,c.created_at) LIMIT 20`)
      .all(gateway.status.environment,iso(),clock(),clock());
    for(const row of candidates)await process(String(row.id));
  }
  function run() {
    if(running)return running;
    running=sweep().finally(()=>{running=null;});return running;
  }
  return {
    run,
    async requestCancellation(eligible: () => Order) {
      const id=transaction(()=>{
        const order=eligible();
        if(order.cancelAction!=='request_refund')throw new OrderError(409,'ORDER_CANNOT_CANCEL','仅已付款且尚未提交充值的订单可申请取消。');
        const now=iso();
        const key='customer-'+createHash('sha256').update(order.id).digest('hex').slice(0,40);
        db.prepare(`INSERT INTO order_cancellations(order_id,state,refund_key,note,created_at,updated_at,source)
          VALUES (?,'checking',?,'正在核实取消条件，退款需后台审核。',?,?,'customer_paid')
          ON CONFLICT(order_id) DO UPDATE SET state='checking',refund_key=excluded.refund_key,source='customer_paid',
            note=excluded.note,updated_at=excluded.updated_at,cancelled_at=NULL,retry_at=0,lease_until=0
          WHERE order_cancellations.source='customer_unpaid' AND order_cancellations.state='fulfilled'`).run(order.id,key,now,now);
        return order.id;
      });
      await process(id);
    },
    async review(id: string, approve: boolean, actor: string, reason: unknown) {
      const note=typeof reason==='string'?reason.trim():'';
      if(typeof reason!=='string' || note.length>300 || (!approve && !note)) throw new OrderError(400,'INVALID_REFUND_REVIEW','请填写审核备注，驳回原因必填且不超过300字。');
      transaction(()=>{
        const row=db.prepare(`SELECT r.status,c.state FROM order_refund_reviews r JOIN orders o ON o.id=r.order_id
          JOIN order_cancellations c ON c.order_id=r.order_id WHERE r.order_id=? AND o.environment=? AND o.status='paid'`).get(id,gateway.status.environment);
        if(!row)throw new OrderError(404,'REFUND_REVIEW_NOT_FOUND','未找到当前环境的退款审核记录。');
        const next=approve?'approved':'rejected';
        if(row.status===next)return;
        if(row.status!=='pending' || row.state==='cancelled' || row.state==='fulfilled')throw new OrderError(409,'REFUND_REVIEW_CHANGED','退款审核状态已变更，请刷新后重试。');
        db.prepare('UPDATE order_refund_reviews SET status=?,reviewed_at=?,reviewed_by=?,reason=? WHERE order_id=? AND status=\'pending\'').run(next,iso(),actor,note,id);
        db.prepare('UPDATE order_cancellations SET note=?,updated_at=?,retry_at=0 WHERE order_id=?').run(approve
          ?'订单已取消，退款审核通过，等待核实后原路退款。'
          :'订单已取消，退款审核未通过，款项尚未退回。请联系客服。',iso(),id);
      });
      if(approve)await process(id);
      const row=db.prepare('SELECT status,reviewed_at,reviewed_by,reason FROM order_refund_reviews WHERE order_id=?').get(id)!;
      return {status:String(row.status),reviewedAt:row.reviewed_at,reviewedBy:row.reviewed_by,reason:row.reason};
    },
    start() {if(timer)return;void run().catch(()=>{});timer=setInterval(()=>{void run().catch(()=>{});},15000);timer.unref();},
    async stop() {if(timer)clearInterval(timer);timer=null;await running;},
  };
}
