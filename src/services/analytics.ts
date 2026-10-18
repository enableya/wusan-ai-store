import { postApi } from './api';

const visits = new Map<string, { eventId: string; at: number }>();
const pending = new Set<string>();
export async function trackProductClick(productId: string) {
  const key = `wusan:product-click:${productId}`;
  let visit = visits.get(key);
  try { visit ||= JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { /* Storage can be unavailable. */ }
  if (!visit || typeof visit.eventId !== 'string' || !Number.isFinite(visit.at) || Date.now() - visit.at >= 30 * 60000) visit = { eventId: crypto.randomUUID(), at: Date.now() };
  visits.set(key, visit);
  try { sessionStorage.setItem(key, JSON.stringify(visit)); } catch { /* Server cookie and event id still deduplicate. */ }
  if (pending.has(visit.eventId)) return;
  pending.add(visit.eventId);
  try { await postApi('/analytics/product-click', { productId, eventId: visit.eventId }); }
  catch { /* Statistics failures never interrupt browsing or checkout. */ }
  finally { pending.delete(visit.eventId); }
}
