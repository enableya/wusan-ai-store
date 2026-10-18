import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useApiResource } from '../hooks/useApiResource';
import { usePageTitle } from '../hooks/usePageTitle';
import { postApi } from '../services/api';
import type { AdminSession, ClickReport } from '../types/admin';
import './admin.css';

const day = (offset = 0) => new Date(Date.now() + 8 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
const number = (value: number) => value.toLocaleString('zh-CN');

function Login({ configured, onLogin }: { configured: boolean; onLogin: (session: AdminSession) => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try { const result = await postApi<AdminSession>('/admin/login', { username, password }); setPassword(''); onLogin(result); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '登录失败，请重试。'); }
    finally { setBusy(false); }
  }
  return <main className="admin-login"><div className="admin-login-card">
    <Link to="/" className="admin-brand"><span>53</span>伍叁 AI</Link>
    <div className="eyebrow">ADMIN CONSOLE</div><h1>登录管理后台</h1><p>查看商品点击数据，了解访客对套餐的关注。</p>
    {!configured && <p className="admin-error" role="status">管理员账号尚未初始化，请在服务器创建管理员后刷新本页。</p>}
    <form onSubmit={submit}>
      <label htmlFor="admin-username">管理员账号</label><input id="admin-username" autoComplete="username" maxLength={40} required value={username} onChange={event => setUsername(event.target.value)} disabled={busy} />
      <label htmlFor="admin-password">登录密码</label><input id="admin-password" type="password" autoComplete="current-password" maxLength={128} required value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
      {error && <p className="admin-error" role="alert">{error}</p>}
      <button className="button primary full-width" disabled={busy || !configured}>{busy ? '正在登录…' : '登录后台'}<Icon name="arrow-right" /></button>
    </form><Link to="/" className="admin-back"><Icon name="arrow-left" />返回商城</Link>
  </div><p className="admin-login-foot">伍叁 AI · 管理控制台</p></main>;
}

