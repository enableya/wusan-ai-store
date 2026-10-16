import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { Icon } from '../components/Icon';
import { ThemeMenu } from '../components/ThemeMenu';
import { site } from '../config/site';

export default function SiteLayout() {
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    setMobileOpen(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
    main.current?.focus({ preventScroll: true });
  }, [pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileOpen(false);
        document.getElementById('mobile-menu-toggle')?.focus();
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [mobileOpen]);
  const catalogActive = pathname === '/' || pathname.startsWith('/products/') || pathname.startsWith('/checkout/');
  const items = [
    { to: '/', label: '订阅套餐', active: catalogActive },
    { to: '/orders', label: '我的订单', active: pathname.startsWith('/orders') },
    { to: '/help', label: '帮助中心', active: pathname.startsWith('/help') },
  ];
  return <>
    <a className="skip-link" href="#main" onClick={(event) => { event.preventDefault(); main.current?.focus(); main.current?.scrollIntoView(); }}>跳转到主要内容</a>
    <header className="site-header"><div className="container header-inner">
      <Brand /><nav className="desktop-nav" aria-label="主导航">
        {items.map((item) => <Link key={item.to} to={item.to} className={item.active ? 'active' : ''} aria-current={item.active ? 'page' : undefined}>{item.label}</Link>)}
      </nav>
      <div className="header-actions"><ThemeMenu /><span className="header-divider" />
        <Link className="support-link" to="/support"><Icon name="headphones" /><span>联系支持</span></Link>
        <button id="mobile-menu-toggle" className="icon-button mobile-menu-button" type="button" title={mobileOpen ? '关闭导航' : '打开导航'} aria-label={mobileOpen ? '关闭导航' : '打开导航'} aria-expanded={mobileOpen}
          aria-controls="mobile-nav" onClick={() => setMobileOpen(!mobileOpen)}><Icon name={mobileOpen ? 'x' : 'menu'} /></button>
      </div>
    </div><nav id="mobile-nav" className="mobile-nav" aria-label="移动端主导航" hidden={!mobileOpen}>
      {items.map((item) => <Link key={item.to} to={item.to} className={item.active ? 'active' : ''} aria-current={item.active ? 'page' : undefined} onClick={() => setMobileOpen(false)}>{item.label}<Icon name="chevron-right" /></Link>)}
      <Link to="/support" onClick={() => setMobileOpen(false)}>联系支持</Link>
    </nav></header>
    <main id="main" tabIndex={-1} ref={main}><Outlet /></main>
    <footer className="site-footer"><div className="container footer-top">
      <div><Brand /><p>独立的 AI 订阅服务站点。<br />把时间，留给真正重要的事。</p></div>
      <div className="footer-group"><h3>订阅服务</h3><Link to="/">全部套餐</Link><Link to="/orders">我的订单</Link><Link to="/help/getting-started">购买指南</Link></div>
      <div className="footer-group"><h3>帮助与支持</h3><Link to="/help">帮助中心</Link><Link to="/support">联系支持</Link><Link to="/help/account-safety">账号安全</Link></div>
      <div className="footer-group"><h3>服务说明</h3><Link to="/terms">服务须知</Link><Link to="/privacy">隐私说明</Link><span className="muted">简体中文 · 人民币 CNY</span></div>
    </div><div className="container footer-bottom"><span>© 2026 {site.name}</span><span>非 OpenAI 官方网站，品牌名称归相应权利人所有。</span><span>经营主体信息待配置</span></div></footer>
  </>;
}
