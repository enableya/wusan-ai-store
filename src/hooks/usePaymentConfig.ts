import {useEffect} from 'react';
import {useApiResource} from './useApiResource';
import type {PaymentConfig} from '../types/orders';

export function usePaymentConfig(productId?:string,active=true){
  const resource=useApiResource<PaymentConfig>(active?'/payments/config':null,{keepDataWhileReloading:true});
  useEffect(()=>{
    if(!active)return;
    const reload=()=>{if(document.visibilityState==='visible')resource.reload();};
    const timer=setInterval(reload,10000);
    window.addEventListener('focus',reload);window.addEventListener('wusan:payment-controls',reload);
    const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('wusan-payment-controls');
    if(channel)channel.onmessage=reload;
    return()=>{clearInterval(timer);window.removeEventListener('focus',reload);window.removeEventListener('wusan:payment-controls',reload);channel?.close();};
  },[active,resource.reload]);
  const blocked=!!productId&&!!resource.data?.blockedProductIds?.includes(productId);
  const data=resource.data&&blocked?{...resource.data,enabled:false,gatewayEnabled:resource.data.gatewayEnabled??resource.data.enabled,
    message:resource.data.globallyPaused?resource.data.message:'该商品暂时关闭支付，请稍后再来。'}:resource.data;
  return {...resource,data,paused:!!resource.data?.globallyPaused||blocked};
}
