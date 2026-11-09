import './admin-coupons.css';
import { useMessage } from '../app/MessageProvider';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { useApiResource } from '../hooks/useApiResource';
import { postApi } from '../services/api';
import { validContact, validNewQueryPassword } from '../lib/order-input';
import { money } from '../lib/format';
import type { Product } from '../types/catalog';
import type { Order, PaymentConfig } from '../types/orders';

export function PurchaseSummary({ product, environment }: { product: Product; environment?: PaymentConfig['environment'] }) {
  return <>
    <fieldset className="product-payment-method"><legend>支付方式</legend><label><input type="radio" name="payment" value="alipay" checked readOnly /><img className="alipay-symbol" src="/brand/alipay.svg" width="32" height="32" alt="" aria-hidden="true" /><strong>支付宝</strong>{environment === 'sandbox' && <small>沙箱测试</small>}</label></fieldset>
    <div className="product-order-total"><span>数量 <b>1</b></span><span>合计 <strong>{product.priceCents === null ? '待确认' : `¥${money(product.priceCents)}`}</strong></span></div>
  </>;
}

export type CouponQuote = { code: string; discountCents: number; originalCents: number; payableCents: number };

export function PurchaseForm({ product, onCreated, onQuoteChange }: {
  product: Product; onCreated?: (order: Order) => void; onQuoteChange?: (quote: CouponQuote | null) => void;
}) {
  const payment = useApiResource<PaymentConfig>('/payments/config');
  const navigate = useNavigate();
  const [contact, setContact] = useState('');
  const [password, setPassword] = useState('');
  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState<CouponQuote | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);
  const couponRequest = useRef(0);
  const quotedInput = useRef('');
  const [errors, setErrors] = useState({ contact: '', password: '' });
  const $message = useMessage();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const key = useRef(crypto.randomUUID());
  const form = useRef<HTMLFormElement>(null);
  const selectable = product.selectable && product.priceCents !== null;
  const sandbox = payment.data?.environment === 'sandbox';
  const sandboxPreview = !onCreated && sandbox;
  const canPay = payment.data?.enabled === true;
  const change = () => { key.current = crypto.randomUUID(); };
  useEffect(() => { onQuoteChange?.(coupon); }, [coupon, onQuoteChange]);
  useEffect(() => {
    couponRequest.current++; quotedInput.current = '';
    setCouponInput(''); setCoupon(null); setCouponBusy(false);
    setContact(''); setPassword('');
    setErrors({ contact: '', password: '' }); key.current = crypto.randomUUID();
  }, [product.id]);
  async function applyCoupon() {
    const code = couponInput.trim();
    if (!code || quotedInput.current === code) return;
    const request = ++couponRequest.current;
    setCouponBusy(true);
    try {
      const result = await postApi<CouponQuote>('/coupons/quote', { code, productId: product.id });
      if (request !== couponRequest.current) return;
      quotedInput.current = code;
      setCoupon(result); change(); $message.success('优惠券已应用。');
    } catch (cause) {
      if (request !== couponRequest.current) return;
      setCoupon(null); $message.error(cause instanceof Error ? cause.message : '优惠券不可用。');
    } finally { if (request === couponRequest.current) setCouponBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || !selectable || couponBusy) return;
    if (couponInput.trim() && quotedInput.current !== couponInput.trim()) { await applyCoupon(); return; }
    if (!canPay) {
      if (sandboxPreview && payment.data) $message.info(payment.data.message);
      return;
    }
    const next = { contact: validContact(contact) ? '' : '请填写有效的联系方式（5–254 个字符）。', password: validNewQueryPassword(password) ? '' : '请设置 6–14 位查询密码。' };
    setErrors(next);
    if (Object.values(next).some(Boolean)) {
      $message.warning(next.contact || next.password);
      const id = next.contact ? 'purchase-contact' : 'query-password';
      form.current?.querySelector<HTMLInputElement>(`#${id}`)?.focus(); return;
    }
    lock.current = true; setBusy(true);
    try {
      const order = await postApi<Order>('/orders', { productId: product.id, contact: contact.trim(), queryPassword: password, expectedPriceCents: product.priceCents, couponCode: coupon?.code, expectedDiscountCents: coupon?.discountCents }, key.current);
      setPassword('');
      if (onCreated) onCreated(order);
      else navigate(`/pay/${order.id}`);
    } catch (cause) { $message.error(cause instanceof Error ? cause.message : '下单失败，请稍后重试。'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <form ref={form} className="product-purchase-form" onSubmit={submit} noValidate>
    <div className="purchase-field"><label htmlFor="purchase-contact">联系方式 <span>*</span></label>
      <input id="purchase-contact" name="contact" type="text" placeholder="邮箱、手机号、QQ 或微信" autoComplete="off" maxLength={254} value={contact} disabled={busy} aria-invalid={!!errors.contact} aria-describedby="contact-hint" onChange={event => { setContact(event.target.value); change(); setErrors(value => ({ ...value, contact: '' })); }} />
      <p className="field-hint" id="contact-hint">用于订单联系和查询，请填写常用联系方式。</p>
    </div>
    <div className="purchase-field"><label htmlFor="query-password">查询密码 <span>*</span></label>
      <input id="query-password" name="queryPassword" type="password" placeholder="设置 6–14 位查询密码" autoComplete="new-password" minLength={6} maxLength={14} value={password} disabled={busy} aria-invalid={!!errors.password} aria-describedby="password-hint" onChange={event => { setPassword(event.target.value); change(); setErrors(value => ({ ...value, password: '' })); }} />
      <p className="field-hint" id="password-hint">用于找回订单，请妥善保存，无需填写账号或支付密码。</p>
    </div>
    <div className="purchase-field coupon-entry"><label htmlFor="coupon-code">优惠码（选填）</label><div className="coupon-entry-row"><input id="coupon-code" value={couponInput} maxLength={40} disabled={busy} placeholder="输入优惠码" aria-busy={couponBusy} onBlur={() => void applyCoupon()} onChange={event => { couponRequest.current++; quotedInput.current = ''; setCouponBusy(false); setCouponInput(event.target.value); setCoupon(null); change(); }} /></div>{coupon && <p className="coupon-entry-note">已优惠 ¥{money(coupon.discountCents)}，应付 ¥{money(coupon.payableCents)}</p>}</div>
    {!onCreated && <PurchaseSummary product={product} environment={payment.data?.environment} />}
    <button className="button primary full-width buy-now" type="submit" disabled={busy || couponBusy || !selectable || (!canPay && !sandboxPreview)}>{busy ? '正在创建订单…' : onCreated ? '继续付款' : '立即购买'}<Icon name="arrow-right" /></button>
    {!selectable ? <p className="field-hint payment-availability">商品暂未开放购买。</p> : !canPay && <p className="field-hint payment-availability">{payment.error ? null : payment.loading ? '正在确认支付状态…' : sandbox ? payment.data?.message : '支付宝收款暂未开放。'}{payment.error && <button type="button" className="text-button" onClick={payment.reload}>重试</button>}</p>}
    {canPay && sandbox && <p className="field-hint payment-availability">当前为沙箱测试，请使用沙箱买家账号付款，不产生真实扣款。</p>}
  </form>;
}
