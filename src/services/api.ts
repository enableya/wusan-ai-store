export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function requestApi<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, { signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
  let body;
  try { body = await response.json(); }
  catch { throw new ApiError('接口返回内容异常，请稍后重试。', response.status); }
  if (!response.ok) throw new ApiError(body?.error?.message || '服务暂不可用，请稍后重试。', response.status);
  if (!body || typeof body !== 'object' || !('data' in body)) throw new ApiError('接口返回内容异常，请稍后重试。');
  return body.data as T;
}
