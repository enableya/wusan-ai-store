import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';
import type { IconName } from './Icon';

export function Breadcrumb({ items }: { items: { label: string; to?: string }[] }) {
  return <nav className="breadcrumb" aria-label="面包屑"><Link to="/">首页</Link>
    {items.map((item, index) => <span className="breadcrumb-item" key={index}><Icon name="chevron-right" />
      {item.to ? <Link to={item.to}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}
    </span>)}
  </nav>;
}

export function PageHeading({ title, eyebrow, description, action }: {
  title: string; eyebrow: string; description: string; action?: ReactNode;
}) {
  return <div className={`page-heading ${action ? 'heading-with-action' : ''}`}>
    <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}
  </div>;
}

export function Notice({ children, subtle = false }: { children: ReactNode; subtle?: boolean }) {
  return <div className={`notice ${subtle ? 'subtle' : ''}`}><Icon name="info" /><span>{children}</span></div>;
}

export function EmptyPage({ title, description, button, to, icon = 'file-question' }: {
  title: string; description: string; button: string; to: string; icon?: IconName;
}) {
  return <div className="container page-space error-page"><div className="empty-state">
    <div className="empty-icon"><Icon name={icon} /></div><h1>{title}</h1><p>{description}</p>
    <Link className="button primary" to={to}>{button}<Icon name="arrow-right" /></Link>
  </div></div>;
}
