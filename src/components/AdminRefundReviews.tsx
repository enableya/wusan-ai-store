import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMessage } from '../app/MessageProvider';
import { useApiResource } from '../hooks/useApiResource';
import { postApi } from '../services/api';
import { formatDate, money } from '../lib/format';
import { orderRefundReviewStatuses } from '../types/admin';
import type { AdminOrderList } from '../types/admin';
import { AdminTable } from './AdminTable';
import { SelectField } from './SelectField';
import { Icon } from './Icon';
import { Dialog } from './Dialog';
import './admin-orders.css';
import './admin-refunds.css';

function RefundReviewDialog({ order, approve, onClose, onSaved, onExpired }: {
  order: AdminOrderList['orders'][number]; approve: boolean; onClose: () => void; onSaved: () => void; onExpired: () => void;
}) {
  const message = useMessage();
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const title = approve ? '同意原路退款' : '驳回退款';
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || (approve && !confirmed)) return;
    setBusy(true);
    try {
      await postApi(`/admin/orders/${encodeURIComponent(order.id)}/refund/${approve ? 'approve' : 'reject'}`, { reason });
      message.success(approve ? '退款审核已通过，请刷新订单查看退款结果。' : '退款已驳回，未执行退款。'); onSaved();
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && error.status === 401) onExpired();
      message.error(error instanceof Error ? error.message : '审核失败，请刷新后重试。');
    } finally { setBusy(false); }
  }
  return <Dialog title={title} onClose={() => { if (!busy) onClose(); }}>
    <form className="order-refund-form" onSubmit={submit}>
      <dl><dt>订单号</dt><dd className="mono">{order.id}</dd><dt>商品</dt><dd>{order.productName}</dd><dt>待退金额</dt><dd><strong>¥{money(Math.max(0, order.priceCents - order.refundedCents))}</strong></dd></dl>
      <p>{approve ? '确认后系统会再次核实充值状态，通过后向原付款渠道退款。退款成功后回收可用卡密。' : '驳回后订单保持取消，系统不会执行退款，卡密继续保留占用。'}</p>
      <label>{approve ? '审核备注（选填）' : '驳回原因'}<textarea rows={3} maxLength={300} required={!approve} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} /></label>
      {approve && <label className="order-refund-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy} /><span>我已核对订单，同意将待退金额原路退回</span></label>}
      <div className="order-refund-actions"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>取消</button><button className="button primary" disabled={busy || (approve && !confirmed)}>{busy ? '处理中…' : title}</button></div>
    </form>
  </Dialog>;
}

