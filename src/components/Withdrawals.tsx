import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Copy, FileCheck2, Undo2, UserCheck } from 'lucide-react';
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
      <p>可提现余额 <strong>¥{money(available)}</strong>，申请后冻结对应金额，审核通过后由管理员人工打款至支付宝。</p>
      <label>提现金额（元）<input type="number" inputMode="decimal" min="0.10" step="0.01" max={available / 100} value={amount} onChange={e => setAmount(e.target.value)} required disabled={busy} /></label>
      <label>支付宝账号<input type="text" autoComplete="off" placeholder="支付宝绑定的手机号或邮箱" maxLength={254} value={account} onChange={e => setAccount(e.target.value)} required disabled={busy} /></label>
      <label>支付宝实名姓名<input autoComplete="name" maxLength={100} value={realName} onChange={e => setRealName(e.target.value)} required disabled={busy} /></label>
      <label>商城登录密码<input type="password" autoComplete="current-password" maxLength={128} value={password} onChange={e => setPassword(e.target.value)} required disabled={busy} /></label>
      <label className="withdrawal-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy} /><span>我已核对支付宝账号和实名姓名，确认将提现金额转入该账号</span></label>
      <div className="withdrawal-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>取消</button><button className="button primary" disabled={busy || !confirmed}>{busy ? '提交中…' : '提交提现申请'}</button></div>
    </form>
  </Dialog>;
}

type Action = 'approve' | 'reject' | 'query' | 'manual-start' | 'manual-complete' | 'manual-release';
const actionLabels = { approve: '同意提现', reject: '驳回申请', query: '查询打款结果', 'manual-start': '领取人工打款', 'manual-complete': '确认已打款', 'manual-release': '退回待打款' };
function CopyValue({ value, label }: { value: string; label: string }) {
  const message = useMessage();
  return <button type="button" className="icon-button withdrawal-copy" aria-label={`复制${label}`} title={`复制${label}`} onClick={async () => {
    try { await navigator.clipboard.writeText(value); message.success(`已复制${label}。`); }
    catch { message.error('复制失败，请手动核对。'); }
  }}><Copy size={16} aria-hidden="true" /></button>;
}
function ReviewForm({ row, action, onClose, onSaved }: { row: Withdrawal; action: Action; onClose: () => void; onSaved: () => void }) {
  const message = useMessage();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const completing = action === 'manual-complete';
  const releasing = action === 'manual-release';
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || (releasing && !confirmed)) return;
    setError('');
    setBusy(true);
    try {
      const input = completing ? { confirmed: true } : { reason, confirmed };
      const result = await postApi<Withdrawal>(`/admin/referrals/withdrawals/${row.id}/${action}`, input);
      message.success(completing ? '已确认人工打款。' : action === 'manual-start' ? '已领取人工打款，余额保持冻结。'
        : releasing ? '已退回待打款，余额仍冻结。' : action === 'query' ? withdrawalStatuses[result.status]
        : action === 'approve' ? '审核通过，等待人工打款。' : '申请已驳回，冻结金额已释放。');
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败，请重试。'); }
    finally { setBusy(false); }
  }
  return <Dialog title={actionLabels[action]} onClose={() => { if (!busy) onClose(); }}>
    <form className="withdrawal-form" onSubmit={submit}>
      <dl className="withdrawal-review"><dt>申请人</dt><dd>{row.username}</dd><dt>提现金额</dt><dd className="withdrawal-copy-value"><strong>¥{money(row.amountCents)}</strong><CopyValue label="提现金额" value={(row.amountCents / 100).toFixed(2)} /></dd><dt>支付宝账号</dt><dd className="withdrawal-copy-value"><span>{row.account}</span><CopyValue label="支付宝账号" value={row.account} /></dd><dt>实名姓名</dt><dd className="withdrawal-copy-value"><span>{row.realName}</span><CopyValue label="实名姓名" value={row.realName} /></dd></dl>
      {action === 'approve' && <p>审核通过后进入待人工打款，当前不会转账。</p>}
      {action === 'manual-start' && <p>领取后将记录你为经办人，余额继续冻结；本次操作不会转账。</p>}
      {completing && <p className="withdrawal-warning">确认已向以上收款人完成 ¥{money(row.amountCents)} 的支付宝转账？确认后将标记为已打款，不可撤销。此操作不会发起转账。</p>}
      {releasing && <><p className="withdrawal-warning">仅限未转账或已明确转账失败。转账结果未知时，必须保留处理中状态。</p>
        <label>退回原因<textarea rows={3} maxLength={300} value={reason} onChange={e => setReason(e.target.value)} required disabled={busy} /></label>
        <label className="withdrawal-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy} /><span>我已核实本笔没有成功转账，不存在待确认的在途款项</span></label>
      </>}
      {action === 'query' && <p>查询原提现单的支付宝结果，不会再次发起转账。</p>}
      {(action === 'approve' || action === 'reject') && <label>{action === 'reject' ? '驳回原因' : '审核备注'}<textarea rows={3} maxLength={300} value={reason} onChange={e => setReason(e.target.value)} required={action === 'reject'} disabled={busy} /></label>}
      {error && <p role="alert" className="withdrawal-error">{error}</p>}
      <div className="withdrawal-actions"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>取消</button><button className="button primary" disabled={busy || (releasing && !confirmed)}>{busy ? '处理中…' : actionLabels[action]}</button></div>
    </form>
  </Dialog>;
}

