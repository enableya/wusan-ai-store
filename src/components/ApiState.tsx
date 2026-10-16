import { Icon } from './Icon';
import type { ApiError } from '../services/api';

export function ApiState({ error, retry, title = '正在加载内容', compact = false }: {
  error: ApiError | null; retry: () => void; title?: string; compact?: boolean;
}) {
  const Heading = compact ? 'h2' : 'h1';
  return <div className="container page-space api-state" data-state={error ? 'error' : 'loading'} aria-busy={!error}>
    <div className="empty-state" role={error ? 'alert' : 'status'}>
      <div className="empty-icon"><Icon name={error ? 'info' : 'package'} /></div>
      <Heading>{error ? '内容加载失败' : title}</Heading>
      <p>{error ? error.message : '正在获取最新信息…'}</p>
      {error && <button className="button secondary" type="button" onClick={retry}><Icon name="refresh-cw" />重新加载</button>}
    </div>
  </div>;
}
