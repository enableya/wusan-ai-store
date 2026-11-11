import {useEffect,useState} from 'react';
import {postApi} from '../services/api';
import {useMessage} from '../app/MessageProvider';
import {Icon} from './Icon';

type Delivery = {delivered:false} | {delivered:true;code:string;deliveredAt:string;usageInstructions?:string};
export function CardDelivery({orderId,onDelivered}: {orderId:string;onDelivered?:()=>void}) {
  const message=useMessage();
  const [delivery,setDelivery]=useState<Delivery|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');
    postApi<Delivery>(`/orders/${encodeURIComponent(orderId)}/card`,{},undefined,controller.signal).then(data=>{
      if(!controller.signal.aborted)setDelivery(data);
    }).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'暂时无法获取卡密，请稍后重试。');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[orderId,attempt]);
  useEffect(()=>{if(delivery?.delivered)onDelivered?.();},[delivery,onDelivered]);
  async function copy() {
    if(!delivery?.delivered)return;
    try{await navigator.clipboard.writeText(delivery.code);message.success('卡密已复制。');}
    catch{message.error('复制失败，可选中卡密后手动复制。');}
  }
  return <section className="account-redemption card-delivery" aria-label="获取卡密" aria-busy={loading}>
    <h3>获取卡密</h3>
    {delivery?.delivered?<><p className="card-delivery-status"><Icon name="circle-check" />卡密已交付</p><code className="delivered-voucher">{delivery.code}</code>
      <button type="button" className="button primary" onClick={()=>void copy()}><Icon name="copy" />复制卡密</button>
      {delivery.usageInstructions && <section className="card-usage-instructions" aria-label="使用说明"><h4>使用说明</h4><p>{delivery.usageInstructions}</p></section>}
      <p className="field-hint">请妥善保管卡密。关闭页面后，可通过“我的订单”再次查看。</p></>:<>
      <p role={error?'alert':'status'}>{loading?'付款已确认，正在获取卡密…':error||'暂时没有可用卡密，请联系客服或稍后重新获取。'}</p>
      <button type="button" className="button secondary" disabled={loading} onClick={()=>setAttempt(value=>value+1)}>{loading?'正在获取…':'重新获取卡密'}</button>
    </>}
  </section>;
}
