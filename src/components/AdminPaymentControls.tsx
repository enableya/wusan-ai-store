import {useState} from 'react';
import {useApiResource} from '../hooks/useApiResource';
import {ApiError,postApi} from '../services/api';
import {useMessage} from '../app/MessageProvider';
import type {PaymentControls} from '../types/admin';
import './admin-payment-controls.css';

export function AdminPaymentControls({onExpired}:{onExpired:()=>void}){
  const resource=useApiResource<PaymentControls>('/admin/payments/settings');
  const [updated,setUpdated]=useState<PaymentControls|null>(null),[busy,setBusy]=useState<string|null>(null);
  const message=useMessage(),data=updated??resource.data;
  async function change(productId:string|null,enabled:boolean){
    if(!data||busy)return;setBusy(productId??'all');
    try{
      const result=await postApi<PaymentControls>('/admin/payments/settings',{productId,enabled,version:data.version});
      setUpdated(result);message.success(enabled?'支付已开启。':'支付已关闭。');
      window.dispatchEvent(new Event('wusan:payment-controls'));
      if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('wusan-payment-controls');channel.postMessage('updated');channel.close();}
    }catch(error){
      if(error instanceof ApiError&&error.status===401)onExpired();
      else message.error(error instanceof Error?error.message:'支付设置保存失败。');
      setUpdated(null);resource.reload();
    }finally{setBusy(null);}
  }
  function toggle(id:string|null,name:string,enabled:boolean){return <button type="button" role="switch" aria-checked={enabled} aria-label={name}
    className="payment-toggle" disabled={!!busy} onClick={()=>void change(id,!enabled)}><span aria-hidden="true"/><strong>{busy===(id??'all')?'保存中…':enabled?'开启':'关闭'}</strong></button>;}
  return <>
    <div className="admin-heading"><div><h1>支付管理</h1><p>控制全站及各商品是否允许支付，修改后立即生效。</p></div>
      <button type="button" className="button secondary" disabled={!!busy} onClick={()=>{setUpdated(null);resource.reload();}}>刷新设置</button></div>
    {resource.error&&<p role="alert">{resource.error.message}</p>}
    {!data?<p role="status">正在读取支付设置…</p>:<>
      <section className="admin-panel payment-master"><div><h2>支付总开关</h2><p>关闭后，所有商品暂停新下单、获取付款二维码和打开收银台。单独商品的开关设置会保留。</p></div>{toggle(null,'支付总开关',data.enabled)}</section>
      <div className="payment-control-note"><span className="admin-chip">{data.environment==='sandbox'?'测试环境':'生产环境'}</span><p>默认全部开启。已付款订单继续核实和交付，免付开通不受支付开关影响。已打开的支付宝收银台可能仍完成付款。</p></div>
      <section className="admin-panel payment-products"><h2>商品支付开关</h2>{data.products.map(product=><div className="payment-product" key={product.id}>
        <div><strong>{product.name}</strong><p>{!data.enabled?'总开关已关闭，当前无法支付':product.enabled?'允许支付':'该商品暂停支付'}</p></div>
        {toggle(product.id,product.name+'支付开关',product.enabled)}</div>)}</section>
      {data.updatedAt&&<p className="field-hint">最近修改：{data.updatedBy} · {new Date(data.updatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}</p>}
    </>}
  </>;
}
