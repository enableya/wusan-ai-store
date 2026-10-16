import { Component } from 'react';
import type { ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div className="container page-space error-page"><div className="empty-state">
      <h1>页面暂时无法显示</h1><p>可以重新加载页面后再试。本机套餐清单不会因此删除。</p>
      <button className="button primary" type="button" onClick={() => window.location.reload()}>重新加载</button>
    </div></div>;
    return this.props.children;
  }
}