export function Withdrawals({ admin = false, operator, onExpired }: { admin?: boolean; operator?: string; onExpired?: () => void }) {
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [apply, setApply] = useState(false);
  const [review, setReview] = useState<{ row: Withdrawal; action: Action } | null>(null);
  const [receiptRow, setReceiptRow] = useState<Withdrawal | null>(null);
  const resource = useApiResource<WithdrawalReport>(`${admin ? '/admin' : ''}/referrals/withdrawals?${new URLSearchParams({ status, page: String(page) })}`, { keepDataWhileReloading: true });
  const data = resource.data;
  useEffect(() => { if (resource.error?.status === 401) onExpired?.(); }, [resource.error?.status, onExpired]);
  const saved = () => { setApply(false); setReview(null); resource.reload(); };
  return <section className="withdrawals" aria-labelledby={admin ? 'withdrawal-admin-title' : 'withdrawal-customer-title'}>
    <div className="withdrawal-heading"><div><h2 id={admin ? 'withdrawal-admin-title' : 'withdrawal-customer-title'}>{admin ? '提现审核与打款' : '返利提现'}</h2><p>{admin ? '人工打款' : '审核通过后由管理员人工打款至支付宝。'}</p></div>
      {!admin && <button className="button primary" disabled={!data?.balance || data.balance.availableCents < 10} onClick={() => setApply(true)}>申请提现</button>}
    </div>
    {data && <p className="withdrawal-environment">{data.environment === 'sandbox' ? '测试环境 · 记录和余额不参与正式结算' : '正式环境'}</p>}
    {data?.balance && <div className="withdrawal-balances">{[['可提现余额', data.balance.availableCents], ['审核 / 打款中', data.balance.heldCents], ['已打款金额', data.balance.paidCents]].map(([label, value]) => <div key={label}><span>{label}</span><strong>¥{money(Number(value))}</strong></div>)}</div>}
    {!!data?.balance?.deficitCents && <p className="withdrawal-error">返利因退款等原因发生变动，请联系客服核对已申请金额。</p>}
    <div className="withdrawal-toolbar"><SelectField label="提现状态" value={status} options={[{ value: 'all', label: '全部状态' }, ...Object.entries(withdrawalStatuses).map(([value, label]) => ({ value, label }))]} onValueChange={value => { setStatus(value); setPage(1); }} />
      <button className="button secondary" disabled={resource.loading} onClick={resource.reload}>刷新提现记录</button></div>
    {resource.error && <p role="alert" className="withdrawal-error">{resource.error.message}</p>}
    {resource.loading && !data && <p role="status">正在读取提现记录…</p>}
    {data && <>
      <div className="withdrawal-table-wrap"><table className="withdrawal-table"><thead><tr>{admin && <th>申请人</th>}<th>提现单 / 金额</th><th>支付宝收款信息</th><th>状态</th><th>申请 / 审核时间</th><th>备注 / 打款单号</th>{admin && <th>操作</th>}</tr></thead>
        <tbody>{data.rows.map(row => <tr key={row.id}>{admin && <td>{row.username}</td>}
          <td><strong>¥{money(row.amountCents)}</strong><small>{row.id}</small></td><td>{row.account}<small>{row.realName}</small></td>
          <td><span className={`withdrawal-status ${row.status}`}>{row.payoutMethod === 'manual' && row.status === 'processing' ? '人工打款处理中' : withdrawalStatuses[row.status]}</span>{row.payoutMethod === 'manual' && row.status === 'paid' && <small>人工核实打款</small>}{row.paidAt && <small>{formatDate(row.paidAt)}</small>}</td>
          <td>{formatDate(row.createdAt)}{row.reviewedAt && <small>{formatDate(row.reviewedAt)}{admin && ` · ${row.reviewedBy}`}</small>}</td>
          <td>{row.note || '—'}{row.transferNo && <small>{row.transferNo}</small>}{admin && row.manual && <small>{row.manual.recordedBy ? `确认：${row.manual.recordedBy} · ${formatDate(row.manual.recordedAt!)}` : `经办：${row.manual.startedBy}`}</small>}</td>
          {admin && <td><div className="withdrawal-row-actions">{row.status === 'pending' && <button className="text-button" onClick={() => setReview({ row, action: 'approve' })}>同意提现</button>}
            {['pending','approved'].includes(row.status) && <button className="text-button" onClick={() => setReview({ row, action: 'reject' })}>驳回</button>}
            {row.status === 'approved' && <button className="text-button" onClick={() => setReview({ row, action: 'manual-start' })}><UserCheck size={15} aria-hidden="true" />领取人工打款</button>}
            {row.status === 'processing' && row.payoutMethod === 'manual' && row.manual?.startedBy === operator && <>
              <button className="text-button" onClick={() => setReview({ row, action: 'manual-complete' })}><FileCheck2 size={15} aria-hidden="true" />确认已打款</button>
              <button className="text-button" onClick={() => setReview({ row, action: 'manual-release' })}><Undo2 size={15} aria-hidden="true" />退回待打款</button>
            </>}
            {row.status === 'processing' && row.payoutMethod !== 'manual' && <button className="text-button" disabled={!data.payoutEnabled} onClick={() => setReview({ row, action: 'query' })}>查询结果</button>}
            {row.status === 'processing' && row.payoutMethod !== 'manual' && !data.payoutEnabled && <small>接口打款待核对，禁止人工重复转账</small>}
            {row.manual?.hasReceipt && <button className="text-button" onClick={() => setReceiptRow(row)}><FileCheck2 size={15} aria-hidden="true" />查看凭证</button>}
          </div></td>}
        </tr>)}</tbody>
      </table></div>
      {!data.rows.length && <p className="withdrawal-empty">暂无提现申请</p>}
      <div className="withdrawal-pagination"><span>共 {data.total} 条 · 第 {data.page} / {Math.max(1, Math.ceil(data.total / data.pageSize))} 页</span><button className="button secondary" disabled={data.page <= 1 || resource.loading} onClick={() => setPage(data.page - 1)}>上一页</button><button className="button secondary" disabled={data.page * data.pageSize >= data.total || resource.loading} onClick={() => setPage(data.page + 1)}>下一页</button></div>
    </>}
    {apply && data?.balance && <ApplyForm available={data.balance.availableCents} onClose={() => setApply(false)} onSaved={saved} />}
    {review && <ReviewForm {...review} onClose={() => setReview(null)} onSaved={saved} />}
    {receiptRow && <Dialog title="人工打款凭证" onClose={() => setReceiptRow(null)}>
      <p className="withdrawal-receipt-meta">{receiptRow.transferNo}</p>
      <img className="withdrawal-receipt-image" src={`/api/admin/referrals/withdrawals/${receiptRow.id}/receipt`} alt="已登记的转账成功凭证" />
    </Dialog>}
  </section>;
}
