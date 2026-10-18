import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Breadcrumb, EmptyPage, Notice, PageHeading } from '../components/Page';
import { ApiState } from '../components/ApiState';
import { Icon } from '../components/Icon';
import { useApiResource } from '../hooks/useApiResource';
import { usePageTitle } from '../hooks/usePageTitle';
import { postApi } from '../services/api';
import type { Order, PaymentConfig } from '../types/orders';
import { orderStatus } from '../types/orders';
import { formatDate, money } from '../lib/format';

export default function PaymentPage() {
  const { orderRef } = useParams();
  usePageTitle('订单与支付');
  const resource = useApiResource<Order>(orderRef ? `/orders/${encodeURIComponent(orderRef)}` : null);
  const config = useApiResource<PaymentConfig>('/payments/config');
  const [updated, setUpdated] = useState<Order | null>(null);
  const [busy, setBusy] = useState<'pay' | 'query' | null>(null);
  const [error, setError] = useState('');
  const [checked, setChecked] = useState(false);
  const [now, setNow] = useState(Date.now());
  const lock = useRef(false);
  const order = updated?.id === orderRef ? updated : resource.data;
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!orderRef || lock.current) return;
    lock.current = true; setBusy('query'); setError('');
    try {
      const result = await postApi<Order>(`/orders/${encodeURIComponent(orderRef)}/refresh`, {}, undefined, signal);
      if (!signal?.aborted) { setUpdated(result); setChecked(true); }
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : '暂时无法查询支付结果，请稍后重试。');
    } finally { lock.current = false; if (!signal?.aborted) setBusy(null); }
  }, [orderRef]);
  useEffect(() => {
    setUpdated(null); setError(''); setChecked(false); setBusy(null);
  }, [orderRef]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  // A return URL is only a reason to query; its untrusted parameters never mark an order paid.
  useEffect(() => {
    if (!config.data?.enabled || order?.status !== 'pending') return;
    const controller = new AbortController();
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState === 'visible') { await refresh(controller.signal); attempts += 1; }
      if (!controller.signal.aborted && attempts < 12) timer = setTimeout(poll, 5000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [config.data?.enabled, order?.status, orderRef, refresh]);
  async function pay() {
    if (!order || lock.current) return;
    lock.current = true; setBusy('pay'); setError('');
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
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法打开支付宝，请重试。'); }
    finally { lock.current = false; setBusy(null); }
  }
  if (resource.error?.status === 404) return <EmptyPage title="无法查看这个订单" description="订单不存在或当前浏览器无权访问。请使用下单时的浏览器，勿清除本站 Cookie。" button="返回我的订单" to="/orders" icon="lock-keyhole" />;
  if (!orderRef) return <EmptyPage title="正在确认支付结果" description="请在下单时的浏览器打开我的订单，通过服务端查询确认付款状态。" button="查看我的订单" to="/orders" icon="shield-check" />;
  if (!order) return <ApiState error={resource.error} retry={resource.reload} title="正在读取订单" />;
  const remaining = Math.max(0, Math.ceil((Date.parse(order.expiresAt) - now) / 1000));
  const canPay = order.status === 'pending' && remaining > 0 && config.data?.enabled && config.data.environment === order.environment;
  return <div className="container page-space">
    <Breadcrumb items={[{ label: '我的订单', to: '/orders' }, { label: order.status === 'paid' ? '支付结果' : '订单与支付' }]} />
    <PageHeading title={order.status === 'paid' ? '付款已确认' : order.status === 'closed' ? '订单已关闭' : '订单已创建，等待付款'} eyebrow="ORDER & PAYMENT" description={order.status === 'paid' ? '支付宝交易已核实，可在这里查看订单信息。' : '请核对订单与金额，通过支付宝完成付款。'} />
    {order.environment === 'sandbox' && <Notice>支付宝沙箱订单，仅用于测试，不产生真实扣款或订阅交付。扫码需使用支付宝沙箱版 App，并登录沙箱买家账号；日常使用的支付宝不能用于沙箱扫码测试。</Notice>}
    {order.environment === 'production' && <Notice>这是正式交易订单，付款将产生真实扣款。付款结果以服务端核实的订单状态为准。</Notice>}
    {!config.data?.enabled && <Notice>{config.data?.message || '正在读取支付配置…'}{config.error && <button type="button" className="text-button" onClick={config.reload}>重试加载支付配置</button>}</Notice>}
    <div className="detail-layout"><section className="order-detail-main">
      <div className="section-heading"><h2>订单信息</h2><span className="status-badge pending">{orderStatus[order.status]}</span></div>
      <dl className="spec-list"><div><dt>订单号</dt><dd className="mono">{order.id}</dd></div>
        <div><dt>订阅方案</dt><dd>{order.productName}</dd></div><div><dt>周期 / 数量</dt><dd>{order.periodMonths} 个月 / 1 份</dd></div>
        <div><dt>订单金额</dt><dd>¥{money(order.priceCents)}</dd></div><div><dt>创建时间</dt><dd>{formatDate(order.createdAt)}</dd></div>
        <div><dt>付款截止</dt><dd>{formatDate(order.expiresAt)}</dd></div><div><dt>支付方式</dt><dd>支付宝</dd></div>
        {order.paidAt && <div><dt>到账确认时间</dt><dd>{formatDate(order.paidAt)}</dd></div>}
        {order.tradeNo && <div><dt>支付宝交易号</dt><dd className="mono">{order.tradeNo}</dd></div>}
        <div><dt>交付方式</dt><dd>{order.details.deliveryMethod || '请联系经营方确认'}</dd></div>
        <div><dt>交付时间</dt><dd>{order.details.deliveryTime || '未设置交付承诺'}</dd></div>
        <div><dt>售后说明</dt><dd>{order.details.afterSales || '请联系经营方确认'}</dd></div>
      </dl>
      <Notice subtle>付款状态与订阅交付分别处理。本站尚未接入自动交付、邮件通知及在线退款；已付款订单请保留订单号，联系经营方办理后续服务。</Notice>
      <p className="field-hint">订单访问凭证保存在当前浏览器的安全 Cookie 中。更换设备、清除 Cookie 后无法直接查询；邮箱验证码找回尚未开通。</p>
    </section><aside className="purchase-panel order-summary">
      <h2>{order.status === 'paid' ? '支付结果' : '支付宝收银台'}</h2>
      <div className="summary-total"><span>订单金额</span><strong>¥{money(order.priceCents)}</strong></div>
      {order.status === 'pending' && <p className="body-copy">{remaining > 0 ? `剩余付款时间 ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : '付款时间已结束，请先查询支付结果。已付款请勿重复下单。'}</p>}
      {order.status === 'pending' && <button className="button primary full-width" type="button" disabled={!canPay || !!busy} onClick={pay}><Icon name="credit-card" />{busy === 'pay' ? '正在打开支付宝…' : canPay ? '前往支付宝付款' : '当前不可付款'}</button>}
      {order.environment === 'sandbox' && order.status === 'pending' && <p className="field-hint">如收银台提供“账号付款”入口，可用开放平台「沙箱账号」中的买家账号登录付款。遇到“二维码不可用”时，请先检查客户端与账号是否属于沙箱环境。</p>}
      {order.status === 'pending' && <button className="button secondary full-width spaced-button" type="button" disabled={!!busy || !config.data?.enabled} onClick={() => void refresh()}>{busy === 'query' ? '正在查询…' : '我已付款，查询结果'}</button>}
      {order.status === 'paid' && <p className="body-copy"><Icon name="circle-check" /> 已付款 · {order.environment === 'sandbox' ? '沙箱验证成功' : '服务端已核实到账'}</p>}
      {order.status === 'closed' && <Link className="button primary full-width" to={`/checkout/${order.productId}`}>重新选择并下单</Link>}
      <p className="field-error" role="alert">{error}</p>
      {checked && order.status === 'pending' && <p role="status" className="field-hint">暂未确认付款，结果可能稍有延迟，请稍后查询。</p>}
      <p className="panel-footnote"><Icon name="shield-check" />以服务端核实结果为准，不以返回页面作为付款成功凭证。</p>
      <Link className="text-button spaced-button" to="/support">联系支持 <Icon name="arrow-up-right" /></Link>
      <Link className="text-button spaced-button" to="/orders"><Icon name="arrow-left" />返回我的订单</Link>
    </aside></div>
  </div>;
}
