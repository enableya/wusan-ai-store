import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useUI } from '../app/UIProvider';
import { Breadcrumb, EmptyPage, Notice, PageHeading } from '../components/Page';
import { Icon } from '../components/Icon';
import { SmallProductIcon } from '../components/Product';
import { usePageTitle } from '../hooks/usePageTitle';
import { useApiResource } from '../hooks/useApiResource';
import { ApiState } from '../components/ApiState';
import type { Product } from '../types/catalog';
import { money, validEmail } from '../lib/format';
import { saveSelection } from '../services/selections';
import { postApi } from '../services/api';
import type { Order, PaymentConfig } from '../types/orders';

export default function CheckoutPage() {
  usePageTitle('核对订阅信息');
  const { productId } = useParams();
  const resource = useApiResource<Product>(productId ? `/products/${encodeURIComponent(productId)}` : null);
  const product = resource.data;
  const payment = useApiResource<PaymentConfig>('/payments/config');
  const navigate = useNavigate();
  const { notify } = useUI();
  const [email, setEmail] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState({ email: '', terms: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const submittingRef = useRef(false);
  const requestKey = useRef(crypto.randomUUID());
  const emailInput = useRef<HTMLInputElement>(null);
  const termsInput = useRef<HTMLInputElement>(null);
  useEffect(() => { setEmail(''); setAccepted(false); setSubmitError(''); requestKey.current = crypto.randomUUID(); setErrors({ email: '', terms: '' }); }, [productId]);
  if (resource.error?.status === 404) return <EmptyPage title="无法选择这个套餐" description="套餐不存在或已下架，请重新选择。" button="查看全部套餐" to="/" icon="package-x" />;
  if (!product) return <ApiState error={resource.error} retry={resource.reload} title="正在核对套餐信息" />;
  if (!product.selectable || product.priceCents === null) return <EmptyPage title="套餐暂未开放" description="该套餐的价格或供应条件尚未确认，暂不能进入下单信息页。" button="返回套餐详情" to={`/products/${product.id}`} icon="package-x" />;

  function validate() {
    const valid = validEmail(email.trim());
    setErrors({ email: valid ? '' : '请填写有效的联系邮箱。', terms: accepted ? '' : '请阅读说明并勾选确认。' });
    if (!valid || !accepted) { (valid ? termsInput : emailInput).current?.focus(); return false; }
    return true;
  }
  function saveDraft() {
    if (!validate()) return;
    try {
      saveSelection(product!);
      notify('套餐清单已保存在此浏览器，未创建真实订单。');
      navigate('/orders');
    } catch { notify('无法保存套餐清单，请检查浏览器是否允许本机存储。'); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!validate() || submittingRef.current || !payment.data?.enabled) return;
    submittingRef.current = true;
    setSubmitting(true); setSubmitError('');
    try {
      const order = await postApi<Order>('/orders', { productId: product!.id, email: email.trim(), acceptedTerms: true, expectedPriceCents: product!.priceCents }, requestKey.current);
      navigate(`/pay/${order.id}`);
    } catch (error) { setSubmitError(error instanceof Error ? error.message : '下单失败，请稍后重试。'); }
    finally { submittingRef.current = false; setSubmitting(false); }
  }

  return <div className="container page-space">
    <Breadcrumb items={[{ label: product.name, to: `/products/${product.id}` }, { label: '核对订阅信息' }]} />
    <PageHeading title="核对订阅信息" eyebrow="YOUR SUBSCRIPTION" description="确认你的选择，了解服务条件。" />
    <div className="checkout-progress"><span className="completed"><Icon name="check" />选择套餐</span><b /><span className="active"><i>2</i>确认信息</span><b /><span><i>3</i>付款与交付</span></div>
    <Notice>{payment.data?.message || (payment.error ? '支付配置暂时无法加载，请重试。' : '正在确认支付宝支付状态…')}
      {payment.error && <button type="button" className="text-button" onClick={payment.reload}>重试</button>}
      {payment.data?.enabled && ' 创建订单后有 30 分钟付款时间，不自动续费。'}</Notice>
    <div className="checkout-layout"><form id="checkout-form" onSubmit={submit} noValidate>
      <section className="form-section"><h2><span>01</span>联系信息</h2><label htmlFor="contact-email">联系邮箱</label>
        <input ref={emailInput} id="contact-email" name="email" type="email" placeholder="you@example.com" maxLength={254} autoComplete="email"
          aria-describedby="email-hint email-error" aria-invalid={!!errors.email} value={email}
          disabled={submitting} onChange={(event) => { setEmail(event.target.value); requestKey.current = crypto.randomUUID(); setErrors((value) => ({ ...value, email: '' })); }} />
        <p id="email-hint" className="field-hint">创建订单时邮箱会保存至服务器，用于订单联系。保存本机草稿不会保存邮箱。邮件通知与邮箱找回暂未开通。</p><p id="email-error" className="field-error" role="alert">{errors.email}</p>
      </section>
      <section className="form-section"><h2><span>02</span>订阅方案</h2>
        <div className="selected-product"><SmallProductIcon product={product} /><div><strong>{product.name}</strong><p>个人订阅 · {product.periodMonths} 个月 · 1 份</p></div><Link className="text-button" to={`/products/${product.id}`}>更换 <Icon name="arrow-left-right" /></Link></div>
        <dl className="spec-list"><div><dt>账号与地区条件</dt><dd>{product.details.accountRequirements || '待确认'}</dd></div><div><dt>交付方式</dt><dd>{product.details.deliveryMethod || '待确认'}</dd></div><div><dt>售后范围</dt><dd>{product.details.afterSales || '正式开放前确认'}</dd></div></dl>
      </section>
      <section className="form-section"><h2><span>03</span>支付方式</h2><div className="payment-option"><Icon name="credit-card" /><strong>支付宝</strong><span className="status-badge pending">{payment.data?.enabled ? payment.data.environment === 'sandbox' ? '沙箱测试' : '安全支付' : '待配置'}</span></div><p className="field-hint">{payment.data?.environment === 'sandbox' ? '当前为沙箱测试：请使用沙箱买家账号和支付宝沙箱版 App。普通支付宝无法用于沙箱扫码；如收银台提供账号付款入口，也可使用沙箱买家账号登录。' : '付款在支付宝官方收银台完成。电脑端可扫码，手机端可跳转支付宝；最终结果以订单状态为准。'}</p></section>
      <div className="terms-checkbox"><input ref={termsInput} id="accept-terms" name="terms" type="checkbox" aria-describedby="terms-error" checked={accepted}
        onChange={(event) => { setAccepted(event.target.checked); setErrors((value) => ({ ...value, terms: '' })); }} />
        <label htmlFor="accept-terms">我已阅读<Link to="/terms" target="_blank" rel="noopener">服务须知</Link>与<Link to="/privacy" target="_blank" rel="noopener">隐私说明</Link>，确认套餐金额并了解交付与售后条件。</label>
      </div><p id="terms-error" className="field-error" role="alert">{errors.terms}</p>
      <p className="field-error" role="alert">{submitError}</p>
      <button className="button primary" type="submit" disabled={!payment.data?.enabled || submitting}><Icon name="credit-card" />{submitting ? '正在创建订单…' : payment.data?.enabled ? '创建订单并继续付款' : payment.error ? '支付状态暂不可用' : payment.loading ? '正在确认支付状态…' : '支付宝待配置'}</button>
      <button className="text-button spaced-button" type="button" disabled={submitting} onClick={saveDraft}><Icon name="bookmark" />保存本机套餐清单</button>
    </form>
    <aside className="purchase-panel order-summary"><h2>你的选择</h2><div className="summary-product"><SmallProductIcon product={product} /><div><strong>{product.name}</strong><p>月度订阅 · 1 份</p></div></div>
      <dl className="purchase-specs"><div><dt>套餐单价</dt><dd>¥{money(product.priceCents)}</dd></div><div><dt>数量</dt><dd>1</dd></div></dl>
      <div className="summary-total"><span>合计</span><strong>¥{money(product.priceCents)}</strong></div>
      <p className="panel-footnote"><Icon name="shield-check" />服务器核对金额，支付宝确认付款。付款完成后请查看订单状态。</p>
    </aside></div>
  </div>;
}
