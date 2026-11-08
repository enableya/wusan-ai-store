import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useMessage } from '../app/MessageProvider';
import { useApiResource } from '../hooks/useApiResource';
import { formatDate, money } from '../lib/format';
import { DateField } from './DateField';
import { Icon } from './Icon';
import './revenue-report.css';

type RevenueData = {
  environment: 'sandbox' | 'production';
  grossCents: number;
  paidOrders: number;
  refundCents: number;
  refundCount: number;
  netCents: number;
  created: { total: number; paid: number; pending: number; closed: number; cancelled: number };
  pendingRefunds: { count: number; cents: number };
  trend: { date: string; orders: number; grossCents: number; refundCents: number; netCents: number }[];
  products: { id: string; name: string; orders: number; grossCents: number; refundCents: number; netCents: number }[];
  recent: { id: string; productName: string; amountCents: number; refundedCents: number; createdAt: string; paidAt: string }[];
};
const day = (offset = 0) => new Date(Date.now() + 8 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
const amount = (cents: number) => `¥${money(cents)}`;

export function RevenueReport({ onExpired }: { onExpired: () => void }) {
  const [filters, setFilters] = useState({ start: day(-6), end: day(), page: 1 });
  const [draft, setDraft] = useState({ start: filters.start, end: filters.end });
  const $message = useMessage();
  const report = useApiResource<RevenueData>(`/admin/revenue?${new URLSearchParams({
    start: filters.start, end: filters.end, page: String(filters.page),
  })}`, { keepDataWhileReloading: true });
  useEffect(() => { if (report.error?.status === 401) onExpired(); }, [report.error?.status, onExpired]);

  function apply(event: FormEvent) {
    event.preventDefault();
    if (!draft.start || !draft.end || draft.start > draft.end || draft.end > day()
      || Date.parse(draft.end) - Date.parse(draft.start) > 365 * 86400000) {
      $message.warning('请选择有效日期，时间范围最多 366 天。');
      return;
    }
    setFilters({ ...draft, page: 1 });
  }

  function preset(days: number) {
    const next = { start: day(1 - days), end: day() };
    setDraft(next);
    setFilters({ ...next, page: 1 });
  }

  const data = report.data;
  const metrics = data ? [
    ['付款总额', amount(data.grossCents), `已付款 ${data.paidOrders} 笔`],
    ['已确认退款', amount(data.refundCents), `退款 ${data.refundCount} 笔`],
    ['收支差额', amount(data.netCents), '付款总额减去同期确认退款'],
    ['平均客单价', amount(data.paidOrders ? data.grossCents / data.paidOrders : 0), '付款总额 ÷ 付款订单数'],
  ] : [];
  const peak = Math.max(1, ...(data?.trend.map(item => item.grossCents) ?? []));
  return <>
    <div className="admin-heading">
      <div><div className="eyebrow">REVENUE ANALYTICS</div><h1>营业额统计</h1><p>查看付款、退款和商品销售情况。</p></div>
      <button type="button" className="button secondary" onClick={report.reload} disabled={report.loading}><Icon name="refresh-cw" />刷新数据</button>
    </div>
    <form className="admin-filters" onSubmit={apply}>
      <div className="admin-presets" aria-label="快捷日期">
        {[1, 7, 30].map(days => <button type="button" key={days}
          className={filters.start === day(1 - days) && filters.end === day() ? 'active' : ''}
          onClick={() => preset(days)}>{days === 1 ? '今日' : `近 ${days} 天`}</button>)}
      </div>
      <DateField label="开始日期" value={draft.start} today={day()} onChange={start => setDraft(current => ({ ...current, start }))} />
      <DateField label="结束日期" value={draft.end} today={day()} onChange={end => setDraft(current => ({ ...current, end }))} />
      <button className="button primary" type="submit">查询</button>
    </form>
    {report.error && report.error.status !== 401 && <button className="text-button" type="button" onClick={report.reload}>重新加载</button>}
    {report.loading && !data && <p className="admin-loading" role="status">正在读取营业额数据…</p>}
    {data && <>
      <div className="revenue-metrics" aria-busy={report.loading}>
        {metrics.map(([label, value, detail]) => <section className="admin-metric" key={label}><span>{label}</span><strong>{value}</strong><small>{detail}</small></section>)}
      </div>
      <section className="admin-panel revenue-overview">
        <div className="admin-panel-title"><div><h2>订单概况</h2><p>按订单创建时间统计当前状态，待付款含尚未关闭的过期订单</p></div><span className="admin-chip">{data.environment === 'production' ? '正式数据' : '测试数据'}</span></div>
        <div className="revenue-order-counts">
          {([['创建订单', data.created.total], ['已付款', data.created.paid], ['待付款', data.created.pending], ['已关闭', data.created.closed], ['订单已取消', data.created.cancelled]] as const).map(([label, value]) =>
            <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
        </div>
        <p className="revenue-pending">所选时间内发起、仍待确认的退款 {data.pendingRefunds.count} 笔，{amount(data.pendingRefunds.cents)}。</p>
      </section>
      <section className="admin-panel">
        <div className="admin-panel-title"><div><h2>每日收支</h2><p>按北京时间分组，付款和退款分别按各自确认时间计入</p></div></div>
        <div className="admin-trend" aria-label="每日付款金额趋势">
          {data.trend.map(item => <div className="admin-trend-day" key={item.date} title={`${item.date} 付款 ${amount(item.grossCents)}`}>
            <span>{item.grossCents ? amount(item.grossCents) : ''}</span><div className="admin-bar-track"><i style={{ height: `${item.grossCents / peak * 100}%`, minHeight: item.grossCents ? 3 : 0 }} /></div><small>{item.date.slice(5)}</small>
          </div>)}
        </div>
        <div className="revenue-table-scroll"><table className="revenue-table"><thead><tr><th>日期</th><th>付款订单</th><th>付款总额</th><th>已确认退款</th><th>收支差额</th></tr></thead>
          <tbody>{[...data.trend].reverse().map(item => <tr key={item.date}><td>{item.date}</td><td>{item.orders}</td><td>{amount(item.grossCents)}</td><td>{amount(item.refundCents)}</td><td>{amount(item.netCents)}</td></tr>)}</tbody>
        </table></div>
      </section>
      <section className="admin-panel">
        <div className="admin-panel-title"><div><h2>商品销售排行</h2><p>付款与退款按各自确认时间计入，按付款总额排序</p></div><span className="admin-chip">{data.products.length} 种商品</span></div>
        <div className="revenue-table-scroll"><table className="revenue-table"><thead><tr><th>商品</th><th>付款订单</th><th>付款总额</th><th>已确认退款</th><th>收支差额</th><th>占付款总额</th><th>平均订单金额</th></tr></thead><tbody>
          {data.products.map(item => <tr key={`${item.id}-${item.name}`}><td><strong>{item.name}</strong><small>{item.id}</small></td><td>{item.orders}</td><td>{amount(item.grossCents)}</td><td>{amount(item.refundCents)}</td><td>{amount(item.netCents)}</td><td>{data.grossCents ? `${(item.grossCents / data.grossCents * 100).toFixed(1)}%` : '0%'}</td><td>{item.orders ? amount(item.grossCents / item.orders) : '—'}</td></tr>)}
        </tbody></table></div>
        {data.products.length === 0 && <p className="admin-zero">所选时间内暂无付款订单。</p>}
      </section>
      <section className="admin-panel">
        <div className="admin-panel-title"><div><h2>付款明细</h2><p>按付款确认时间倒序，退款金额为该订单目前已确认的累计退款</p></div></div>
        <div className="revenue-table-scroll"><table className="revenue-table"><thead><tr><th>订单号</th><th>商品</th><th>订单金额</th><th>累计退款</th><th>下单时间</th><th>付款时间</th></tr></thead><tbody>
          {data.recent.map(item => <tr key={item.id}><td className="mono">{item.id}</td><td>{item.productName}</td><td>{amount(item.amountCents)}</td><td>{amount(item.refundedCents)}</td><td>{formatDate(item.createdAt)}</td><td>{formatDate(item.paidAt)}</td></tr>)}
        </tbody></table></div>
        {data.recent.length === 0 && <p className="admin-zero">所选时间内暂无付款明细。</p>}
        <div className="revenue-pagination"><span>共 {data.paidOrders} 笔 · 第 {filters.page} 页</span><button className="button secondary" disabled={filters.page === 1 || report.loading} onClick={() => setFilters(current => ({ ...current, page: current.page - 1 }))}>上一页</button><button className="button secondary" disabled={filters.page * 20 >= data.paidOrders || report.loading} onClick={() => setFilters(current => ({ ...current, page: current.page + 1 }))}>下一页</button></div>
      </section>
      <p className="admin-method"><Icon name="info" />付款按已核实的付款时间统计，退款按系统记录的确认时间统计。收支差额不是利润，不包含手续费、返利和成本。站外退款须在系统内核实后才会计入。</p>
    </>}
  </>;
}
