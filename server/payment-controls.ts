import type { DatabaseSync } from 'node:sqlite';
import type { PaymentConfig } from '../src/types/orders.ts';
import type { PaymentControls } from '../src/types/admin.ts';
import { OrderError } from './orders.ts';

export function paymentControls(db: DatabaseSync, environment: PaymentConfig['environment']) {
  const global = () => db.prepare('SELECT * FROM payment_controls WHERE environment=?').get(environment);
  function list(): PaymentControls {
    const settings=global();
    return {environment,enabled:settings?.enabled!==0,version:Number(settings?.version||0),
      updatedAt:settings?.updated_at ? String(settings.updated_at):null,updatedBy:settings?.updated_by ? String(settings.updated_by):null,
      products:db.prepare(`SELECT p.id,p.name,coalesce(c.enabled,1) enabled FROM products p
        LEFT JOIN product_payment_controls c ON c.product_id=p.id AND c.environment=?
        WHERE p.active=1 ORDER BY p.sort_order,p.id`).all(environment).map(row=>({id:String(row.id),name:String(row.name),enabled:!!row.enabled}))};
  }
  function assertEnabled(productId: string) {
    if(global()?.enabled===0)throw new OrderError(503,'PAYMENT_PAUSED','全站支付已暂停，请稍后再来。');
    if(db.prepare('SELECT enabled FROM product_payment_controls WHERE environment=? AND product_id=?').get(environment,productId)?.enabled===0)
      throw new OrderError(503,'PRODUCT_PAYMENT_PAUSED','该商品暂时关闭支付，请选择其他商品或稍后再来。');
  }
  return {list,assertEnabled,
    publicStatus(status:PaymentConfig):PaymentConfig {
      const settings=global();
      const blocked=db.prepare('SELECT product_id FROM product_payment_controls WHERE environment=? AND enabled=0 ORDER BY product_id').all(environment).map(row=>String(row.product_id));
      return {...status,...(blocked.length?{blockedProductIds:blocked}:{}),
        ...(settings?.enabled===0?{enabled:false,globallyPaused:true,gatewayEnabled:status.enabled,message:'全站支付已暂停，请稍后再来。'}:{})};
    },
    update(input:Record<string,unknown>,actor:string) {
      if(typeof input.enabled!=='boolean'||!Number.isSafeInteger(input.version)||Number(input.version)<0
        ||!(input.productId===null||typeof input.productId==='string'&&/^[a-z0-9-]{1,80}$/.test(input.productId)))
        throw new OrderError(400,'INVALID_PAYMENT_CONTROL','请选择有效的支付开关。');
      db.exec('BEGIN IMMEDIATE');
      try{
        const previous=list();
        if(input.version!==previous.version)throw new OrderError(409,'PAYMENT_CONTROLS_CHANGED','支付设置已被其他操作更新，请刷新后重试。');
        const product=input.productId===null?null:previous.products.find(p=>p.id===input.productId);
        if(input.productId!==null&&!product)throw new OrderError(404,'PRODUCT_NOT_FOUND','该商品不存在或已下架。');
        if((product?product.enabled:previous.enabled)!==input.enabled){
          const now=new Date().toISOString();
          db.prepare(`INSERT INTO payment_controls(environment,enabled,version,updated_at,updated_by) VALUES (?,?,1,?,?)
            ON CONFLICT(environment) DO UPDATE SET enabled=excluded.enabled,version=payment_controls.version+1,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
            .run(environment,Number(product?previous.enabled:input.enabled),now,actor);
          if(product)db.prepare(`INSERT INTO product_payment_controls(environment,product_id,enabled) VALUES (?,?,?)
            ON CONFLICT(environment,product_id) DO UPDATE SET enabled=excluded.enabled`).run(environment,product.id,Number(input.enabled));
          db.prepare('INSERT INTO payment_control_events(environment,product_id,enabled,actor,created_at) VALUES (?,?,?,?,?)')
            .run(environment,input.productId as string|null,Number(input.enabled),actor,now);
        }
        const result=list();db.exec('COMMIT');return result;
      }catch(error){db.exec('ROLLBACK');throw error;}
    },
  };
}
