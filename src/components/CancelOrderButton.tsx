import { useRef, useState } from 'react';
import { useMessage } from '../app/MessageProvider';
import { postApi, requestApi } from '../services/api';
import { money } from '../lib/format';
import type { Order } from '../types/orders';
import { Dialog } from './Dialog';
import './cancel-order.css';

export function CancelOrderButton({ order, onChanged, onBusyChange, disabled = false, className = 'text-button' }: {
  order: Order; onChanged: (order: Order) => void; onBusyChange?: (busy: boolean) => void; disabled?: boolean; className?: string;
}) {
  const message = useMessage();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const action = !order.staffCheckout && !order.cancellation && ((order.status === 'pending' && order.cancelAction === 'cancel')
    || (order.status === 'paid' && order.cancelAction === 'request_refund')) ? order.cancelAction : null;
  if (!action) return null;
  const paid = action === 'request_refund';
  async function cancel() {
    if (locked.current || disabled) return;
    locked.current = true; setBusy(true); setError(''); onBusyChange?.(true);
    try {
      const result = await postApi<Order>(`/orders/${encodeURIComponent(order.id)}/cancel`, { expectedAction: action }, undefined, AbortSignal.timeout(60000));
      onChanged(result); setOpen(false);
      if (result.cancellation?.state === 'refund_review') message.success('取消申请已提交，退款待后台审核。');
      else if (result.status === 'cancelled') message.success('订单已取消。');
      else if (result.cancellation) message.info(result.cancellation.message);
      else message.info('订单状态已更新，请重新核对后操作。');
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : '取消结果暂未确认，请刷新订单后重试。';
      setError(text); message.error(text);
      // A late payment or concurrent recharge may have changed eligibility while the dialog was open.
      try { onChanged(await requestApi<Order>(`/orders/${encodeURIComponent(order.id)}`, AbortSignal.timeout(10000))); }
      catch { /* Keep the error visible and allow the customer to retry a read later. */ }
    } finally { locked.current = false; setBusy(false); onBusyChange?.(false); }
  }
  return <>
    <button type="button" className={className} disabled={disabled || busy} onClick={() => { setError(''); setOpen(true); }}>取消订单</button>
    {open && <Dialog title={paid ? '申请取消订单' : '取消订单'} onClose={() => { if (!busy) setOpen(false); }}>
      <dl className="order-cancel-summary"><dt>订单号</dt><dd className="mono">{order.id}</dd><dt>商品</dt><dd>{order.productName}</dd><dt>订单金额</dt><dd>¥{money(order.priceCents)}</dd></dl>
      <p>{paid ? '确认后将核实该订单是否尚未充值。符合条件的订单会取消，款项需后台审核通过后原路退回；审核期间不退款，卡密继续保留占用。' : '确认后将核实付款状态并关闭未付款交易。取消后无法继续支付此订单，需要重新下单。'}</p>
      {error && <p className="order-cancel-error" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setOpen(false)}>暂不取消</button>
        <button type="button" className="button primary" disabled={busy || disabled} onClick={() => void cancel()}>{busy ? '正在核实…' : paid ? '提交取消申请' : '确认取消订单'}</button></div>
    </Dialog>}
  </>;
}
