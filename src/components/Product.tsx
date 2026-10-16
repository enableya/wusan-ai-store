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
  return <article className={`product-card ${product.id === 'chatgpt-plus' ? 'featured' : ''}`}>
    <ProductArt product={product} /><div className="product-body">
      <div className="product-title-line"><span className="category-caption">{product.category} 订阅</span><StatusBadge product={product} /></div>
      <h3><Link to={`/products/${product.id}`}>{product.name}</Link></h3>
      <p className="product-description">{product.audience}</p>
      <div className="card-price"><Price product={product} /></div>
      <ul className="feature-list">{product.features.map((feature) => <li key={feature}><Icon name="check" />{feature}</li>)}</ul>
      <Link className={`button ${product.id === 'chatgpt-plus' ? 'primary' : 'secondary'} full-width`} to={`/products/${product.id}`}>
        查看套餐 <Icon name="arrow-right" />
      </Link>
    </div>
  </article>;
}
