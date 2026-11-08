import { Link } from 'react-router-dom';
import { useCustomer } from '../app/CustomerProvider';
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

export function productCover(product: Product, detail = false) {
  const covers: Record<string, string> = {
    'chatgpt-plus': 'chatgpt-plus.svg', 'chatgpt-pro-5x': 'chatgpt-pro-5x.svg',
    'chatgpt-pro-20x': 'chatgpt-pro-20x.svg', 'chatgpt-pro-50x-ph': 'chatgpt-pro-50x.svg',
  };
  const file = covers[product.id] || 'subscription.svg';
  return `/products/${detail ? file.replace('.svg', '-detail.svg') : file}`;
}

export function productCardCover(product: Product) {
  return productCover(product).replace('.svg', '-card.svg');
}

// Merchant-provided tier labels; these do not affect CNY prices or payment amounts.
export function productUsdTier(product: Product) {
  const tiers: Record<string, number> = {
    'chatgpt-plus': 20, 'chatgpt-pro-5x': 100,
    'chatgpt-pro-20x': 200, 'chatgpt-pro-50x-ph': 500,
  };
  return tiers[product.id] ? `$${tiers[product.id]}/月档位` : null;
}

function useDisplayedPrice(product: Product) {
  const { user } = useCustomer();
  const staffPrice = user?.staffCheckout === true && product.selectable && product.priceCents !== null;
  return { staffPrice, priceCents: staffPrice ? 0 : product.priceCents };
}

export function ProductBuyPrice({ product }: { product: Product }) {
  const { staffPrice, priceCents } = useDisplayedPrice(product);
  return <div className="product-buy-price">
    <span>{staffPrice ? '免付开通' : '价格'}</span>
    <strong>{priceCents === null ? '待确认' : <><small>¥</small>{money(priceCents)}</>}</strong>
    <span>/ {product.periodMonths} 个月</span>
  </div>;
}

export function ProductCard({ product }: { product: Product }) {
  const { staffPrice, priceCents } = useDisplayedPrice(product);
  const [amount, fraction] = priceCents === null ? [] : new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(priceCents / 100).split('.');
  const cover = productCardCover(product);
  return <article className="product-card storefront-card">
    <Link className="storefront-cover" to={`/products/${product.id}`} tabIndex={-1} aria-hidden="true"><img src={cover} width="800" height="330" alt="" loading="lazy" decoding="async" /></Link>
    <div className="product-body">
      <h3><Link to={`/products/${product.id}`}>{product.name}</Link></h3>
      <p className="storefront-card-description">{product.features[0] || '订阅服务'} · {productUsdTier(product) || `${product.periodMonths} 个月`}</p>
      <div className="storefront-card-footer">
        <div className="card-price">
          {priceCents === null ? <span className="storefront-pending-price">价格待确认</span> : <span className="price"><span className="currency">¥</span>{amount}<small>.{fraction}</small></span>}
          {staffPrice && <div><span className="price-caption">免付开通</span></div>}
        </div>
        <Link className="button storefront-buy" to={`/products/${product.id}`} aria-label="立即购买"><span className="storefront-buy-label">立即购买</span><span className="storefront-buy-short" aria-hidden="true">购买</span><span className="storefront-buy-arrow"><Icon name="arrow-right" /></span></Link>
      </div>
    </div>
  </article>;
}