function Dashboard({ username, onExpired }: { username: string; onExpired: () => void }) {
  const [filters, setFilters] = useState({ start: day(-6), end: day(), environment: 'production' });
  const [draft, setDraft] = useState(filters);
  const [error, setError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const report = useApiResource<ClickReport>(`/admin/analytics/products?${new URLSearchParams(filters)}`);
  useEffect(() => { if (report.error?.status === 401) onExpired(); }, [report.error?.status, onExpired]);
  function apply(event: FormEvent) {
    event.preventDefault();
    if (!draft.start || !draft.end || draft.start > draft.end || draft.end > day() || Date.parse(draft.end) - Date.parse(draft.start) > 365 * 86400000) { setError('请选择有效日期，开始日期不能晚于结束日期，最多查询 366 天。'); return; }
    setError(''); setFilters(draft);
  }
  function preset(days: number) {
    const next = { ...draft, start: day(1 - days), end: day() };
    setDraft(next); setFilters(next); setError('');
  }
  async function logout() {
    setLoggingOut(true); setError('');
    try { await postApi('/admin/logout', {}); onExpired(); }
    catch { setError('退出失败，请重试。'); }
    finally { setLoggingOut(false); }
  }
  const data = report.data;
  const peak = Math.max(1, ...data?.trend.map(item => item.clicks) || []);
  return <div className="admin-shell">
    <aside className="admin-sidebar"><Link to="/admin" className="admin-brand"><span>53</span><div>伍叁 AI<small>管理控制台</small></div></Link>
      <div className="admin-nav-label">数据中心</div><nav aria-label="后台导航"><Link to="/admin" aria-current="page"><Icon name="columns-3" />商品点击分析</Link></nav>
      <Link className="admin-store-link" to="/"><Icon name="arrow-up-right" />访问商城</Link>
    </aside>
    <div className="admin-workspace"><header className="admin-topbar"><span>工作台 <Icon name="chevron-right" />商品点击分析</span><div><span className="admin-user"><Icon name="user-round" />{username}</span><button onClick={logout} disabled={loggingOut}>{loggingOut ? '正在退出…' : '退出登录'}</button></div></header>
      <main className="admin-content"><div className="admin-heading"><div><div className="eyebrow">PRODUCT ANALYTICS</div><h1>商品点击分析</h1><p>了解哪些套餐更受关注，让每一次访问都有迹可循。</p></div><button className="button secondary" onClick={report.reload} disabled={report.loading}><Icon name="refresh-cw" />{report.loading ? '加载中…' : '刷新数据'}</button></div>
        <form className="admin-filters" onSubmit={apply}>
          <div className="admin-presets" aria-label="快捷日期">{[1, 7, 30].map(days => <button type="button" key={days} className={filters.start === day(1 - days) && filters.end === day() ? 'active' : ''} onClick={() => preset(days)}>{days === 1 ? '今日' : `近 ${days} 天`}</button>)}</div>
          <label>开始日期<input type="date" aria-label="开始日期" value={draft.start} max={day()} onChange={event => setDraft({ ...draft, start: event.target.value })} required /></label>
          <label>结束日期<input type="date" aria-label="结束日期" value={draft.end} max={day()} onChange={event => setDraft({ ...draft, end: event.target.value })} required /></label>
          <label>数据环境<select aria-label="数据环境" value={draft.environment} onChange={event => setDraft({ ...draft, environment: event.target.value })}><option value="production">正式环境</option><option value="sandbox">测试环境</option><option value="all">全部环境</option></select></label>
          <button className="button primary" type="submit">查询</button>
        </form>
        {error && <p className="admin-error" role="alert">{error}</p>}
        {report.error && report.error.status !== 401 && <div className="admin-error" role="alert">{report.error.message}<button className="text-button" onClick={report.reload}>重试</button></div>}
        <div className="admin-metrics" aria-busy={report.loading}>{[
          ['所选时段点击', data?.total, '当前筛选范围内的有效点击'], ['今日点击', data?.today, '北京时间 00:00 至现在'], ['被点击商品', data?.clickedProducts, '所选时段内获得点击的商品数'],
        ].map(([label, value, note]) => <section className="admin-metric" key={String(label)}><span>{label}</span><strong>{typeof value === 'number' ? number(value) : '—'}</strong><small>{note}</small></section>)}</div>
        <section className="admin-panel"><div className="admin-panel-title"><div><h2>点击趋势</h2><p>{filters.start} 至 {filters.end} · 按北京时间统计</p></div><span className="admin-chip">{filters.environment === 'production' ? '正式数据' : filters.environment === 'sandbox' ? '测试数据' : '全部数据'}</span></div>
          {report.loading ? <p role="status" className="admin-loading">正在读取点击数据…</p> : data && <>
            {data.total === 0 && <p className="admin-zero">当前时段暂无点击，访客打开商品详情后将在这里显示。</p>}
            <div className="admin-trend" aria-label="每日商品点击趋势">{data.trend.map(item => <div className="admin-trend-day" key={item.date} title={`${item.date}：${item.clicks} 次`}><span>{item.clicks > 0 ? number(item.clicks) : ''}</span><div className="admin-bar-track"><i style={{ height: `${item.clicks / peak * 100}%`, minHeight: item.clicks ? 3 : 0 }} /></div><small>{item.date.slice(5)}</small><span className="sr-only">{item.date}：{item.clicks} 次点击</span></div>)}</div>
          </>}
        </section>
        <section className="admin-panel"><div className="admin-panel-title"><div><h2>商品点击排行</h2><p>按所选时段点击量排序，未获得点击的商品显示为 0。</p></div><span className="admin-chip">{data?.products.length ?? '—'} 个商品</span></div>
          <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th scope="col">排名</th><th scope="col">商品</th><th scope="col">商品状态</th><th scope="col">点击次数</th><th scope="col">点击占比</th></tr></thead><tbody>{data?.products.map((product, index) => <tr key={product.id}><td><span className={`admin-rank ${index === 0 && product.clicks ? 'first' : ''}`}>{index + 1}</span></td><td><strong>{product.name}</strong><small>{product.id}</small></td><td><span className={`admin-chip ${product.active ? '' : 'inactive'}`}>{product.active ? '展示中' : '已下架 / 移除'}</span></td><td className="admin-click-number">{number(product.clicks)}</td><td><div className="admin-share"><span style={{ width: `${data.total ? product.clicks / data.total * 100 : 0}%` }} /></div><small>{data.total ? (product.clicks / data.total * 100).toFixed(1) : '0.0'}%</small></td></tr>)}</tbody></table></div>
          {data && data.products.length === 0 && <p className="admin-zero">尚无商品。</p>}
        </section>
        <p className="admin-method"><Icon name="info" />统计口径：成功打开商品详情记一次，同一浏览器、同一商品 30 分钟内去重；管理员浏览不计入。点击量不代表独立人数，统计从本功能启用后开始。</p>
      </main><footer className="admin-footer">伍叁 AI · 商品数据中心</footer>
    </div>
  </div>;
}

export default function AdminPage() {
  usePageTitle('管理后台 · 商品点击');
  const resource = useApiResource<AdminSession>('/admin/session');
  const [session, setSession] = useState<AdminSession | null>(null);
  const current = session || resource.data;
  if (!current) return <main className="admin-login"><div className="admin-login-card"><h1>管理后台</h1><p role="status">{resource.error ? '无法连接后台，请稍后重试。' : '正在确认登录状态…'}</p>{resource.error && <button className="button primary" onClick={resource.reload}>重新加载</button>}</div></main>;
  return current.authenticated ? <Dashboard username={current.username || 'admin'} onExpired={() => setSession({ configured: true, authenticated: false })} /> : <Login configured={current.configured} onLogin={setSession} />;
}
