import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUI } from '../app/UIProvider';
import { useCustomer } from '../app/CustomerProvider';
import { Icon } from '../components/Icon';
import { Notice, PageHeading } from '../components/Page';
import { SmallProductIcon } from '../components/Product';
import { CancelOrderButton } from '../components/CancelOrderButton';
import { useApiResource } from '../hooks/useApiResource';
import type { Product } from '../types/catalog';
import { usePageTitle } from '../hooks/usePageTitle';
import { useSelections } from '../hooks/useSelections';
import { formatDate, money } from '../lib/format';
import { ApiState } from '../components/ApiState';
import type { Order } from '../types/orders';
import { orderStatus, orderStatusLabel } from '../types/orders';
import { orderRechargeTag } from '../lib/redemption-status';

export default function OrdersPage() {
  usePageTitle('我的订单');
  const { openModal } = useUI();
  const { user } = useCustomer();
  const [filter, setFilter] = useState('全部');
  const [query, setQuery] = useState('');
  const selections = useSelections();
  const orders = useApiResource<Order[]>('/orders');
  const staffCheckout = user?.staffCheckout === true;
  useEffect(() => { if (staffCheckout) orders.reload(); }, [staffCheckout, orders.reload]);
  useEffect(() => { const reload = () => orders.reload(); window.addEventListener('wusan:orders-updated', reload); return () => window.removeEventListener('wusan:orders-updated', reload); }, [orders.reload]);
  const catalog = useApiResource<Product[]>(selections.length ? '/products' : null);
  const normalized = query.trim().toLowerCase();
  const filtered = selections.filter((selection) => !normalized || selection.productName.toLowerCase().includes(normalized) || selection.id.includes(normalized));
  const visibleOrders = (orders.data || []).filter(order => !order.staffCheckout || staffCheckout);
  const orderCounts = visibleOrders.reduce<Record<string, number>>((counts, order) => {
    const status = order.staffCheckout && order.status === 'paid' ? '免付开通' : orderStatus[order.status];
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, { 全部: visibleOrders.length });
  const matching = visibleOrders.filter(order => (filter === '全部' || (order.staffCheckout && order.status === 'paid' ? '免付开通' : orderStatus[order.status]) === filter)
    && (!normalized || order.productName.toLowerCase().includes(normalized) || order.id.toLowerCase().includes(normalized)));
  const recover = () => openModal({ type: 'recover' });
  return <div className="container page-space orders-page">
    <PageHeading title="我的订单" eyebrow="YOUR ORDERS" description="每一次订阅，都有迹可循。"
      action={<button className="button secondary" type="button" onClick={recover}><Icon name="search" />找回订单</button>} />
    <Notice subtle>此处展示当前浏览器有权访问的订单。更换浏览器后，可用购买时的联系方式和查询密码找回订单。
      <button type="button" className="text-button" onClick={orders.reload}>刷新订单</button></Notice>
    <div className="orders-toolbar"><div className="underlined-tabs" role="group" aria-label="订单状态">
      {['全部', '待付款', '已付款', '已关闭', '订单已取消', ...(staffCheckout ? ['免付开通'] : [])].map((value) => <button key={value} type="button" data-order-filter={value}
        aria-label={value} aria-pressed={filter === value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>
        {value}{orderCounts[value] > 0 && <span className="count-label">{orderCounts[value]}</span>}
      </button>)}
    </div><div className="search-field"><Icon name="search" /><input id="order-search" type="search" placeholder="搜索订单号或商品名称" aria-label="搜索订单号或商品名称" maxLength={100} value={query} onChange={(event) => setQuery(event.target.value)} /></div></div>
    <div id="order-results" aria-live="polite">{!orders.data ? <ApiState compact error={orders.error} retry={orders.reload} title="正在读取订单" /> : matching.length > 0 ? <div className="draft-list">{matching.map(order => <div className="draft-row server-order-row" key={order.id}>
      <div className="draft-info"><strong>{order.productName}</strong><span className="mono">{order.id}</span><span>{formatDate(order.createdAt)}{order.environment === 'sandbox' ? ' · 沙箱测试' : ''}</span>
        <span className="order-recharge-status" data-tone={orderRechargeTag(order).tone}>{order.deliveryType==='voucher'?'交付状态：':'充值状态：'}<span className="order-recharge-badge">{orderRechargeTag(order).label}</span></span>
        {order.fulfillment?.status === 'succeeded' && <span className="order-recharge-email">充值邮箱：{order.fulfillment.rechargeEmail || '未记录'}</span>}
        {order.cancellation && <span className="order-cancellation-note" data-state={order.cancellation.state}>{order.cancellation.message}</span>}</div>
      <span className="draft-price">¥{money(order.priceCents)}</span><span className="status-badge pending">{orderStatusLabel(order)}</span>
      <div className="server-order-actions"><CancelOrderButton order={order} onChanged={orders.reload} /><Link className="text-button" to={`/orders/${order.id}`}>{order.status === 'pending' ? '查看 / 付款' : '查看订单'} <Icon name="arrow-right" /></Link></div>
    </div>)}</div> : <div className="empty-state">
      <div className="empty-icon"><Icon name={normalized ? 'search-x' : 'receipt-text'} /></div>
      <h2>{normalized ? '没有匹配的订单' : filter === '全部' ? '还没有订单' : `暂无${filter}订单`}</h2>
      <p>{normalized ? '试试其他订单号或商品名称。' : '浏览套餐并确认服务条件，支付宝可用后即可创建订单。'}</p>
      <div className="empty-actions"><Link className="button primary" to="/">浏览订阅套餐 <Icon name="arrow-right" /></Link><button className="button secondary" type="button" onClick={recover}><Icon name="search" />通过密码查询</button></div>
    </div>}</div>
    {filter === '全部' && filtered.length > 0 && <section className="draft-section">
      <div className="section-heading"><div><h2>本机套餐清单 <span className="count-label">{filtered.length}</span></h2><p>仅保存在此浏览器，不是真实订单。</p></div></div>
      {catalog.error && <Notice subtle>最新商品信息暂时无法获取，以下仍为保存时的清单。<button className="text-button" type="button" onClick={catalog.reload}>重试</button></Notice>}
      <div className="draft-list">{filtered.map((selection) => <div className="draft-row" key={selection.id}>
        <SmallProductIcon product={catalog.data?.find((product) => product.id === selection.productId)} /><div className="draft-info"><strong>{selection.productName}</strong><span>{formatDate(selection.createdAt)} 保存</span></div>
        <span className="draft-price">¥{money(selection.priceCents)}<small>保存时价格</small></span><span className="status-badge pending">套餐草稿</span>
        <Link className="text-button" to={`/orders/${encodeURIComponent(selection.id)}`}>查看 <Icon name="arrow-right" /></Link>
        <button className="icon-button" type="button" title="删除套餐草稿" aria-label={`删除 ${selection.productName} 套餐草稿`} onClick={() => openModal({ type: 'delete-selection', id: selection.id })}><Icon name="trash-2" /></button>
      </div>)}</div>
    </section>}
  </div>;
}
