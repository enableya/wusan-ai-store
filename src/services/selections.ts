import type { Product, Selection } from '../types/catalog';

export const SELECTION_KEY = 'wusan-ai:selections:v1';
export const SELECTION_EVENT = 'wusan-ai:selections-changed';

export function parseSelections(raw: string | null): Selection[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is Selection =>
      typeof item === 'object' && item !== null &&
      typeof item.id === 'string' && typeof item.productId === 'string' &&
      typeof item.productName === 'string' &&
      Number.isSafeInteger(item.priceCents) && item.priceCents > 0 &&
      typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt)),
    ).map(({ id, productId, productName, priceCents, createdAt }) =>
      ({ id, productId, productName, priceCents, createdAt }),
    ).slice(0, 50);
  } catch {
    return [];
  }
}

export function readSelections(): Selection[] {
  try {
    return parseSelections(localStorage.getItem(SELECTION_KEY));
  } catch {
    return [];
  }
}

function writeSelections(selections: Selection[]) {
  localStorage.setItem(SELECTION_KEY, JSON.stringify(selections));
  window.dispatchEvent(new Event(SELECTION_EVENT));
}

export function saveSelection(product: Product): Selection {
  if (!product.selectable || !Number.isSafeInteger(product.priceCents) || product.priceCents === null || product.priceCents <= 0) {
    throw new Error('该套餐暂不可选择。');
  }
  const selections = readSelections();
  const existing = selections.find((item) =>
    item.productId === product.id && item.priceCents === product.priceCents,
  );
  if (existing) return existing;
  const selection: Selection = {
    id: crypto.randomUUID(),
    productId: product.id,
    productName: product.name,
    priceCents: product.priceCents,
    createdAt: new Date().toISOString(),
  };
  writeSelections([selection, ...selections].slice(0, 50));
  return selection;
}

export function removeSelection(id: string) {
  writeSelections(readSelections().filter((item) => item.id !== id));
}
