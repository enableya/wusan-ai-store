import { postApi } from './api';

export const productClicksChannel = 'wusan:product-clicks';
const trackedEntries = new Set<string>();

export async function trackProductClick(productId: string, locationKey: string) {
  const entry = `${locationKey}:${productId}`;
  if (trackedEntries.has(entry)) return;
  trackedEntries.add(entry);

  try {
    const result = await postApi<{ recorded: boolean }>('/analytics/product-click', {
      productId,
      eventId: crypto.randomUUID(),
    });
    if (result.recorded && typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(productClicksChannel);
      channel.postMessage('recorded');
      channel.close();
    }
  } catch { /* Statistics failures never interrupt browsing or checkout. */ }
}