export function AdminRefundReviews({ onExpired }: { onExpired: () => void }) {
  const message = useMessage();
  const [params] = useSearchParams();
  const [filters, setFilters] = useState(() => ({ orderNo: (params.get('orderNo') || '').slice(0, 80), refundReview: 'pending', page: 1 }));
  const [draft, setDraft] = useState(() => ({ orderNo: filters.orderNo, refundReview: filters.refundReview }));
  const [review, setReview] = useState<{ order: AdminOrderList['orders'][number]; approve: boolean } | null>(null);
  const resource = useApiResource<AdminOrderList>(`/admin/refunds?${new URLSearchParams({ ...filters, page: String(filters.page) })}`, { keepDataWhileReloading: true });
  const { data, loading, error, reload } = resource;
  useEffect(() => { if (error?.status === 401) onExpired(); }, [error?.status, onExpired]);
  function apply(event: FormEvent) {
    event.preventDefault(); setFilters({ ...draft, orderNo: draft.orderNo.trim(), page: 1 }); reload();
  }
  function reset() {
    const next = { orderNo: '', refundReview: 'pending' };
    setDraft(next); setFilters({ ...next, page: 1 }); reload();
  }
  async function copyVoucher(code: string) {
    try { await navigator.clipboard.writeText(code); message.success('卡密已复制。'); }
    catch { message.error('复制失败，可选中卡密后手动复制。'); }
  }
  const page = data?.page ?? filters.page;
  return <>
    <div className="admin-heading"><div><div className="eyebrow">REFUND REVIEW</div><h1>退款审核</h1><p>集中处理用户取消与超时订单的退款，同意后由系统核实并原路退回。</p></div>
      <button type="button" className="button secondary" disabled={loading} onClick={reload}><Icon name="refresh-cw" />刷新退款记录</button>
    </div>
    <form className="order-filters refund-review-filters" onSubmit={apply}>
      <label className="order-number-field">订单号<input placeholder="输入完整或部分订单号" maxLength={80} value={draft.orderNo} onChange={event => setDraft(current => ({ ...current, orderNo: event.target.value }))} /></label>
      <SelectField label="审核状态" value={draft.refundReview || 'all'} onValueChange={value => setDraft(current => ({ ...current, refundReview: value === 'all' ? '' : value }))}
        options={[{ value: 'all', label: '全部审核状态' }, ...Object.entries(orderRefundReviewStatuses).map(([value, label]) => ({ value, label }))]} />
      <div className="order-filter-actions"><button type="submit" className="button primary">查询</button><button type="button" className="button secondary" onClick={reset}>重置筛选</button></div>
    </form>
    <div className="order-update"><span role="status">{loading ? '正在读取退款记录…' : error ? '更新失败，请重试' : data ? `最近更新：${new Date(data.updatedAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}` : ''}</span></div>
    {error && <div className="order-error" role="alert">{error.message}<button type="button" className="text-button" onClick={reload}>重新加载</button></div>}
    {data && <section className="admin-panel order-list" aria-busy={loading}>
      <div className="admin-panel-title"><div><h2 id="refund-list-title">退款审核列表</h2><p>默认查看全部时间的待审核退款 · 共 {data.total} 条符合条件的记录</p></div><span className="admin-chip">{data.environment === 'production' ? '正式数据' : '测试数据'}</span></div>
      <AdminTable className="order-table refund-review-table" labelledBy="refund-list-title" emptyState={!data.orders.length && <p>暂无符合条件的退款审核记录。</p>}>
        <thead><tr>{['订单号', '商品 / 充值邮箱', '卡密', '订单金额', '已退款 / 待退金额', '审核状态', '退款进度', '提交审核时间', '审核人 / 时间', '审核备注', '操作'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{data.orders.map(order => <tr key={order.id}>
          <td className="order-id">{order.id}</td><td className="order-email-cell"><strong>{order.productName}</strong><small>{order.rechargeEmail || '未记录充值邮箱'}</small></td>
          <td className="order-voucher-cell">{!data.canViewVoucherCodes ? <span className="admin-table-secondary">无查看权限</span> : order.voucherCode ? <><code>{order.voucherCode}</code><button type="button" className="text-button" onClick={() => void copyVoucher(order.voucherCode!)} aria-label={`复制订单 ${order.id} 的卡密`}>复制卡密</button></> : <span className="admin-table-secondary">未分配 / 未记录</span>}</td>
          <td className="admin-table-number">¥{money(order.priceCents)}</td><td className="admin-table-number">已退 ¥{money(order.refundedCents)}<small>待退 ¥{money(Math.max(0, order.priceCents - order.refundedCents))}</small></td>
          <td><strong>{order.refundReview && orderRefundReviewStatuses[order.refundReview.status]}</strong></td>
          <td className="order-refund-cell">{order.cancellationMessage || '—'}</td>
          <td>{order.refundReview ? formatDate(order.refundReview.requestedAt) : '—'}</td>
          <td>{order.refundReview?.reviewedBy || '—'}{order.refundReview?.reviewedAt && <small>{formatDate(order.refundReview.reviewedAt)}</small>}</td>
          <td className="order-refund-cell">{order.refundReview?.reason || '—'}</td>
          <td>{order.refundReview?.status === 'pending' && data.canReviewRefunds ? <div className="order-refund-actions">
            <button type="button" className="text-button" onClick={() => setReview({ order, approve: true })}>同意退款</button>
            <button type="button" className="text-button" onClick={() => setReview({ order, approve: false })}>驳回退款</button>
          </div> : <span className="admin-table-secondary">已审核</span>}</td>
        </tr>)}</tbody>
      </AdminTable>
      <div className="order-pagination"><span>共 {data.total} 条 · 第 {page} / {Math.max(1, Math.ceil(data.total / data.pageSize))} 页</span>
        <button type="button" className="button secondary" disabled={page <= 1 || loading} onClick={() => setFilters(current => ({ ...current, page: page - 1 }))}>上一页</button>
        <button type="button" className="button secondary" disabled={page * data.pageSize >= data.total || loading} onClick={() => setFilters(current => ({ ...current, page: page + 1 }))}>下一页</button>
      </div>
    </section>}
    <p className="admin-method"><Icon name="info" />待审核或已驳回的记录不会退款；审核通过后仍需核实充值状态。点击「刷新退款记录」获取最新结果。</p>
    {review && <RefundReviewDialog {...review} onExpired={onExpired} onClose={() => setReview(null)} onSaved={() => { setReview(null); reload(); }} />}
  </>;
}

