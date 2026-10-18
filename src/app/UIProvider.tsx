import { createContext, useContext, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { Notice } from '../components/Page';
import { StatusBadge } from '../components/Product';
import { useApiResource } from '../hooks/useApiResource';
import { ApiState } from '../components/ApiState';
import type { Product } from '../types/catalog';
import { money, validEmail } from '../lib/format';
import { removeSelection } from '../services/selections';

type ModalState = { type: 'compare' } | { type: 'recover' } | { type: 'delete-selection'; id: string } | null;
const UIContext = createContext<{
  notify: (message: string) => void;
  openModal: (modal: NonNullable<ModalState>) => void;
} | null>(null);

function RecoverForm() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState(false);
  function submit(event: FormEvent) {
    event.preventDefault();
    const valid = validEmail(email.trim());
    setInvalid(!valid);
    setError(valid ? '邮件服务尚未开放，未发送验证码。' : '请填写有效的联系邮箱。');
  }
  return <>
    <p className="modal-description">当前浏览器的订单可在“我的订单”查看。跨设备邮箱找回仍在准备中，请保留下单时的浏览器 Cookie 和订单号。</p>
    <Notice subtle>邮箱验证尚未开放，当前不会发送验证码。</Notice>
    <form onSubmit={submit} noValidate>
      <label htmlFor="recover-email">联系邮箱</label>
      <input id="recover-email" name="email" type="email" autoComplete="email" maxLength={254}
        placeholder="you@example.com" aria-describedby="recover-error" aria-invalid={invalid}
        value={email} onChange={(event) => { setEmail(event.target.value); setError(''); setInvalid(false); }} />
      <p id="recover-error" className="field-error" role="alert">{error}</p>
      <button className="button primary full-width" type="submit"><Icon name="mail" />获取验证码</button>
      <p className="panel-footnote"><Icon name="shield-check" />仅填写邮箱不能访问私有订单</p>
    </form>
  </>;
}

function Comparison({ onClose }: { onClose: () => void }) {
  const resource = useApiResource<Product[]>('/products');
  if (!resource.data) return <ApiState compact error={resource.error} retry={resource.reload} title="正在加载套餐对比" />;
  const products = resource.data;
  return <>
    <p className="modal-description">以下为本站月度套餐及实际售价，不代表官方定价。具体权益与交付条件请在购买前确认。</p>
    <div className="comparison-scroll"><table className="comparison-table">
      <caption className="sr-only">月度订阅套餐对比</caption>
      <thead><tr><th scope="col">订阅方案</th>{products.map((product) => <th scope="col" key={product.id}>{product.name}</th>)}</tr></thead>
      <tbody>
        <tr><th scope="row">本站售价</th>{products.map((product) => <td key={product.id}>{product.priceCents === null ? '待确认' : `¥${money(product.priceCents)}/月`}</td>)}</tr>
        <tr><th scope="row">适用需求</th>{products.map((product) => <td key={product.id}>{product.audience}</td>)}</tr>
        <tr><th scope="row">订阅周期</th>{products.map((product) => <td key={product.id}>{product.periodMonths} 个月</td>)}</tr>
        <tr><th scope="row">具体权益</th>{products.map((product) => <td key={product.id}>{product.details.entitlements || '待供应方案确认'}</td>)}</tr>
        <tr><th scope="row">套餐状态</th>{products.map((product) => <td key={product.id}><StatusBadge product={product} /></td>)}</tr>
        <tr><th scope="row">查看方案</th>{products.map((product) => <td key={product.id}><Link className="text-button" to={`/products/${product.id}`} onClick={onClose}>查看详情 <Icon name="arrow-up-right" /></Link></td>)}</tr>
      </tbody>
    </table></div>
  </>;
}

export function UIProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [modal, setModal] = useState<ModalState>(null);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const notify = (message: string) => setToast({ id: Date.now(), message });
  const close = () => setModal(null);
  useEffect(() => { setModal(null); }, [pathname]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  return <UIContext.Provider value={{ notify, openModal: setModal }}>
    {children}
    <div id="toast" className={toast ? 'visible' : ''} role="status" aria-live="polite">{toast?.message}</div>
    {modal?.type === 'compare' && <Dialog title="套餐对比" onClose={close} wide><Comparison onClose={close} /></Dialog>}
    {modal?.type === 'recover' && <Dialog title="通过邮箱找回订单" onClose={close}><RecoverForm /></Dialog>}
    {modal?.type === 'delete-selection' && <Dialog title="删除套餐草稿？" onClose={close}>
      <p className="modal-description">仅删除此浏览器中的套餐清单，不涉及订单、付款或退款。</p>
      <div className="modal-actions"><button className="button secondary" type="button" onClick={close}>取消</button>
        <button className="button danger" type="button" onClick={() => {
          try { removeSelection(modal.id); close(); notify('本机套餐草稿已删除。'); }
          catch { notify('浏览器禁止修改本机存储，暂时无法删除。'); }
        }}><Icon name="trash-2" />删除草稿</button>
      </div>
    </Dialog>}
  </UIContext.Provider>;
}

export function useUI() {
  const value = useContext(UIContext);
  if (!value) throw new Error('UIProvider is required.');
  return value;
}
