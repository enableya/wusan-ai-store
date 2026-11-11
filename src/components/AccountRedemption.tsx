import { useMessage } from '../app/MessageProvider';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Icon } from './Icon';
import { useApiResource } from '../hooks/useApiResource';
import { ApiError, postApi } from '../services/api';
import { resultTag } from '../lib/redemption-status';
import { redemptionProgress } from '../lib/redemption-progress';
import { RedemptionHistory } from './RedemptionHistory';
import type { RedemptionPolicy, RedemptionResult, RedemptionView } from '../types/redemption';


function RedemptionSteps({ result }: { result: RedemptionResult | null }) {
  const failed = resultTag(result).tone === 'failure';
  const stage = redemptionProgress(result).stage;
  const attention = resultTag(result).tone === 'attention' || resultTag(result).tone === 'failure';
  return <ol className="redemption-stage-list" aria-label="充值流程">
    {['排队受理', '充值处理', '结果确认', failed ? '充值未完成' : '充值成功'].map((label, index) => {
      const complete = stage === 4 || index < stage;
      return <li key={label} data-complete={complete} data-active={index === stage} data-attention={index === stage && attention} data-failure={index === stage && failed || undefined} aria-current={index === stage ? 'step' : undefined}>
        <span>{complete ? '✓' : index === stage && failed ? '×' : index + 1}</span><strong>{label}</strong>
      </li>;
    })}
  </ol>;
}

function RedemptionLoading({ label }: { label: string }) {
  return <div className="redemption-loading" role="status" aria-live="polite">
    <div className="redemption-loading-content">
      <div className="redemption-loading-indicator"><span className="redemption-loading-ring" aria-hidden="true" /></div>
      <span className="redemption-loading-label">{label}</span>
    </div>
  </div>;
}

