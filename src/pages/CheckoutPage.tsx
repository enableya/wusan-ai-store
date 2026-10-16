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

export default function CheckoutPage() {
  usePageTitle('核对订阅信息');
  const { productId } = useParams();
  const resource = useApiResource<Product>(productId ? `/products/${encodeURIComponent(productId)}` : null);
  const product = resource.data;
  const navigate = useNavigate();
  const { notify } = useUI();
  const [email, setEmail] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState({ email: '', terms: '' });
  const emailInput = useRef<HTMLInputElement>(null);
  const termsInput = useRef<HTMLInputElement>(null);
  useEffect(() => { setEmail(''); setAccepted(false); setErrors({ email: '', terms: '' }); }, [productId]);
  if (resource.error?.status === 404) return <EmptyPage title="无法选择这个套餐" description="套餐不存在或已下架，请重新选择。" button="查看全部套餐" to="/" icon="package-x" />;
  if (!product) return <ApiState error={resource.error} retry={resource.reload} title="正在核对套餐信息" />;
  if (!product.selectable || product.priceCents === null) return <EmptyPage title="套餐暂未开放" description="该套餐的价格或供应条件尚未确认，暂不能进入下单信息页。" button="返回套餐详情" to={`/products/${product.id}`} icon="package-x" />;

  function submit(event: FormEvent) {
    event.preventDefault();
    const valid = validEmail(email.trim());
    setErrors({ email: valid ? '' : '请填写有效的联系邮箱。', terms: accepted ? '' : '请阅读说明并勾选确认。' });
    if (!valid || !accepted) { (valid ? termsInput : emailInput).current?.focus(); return; }
    try {
      saveSelection(product!);
      notify('套餐清单已保存在此浏览器，未创建真实订单。');
      navigate('/orders');
    } catch { notify('无法保存套餐清单，请检查浏览器是否允许本机存储。'); }
  }

  return <div className="container page-space">
    <Breadcrumb items={[{ label: product.name, to: `/products/${product.id}` }, { label: '核对订阅信息' }]} />
    <PageHeading title="核对订阅信息" eyebrow="YOUR SUBSCRIPTION" description="确认你的选择，了解服务条件。" />
    <div className="checkout-progress"><span className="completed"><Icon name="check" />选择套餐</span><b /><span className="active"><i>2</i>确认信息</span><b /><span><i>3</i>付款与交付</span></div>
    <Notice>暂未开放购买。可以保存本机套餐清单，但不会创建真实订单、发送邮件或收款。</Notice>
    <div className="checkout-layout"><form id="checkout-form" onSubmit={submit} noValidate>
      <section className="form-section"><h2><span>01</span>联系信息</h2><label htmlFor="contact-email">联系邮箱</label>
        <input ref={emailInput} id="contact-email" name="email" type="email" placeholder="you@example.com" maxLength={254} autoComplete="email"
          aria-describedby="email-hint email-error" aria-invalid={!!errors.email} value={email}
          onChange={(event) => { setEmail(event.target.value); setErrors((value) => ({ ...value, email: '' })); }} />
        <p id="email-hint" className="field-hint">联系邮箱不必与订阅账号一致。当前输入不会提交或保存。</p><p id="email-error" className="field-error" role="alert">{errors.email}</p>
      </section>
      <section className="form-section"><h2><span>02</span>订阅方案</h2>
        <div className="selected-product"><SmallProductIcon product={product} /><div><strong>{product.name}</strong><p>个人订阅 · {product.periodMonths} 个月 · 1 份</p></div><Link className="text-button" to={`/products/${product.id}`}>更换 <Icon name="arrow-left-right" /></Link></div>
        <dl className="spec-list"><div><dt>账号与地区条件</dt><dd>{product.details.accountRequirements || '待确认'}</dd></div><div><dt>交付方式</dt><dd>{product.details.deliveryMethod || '待确认'}</dd></div><div><dt>售后范围</dt><dd>{product.details.afterSales || '正式开放前确认'}</dd></div></dl>
      </section>
      <section className="form-section"><h2><span>03</span>支付方式</h2><div className="payment-option" aria-disabled="true"><Icon name="credit-card" /><strong>支付宝</strong><span className="status-badge pending">尚未开放</span></div><p className="field-hint">暂不提供付款链接或收款二维码。</p></section>
      <div className="terms-checkbox"><input ref={termsInput} id="accept-terms" name="terms" type="checkbox" aria-describedby="terms-error" checked={accepted}
        onChange={(event) => { setAccepted(event.target.checked); setErrors((value) => ({ ...value, terms: '' })); }} />
        <label htmlFor="accept-terms">我已阅读<Link to="/terms" target="_blank" rel="noopener">服务须知</Link>与<Link to="/privacy" target="_blank" rel="noopener">隐私说明</Link>，理解当前尚未开放交易。</label>
      </div><p id="terms-error" className="field-error" role="alert">{errors.terms}</p>
      <button className="button primary" type="submit"><Icon name="bookmark" />保存本机套餐清单</button>
    </form>
    <aside className="purchase-panel order-summary"><h2>你的选择</h2><div className="summary-product"><SmallProductIcon product={product} /><div><strong>{product.name}</strong><p>月度订阅 · 1 份</p></div></div>
      <dl className="purchase-specs"><div><dt>套餐单价</dt><dd>¥{money(product.priceCents)}</dd></div><div><dt>数量</dt><dd>1</dd></div></dl>
      <div className="summary-total"><span>合计</span><strong>¥{money(product.priceCents)}</strong></div>
      <button className="button full-width" type="button" disabled><Icon name="lock-keyhole" />支付尚未开放</button><p className="panel-footnote">以上为本站售价，当前不会发起扣款。</p>
    </aside></div>
  </div>;
}
