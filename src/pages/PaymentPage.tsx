import { useMessage } from '../app/MessageProvider';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Breadcrumb, EmptyPage, Notice, PageHeading } from '../components/Page';
import { AccountRedemption } from '../components/AccountRedemption';
import { CancelOrderButton } from '../components/CancelOrderButton';
import { ApiState } from '../components/ApiState';
import { Icon } from '../components/Icon';
import { SupportButton } from '../components/SupportButton';
import { useApiResource } from '../hooks/useApiResource';
import { usePageTitle } from '../hooks/usePageTitle';
import { postApi } from '../services/api';
import type { Order, PaymentConfig } from '../types/orders';
import { orderStatusLabel } from '../types/orders';
import { formatDate, money } from '../lib/format';
import './product-detail.css';

export default function PaymentPage() {
  const { orderRef } = useParams();
  usePageTitle('订单与支付');
  const resource = useApiResource<Order>(orderRef ? `/orders/${encodeURIComponent(orderRef)}` : null);
  const config = useApiResource<PaymentConfig>('/payments/config');
  const [updated, setUpdated] = useState<Order | null>(null);
  const [busy, setBusy] = useState<'pay' | 'query' | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [redemptionSubmitted, setRedemptionSubmitted] = useState(false);
  const onRedemptionSubmitted = useCallback(() => {
    setRedemptionSubmitted(true);
    window.dispatchEvent(new Event('wusan:orders-updated'));
  }, []);
  const $message = useMessage();
  const queryFailed = useRef(false);
  const [now, setNow] = useState(Date.now());
  const lock = useRef(false);
  const order = updated?.id === orderRef ? updated : resource.data;
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!orderRef || lock.current) return;
    lock.current = true; setBusy('query');
    try {
      const result = await postApi<Order>(`/orders/${encodeURIComponent(orderRef)}/refresh`, {}, undefined, signal);
      if (signal?.aborted) return;
      setUpdated(result);
      queryFailed.current = false;
      if (result.status === 'paid') $message.success('付款已确认。');
      else if (!signal && result.status === 'pending') $message.info('暂未确认付款，结果可能稍有延迟，请稍后查询。');
    } catch (cause) {
      if (signal?.aborted) return;
      if (!signal || !queryFailed.current) $message.error(cause instanceof Error ? cause.message : '暂时无法查询支付结果，请稍后重试。');
      queryFailed.current = true;
    } finally { lock.current = false; if (!signal?.aborted) setBusy(null); }
  }, [orderRef, $message]);
  useEffect(() => {
    setUpdated(null); queryFailed.current = false; setBusy(null); setRedemptionSubmitted(false);
  }, [orderRef, $message]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  // A return URL is only a reason to query; its untrusted parameters never mark an order paid.
  useEffect(() => {
    if (!config.data?.enabled || order?.status !== 'pending' || cancelling) return;
    const controller = new AbortController();
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState === 'visible') { await refresh(controller.signal); attempts += 1; }
      if (!controller.signal.aborted && attempts < 12) timer = setTimeout(poll, 5000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [config.data?.enabled, order?.status, orderRef, refresh, cancelling]);
  async function pay() {
    if (!order || lock.current) return;
    lock.current = true; setBusy('pay');
    try {
      const result = await postApi<{ paymentHtml: string }>(`/orders/${order.id}/payment`, {});
      const document = new DOMParser().parseFromString(result.paymentHtml, 'text/html');
      const form = document.querySelector('form');
      if (!form || form.method.toLowerCase() !== 'post') throw new Error('支付表单异常，请联系支持。');
      const target = new URL(form.action);
      const gateway = order.environment === 'production' ? 'openapi.alipay.com' : 'openapi-sandbox.dl.alipaydev.com';
      if (config.data?.environment !== order.environment || target.protocol !== 'https:' || target.hostname !== gateway || target.pathname !== '/gateway.do' || target.username || target.password || target.port) throw new Error('支付环境或地址异常，请联系支持。');
      const container = window.document.createElement('div');
      container.hidden = true;
      const submitted = window.document.createElement('form');
      submitted.method = 'POST'; submitted.action = target.href;
      for (const input of form.querySelectorAll('input[type=hidden]')) {
        const field = window.document.createElement('input'); field.type = 'hidden';
        field.name = (input as HTMLInputElement).name; field.value = (input as HTMLInputElement).value;
        submitted.appendChild(field);
      }
      container.appendChild(submitted); window.document.body.appendChild(container); submitted.submit();
    } catch (cause) { $message.error(cause instanceof Error ? cause.message : '无法打开支付宝，请重试。'); }
    finally { lock.current = false; setBusy(null); }
  }
  if (resource.error?.status === 404) return <EmptyPage title="无法查看这个订单" description="订单不存在或当前浏览器无权访问。可在我的订单中使用联系方式和查询密码找回。" button="返回我的订单" to="/orders" icon="lock-keyhole" />;
  if (!orderRef) return <EmptyPage title="正在确认支付结果" description="请在下单时的浏览器打开我的订单，通过服务端查询确认付款状态。" button="查看我的订单" to="/orders" icon="shield-check" />;
  if (!order) return <ApiState error={resource.error} retry={resource.reload} title="正在读取订单" />;
  const remaining = Math.max(0, Math.ceil((Date.parse(order.expiresAt) - now) / 1000));
  const canPay = order.status === 'pending' && remaining > 0 && config.data?.enabled && config.data.environment === order.environment;
  const resultTitle = order.staffCheckout ? '连接账号' : '支付结果';
  return <div className="container page-space">
    <Breadcrumb items={[{ label: '我的订单', to: '/orders' }, { label: order.status === 'paid' ? resultTitle : '订单与支付' }]} />
    <PageHeading title={order.cancellation?.voucherReclaimed ? '卡密已回收，订单已取消' : order.status === 'cancelled' ? '订单已取消' : order.staffCheckout ? '免付开通订单' : order.status === 'paid' ? '付款已确认' : order.status === 'closed' ? '订单已关闭' : '订单已创建，等待付款'} eyebrow="ORDER & PAYMENT" description={order.status === 'pending' ? '请核对金额后通过支付宝付款。' : undefined} />
    {!order.staffCheckout && (config.error ? <button type="button" className="text-button" onClick={config.reload}>重试加载支付配置</button>
      : !config.data?.enabled && <Notice>{config.data?.message || '正在读取支付配置…'}</Notice>)}
    <div className="detail-layout"><section className="order-detail-main">
      <div className="section-heading"><h2>订单信息</h2><span className="status-badge pending">{orderStatusLabel(order)}</span></div>
      <dl className="spec-list"><div><dt>订单号</dt><dd className="mono">{order.id}</dd></div>
        <div><dt>订阅方案</dt><dd>{order.productName}</dd></div><div><dt>周期 / 数量</dt><dd>{order.periodMonths} 个月 / 1 份</dd></div>
        <div><dt>订单金额</dt><dd>¥{money(order.priceCents)}</dd></div><div><dt>创建时间</dt><dd>{formatDate(order.createdAt)}</dd></div>
        {!order.staffCheckout && <><div><dt>付款截止</dt><dd>{formatDate(order.expiresAt)}</dd></div><div><dt>支付方式</dt><dd>支付宝</dd></div></>}
        {order.paidAt && <div><dt>到账确认时间</dt><dd>{formatDate(order.paidAt)}</dd></div>}
        {order.tradeNo && <div><dt>支付宝交易号</dt><dd className="mono">{order.tradeNo}</dd></div>}
      </dl>
      <p className="field-hint">{order.staffCheckout ? '更换设备后，登录已绑定的商城账号即可查看。' : '更换设备后，可在「我的订单」中使用联系方式和查询密码找回订单。'}</p>
    </section><aside className="purchase-panel order-summary">
      <h2>{order.status === 'cancelled' ? '订单已取消' : order.status === 'paid' ? resultTitle : '支付宝收银台'}</h2>
      <div className="summary-total"><span>订单金额</span><strong>¥{money(order.priceCents)}</strong></div>
      {order.status === 'pending' && <p className="body-copy">{remaining > 0 ? `剩余付款时间 ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : '付款时间已结束，请先查询支付结果。已付款请勿重复下单。'}</p>}
      {order.status === 'pending' && <button className="button primary full-width" type="button" disabled={!canPay || !!busy || cancelling} onClick={pay}><Icon name="credit-card" />{busy === 'pay' ? '正在打开支付宝…' : canPay ? '前往支付宝付款' : '当前不可付款'}</button>}
      {order.environment === 'sandbox' && order.status === 'pending' && <p className="field-hint">请使用支付宝沙箱版和沙箱买家账号付款。</p>}
      {order.status === 'pending' && <button className="button secondary full-width spaced-button" type="button" disabled={!!busy || cancelling || !config.data?.enabled} onClick={() => void refresh()}>{busy === 'query' ? '正在查询…' : '我已付款，查询结果'}</button>}
      {order.cancellation && <Notice>{order.cancellation.message}</Notice>}
      {order.status === 'paid' && !order.cancellation && <AccountRedemption key={order.id} orderId={order.id} productName={order.productName} onResult={onRedemptionSubmitted} onBusyChange={setRedeeming} />}
      <CancelOrderButton order={redemptionSubmitted ? { ...order, cancelAction: null } : order} className="button secondary full-width spaced-button" disabled={!!busy || redeeming} onBusyChange={value => { setCancelling(value); lock.current = value; }} onChanged={next => { setUpdated(next); window.dispatchEvent(new Event('wusan:orders-updated')); }} />
      {(order.status === 'closed' || order.status === 'cancelled') && <Link className="button primary full-width" to={`/products/${order.productId}`}>重新选择并下单</Link>}
      <div className="order-detail-actions">
        <SupportButton className="button secondary"><Icon name="headphones" />联系支持</SupportButton>
        <Link className="button secondary" to="/orders"><Icon name="arrow-left" />返回我的订单</Link>
      </div>
    </aside></div>
  </div>;
}
