import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useMessage } from '../app/MessageProvider';
import { useApiResource } from '../hooks/useApiResource';
import { Link } from 'react-router-dom';
import { formatDate, money } from '../lib/format';
import { orderPaymentTypes, orderRefundReviewStatuses } from '../types/admin';
import type { AdminOrderList } from '../types/admin';
import { orderStatus } from '../types/orders';
import { orderRechargeTag } from '../lib/redemption-status';
import { AdminTable } from './AdminTable';
import { DateField } from './DateField';
import { SelectField } from './SelectField';
import { Icon } from './Icon';
import './admin-orders.css';

const day = (offset = 0) => new Date(Date.now() + 8 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
const emptyFilters = { orderNo: '', status: '', paymentType: '', refundReview: '', category: '', productId: '', start: '', end: '' };
const initialFilters = () => ({ ...emptyFilters, start: day(-29), end: day() });
const categoryName = (category: string) => category === 'unknown' ? '未分类' : category;

export function AdminOrders({ onExpired }: { onExpired: () => void }) {
  const message = useMessage();
  const [filters, setFilters] = useState(() => ({ ...initialFilters(), page: 1 }));
  const [draft, setDraft] = useState(initialFilters);
  const [products, setProducts] = useState<AdminOrderList['products']>([]);
  const report = useApiResource<AdminOrderList>(`/admin/orders?${new URLSearchParams({ ...filters, page: String(filters.page) })}`, { keepDataWhileReloading: true });
  const { reload, loading, error, data } = report;
  useEffect(() => { if (error?.status === 401) onExpired(); }, [error?.status, onExpired]);
  useEffect(() => { if (data) setProducts(data.products); }, [data]);


  function apply(event: FormEvent) {
    event.preventDefault();
    if ((draft.start && draft.end && draft.start > draft.end) || draft.start > day() || draft.end > day()) {
      message.warning('请选择有效的下单日期，开始日期不能晚于结束日期。'); return;
    }
    setFilters({ ...draft, orderNo: draft.orderNo.trim(), page: 1 });
    reload();
  }
  function preset(days: number | null) {
    const next = { ...draft, start: days ? day(1 - days) : '', end: days ? day() : '' };
    setDraft(next); setFilters({ ...next, page: 1 }); reload();
  }
  function reset() { setDraft(emptyFilters); setFilters({ ...emptyFilters, page: 1 }); reload(); }
  async function copyVoucher(code: string) {
    try { await navigator.clipboard.writeText(code); message.success('卡密已复制。'); }
    catch { message.error('复制失败，可选中卡密后手动复制。'); }
  }
  const page = data?.page ?? filters.page;
  return <>
    <div className="admin-heading"><div><div className="eyebrow">ORDER MANAGEMENT</div><h1>订单管理</h1><p>查看订单、付款与充值状态，支持组合筛选。</p></div>
      <button type="button" className="button secondary" onClick={reload} disabled={loading}><Icon name="refresh-cw" />刷新订单</button>
    </div>
    <form className="order-filters" onSubmit={apply}>
      <label className="order-number-field">订单号<input placeholder="输入完整或部分订单号" maxLength={80} value={draft.orderNo} onChange={event => setDraft(current => ({ ...current, orderNo: event.target.value }))} /></label>
      <SelectField label="订单状态" value={draft.status || 'all'} onValueChange={value => setDraft(current => ({ ...current, status: value === 'all' ? '' : value }))}
        options={[{ value: 'all', label: '全部状态' }, ...Object.entries(orderStatus).map(([value, label]) => ({ value, label }))]} />
      <SelectField label="付费类别" value={draft.paymentType || 'all'} onValueChange={value => setDraft(current => ({ ...current, paymentType: value === 'all' ? '' : value }))}
        options={[{ value: 'all', label: '全部类别' }, ...Object.entries(orderPaymentTypes).map(([value, label]) => ({ value, label }))]} />
      <SelectField label="退款审核" value={draft.refundReview || 'all'} onValueChange={value => setDraft(current => ({ ...current, refundReview: value === 'all' ? '' : value }))}
        options={[{ value: 'all', label: '全部审核状态' }, ...Object.entries(orderRefundReviewStatuses).map(([value, label]) => ({ value, label }))]} />
      <SelectField label="商品分类" value={draft.category || 'all'} onValueChange={value => setDraft(current => ({ ...current, category: value === 'all' ? '' : value }))}
        options={[{ value: 'all', label: '全部分类' }, { value: 'Plus', label: 'Plus' }, { value: 'Pro', label: 'Pro' }, { value: 'unknown', label: '未分类' }]} />
      <SelectField label="商品" value={draft.productId || 'all'} onValueChange={value => setDraft(current => ({ ...current, productId: value === 'all' ? '' : value }))}
        options={[{ value: 'all', label: '全部商品' }, ...products.map(product => ({ value: product.id, label: product.name }))]} />
      <DateField label="下单开始日期" value={draft.start} today={day()} onChange={start => setDraft(current => ({ ...current, start }))} />
      <DateField label="下单结束日期" value={draft.end} today={day()} onChange={end => setDraft(current => ({ ...current, end }))} />
      <div className="order-filter-actions"><button className="button primary" type="submit">查询</button><button className="button secondary" type="button" onClick={reset}>重置筛选</button></div>
      <div className="order-presets"><div className="admin-presets" aria-label="订单快捷日期">{[1, 7, 30].map(days => <button type="button" key={days} className={filters.start === day(1 - days) && filters.end === day() ? 'active' : ''} onClick={() => preset(days)}>{days === 1 ? '今日' : `近 ${days} 天`}</button>)}<button type="button" className={!filters.start && !filters.end ? 'active' : ''} onClick={() => preset(null)}>全部时间</button></div><span>{!filters.start && !filters.end ? '当前查询全部时间' : `${filters.start || '不限'} 至 ${filters.end || '不限'}`} · 北京时间</span></div>
    </form>
    <div className="order-update"><span role="status">{loading ? '正在更新订单…' : error ? '更新失败，请重试' : data ? `最近更新：${new Date(data.updatedAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}` : ''}</span></div>
    {error && <div className="order-error" role="alert">{error.message}<button type="button" className="text-button" onClick={reload}>重新加载</button></div>}
    {data && <>
      <div className="order-metrics" aria-busy={loading}>{[
        ['筛选订单', data.total], ['待付款', data.counts.pending], ['已付款', data.counts.paid], ['已关闭', data.counts.closed], ['订单已取消', data.counts.cancelled],
      ].map(([label, count]) => <section className="admin-metric" key={label}><span>{label}</span><strong>{count.toLocaleString('zh-CN')}</strong><small>当前筛选范围</small></section>)}</div>
      <section className="admin-panel order-list" aria-busy={loading}>
        <div className="admin-panel-title"><div><h2 id="order-list-title">订单列表</h2><p>按下单时间倒序 · 待付款包含尚未关闭的过期订单</p></div><span className="admin-chip">{data.environment === 'production' ? '正式数据' : '测试数据'}</span></div>
        <AdminTable className="order-table" labelledBy="order-list-title" emptyState={!data.orders.length && <p>暂无符合筛选条件的订单，可调整条件或重置筛选。</p>}>
          <thead><tr>{['订单号', '商品 / 分类', '付费类别', '卡密', '充值邮箱', '充值状态', '订单状态', '订单金额', '累计退款', '退款审核', '下单时间', '付款时间', '支付宝交易号'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{data.orders.map(order => <tr key={order.id}>
            <td className="order-id">{order.id}</td>
            <td><strong>{order.productName}</strong><small>{categoryName(order.category)}</small></td>
            <td><span className={`admin-chip ${order.paymentType === 'free' ? 'inactive' : ''}`}>{orderPaymentTypes[order.paymentType]}</span></td>
            <td className="order-voucher-cell">{!data.canViewVoucherCodes ? <span className="admin-table-secondary">无查看权限</span> : order.voucherCode ? <><code>{order.voucherCode}</code><button type="button" className="text-button" onClick={() => void copyVoucher(order.voucherCode!)} aria-label={`复制订单 ${order.id} 的卡密`}>复制卡密</button></> : <span className="admin-table-secondary">未分配 / 未记录</span>}</td>
            <td className="order-email-cell">{order.rechargeEmail || (order.status === 'pending' ? '尚未验证' : '未记录')}</td>
            <td className="order-recharge-cell"><span className="order-status" data-tone={orderRechargeTag(order).tone}>{orderRechargeTag(order).label}</span></td>
            <td><span className={`order-status ${order.status}`}>{orderStatus[order.status]}</span>{order.cancellationMessage && <small>{order.cancellationMessage}</small>}{order.status === 'pending' && Date.parse(order.expiresAt) <= Date.now() && <small>付款时间已过，待核实</small>}</td>
            <td className="admin-table-number">¥{money(order.priceCents)}</td><td className="admin-table-number">¥{money(order.refundedCents)}</td>
            <td className="order-refund-cell">{order.refundReview ? <>
              <strong>{orderRefundReviewStatuses[order.refundReview.status]}</strong>
              {order.refundReview.reviewedBy && <small>{order.refundReview.reviewedBy} · {formatDate(order.refundReview.reviewedAt!)}</small>}
              {order.refundReview.reason && <small>{order.refundReview.reason}</small>}
              {order.refundReview.status === 'pending' && data.canReviewRefunds && <Link className="text-button" to={`/admin?tab=refunds&orderNo=${encodeURIComponent(order.id)}`}>前往退款审核</Link>}
            </> : '—'}</td>
            <td>{formatDate(order.createdAt)}</td><td>{order.paidAt ? formatDate(order.paidAt) : '—'}</td><td className="order-id">{order.tradeNo || '—'}</td>
          </tr>)}</tbody>
        </AdminTable>
        <div className="order-pagination"><span>共 {data.total} 笔 · 第 {page} / {Math.max(1, Math.ceil(data.total / data.pageSize))} 页</span>
          <button className="button secondary" disabled={page <= 1 || loading} onClick={() => setFilters(current => ({ ...current, page: page - 1 }))}>上一页</button>
          <button className="button secondary" disabled={page * data.pageSize >= data.total || loading} onClick={() => setFilters(current => ({ ...current, page: page + 1 }))}>下一页</button></div>
      </section>
    </>}
    <p className="admin-method"><Icon name="info" />订单按系统已记录的支付结果显示，点击「刷新订单」获取最新状态。免付开通单会单独标记。</p>
  </>;
}
