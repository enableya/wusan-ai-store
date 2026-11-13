import { useMessage } from './MessageProvider';
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode, FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Dialog } from '../components/Dialog';
import { postApi, requestApi } from '../services/api';
import '../pages/referrals.css';

type Customer = { id: string; username: string; inviteCode: string; staffCheckout?: true };
const Context = createContext<{user: Customer | null; login: () => void; share: () => void; logout: () => void} | null>(null);
export function CustomerProvider({ children }: {children: ReactNode}) {
  const $message = useMessage();
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState<Customer | null>(null);
  const [modal, setModal] = useState<'guest'|'auth'|'link'|null>(null);
  const [register, setRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [shareAfterLogin, setShareAfterLogin] = useState(false);
  const [link, setLink] = useState('');
  const code = new URLSearchParams(location.search).get('ref') || '';
  const [capture, setCapture] = useState<{ requestedCode: string; invitation: { code: string; expiresAt: number | null } | null } | null>(null);
  const [captureError, setCaptureError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => { void requestApi<Customer | null>('/customer/session').then(setUser).catch(() => {}); }, []);
  useEffect(() => {
    if (capture && (!code || capture.requestedCode === code || capture.invitation?.code === code)) return;
    let active = true;
    setCaptureError(false);
    const load = code
      ? postApi<{ invitation: { code: string; expiresAt: number | null } | null }>('/referrals/visit', { code }).then(result => result.invitation)
      : requestApi<{ code: string; expiresAt: number | null } | null>('/referrals/invitation', AbortSignal.timeout(12000));
    void load.then(invitation => {
      if (active) setCapture({ requestedCode: code, invitation });
    }).catch(() => {
      if (!active) return;
      setCaptureError(true);
      $message.error('邀请信息加载失败，请重试。');
    });
    return () => { active = false; };
  }, [code, capture, retry, $message]);
  useEffect(() => {
    if (!capture || (code && code !== capture.requestedCode && code !== capture.invitation?.code)) return;
    const params = new URLSearchParams(location.search);
    const saved = capture.invitation;
    if (saved) {
      if (params.getAll('ref').length === 1 && code === saved.code) return;
      params.set('ref', saved.code);
    } else {
      if (!params.has('ref')) return;
      params.delete('ref');
    }
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash }, { replace: true, state: location.state });
  }, [capture, code, location, navigate]);
  const makeLink = (account: Customer | null) => {
    const url = new URL(location.pathname.startsWith('/products/') ? location.pathname : '/', window.location.origin);
    if (account) url.searchParams.set('ref', account.inviteCode);
    return url.href;
  };
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); $message.success('分享链接已复制'); return true; }
    catch { $message.warning('复制失败，请选中链接后手动复制。'); setLink(value); setModal('link'); return false; }
  }
  async function share() {
    setBusy(true);
    try {
      const account = await requestApi<Customer | null>('/customer/session'); setUser(account);
      if (!account) setModal('guest');
      else { const value = makeLink(account); setLink(value); setModal('link'); await copy(value); }
    } catch { $message.error('暂时无法确认登录状态，请重试。'); }
    finally { setBusy(false); }
  }
  function login(after = false) { setShareAfterLogin(after); setRegister(false); setPassword(''); setModal('auth'); }
  async function authenticate(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true);
    try {
      const account = await postApi<Customer>(`/customer/${register ? 'register' : 'login'}`, {username, password});
      setUser(account); setCapture(null); setPassword('');
      if (shareAfterLogin) { const value = makeLink(account); setLink(value); setModal('link'); await copy(value); }
      else { setModal(null); $message.success('登录成功'); }
    } catch (cause) { $message.error(cause instanceof Error ? cause.message : '登录失败'); }
    finally { setBusy(false); }
  }
  async function logout() {
    try { await postApi('/customer/logout'); setUser(null); setCapture(null); $message.success('已退出登录'); }
    catch { $message.error('退出失败，请重试。'); }
  }
  const close = () => { if (!busy) { setModal(null); setPassword(''); } };
  return <Context.Provider value={{user, login: () => login(), share: () => void share(), logout: () => void logout()}}>
    {(!capture || (code && code !== capture.requestedCode && code !== capture.invitation?.code)) ? <div className="container page-space">{!captureError && <p role="status">正在打开邀请链接…</p>}{captureError && <button className="button primary" onClick={() => setRetry(n => n + 1)}>重试</button>}</div> : children}
    {modal === 'guest' && <Dialog title="分享给好友" onClose={close}><p className="modal-description">登录后分享，好友通过你的专属链接下单并付款，可获得 5 元返利。</p><div className="modal-actions"><button className="button secondary" onClick={async () => { if (await copy(makeLink(null))) setModal(null); }}>不登录，直接复制链接</button><button className="button primary" onClick={() => login(true)}>前往登录</button></div></Dialog>}
    {modal === 'auth' && <Dialog title={register ? '注册商城账号' : '登录商城账号'} onClose={close}><form className="customer-auth" onSubmit={authenticate}>
      <label htmlFor="customer-name">账号</label><input id="customer-name" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required pattern={'[a-zA-Z0-9_\\-]{3,40}'} maxLength={40} placeholder="3–40 位字母、数字或下划线" disabled={busy} />
      <label htmlFor="customer-password">登录密码</label><input id="customer-password" type="password" autoComplete={register ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} minLength={8} maxLength={128} required placeholder="至少 8 位" disabled={busy} />
      <button className="button primary full-width" disabled={busy}>{busy ? '处理中…' : register ? '注册并登录' : '登录'}</button><button className="text-button" type="button" disabled={busy} onClick={() => {setRegister(!register);}}>{register ? '已有账号，去登录' : '没有账号？立即注册'}</button>
    </form></Dialog>}
    {modal === 'link' && <Dialog title="分享链接" onClose={close}><div className="customer-auth"><p>{user ? '好友通过此链接下单并付款后，返利将记入你的邀请记录。' : '此链接不包含邀请码。'}</p><input aria-label="分享链接" readOnly value={link} onFocus={e => e.target.select()} /><button className="button primary" onClick={() => void copy(link)}>复制链接</button></div></Dialog>}
  </Context.Provider>;
}
export function useCustomer() { const context = useContext(Context); if (!context) throw new Error('CustomerProvider required'); return context; }
