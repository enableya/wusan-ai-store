import { useState } from 'react';
import { useMessage } from '../app/MessageProvider';
import { postApi } from '../services/api';
import type { AdminOrderList } from '../types/admin';
import { Dialog } from './Dialog';

export function ReclaimVoucherDialog({order,onClose,onSaved,onExpired}: {
  order: AdminOrderList['orders'][number]; onClose: () => void; onSaved: () => void; onExpired: () => void;
}) {
  const message = useMessage();
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  async function reclaim() {
    if (busy) return;
    setBusy(true);setError('');
    try {
      await postApi(`/admin/orders/${encodeURIComponent(order.id)}/reclaim-voucher`,{expectedVoucherCode:order.voucherCode});
      message.success('卡密已回收，订单已取消。');onSaved();
    } catch (cause) {
      if (cause && typeof cause === 'object' && 'status' in cause && cause.status === 401) onExpired();
      setError(cause instanceof Error ? cause.message : '暂时无法回收卡密，请稍后重试。');
    } finally { setBusy(false); }
  }
  return <Dialog title="回收卡密" onClose={() => {if(!busy)onClose();}}>
    <div className="order-refund-form">
      <dl><dt>订单号</dt><dd className="mono">{order.id}</dd><dt>商品</dt><dd>{order.productName}</dd><dt>卡密</dt><dd><code>{order.voucherCode}</code></dd></dl>
      <p>系统将实时核实卡密是否未使用。回收成功后，卡密返回原商品库存，订单取消并显示「卡密已回收」，该订单不能继续充值。</p>
      <p className="field-hint">已使用、正在充值或结果尚未确认的卡密不能回收。免付开通订单不涉及退款。</p>
      {error && <p className="order-error" role="alert">{error}</p>}
      <div className="order-refund-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>取消</button><button type="button" className="button primary" disabled={busy} onClick={() => void reclaim()}>{busy ? '正在核实并回收…' : '确认回收并取消订单'}</button></div>
    </div>
  </Dialog>;
}
