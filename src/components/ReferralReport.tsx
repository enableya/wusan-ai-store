import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { SelectField } from './SelectField';
import { useApiResource } from '../hooks/useApiResource';
import type { ReferralReportData } from '../types/referrals';
import { money } from '../lib/format';
import '../pages/referrals.css';
const statuses = {pending: '待好友付款', earned: '返利已入账', cancelled: '不计返利'};
const statusOptions = [
  { value: 'all', label: '全部状态' },
  ...Object.entries(statuses).map(([value, label]) => ({ value, label })),
];
export function ReferralReport({admin = false, onExpired, endpoint}: {admin?: boolean; onExpired?: () => void; endpoint?: string}) {
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const path = endpoint ?? `${admin ? '/admin' : ''}/referrals`;
  const report = useApiResource<ReferralReportData>(
    `${path}${path.includes('?')?'&':'?'}${new URLSearchParams({ status, page: String(page) })}`,
    { keepDataWhileReloading: true },
  );
  useEffect(() => {if (report.error?.status === 401) onExpired?.();}, [report.error?.status, onExpired]);
  return <section className="referral-report">
    <div className="referral-toolbar">
      <SelectField label="返利状态" value={status} options={statusOptions}
        onValueChange={value => { setStatus(value); setPage(1); }} />
      <button className="button secondary referral-refresh" type="button" onClick={report.reload} disabled={report.loading}>
        <RefreshCw aria-hidden="true" />刷新
      </button>
    </div>
    <div className="referral-totals"><div><span>邀请订单</span><strong>{report.data?.total ?? '—'}</strong></div><div><span>{admin?'累计已入账返利':'已入账商城余额'}</span><strong>¥{money(report.data?.earnedCents ?? 0)}</strong></div></div>
    <p className="referral-report-note">返利记录会注明未入账原因。「已入账」指商城返利余额，支付宝打款请查看提现记录。</p>
    <div className="referral-table-wrap" aria-busy={report.loading}>
      <table className="referral-table"><thead><tr>{admin && <th>邀请人 / 邀请码</th>}<th>订单 / 商品</th><th>订单金额</th><th>已入账返利</th><th>状态</th><th>原因 / 说明</th><th>创建时间</th></tr></thead>
        <tbody>{report.data?.rows.map(row => <tr key={row.orderId}>
          {admin && <td className="referral-inviter" data-label="邀请人 / 邀请码"><strong>{row.inviter}</strong><small>{row.inviteCode}</small></td>}
          <td className="referral-order"><strong>{row.productName}</strong><small>{row.displayOrderId}</small></td>
          <td data-label="订单金额">¥{money(row.orderCents)}</td>
          <td className="referral-amount" data-label="已入账返利">¥{money(row.amountCents)}{row.expectedAmountCents>0 && <small>付款后预计 ¥{money(row.expectedAmountCents)}</small>}</td>
          <td className="referral-status-cell"><span className={`referral-status ${row.status}`}>{statuses[row.status]}</span>{row.earnedAt && row.status==='earned' && <small>{new Date(row.earnedAt).toLocaleString('zh-CN')}</small>}</td>
          <td className="referral-reason" data-label="原因 / 说明"><p>{row.reasonMessage}</p><small>记录于 {new Date(row.reasonUpdatedAt).toLocaleString('zh-CN')}</small></td>
          <td className="referral-created" data-label="创建时间">{new Date(row.createdAt).toLocaleString('zh-CN')}</td>
        </tr>)}</tbody>
      </table>
      {!report.loading && report.data?.rows.length === 0 && <p className="referral-empty">暂无邀请返利记录</p>}
      {report.loading && <p role="status" className="referral-empty">正在加载…</p>}
    </div>
    <div className="referral-pagination"><span>共 {report.data?.total ?? 0} 条 · 第 {page} 页</span><button className="button secondary" disabled={page === 1 || report.loading} onClick={() => setPage(n => n - 1)}>上一页</button><button className="button secondary" disabled={!report.data || page * 20 >= report.data.total || report.loading} onClick={() => setPage(n => n + 1)}>下一页</button></div>
  </section>;
}
