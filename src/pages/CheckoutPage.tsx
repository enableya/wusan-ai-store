import { useParams } from 'react-router-dom';
import { Breadcrumb, EmptyPage } from '../components/Page';
import { productCover, productCardCover } from '../components/Product';
import { PurchaseForm } from '../components/PurchaseForm';
import { usePageTitle } from '../hooks/usePageTitle';
import { useApiResource } from '../hooks/useApiResource';
import { ApiState } from '../components/ApiState';
import type { Product } from '../types/catalog';
import { money } from '../lib/format';
import './product-detail.css';

export default function CheckoutPage() {
  usePageTitle('确认购买');
  const { productId } = useParams();
  const resource = useApiResource<Product>(productId ? `/products/${encodeURIComponent(productId)}` : null);
  const product = resource.data;
  if (resource.error?.status === 404) return <EmptyPage title="无法选择这个套餐" description="套餐不存在或已下架，请重新选择。" button="查看全部套餐" to="/" icon="package-x" />;
  if (!product) return <ApiState error={resource.error} retry={resource.reload} title="正在核对套餐信息" />;
  if (!product.selectable || product.priceCents === null) return <EmptyPage title="套餐暂未开放" description="该套餐暂不能下单。" button="返回套餐详情" to={`/products/${product.id}`} icon="package-x" />;
  return <div className="product-detail-page"><div className="container product-detail-container page-space"><Breadcrumb items={[{ label: product.name, to: `/products/${product.id}` }, { label: '确认购买' }]} />
    <section className="product-buy-layout"><div className="product-gallery"><picture><source media="(max-width: 760px)" srcSet={productCardCover(product)} /><img src={productCover(product, true)} alt={`${product.name} 商品图片`} width="800" height="760" /></picture></div><div className="product-buy-info"><div className="eyebrow">确认购买</div><h1>{product.name}</h1><p className="product-buy-description">{product.description}</p><div className="product-buy-price"><span>价格</span><strong><small>¥</small>{money(product.priceCents)}</strong><span>/ {product.periodMonths} 个月</span></div><PurchaseForm key={product.id} product={product} /></div></section>
  </div></div>;
}
