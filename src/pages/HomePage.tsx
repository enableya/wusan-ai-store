import { useState } from 'react';
import { Icon } from '../components/Icon';
import { ProductCard } from '../components/Product';
import { usePageTitle } from '../hooks/usePageTitle';
import { useApiResource } from '../hooks/useApiResource';
import { ApiState } from '../components/ApiState';
import type { HomeData } from '../types/catalog';
import './storefront.css';

export default function HomePage() {
  usePageTitle('全部商品');
  const [category, setCategory] = useState('全部');
  const [query, setQuery] = useState('');
  const resource = useApiResource<HomeData>('/home');
  if (!resource.data) return <ApiState error={resource.error} retry={resource.reload} title="正在加载订阅套餐" />;
  const { products, hero } = resource.data;
  const search = query.trim().toLocaleLowerCase();
  const selected = products.filter(product => (category === '全部' || product.category === category)
    && `${product.name} ${product.category} ${product.audience}`.toLocaleLowerCase().includes(search));
  const reset = () => { setCategory('全部'); setQuery(''); };
  return <div className="storefront"><div className="container storefront-container">
    <section className="storefront-hero" aria-labelledby="storefront-title">
      <div className="storefront-hero-copy">
      <div className="storefront-eyebrow"><span />伍叁 AI · 订阅服务</div>
      <h1 id="storefront-title">{hero.title}</h1>
      <p>找到适合自己的 AI 订阅，让选择更简单。</p>
      <a className="button primary" href="#catalog" onClick={reset}>浏览全部商品<Icon name="arrow-right" /></a>
      </div>
      <img className="storefront-hero-logo" src="/brand/chatgpt.svg" alt="ChatGPT" width="180" height="180" />
    </section>
    <div className="storefront-layout" id="catalog">
      <aside className="storefront-sidebar" aria-label="商品分类"><h2>分类</h2><nav aria-label="套餐分类">
        {['全部', 'Plus', 'Pro'].map(value => <button key={value} type="button" data-category={value} aria-pressed={category === value} className={category === value ? 'selected' : ''} onClick={() => setCategory(value)}>
          <Icon name={value === '全部' ? 'package' : value === 'Plus' ? 'sparkles' : 'layers'} />
          <span>{value === '全部' ? '全部商品' : `ChatGPT ${value}`}</span>
          <small>{products.filter(product => value === '全部' || product.category === value).length}</small>
        </button>)}
      </nav></aside>
      <section className="storefront-catalog" aria-labelledby="catalog-heading">
        <div className="storefront-search"><Icon name="search" /><label htmlFor="product-search" className="sr-only">搜索商品</label>
          <input id="product-search" type="search" placeholder="搜索商品名称或关键词…" value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" maxLength={100} />
          {query && <button type="button" aria-label="清空搜索" onClick={() => setQuery('')}><Icon name="x" /></button>}
        </div>
        <div className="storefront-list-heading"><h2 id="catalog-heading">{category === '全部' ? '全部商品' : `ChatGPT ${category}`}</h2><span aria-live="polite">{selected.length} 件商品</span></div>
        <div className="product-grid storefront-grid">{selected.map(product => <ProductCard key={product.id} product={product} />)}</div>
        {!selected.length && <div className="storefront-empty"><Icon name="search-x" /><h3>{products.length ? '没有找到相关商品' : '暂无可选套餐'}</h3><p>{products.length ? '试试其他关键词，或查看全部商品。' : '商品上架后将在这里展示。'}</p>{products.length > 0 && <button className="button secondary" type="button" onClick={reset}>清空筛选</button>}</div>}
      </section>
    </div>
  </div></div>;
}
