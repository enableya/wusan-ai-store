import { Link } from 'react-router-dom';
import type { Product } from '../types/catalog';
import { money } from '../lib/format';
import { Icon } from './Icon';

export function ProductArt({ product, large = false }: { product: Product; large?: boolean }) {
  return <div className={`product-art ${product.color} ${large ? 'large' : ''}`} aria-hidden="true">
    <div className="art-label"><Icon name={product.icon} /><strong>{product.label}</strong><span>CHATGPT {product.category.toUpperCase()}</span></div>
    <div className="art-symbol"><span>{product.mark}</span></div>
  </div>;
}

export function StatusBadge({ product }: { product: Product }) {
  return <span className={`status-badge ${product.selectable ? 'selectable' : 'pending'}`}>
    <span className="status-dot" />{product.selectable ? '可选套餐' : '暂未开放'}
  </span>;
}

export function Price({ product }: { product: Product }) {
  if (product.priceCents === null) return <>
    <div className="price pending-price">价格待确认</div><span className="price-caption">确认价格后开放选择</span>
  </>;
  return <><div className="price"><span className="currency">¥</span>{money(product.priceCents)}
    <span className="period">/ 月</span></div><span className="price-caption">本站售价 · 人民币</span></>;
}

export function SmallProductIcon({ product }: { product?: Product }) {
  return <div className={`small-product-icon ${product?.color || 'gray'}`}><Icon name={product?.icon || 'package'} /></div>;
}

export function ProductCard({ product }: { product: Product }) {
  const covers: Record<string, string> = {
    'chatgpt-plus': 'chatgpt-plus.svg', 'chatgpt-pro-5x': 'chatgpt-pro-5x.svg',
    'chatgpt-pro-20x': 'chatgpt-pro-20x.svg', 'chatgpt-pro-50x-ph': 'chatgpt-pro-50x.svg',
  };
  return <article className="product-card storefront-card">
    <Link className="storefront-cover" to={`/products/${product.id}`} tabIndex={-1} aria-hidden="true"><img src={`/products/${covers[product.id] || 'subscription.svg'}`} width="800" height="540" alt="" /></Link>
    <div className="product-body">
      <h3><Link to={`/products/${product.id}`}>{product.name}</Link></h3>
      <div className="card-price">{product.priceCents === null ? <span className="storefront-pending-price">价格待确认</span> : <span className="price"><span className="currency">¥</span>{money(product.priceCents)}<small> / {product.periodMonths === 1 ? '月' : `${product.periodMonths} 个月`}</small></span>}</div>
      <Link className="button secondary full-width" to={`/products/${product.id}`}>查看详情</Link>
    </div>
  </article>;
}
