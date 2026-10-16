import { useCallback, useEffect, useState } from 'react';
import { ApiError, requestApi } from '../services/api';

export function useApiResource<T>(path: string | null) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ path: string | null; attempt: number; data: T | null; error: ApiError | null } | null>(null);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    let active = true;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 10000);
    requestApi<T>(path, controller.signal).then((data) => {
      if (active && !controller.signal.aborted) setState({ path, attempt, data, error: null });
    }).catch((error: unknown) => {
      if (!active || (controller.signal.aborted && !timedOut)) return;
      setState({
        path, attempt, data: null,
        error: error instanceof ApiError ? error : new ApiError(timedOut ? '请求超时，请重试。' : '无法连接服务，请检查网络后重试。'),
      });
    }).finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [path, attempt]);
  const current = state?.path === path && state?.attempt === attempt ? state : null;
  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  return { data: current?.data ?? null, error: current?.error ?? null, loading: Boolean(path && !current), reload };
}
