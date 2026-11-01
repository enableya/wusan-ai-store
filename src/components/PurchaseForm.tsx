import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { useApiResource } from '../hooks/useApiResource';
import { postApi } from '../services/api';
import { validContact, validQueryPassword } from '../lib/order-input';
import { money } from '../lib/format';
import type { Product } from '../types/catalog';
import type { Order, PaymentConfig } from '../types/orders';

export function PurchaseForm({ product }: { product: Product }) {
  const payment = useApiResource<PaymentConfig>('/payments/config');
  const navigate = useNavigate();
  const [contact, setContact] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState({ contact: '', password: '', terms: '' });
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const key = useRef(crypto.randomUUID());
  const form = useRef<HTMLFormElement>(null);
  const change = () => { key.current = crypto.randomUUID(); setSubmitError(''); };
  useEffect(() => {
    setContact(''); setPassword(''); setAccepted(false); setSubmitError('');
    setErrors({ contact: '', password: '', terms: '' }); key.current = crypto.randomUUID();
  }, [product.id]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    const next = { contact: validContact(contact) ? '' : '请填写有效的联系方式（5–254 个字符）。', password: validQueryPassword(password) ? '' : '请设置 8–64 位查询密码。', terms: accepted ? '' : '请先阅读并同意服务须知和隐私说明。' };
    setErrors(next);
    if (Object.values(next).some(Boolean)) {
      const id = next.contact ? 'purchase-contact' : next.password ? 'query-password' : 'accept-terms';
      form.current?.querySelector<HTMLInputElement>(`#${id}`)?.focus(); return;
    }
    if (!payment.data?.enabled || !product.selectable || product.priceCents === null) return;
    lock.current = true; setBusy(true); setSubmitError('');
    try {
      const order = await postApi<Order>('/orders', { productId: product.id, contact: contact.trim(), queryPassword: password, acceptedTerms: true, expectedPriceCents: product.priceCents }, key.current);
      setPassword(''); navigate(`/pay/${order.id}`);
    } catch (cause) { setSubmitError(cause instanceof Error ? cause.message : '下单失败，请稍后重试。'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <form ref={form} className="product-purchase-form" onSubmit={submit} noValidate>
    <div className="purchase-field"><label htmlFor="purchase-contact">联系方式 <span>*</span></label>
      <input id="purchase-contact" name="contact" type="text" placeholder="邮箱、手机号、QQ 或微信" autoComplete="off" maxLength={254} value={contact} disabled={busy} aria-invalid={!!errors.contact} aria-describedby="contact-hint contact-error" onChange={event => { setContact(event.target.value); change(); setErrors(value => ({ ...value, contact: '' })); }} />
      <p className="field-hint" id="contact-hint">用于订单联系和查询，请填写常用联系方式。</p><p className="field-error" id="contact-error" role="alert">{errors.contact}</p>
    </div>
    <div className="purchase-field"><label htmlFor="query-password">查询密码 <span>*</span></label>
      <input id="query-password" name="queryPassword" type="password" placeholder="设置 8–64 位查询密码" autoComplete="new-password" minLength={8} maxLength={64} value={password} disabled={busy} aria-invalid={!!errors.password} aria-describedby="password-hint password-error" onChange={event => { setPassword(event.target.value); change(); setErrors(value => ({ ...value, password: '' })); }} />
      <p className="field-hint" id="password-hint">用于找回订单，请妥善保存，无需填写账号或支付密码。</p><p className="field-error" id="password-error" role="alert">{errors.password}</p>
    </div>
    <fieldset className="product-payment-method"><legend>支付方式</legend><label><input type="radio" name="payment" value="alipay" checked readOnly /><img className="alipay-symbol" src="/brand/alipay.svg" width="32" height="32" alt="" aria-hidden="true" /><strong>支付宝</strong>{payment.data?.environment === 'sandbox' && <small>沙箱测试</small>}</label></fieldset>
    <div className="product-order-total"><span>数量 <b>1</b></span><span>合计 <strong>{product.priceCents === null ? '待确认' : `¥${money(product.priceCents)}`}</strong></span></div>
    <div className="terms-checkbox product-terms"><input id="accept-terms" type="checkbox" checked={accepted} disabled={busy} aria-invalid={!!errors.terms} aria-describedby="terms-error" onChange={event => { setAccepted(event.target.checked); setErrors(value => ({ ...value, terms: '' })); }} /><label htmlFor="accept-terms">我已阅读并同意<Link to="/terms" target="_blank" rel="noopener">服务须知</Link>和<Link to="/privacy" target="_blank" rel="noopener">隐私说明</Link></label></div>
    <p className="field-error" id="terms-error" role="alert">{errors.terms}</p><p className="field-error" role="alert">{submitError}</p>
    <button className="button primary full-width buy-now" type="submit" disabled={busy || !payment.data?.enabled || !product.selectable || product.priceCents === null}>{busy ? '正在创建订单…' : '立即购买'}<Icon name="arrow-right" /></button>
    {!product.selectable ? <p className="field-hint payment-availability">商品暂未开放购买。</p> : !payment.data?.enabled && <p className="field-hint payment-availability">{payment.error ? '支付状态暂时无法获取。' : payment.loading ? '正在确认支付状态…' : '支付宝收款暂未开放。'}{payment.error && <button type="button" className="text-button" onClick={payment.reload}>重试</button>}</p>}
    {payment.data?.enabled && payment.data.environment === 'sandbox' && <p className="field-hint payment-availability">当前为沙箱测试，请使用沙箱买家账号付款，不产生真实扣款。</p>}
  </form>;
}