export function AccountRedemption({ orderId, productName, onResult, onBusyChange }: {
  orderId: string; productName: string; onResult?: () => void; onBusyChange?: (busy: boolean) => void;
}) {
  const path = '/orders/' + encodeURIComponent(orderId) + '/redemption';
  const resource = useApiResource<RedemptionView>(path);
  const [updated, setUpdated] = useState<RedemptionView | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationCode, setValidationCode] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<string>('');
  const [progressPaused, setProgressPaused] = useState(false);
  const $message = useMessage();
  const input = useRef<HTMLTextAreaElement>(null);
  const session = useRef<{ orderId: string; confirmationId: string; value: string } | null>(null);
  const lock = useRef(false);
  const view = updated ?? resource.data;
  const account = editing || (view?.requiresSession && (session.current?.orderId !== orderId
    || session.current.confirmationId !== view.account?.confirmationId)) ? null : view?.account;
  const policy = useApiResource<RedemptionPolicy>(view?.enabled && !view.submitted && !account ? path + '/policy' : null);
  const policyData = policy.data;
  const result = view?.result ?? null;
  const tag = resultTag(result);
  const progress = redemptionProgress(result);
  const submitted = view?.submitted;
  const sessionExpired = validationCode === 'SESSION_EXPIRED'
    || ((!validationCode || validationCode === 'INVALID_SESSION') && /过期|失效/.test(validationError || ''));
  const validationTitle = validationCode === 'SESSION_EXPIRED' ? 'Session 已过期' : sessionExpired ? 'Session 已失效'
    : ['REDEMPTION_EXPIRED', 'REDEMPTION_NOT_FOUND', 'PORTAL_PRECHECK_EXPIRED'].includes(validationCode || '') ? '账号确认已过期'
    : ['REDEMPTION_TIMEOUT', 'REDEMPTION_CONNECTION_FAILED', 'REDEMPTION_UNAVAILABLE', 'REDEMPTION_INVALID_RESPONSE', 'REDEMPTION_RATE_LIMITED'].includes(validationCode || '') ? '暂时无法验证账号'
    : ['SESSION_INVALID_JSON', 'SESSION_MISSING_TOKEN', 'SESSION_INVALID_ACCOUNT', 'SESSION_INVALID_EXPIRY', 'SESSION_TOO_LARGE'].includes(validationCode || '') ? '登录信息不完整或格式有误'
    : '账号验证未通过';
  const settled = result?.settlement === 'PAID' || result?.settlement === 'NO_CHARGE'
    || result?.state === 'NO_CHARGE' || result?.renewal === 'paid'
    || result?.renewal === 'ready' || result?.renewal === 'attention';

  useEffect(() => {
    if (submitted) onResult?.();
  }, [submitted, onResult]);

  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  useEffect(() => {
    if (!view?.enabled || !submitted || settled) return;
    const controller = new AbortController();
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const interval = 5000;
    let delay = interval;
    const poll = async () => {
      if (document.visibilityState === 'visible' && !lock.current) {
        lock.current = true;
        try {
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]);
          const next = await postApi<RedemptionView>(path + '/refresh', {}, undefined, signal);
          if (!controller.signal.aborted) { setUpdated(next); setProgressPaused(false); }
          delay = interval;
        } catch (cause) {
          if (controller.signal.aborted) return;
          setProgressPaused(true);
          if (delay === interval) $message.error(cause instanceof ApiError ? cause.message : '暂时无法读取进度，请稍后查询。');
          delay = Math.min(delay * 2, 60000);
        } finally { lock.current = false; }
      }
      if (!controller.signal.aborted && Date.now() - started < 600000) timer = setTimeout(poll, delay);
      else if (!controller.signal.aborted) setProgressPaused(true);
    };
    timer = setTimeout(poll, delay);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [path, settled, submitted, view?.enabled, $message]);

  async function send(action: 'preview' | 'submit' | 'refresh', body: Record<string, unknown>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setAction(action); setProgressPaused(false);
    if (action === 'preview') { setValidationError(null); setValidationCode(undefined); setConfirmed(false); }
    try {
      const next = await postApi<RedemptionView>(path + '/' + action, body, undefined, AbortSignal.timeout(90000));
      if (action === 'preview' && next.account) {
        session.current = next.requiresSession && typeof body.sessionInput === 'string'
          ? { orderId, confirmationId: next.account.confirmationId, value: body.sessionInput } : null;
      }
      if (next.submitted) session.current = null;
      if (action === 'preview' && next.account && input.current) input.current.value = '';
      setUpdated(next); setEditing(false);
    } catch (cause) {
      setProgressPaused(true);
      const message = cause instanceof Error ? cause.message : '请求未确认，请刷新订单状态。';
      if (action === 'preview') { setValidationError(message); setValidationCode(cause instanceof ApiError ? cause.code : undefined); }
      else $message.error(message);
      if (action === 'submit' || (action === 'refresh' && cause instanceof ApiError && cause.status === 409)) { setUpdated(null); resource.reload(); }
    } finally { lock.current = false; setBusy(false); }
  }

  function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policyData || !input.current || lock.current) return;
    const sessionInput = input.current.value.trim();
    if (!sessionInput) {
      $message.warning('请填写 ChatGPT Session。');
      input.current.focus();
      return;
    }
    void send('preview', { sessionInput, consent: true, termsVersion: policyData.terms, privacyVersion: policyData.privacy });
  }

  if (!view) return resource.error
    ? <button type="button" className="text-button" onClick={resource.reload}>重新读取兑换状态</button>
    : <p role="status">正在读取兑换状态…</p>;

  if (view.cancellation) return <section className="account-redemption" aria-label="订单取消状态">
    <h3>{view.cancellation.state === 'refund_review' ? '退款待审核' : view.cancellation.state === 'refund_rejected' ? '退款未通过审核' : view.cancellation.cancelledAt || view.cancellation.state === 'cancelled' ? '订单已取消' : '超时处理进度'}</h3><p role="status">{view.cancellation.message}</p>
  </section>;

  const charging = !settled && !progressPaused && result?.state !== 'MANUAL_REVIEW' && result?.state !== 'CANCELED';
  const succeeded = tag.tone === 'success';
  if (submitted) return <section className="account-redemption redemption-result-panel" data-success={succeeded || undefined} data-failure={tag.tone === 'failure' || undefined} aria-label="开通结果" aria-busy={charging}>
    <h3>开通结果</h3>
    {succeeded && <p className="redemption-success-banner" role="status"><Icon name="circle-check" /><span className="redemption-result-tag" data-tone="success">{tag.label}</span></p>}
    <RedemptionSteps result={result} />
    {!settled && <div className="redemption-progress-status" role="status">{charging && <span className="redemption-loading-ring" aria-hidden="true" />}<div><strong>{progress.title}</strong><p>{progress.detail}</p></div></div>}
    {tag.tone === 'failure' && result?.reason ? <div className="redemption-validation-error redemption-failure-detail" role="alert"><Icon name="info" /><div><h4>充值未完成</h4><p>{result.reason}</p></div></div>
      : !succeeded && settled && <p role="status"><span className="status-badge redemption-result-tag" data-tone={tag.tone}>{tag.label}</span></p>}
    <RedemptionHistory result={result} />
    <dl className="redemption-result-email"><dt>开通邮箱</dt><dd>{view.rechargeEmail || '未记录'}</dd></dl>
    {result?.orderNo && <p className="redemption-result-order">兑换单号 <span className="mono">{result.orderNo}</span></p>}
    {!settled && <p className="field-hint">可稍后在订单页查询原单进度。</p>}
    {view.enabled && <button type="button" className="button secondary" disabled={busy} onClick={() => void send('refresh', {})}>{succeeded ? '刷新处理记录' : '刷新充值进度'}</button>}
  </section>;

  if (!view.enabled) return <p role="status" className="account-redemption">当前环境暂未开放账号兑换。</p>;

  return <section className="account-redemption" aria-label="连接账号" aria-busy={busy}>
    <h3>连接账号</h3>
    {account ? <div className="account-redemption-confirm">
      <div className="redemption-account-card" data-verified={account.validation === 'confirmed'}>
        <div className="redemption-account-card-heading">
          <h4><Icon name="shield-check" />{account.validation === 'confirmed' ? '账号检测通过' : '账号信息已识别'}</h4>
          {account.validation === 'confirmed' && <span className="redemption-account-eligibility"><Icon name="check" />可以开通</span>}
        </div>
        <dl>
          <div className="redemption-account-email"><dt><Icon name="mail" />账号邮箱</dt><dd>{account.email}</dd></div>
          <div><dt>目标套餐</dt><dd>{productName.replace(/^ChatGPT\s+/i, '')}</dd></div>
        </dl>
        <p>请确认充值账号是否正确</p>
      </div>
      <label className="redemption-account-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /><span>我已确认以上账号，将为此账号充值</span></label>
      <div className="redemption-account-actions">
        <button type="button" className="button primary" disabled={busy || !confirmed} onClick={() => void send('submit', { confirmationId: account.confirmationId, ...(view.requiresSession ? { sessionInput: session.current?.value } : {}) })}>确认并提交充值<Icon name="arrow-right" /></button>
        <button type="button" className="button secondary" disabled={busy} onClick={() => { session.current = null; setEditing(true); setConfirmed(false); setValidationError(null); }}>更换账号</button>
      </div>
    </div> : <form onSubmit={preview}>
      <ol className="redemption-account-guide" aria-label="连接账号步骤">
        <li><span className="redemption-guide-number" aria-hidden="true">01</span><div>
          <strong>登录 ChatGPT</strong>
          <p>使用浏览器打开并登录你的个人 ChatGPT 账号。</p>
          <a href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">前往登录<Icon name="arrow-up-right" /></a>
        </div></li>
        <li><span className="redemption-guide-number" aria-hidden="true">02</span><div>
          <strong>复制登录信息</strong>
          <p>点击下方入口，复制页面全部内容。</p>
          <a href="https://chatgpt.com/api/auth/session" target="_blank" rel="noopener noreferrer">获取登录信息<Icon name="arrow-up-right" /></a>
        </div></li>
      </ol>
      <label htmlFor={'session-' + orderId}>ChatGPT Session</label>
      <textarea ref={input} id={'session-' + orderId} rows={5} maxLength={512000} autoComplete="off" spellCheck={false} required disabled={busy} aria-invalid={validationError ? true : undefined} aria-describedby={validationError ? `session-error-${orderId}` : undefined} onChange={() => setValidationError(null)} />
      {validationError && <div className="redemption-validation-error" role="alert" id={`session-error-${orderId}`}>
        <Icon name="info" /><div><h4>{validationTitle}</h4>
          <p>{validationError}</p>{sessionExpired && !validationError.includes('重新登录') && <p>请重新登录 ChatGPT，获取最新登录信息并复制完整内容后再试。</p>}
        </div>
      </div>}
      {policy.error && <button className="text-button" type="button" onClick={policy.reload}>重新读取条款</button>}
      <button type="submit" className="button primary" disabled={busy || !policyData}>{validationError ? '重新检测账号' : '验证账号并继续'}</button>
    </form>}
    {busy && <RedemptionLoading label={action === 'submit' ? '正在提交充值' : '正在检测账号'} />}
  </section>;
}
