import { Link, useParams } from 'react-router-dom';
import { Breadcrumb, EmptyPage } from '../components/Page';
import { Icon } from '../components/Icon';
import { usePageTitle } from '../hooks/usePageTitle';
import { useApiResource } from '../hooks/useApiResource';
import { ApiState } from '../components/ApiState';
import type { Article } from '../types/catalog';

export default function HelpArticlePage() {
  const { articleId } = useParams();
  const resource = useApiResource<{ articles: Article[] }>('/content');
  const articles = resource.data?.articles ?? [];
  const article = articles.find((item) => item.id === articleId);
  usePageTitle(article?.title || '文章不存在');
  if (!resource.data) return <ApiState error={resource.error} retry={resource.reload} title="正在加载帮助文章" />;
  if (!article) return <EmptyPage title="没有找到这篇指南" description="文章链接可能已更新，可以回到帮助中心查找。" button="返回帮助中心" to="/help" />;
  const index = articles.indexOf(article);
  const previous = articles[index - 1];
  const next = articles[index + 1];
  return <div className="container page-space">
    <Breadcrumb items={[{ label: '帮助中心', to: '/help' }, { label: article.category }]} />
    <div className="article-layout"><aside className="article-sidebar"><h2>帮助中心</h2>
      {articles.map((item) => <Link key={item.id} to={`/help/${item.id}`} className={item.id === article.id ? 'active' : ''} aria-current={item.id === article.id ? 'page' : undefined}>
        <Icon name={item.icon} />{item.category}<Icon name="chevron-right" />
      </Link>)}<Link className="sidebar-support" to="/support"><Icon name="headphones" />联系支持</Link>
    </aside>
    <article className="article-content"><span className="eyebrow">{article.category}</span><h1>{article.title}</h1><p className="article-summary">{article.summary}</p>
      <div className="article-meta">更新于 2026 年 10 月 16 日<span>适用于当前站点</span></div>
      {article.sections.map((section, sectionIndex) => <section key={section.title}><span className="article-section-number">{String(sectionIndex + 1).padStart(2, '0')}</span><div><h2>{section.title}</h2><p>{section.text}</p></div></section>)}
      <div className="article-pagination">{previous ? <Link to={`/help/${previous.id}`}><Icon name="arrow-left" /><span><small>上一篇</small>{previous.title}</span></Link> : <span />}
        {next && <Link to={`/help/${next.id}`}><span><small>下一篇</small>{next.title}</span><Icon name="arrow-right" /></Link>}
      </div>
    </article></div>
  </div>;
}
