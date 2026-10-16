import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FaqList } from '../components/FaqList';
import { Icon } from '../components/Icon';
import { usePageTitle } from '../hooks/usePageTitle';
import { useApiResource } from '../hooks/useApiResource';
import { ApiState } from '../components/ApiState';
import type { Article, Faq } from '../types/catalog';

export default function HelpPage() {
  usePageTitle('帮助中心');
  const [category, setCategory] = useState('全部');
  const [query, setQuery] = useState('');
  const resource = useApiResource<{ articles: Article[]; faqs: Faq[] }>('/content');
  if (!resource.data) return <ApiState error={resource.error} retry={resource.reload} title="正在加载帮助中心" />;
  const { articles, faqs } = resource.data;
  const normalized = query.trim().toLowerCase();
  const results = articles.filter((article) =>
    (category === '全部' || article.category === category) &&
    (!normalized || (article.title + article.summary + article.sections.map((section) => section.text).join('')).toLowerCase().includes(normalized)),
  );
  return <div className="container page-space">
    <div className="help-intro"><span className="eyebrow">HERE TO HELP</span><h1>帮助中心</h1><p>从第一次订阅，到每一个小问题。</p>
      <div className="search-field large-search"><Icon name="search" /><input id="help-search" type="search" placeholder="搜索购买、订单、账号安全…" aria-label="搜索帮助文章" maxLength={100} value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    </div>
    <div className="help-toolbar segmented-control" role="group" aria-label="帮助分类">
      {['全部', '购买指南', '订单查询', '账号安全', '售后服务'].map((value) => <button key={value} type="button" data-help-category={value} aria-pressed={category === value}
        className={category === value ? 'selected' : ''} onClick={() => setCategory(value)}>{value}</button>)}
    </div>
    <div id="help-results" aria-live="polite">{results.length ? <div className="article-grid">
      {results.map((article) => <Link className="article-card" key={article.id} to={`/help/${article.id}`}>
        <span className="article-icon"><Icon name={article.icon} /></span><span className="eyebrow">{article.category}</span>
        <h2>{article.title}</h2><p>{article.summary}</p><span className="article-card-link">阅读指南 <Icon name="arrow-up-right" /></span>
      </Link>)}
    </div> : <div className="empty-state compact"><div className="empty-icon"><Icon name="search-x" /></div><h2>没有找到相关内容</h2><p>换一个关键词，或查看全部分类。</p>
      <button className="button secondary" type="button" onClick={() => { setCategory('全部'); setQuery(''); }}>查看全部文章</button>
    </div>}</div>
    <div className="help-faq"><div className="section-heading"><h2>常见问题</h2><Link className="text-button" to="/support">仍有疑问？联系支持 <Icon name="arrow-right" /></Link></div><FaqList faqs={faqs} /></div>
  </div>;
}
