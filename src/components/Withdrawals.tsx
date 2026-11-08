import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useMessage } from '../app/MessageProvider';
import { useApiResource } from '../hooks/useApiResource';
import { postApi } from '../services/api';
import { formatDate, money } from '../lib/format';
import { withdrawalStatuses } from '../types/withdrawals';
import type { Withdrawal, WithdrawalReport } from '../types/withdrawals';
import { Dialog } from './Dialog';
import { SelectField } from './SelectField';
import './withdrawals.css';

function ApplyForm({ onClose, onSaved, available }: { onClose: () => void; onSaved: () => void; available: number }) {
  const message = useMessage();
  const [amount, setAmount] = useState('');
  const [account, setAccount] = useState('');
  const [realName, setRealName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || !confirmed) return;
    setBusy(true);
    try {
      await postApi('/referrals/withdrawals', { amount, account, realName, password }, key);
      setPassword(''); message.success('提现申请已提交，等待后台审核。'); onSaved();
    } catch (error) { message.error(error instanceof Error ? error.message : '提交失败，请重试。'); }
    finally { setBusy(false); }
  }
  return <Dialog title="申请提现至支付宝" onClose={() => { if (!busy) onClose(); }}>
    <form className="withdrawal-form" onSubmit={submit}>
      <p>可提现余额 <strong>¥{money(available)}</strong>，申请后冻结对应金额，审核通过后由后台打款。</p>
      <label>提现金额（元）<input type="number" inputMode="decimal" min="0.10" step="0.01" max={available / 100} value={amount} onChange={e => setAmount(e.target.value)} required disabled={busy} /></label>
      <label>支付宝账号<input type="text" autoComplete="off" placeholder="支付宝绑定的手机号或邮箱" maxLength={254} value={account} onChange={e => setAccount(e.target.value)} required disabled={busy} /></label>
      <label>支付宝实名姓名<input autoComplete="name" maxLength={100} value={realName} onChange={e => setRealName(e.target.value)} required disabled={busy} /></label>
      <label>商城登录密码<input type="password" autoComplete="current-password" maxLength={128} value={password} onChange={e => setPassword(e.target.value)} required disabled={busy} /></label>
      <label className="withdrawal-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy} /><span>我已核对支付宝账号和实名姓名，确认将提现金额转入该账号</span></label>
      <div className="withdrawal-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>取消</button><button className="button primary" disabled={busy || !confirmed}>{busy ? '提交中…' : '提交提现申请'}</button></div>
    </form>
  </Dialog>;
}

type Action = 'approve' | 'reject' | 'pay' | 'query';
const actionLabels = { approve: '同意提现', reject: '驳回申请', pay: '打款至支付宝', query: '查询打款结果' };
function ReviewForm({ row, action, onClose, onSaved }: { row: Withdrawal; action: Action; onClose: () => void; onSaved: () => void }) {
  const message = useMessage();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true);
    try {
      const result = await postApi<Withdrawal>(`/admin/referrals/withdrawals/${row.id}/${action}`, { reason });
      message.success(action === 'pay' || action === 'query' ? withdrawalStatuses[result.status] : action === 'approve' ? '审核通过，等待打款。' : '申请已驳回，冻结金额已释放。');
      onSaved();
    } catch (error) { message.error(error instanceof Error ? error.message : '操作失败，请重试。'); }
    finally { setBusy(false); }
  }
  return <Dialog title={actionLabels[action]} onClose={() => { if (!busy) onClose(); }}>
    <form className="withdrawal-form" onSubmit={submit}>
      <dl className="withdrawal-review"><dt>申请人</dt><dd>{row.username}</dd><dt>提现金额</dt><dd><strong>¥{money(row.amountCents)}</strong></dd><dt>支付宝账号</dt><dd>{row.account}</dd><dt>实名姓名</dt><dd>{row.realName}</dd></dl>
      {action === 'approve' && <p>审核通过后仍需点击「打款至支付宝」执行转账。</p>}
      {action === 'pay' && <p>确认后将向该支付宝账号发起转账，请核对金额、账号和实名姓名。</p>}
      {action === 'query' && <p>查询原提现单的支付宝结果，不会再次发起转账。</p>}
      {(action === 'approve' || action === 'reject') && <label>{action === 'reject' ? '驳回原因' : '审核备注'}<textarea rows={3} maxLength={300} value={reason} onChange={e => setReason(e.target.value)} required={action === 'reject'} disabled={busy} /></label>}
      <div className="withdrawal-actions"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>取消</button><button className="button primary" disabled={busy}>{busy ? '处理中…' : actionLabels[action]}</button></div>
    </form>
  </Dialog>;
}

