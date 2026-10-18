import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import type { ClickReport } from '../src/types/admin.ts';
import { OrderError } from './orders.ts';

export const chinaDay = (time = Date.now()) => new Date(time + 8 * 3600000).toISOString().slice(0, 10);
const boundary = (day: string) => new Date(`${day}T00:00:00+08:00`).toISOString();
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const dayValid = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;

export function analyticsRepository(db: DatabaseSync, environment: 'sandbox' | 'production', secure: boolean) {
  return {
    record(request: IncomingMessage, response: ServerResponse, input: Record<string, unknown>, admin: boolean) {
      if (admin) return { recorded: false };
      if (typeof input.productId !== 'string' || !/^[a-z0-9-]{1,80}$/.test(input.productId) || typeof input.eventId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.eventId)) throw new OrderError(400, 'INVALID_CLICK', '统计参数无效。');
      const product = db.prepare('SELECT name FROM products WHERE id = ? AND active = 1').get(input.productId);
      if (!product) throw new OrderError(404, 'PRODUCT_NOT_FOUND', '商品不存在或已下架。');
      const cookies = (request.headers.cookie || '').split(';').map(part => part.trim()).filter(part => part.startsWith('wusan_visit='));
      let visitor = cookies.length === 1 ? cookies[0].slice('wusan_visit='.length) : '';
      if (!/^[a-f0-9]{64}$/.test(visitor)) {
        visitor = randomBytes(32).toString('hex');
        response.setHeader('Set-Cookie', `wusan_visit=${visitor}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
      }
      const hash = createHash('sha256').update(visitor).digest('hex');
      const since = new Date(Date.now() - 30 * 60000).toISOString();
      if (db.prepare('SELECT 1 FROM product_clicks WHERE visitor_hash = ? AND product_id = ? AND environment = ? AND created_at > ? LIMIT 1').get(hash, input.productId, environment, since)) return { recorded: false };
      const result = db.prepare('INSERT OR IGNORE INTO product_clicks(event_id,product_id,product_name,visitor_hash,environment,created_at) VALUES(?,?,?,?,?,?)').run(input.eventId, input.productId, String(product.name), hash, environment, new Date().toISOString());
      return { recorded: result.changes === 1 };
    },
    report(params: URLSearchParams): ClickReport {
      const allowed = ['start', 'end', 'environment'];
      if ([...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1)) throw new OrderError(400, 'INVALID_FILTER', '筛选条件无效。');
      const today = chinaDay();
      const end = params.get('end') || today;
      const start = params.get('start') || chinaDay(Date.now() - 6 * 86400000);
      const selected = params.get('environment') || environment;
      if (!dayValid(start) || !dayValid(end) || start > end || end > today || Date.parse(end) - Date.parse(start) > 365 * 86400000 || !['sandbox', 'production', 'all'].includes(selected)) throw new OrderError(400, 'INVALID_FILTER', '请选择有效日期，时间范围最多 366 天。');
      const clause = selected === 'all' ? '' : ' AND environment = ?';
      const env = selected === 'all' ? [] : [selected];
      const args = [boundary(start), boundary(nextDay(end)), ...env];
      const rows = db.prepare(`SELECT product_id, max(product_name) AS name, count(*) AS clicks FROM product_clicks WHERE created_at >= ? AND created_at < ?${clause} GROUP BY product_id`).all(...args);
      const current = db.prepare('SELECT id,name,active FROM products ORDER BY sort_order,id').all();
      const products = new Map(current.map(row => [String(row.id), { id: String(row.id), name: String(row.name), active: !!row.active, clicks: 0 }]));
      for (const row of rows) {
        const id = String(row.product_id);
        const item = products.get(id) || { id, name: String(row.name), active: false, clicks: 0 };
        item.clicks = Number(row.clicks); products.set(id, item);
      }
      const days = db.prepare(`SELECT date(created_at,'+8 hours') AS day, count(*) AS clicks FROM product_clicks WHERE created_at >= ? AND created_at < ?${clause} GROUP BY day`).all(...args);
      const counts = new Map(days.map(row => [String(row.day), Number(row.clicks)]));
      const trend = [];
      for (let day = start; day <= end; day = nextDay(day)) trend.push({ date: day, clicks: counts.get(day) || 0 });
      return {
        start, end, environment: selected as ClickReport['environment'],
        total: rows.reduce((sum, row) => sum + Number(row.clicks), 0),
        today: Number(db.prepare(`SELECT count(*) AS n FROM product_clicks WHERE created_at >= ? AND created_at < ?${clause}`).get(boundary(today), boundary(nextDay(today)), ...env)!.n),
        clickedProducts: rows.length, trend,
        products: [...products.values()].sort((a, b) => b.clicks - a.clicks || a.name.localeCompare(b.name, 'zh-CN')),
      };
    },
  };
}
