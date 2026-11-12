import { useCustomer } from '../app/CustomerProvider';
import { useEffect } from 'react';
import { useLocation, useNavigationType, useParams } from 'react-router-dom';
import { Breadcrumb, EmptyPage } from '../components/Page';
import { ProductBuyPrice, productCover, productCardCover, productUsdTier } from '../components/Product';
import { ProductPurchase } from '../components/ProductPurchase';
import { CardProductDetails } from '../components/CardProductDetails';
import { Icon } from '../components/Icon';
import { usePageTitle } from '../hooks/usePageTitle';
import { useApiResource } from '../hooks/useApiResource';
import { ApiState } from '../components/ApiState';
import type { Product } from '../types/catalog';
import { trackProductClick } from '../services/analytics';
import './product-detail.css';

export default function ProductPage() {
  const { share } = useCustomer();
  const { productId } = useParams();
  const { key: locationKey } = useLocation();
  const navigationType = useNavigationType();
  const resource = useApiResource<Product>(productId ? `/products/${encodeURIComponent(productId)}` : null);
  const product = resource.data;
  usePageTitle(product?.name || '套餐不存在');
  useEffect(() => {
    if (!product || product.id !== productId) return;
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (navigationType === 'POP' && (entry?.type === 'reload' || entry?.type === 'back_forward')) return;
    void trackProductClick(product.id, locationKey);
  }, [product?.id, productId, locationKey, navigationType]);
  if (resource.error?.status === 404) return <EmptyPage title="套餐不存在或已下架" description="这个链接没有对应的订阅套餐，可以回到目录继续浏览。" button="查看全部套餐" to="/" icon="package-x" />;
  if (!product) return <ApiState error={resource.error} retry={resource.reload} title="正在加载套餐详情" />;
  return <div className="product-detail-page"><div className="container product-detail-container page-space">
    <Breadcrumb items={[{ label: '全部商品', to: '/' }, { label: product.name }]} />
    <section className="product-buy-layout" aria-label="商品购买">
      <div className="product-gallery"><picture><source media="(max-width: 760px)" srcSet={productCardCover(product)} /><img src={productCover(product, true)} alt={`${product.name} 商品图片`} width="800" height="760" /></picture><div className="product-gallery-caption"><span>伍叁 AI</span><span>{product.category} · {product.deliveryType==='voucher'?'卡密交付':'订阅服务'}</span></div></div>
      <div className="product-buy-info">
        <div className="product-buy-heading">
          <div>
            <div className="eyebrow">{product.category === 'Codex' ? 'CODEX' : `CHATGPT ${product.category.toUpperCase()}`}{productUsdTier(product) && ` · ${productUsdTier(product)}`}</div>
            <h1>{product.name}</h1>
          </div>
          <button type="button" className="text-button product-share" onClick={share}>
            <Icon name="send" /><span>分享给好友</span>
          </button>
        </div>
        <p className="product-buy-description">{product.description}</p>
        <ProductBuyPrice product={product} />
        <ProductPurchase key={product.id} product={product} />
      </div>
    </section>
    <section className="product-description-panel" aria-labelledby="item-details-heading"><div className="item-details-heading"><span /><h2 id="item-details-heading">宝贝详情</h2><span /></div>
      {product.deliveryType==='voucher'?<CardProductDetails product={product}/>:<div className="item-details-content"><div className="item-details-intro"><span className="eyebrow">伍叁 AI · 订阅服务</span><h3>{product.name} · {product.periodMonths} 个月</h3><p>{product.details.entitlements || `${product.description} 适合${product.audience}，具体权益和使用限额请在购买前确认。`}</p><div className="item-detail-tags"><span>月度订阅</span><span>支付宝支付</span><span>订单查询</span></div></div>
        <section className="item-detail-section"><h3><span className="item-section-number">01</span>商品信息</h3><dl className="item-specifications"><div><dt>商品名称</dt><dd>{product.name}</dd></div><div><dt>订阅周期</dt><dd>{product.periodMonths} 个月</dd></div><div><dt>适用需求</dt><dd>{product.audience}</dd></div><div><dt>续费方式</dt><dd>按需购买，不自动扣费</dd></div></dl></section>
        <section className="item-detail-section"><h3><span className="item-section-number">02</span>购买流程</h3><ol className="item-purchase-steps"><li><span>01</span><div><h4>确认购买信息</h4><p>输入验证码，点击立即购买，在弹窗中确认购买信息。</p></div></li><li><span>02</span><div><h4>支付宝付款</h4><p>核对订单金额后，使用支付宝扫码付款。</p></div></li><li><span>03</span><div><h4>查看订单结果</h4><p>前往我的订单查看付款结果或找回订单。</p></div></li></ol></section>
        <section className="item-detail-section item-warranty-section" aria-labelledby="warranty-heading"><h3 id="warranty-heading"><span className="item-section-number"><Icon name="check" /></span>30 天质保与售后范围</h3><dl className="item-specifications">
          <div><dt>质保起算</dt><dd>以兑换成功时间为准，提供 30 天订阅状态保障。</dd></div>
          <div><dt>正常保障</dt><dd>服务侧异常、支付未完成或套餐未到账，经核验后按实际情况处理。</dd></div>
          <div><dt>处理方式</dt><dd>根据核验结果采取继续处理、补充处理、换码或退款等可执行方案。</dd></div>
          <div><dt>不保情形</dt><dd>账号历史异常、违规使用、共享转售、反代、破限、逆向或频繁切换地区。</dd></div>
          <div><dt>账号侧问题</dt><dd>封号、KYC、手机号、邮箱、密码、用户主动取消订阅或修改账号不属于服务故障。</dd></div>
        </dl></section>
      </div>}
    </section>
  </div></div>;
}
