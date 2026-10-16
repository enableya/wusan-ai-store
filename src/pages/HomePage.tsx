import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useUI } from '../app/UIProvider';
import { FaqList } from '../components/FaqList';
import { Icon } from '../components/Icon';
import { IdeaBackdrop } from '../components/IdeaBackdrop';
import { ProductCard } from '../components/Product';
import { usePageTitle } from '../hooks/usePageTitle';
import { useApiResource } from '../hooks/useApiResource';
import { ApiState } from '../components/ApiState';
import type { HomeData } from '../types/catalog';

export default function HomePage() {
  usePageTitle('订阅套餐');
  const [category, setCategory] = useState('全部');
  const { openModal } = useUI();
  const resource = useApiResource<HomeData>('/home');
  if (!resource.data) return <ApiState error={resource.error} retry={resource.reload} title="正在加载订阅套餐" />;
  const { products, faqs, hero, services, steps } = resource.data;
  const selected = products.filter((product) => category === '全部' || product.category === category);
  return <>
    <section className="catalog-intro"><IdeaBackdrop /><div className="container intro-inner">
      <div className="intro-copy"><div className="eyebrow"><Icon name="sparkles" />伍叁 AI · 个人订阅服务</div>
        <h1>{hero.title}</h1>
        <p className="intro-lead">{hero.lead}<span>{hero.leadAccent}</span></p>
        <p className="intro-description">{hero.description.map((line, index) => <span key={index}>{index > 0 && <br />}{line}</span>)}</p>
        <div className="intro-actions">
          <Link className="button primary" to="/help/getting-started">了解订阅流程 <Icon name="arrow-right" /></Link>
          <button className="text-button" type="button" onClick={() => openModal({ type: 'compare' })}>比较套餐 <Icon name="arrow-up-right" /></button>
        </div>
        <div className="intro-meta"><span><Icon name="user-round" />个人账号</span><span><Icon name="calendar-days" />按月选择</span><span><Icon name="shield-check" />不收集账号密码</span></div>
      </div>
    </div></section>
    <section className="container catalog-section">
      <div className="section-heading"><div><h2>选择你的套餐</h2><p>比较使用场景、订阅周期与服务条件。</p></div>
        <button className="text-button" type="button" onClick={() => openModal({ type: 'compare' })}><Icon name="columns-3" />套餐对比 <Icon name="arrow-up-right" /></button>
      </div>
      <div className="catalog-toolbar"><div className="segmented-control" role="group" aria-label="套餐分类">
        {['全部', 'Plus', 'Pro'].map((value) => <button key={value} type="button" data-category={value}
          className={category === value ? 'selected' : ''} aria-pressed={category === value} onClick={() => setCategory(value)}>
          {value === '全部' ? '全部套餐' : value}<span>{products.filter((product) => value === '全部' || product.category === value).length}</span>
        </button>)}
      </div><span className="result-count" aria-live="polite">{selected.length} 款套餐<span className="catalog-cycle"><Icon name="calendar-days" />按月订阅</span></span></div>
      <div className="product-grid">{selected.map((product) => <ProductCard key={product.id} product={product} />)}</div>
      {!selected.length && <div className="empty-state compact"><h3>暂无可选套餐</h3><p>请稍后再来查看。</p></div>}
      <div className="catalog-note"><Icon name="info" />以上为本站实际售价，按月计价，单位为人民币；在线下单与支付尚未开放。</div>
    </section>
    <section className="service-band"><div className="container service-grid">
      {services.map((service) => <div key={service.title}><Icon name={service.icon} /><span><strong>{service.title}</strong><small>{service.description}</small></span></div>)}
    </div></section>
    <section className="container guide-section">
      <div className="section-heading"><div><span className="eyebrow">HOW IT WORKS</span><h2>订阅，不必复杂</h2></div><Link className="text-button" to="/help/getting-started">查看完整指南 <Icon name="arrow-right" /></Link></div>
      <div className="steps-grid">
        {steps.map((step, index) => <div className="step" key={step.title}><span className="step-number">{String(index + 1).padStart(2, '0')}</span>
          <div><h3>{step.title}</h3><p>{step.description}</p></div>{index < steps.length - 1 && <Icon name="arrow-right" className="step-arrow" />}</div>)}
      </div>
    </section>
    <section className="container faq-section"><div className="faq-heading"><span className="eyebrow">GOOD TO KNOW</span><h2>你可能想了解</h2><p>先把问题说清楚，<br />再放心做选择。</p><Link className="text-button" to="/help">更多帮助 <Icon name="arrow-up-right" /></Link></div><FaqList faqs={faqs} /></section>
  </>;
}
