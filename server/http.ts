import type { IncomingMessage } from 'node:http';
import { OrderError } from './orders.ts';

export function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 16384) {
        if (!tooLarge) reject(new OrderError(413, 'BODY_TOO_LARGE', '请求内容过长。'));
        tooLarge = true;
        chunks.length = 0;
      } else if (!tooLarge) chunks.push(chunk);
    });
    request.once('end', () => { if (!tooLarge) resolve(Buffer.concat(chunks).toString('utf8')); });
    request.once('error', reject);
    request.once('aborted', () => reject(new OrderError(400, 'REQUEST_ABORTED', '请求已中断。')));
  });
}

export async function readJson(request: IncomingMessage, origin: string) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new OrderError(415, 'JSON_REQUIRED', '请使用 JSON 提交订单。');
  }
  const expected = origin || `http://${request.headers.host}`;
  if (request.headers['sec-fetch-site'] === 'cross-site' || (request.headers.origin && request.headers.origin !== expected)) {
    throw new OrderError(403, 'INVALID_ORIGIN', '请从本站页面发起请求。');
  }
  try {
    const input = JSON.parse(await readBody(request));
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();
    return input as Record<string, unknown>;
  } catch (error) {
    if (error instanceof OrderError) throw error;
    throw new OrderError(400, 'INVALID_JSON', '请求格式无效。');
  }
}
