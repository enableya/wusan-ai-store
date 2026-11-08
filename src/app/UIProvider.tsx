import { useMessage } from './MessageProvider';
import { createContext, useContext, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { SupportContacts } from '../components/SupportContacts';
import { site } from '../config/site';
import { StatusBadge } from '../components/Product';
import { useApiResource } from '../hooks/useApiResource';
import { ApiState } from '../components/ApiState';
import type { Product } from '../types/catalog';
import { money } from '../lib/format';
import { validContact, validQueryPassword } from '../lib/order-input';
import { postApi } from '../services/api';
import type { Order } from '../types/orders';
import { removeSelection } from '../services/selections';

type ModalState = { type: 'compare' } | { type: 'recover' } | { type: 'support' } | { type: 'delete-selection'; id: string } | null;
const UIContext = createContext<{
  openModal: (modal: NonNullable<ModalState>) => void;
} | null>(null);

function RecoverForm({ onClose }: { onClose: () => void }) {
  const [contact, setContact] = useState('');
  const [password, setPassword] = useState('');
  const $message = useMessage();
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!validContact(contact) || !validQueryPassword(password)) { $message.warning('请填写联系方式和 6–64 位查询密码。'); return; }
    setBusy(true);
    try {
      await postApi<Order[]>('/orders/lookup', { contact: contact.trim(), queryPassword: password });
      setPassword(''); window.dispatchEvent(new Event('wusan:orders-updated')); onClose();
      $message.success('已找回订单。');
    } catch (cause) { $message.error(cause instanceof Error ? cause.message : '暂时无法查询订单。'); }
    finally { setBusy(false); }
  }
  return <>
    <p className="modal-description">填写购买时使用的联系方式和查询密码，找回最近的对应订单。旧版未设置查询密码的订单，请使用下单浏览器或联系支持。</p>
    <form onSubmit={submit} noValidate>
      <label htmlFor="recover-contact">联系方式</label>
      <input id="recover-contact" name="contact" type="text" autoComplete="off" maxLength={254} placeholder="购买时填写的联系方式" disabled={busy} value={contact} onChange={event => { setContact(event.target.value); }} />
      <label htmlFor="recover-password" style={{ marginTop: 16 }}>查询密码</label>
      <input id="recover-password" name="queryPassword" type="password" autoComplete="current-password" maxLength={64} placeholder="购买时设置的查询密码" disabled={busy} value={password} onChange={event => { setPassword(event.target.value); }} />
      <button className="button primary full-width spaced-button" type="submit" disabled={busy}><Icon name="search" />{busy ? '正在查询…' : '查询订单'}</button>
      <p className="panel-footnote"><Icon name="shield-check" />验证后可在当前浏览器查看对应订单，有效期 8 小时</p>
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
  const $message = useMessage();
  const close = () => setModal(null);
  useEffect(() => { setModal(null); }, [pathname]);
  return <UIContext.Provider value={{ openModal: setModal }}>
    {children}
    {modal?.type === 'compare' && <Dialog title="套餐对比" onClose={close} wide><Comparison onClose={close} /></Dialog>}
    {modal?.type === 'recover' && <Dialog title="找回订单" onClose={close}><RecoverForm onClose={close} /></Dialog>}
    {modal?.type === 'support' && <Dialog title="联系支持" className="support-modal" onClose={close}>
      <div className="support-modal-content"><p>{site.name}</p><SupportContacts /></div>
    </Dialog>}
    {modal?.type === 'delete-selection' && <Dialog title="删除套餐草稿？" onClose={close}>
      <p className="modal-description">仅删除此浏览器中的套餐清单，不涉及订单、付款或退款。</p>
      <div className="modal-actions"><button className="button secondary" type="button" onClick={close}>取消</button>
        <button className="button danger" type="button" onClick={() => {
          try { removeSelection(modal.id); close(); $message.success('本机套餐草稿已删除。'); }
          catch { $message.error('浏览器禁止修改本机存储，暂时无法删除。'); }
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
