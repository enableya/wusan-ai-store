import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Breadcrumb, EmptyPage, Notice } from '../components/Page';
import { Icon } from '../components/Icon';
import { Price, ProductArt, StatusBadge } from '../components/Product';
import { usePageTitle } from '../hooks/usePageTitle';
import { useApiResource } from '../hooks/useApiResource';
import { ApiState } from '../components/ApiState';
import type { Article, Product } from '../types/catalog';
import type { PaymentConfig } from '../types/orders';
import { trackProductClick } from '../services/analytics';

const tabs = [
  { id: 'overview', label: '套餐介绍' },
  { id: 'guide', label: '购买指南' },
  { id: 'notes', label: '服务须知' },
] as const;
type TabId = (typeof tabs)[number]['id'];

function ProductPanel({ product, tab }: { product: Product; tab: TabId }) {
  const guide = useApiResource<{ articles: Article[] }>(tab === 'guide' ? '/content' : null);
  if (tab === 'guide') return <>
    <h2>订阅流程</h2>{!guide.data ? <ApiState compact error={guide.error} retry={guide.reload} title="正在加载购买指南" /> :
      <ol className="article-steps">{guide.data.articles.find((article) => article.id === 'getting-started')?.sections.map((section) => <li key={section.title}><h3>{section.title}</h3><p>{section.text}</p></li>)}</ol>}
    <Link className="text-button" to="/help/getting-started">打开完整购买指南 <Icon name="arrow-right" /></Link>
  </>;
  if (tab === 'notes') return <>
    <h2>购买前，请先确认</h2><Notice>支付通过支付宝完成，支付结果与订阅交付分别处理。付款前请确认服务条件及实际收款方。</Notice>
    <ul className="article-list"><li>展示金额为本站实际售价，套餐名称不表示官方定价或授权认可。</li><li>账号、地区及购买资格以上线前最终确认为准。</li><li>交付方式、预计时限、售后期与退款规则尚待确认。</li><li>不要求提供账号密码、完整 Session 或多因素验证码。</li></ul>
    <Link className="text-button" to="/terms">阅读服务须知 <Icon name="arrow-right" /></Link>
  </>;
  return <>
    <h2>关于这个套餐</h2><p className="body-copy">{product.description} 这是一项面向{product.audience}的月度订阅方案。{product.details.entitlements || '具体权益、使用限额与可用服务以正式供应方案确认为准。'}</p>
    <div className="detail-feature-grid">
      <div><Icon name="user-round" /><h3>个人账号订阅</h3><p>服务对象与账号条件在购买前确认。</p></div>
      <div><Icon name="calendar-days" /><h3>按月选择</h3><p>月度周期，不设置自动续费扣款。</p></div>
      <div><Icon name="shield-check" /><h3>重视账号安全</h3><p>不收集密码或完整登录凭据。</p></div>
      <div><Icon name="clipboard-list" /><h3>服务条件透明</h3><p>交付与售后条件待正式上线确认。</p></div>
    </div>
    <h2 className="subsection-title">订阅信息</h2><dl className="spec-list">
      <div><dt>方案类型</dt><dd>{product.name}</dd></div><div><dt>订阅周期</dt><dd>{product.periodMonths} 个月</dd></div>
      <div><dt>交付方式</dt><dd>{product.details.deliveryMethod || '待确认'}</dd></div><div><dt>预计交付时间</dt><dd>{product.details.deliveryTime || '待确认'}</dd></div><div><dt>账号及地区条件</dt><dd>{product.details.accountRequirements || '正式开放前确认'}</dd></div>
      <div><dt>售后说明</dt><dd>{product.details.afterSales || '待确认'}</dd></div>
    </dl>
  </>;
}

export default function ProductPage() {
  const { productId } = useParams();
  const resource = useApiResource<Product>(productId ? `/products/${encodeURIComponent(productId)}` : null);
  const product = resource.data;
  const payment = useApiResource<PaymentConfig>('/payments/config');
  const [tab, setTab] = useState<TabId>('overview');
  usePageTitle(product?.name || '套餐不存在');
  useEffect(() => { setTab('overview'); }, [productId]);
  useEffect(() => { if (product && product.id === productId) void trackProductClick(product.id); }, [product?.id, productId]);
  if (resource.error?.status === 404) return <EmptyPage title="套餐不存在或已下架" description="这个链接没有对应的订阅套餐，可以回到目录继续浏览。" button="查看全部套餐" to="/" icon="package-x" />;
  if (!product) return <ApiState error={resource.error} retry={resource.reload} title="正在加载套餐详情" />;
  return <div className="container page-space">
    <Breadcrumb items={[{ label: '订阅套餐', to: '/' }, { label: product.name }]} />
    <div className="detail-layout"><div className="detail-main">
      <ProductArt product={product} large />
      <div className="detail-title"><div className="eyebrow">{product.category.toUpperCase()} SUBSCRIPTION</div><h1>{product.name}</h1><p>{product.description}</p></div>
      <div className="underlined-tabs" role="tablist" aria-label="套餐详情">{tabs.map((item, index) =>
        <button key={item.id} type="button" id={`tab-${item.id}`} role="tab" aria-selected={tab === item.id}
          aria-controls="product-panel" tabIndex={tab === item.id ? 0 : -1} className={tab === item.id ? 'active' : ''}
          onClick={() => setTab(item.id)} onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
            setTab(tabs[next].id);
            document.getElementById(`tab-${tabs[next].id}`)?.focus();
          }}>{item.label}</button>,
      )}</div>
      <div id="product-panel" className="product-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}><ProductPanel product={product} tab={tab} /></div>
    </div>
    <aside className="purchase-panel" aria-label="套餐选择"><div className="panel-top"><h2>订阅方案</h2><StatusBadge product={product} /></div>
      <div className="purchase-price"><Price product={product} /></div><span className="field-label">订阅周期</span>
      <div className="period-choice"><Icon name="calendar-days" /><span>{product.periodMonths} 个月<small>月度订阅</small></span><Icon name="circle-check" /></div>
      <dl className="purchase-specs"><div><dt>数量</dt><dd>1 份</dd></div><div><dt>服务对象</dt><dd>个人账号</dd></div><div><dt>支付方式</dt><dd>{payment.data?.enabled ? payment.data.environment === 'sandbox' ? '支付宝 · 沙箱测试' : '支付宝' : payment.error ? '暂时无法获取' : payment.loading ? '正在确认…' : '支付宝待配置'}</dd></div></dl>
      {product.selectable ? <Link className="button primary full-width" to={`/checkout/${product.id}`}>核对订阅信息 <Icon name="arrow-right" /></Link> : <button className="button full-width" type="button" disabled>暂未开放选择</button>}
      <p className="panel-footnote"><Icon name="lock-keyhole" />{payment.data?.enabled ? '服务器核对金额，支付宝确认付款' : '支付配置完成后开放下单，可先保存套餐清单'}</p>
      <div className="panel-support">对这个方案有疑问？<Link to="/support">联系支持 <Icon name="arrow-up-right" /></Link></div>
    </aside></div>
  </div>;
}