export function Withdrawals({ admin = false, onExpired }: { admin?: boolean; onExpired?: () => void }) {
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [apply, setApply] = useState(false);
  const [review, setReview] = useState<{ row: Withdrawal; action: Action } | null>(null);
  const resource = useApiResource<WithdrawalReport>(`${admin ? '/admin' : ''}/referrals/withdrawals?${new URLSearchParams({ status, page: String(page) })}`, { keepDataWhileReloading: true });
  const data = resource.data;
  useEffect(() => { if (resource.error?.status === 401) onExpired?.(); }, [resource.error?.status, onExpired]);
  const saved = () => { setApply(false); setReview(null); resource.reload(); };
  return <section className="withdrawals" aria-labelledby={admin ? 'withdrawal-admin-title' : 'withdrawal-customer-title'}>
    <div className="withdrawal-heading"><div><h2 id={admin ? 'withdrawal-admin-title' : 'withdrawal-customer-title'}>{admin ? '提现审核与打款' : '返利提现'}</h2><p>{admin ? '先审核提现申请，再向支付宝打款。' : '填写支付宝收款信息，审核通过后由后台打款。'}</p></div>
      {!admin && <button className="button primary" disabled={!data?.balance || data.balance.availableCents < 10} onClick={() => setApply(true)}>申请提现</button>}
    </div>
    {data && <p className="withdrawal-environment">{data.environment === 'sandbox' ? '测试环境 · 记录和余额不参与正式结算' : '正式环境'}</p>}
    {data?.balance && <div className="withdrawal-balances">{[['可提现余额', data.balance.availableCents], ['审核 / 打款中', data.balance.heldCents], ['已到账金额', data.balance.paidCents]].map(([label, value]) => <div key={label}><span>{label}</span><strong>¥{money(Number(value))}</strong></div>)}</div>}
    {!!data?.balance?.deficitCents && <p className="withdrawal-error">返利因退款等原因发生变动，请联系客服核对已申请金额。</p>}
    {admin && data && !data.payoutEnabled && <p className="withdrawal-environment">支付宝打款暂未启用，可正常审核申请，启用后再打款。</p>}
    <div className="withdrawal-toolbar"><SelectField label="提现状态" value={status} options={[{ value: 'all', label: '全部状态' }, ...Object.entries(withdrawalStatuses).map(([value, label]) => ({ value, label }))]} onValueChange={value => { setStatus(value); setPage(1); }} />
      <button className="button secondary" disabled={resource.loading} onClick={resource.reload}>刷新提现记录</button></div>
    {resource.error && <p role="alert" className="withdrawal-error">{resource.error.message}</p>}
    {resource.loading && !data && <p role="status">正在读取提现记录…</p>}
    {data && <>
      <div className="withdrawal-table-wrap"><table className="withdrawal-table"><thead><tr>{admin && <th>申请人</th>}<th>提现单 / 金额</th><th>支付宝收款信息</th><th>状态</th><th>申请 / 审核时间</th><th>备注 / 打款单号</th>{admin && <th>操作</th>}</tr></thead>
        <tbody>{data.rows.map(row => <tr key={row.id}>{admin && <td>{row.username}</td>}
          <td><strong>¥{money(row.amountCents)}</strong><small>{row.id}</small></td><td>{row.account}<small>{row.realName}</small></td>
          <td><span className={`withdrawal-status ${row.status}`}>{withdrawalStatuses[row.status]}</span>{row.paidAt && <small>{formatDate(row.paidAt)}</small>}</td>
          <td>{formatDate(row.createdAt)}{row.reviewedAt && <small>{formatDate(row.reviewedAt)}{admin && ` · ${row.reviewedBy}`}</small>}</td>
          <td>{row.note || '—'}{row.transferNo && <small>{row.transferNo}</small>}</td>
          {admin && <td><div className="withdrawal-row-actions">{row.status === 'pending' && <button className="text-button" onClick={() => setReview({ row, action: 'approve' })}>同意提现</button>}
            {['pending','approved'].includes(row.status) && <button className="text-button" onClick={() => setReview({ row, action: 'reject' })}>驳回</button>}
            {row.status === 'approved' && <button className="text-button" disabled={!data.payoutEnabled} onClick={() => setReview({ row, action: 'pay' })}>打款至支付宝</button>}
            {row.status === 'processing' && <button className="text-button" disabled={!data.payoutEnabled} onClick={() => setReview({ row, action: 'query' })}>查询结果</button>}
          </div></td>}
        </tr>)}</tbody>
      </table></div>
      {!data.rows.length && <p className="withdrawal-empty">暂无提现申请</p>}
      <div className="withdrawal-pagination"><span>共 {data.total} 条 · 第 {data.page} / {Math.max(1, Math.ceil(data.total / data.pageSize))} 页</span><button className="button secondary" disabled={data.page <= 1 || resource.loading} onClick={() => setPage(data.page - 1)}>上一页</button><button className="button secondary" disabled={data.page * data.pageSize >= data.total || resource.loading} onClick={() => setPage(data.page + 1)}>下一页</button></div>
    </>}
    {apply && data?.balance && <ApplyForm available={data.balance.availableCents} onClose={() => setApply(false)} onSaved={saved} />}
    {review && <ReviewForm {...review} onClose={() => setReview(null)} onSaved={saved} />}
  </section>;
}
