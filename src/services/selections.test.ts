import { beforeEach, describe, expect, it, vi } from 'vitest';
import { products, findProduct } from '../../server/seed/catalog';
import { parseSelections, readSelections, removeSelection, saveSelection, SELECTION_KEY } from './selections';
import { money, validEmail } from '../lib/format';

let stored: Map<string, string>;
beforeEach(() => {
  stored = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) || null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
  vi.stubGlobal('window', { dispatchEvent: vi.fn() });
});

describe('catalog and amounts', () => {
  it('allows selections only with positive integer prices', () => {
    for (const product of products) {
      if (product.selectable) {
        expect(Number.isSafeInteger(product.priceCents)).toBe(true);
        expect(product.priceCents).toBeGreaterThan(0);
      } else expect(product.priceCents).toBeNull();
    }
  });
  it('uses the confirmed merchant prices for every monthly plan', () => {
    expect(products.map(({ id, priceCents, selectable }) => ({ id, priceCents, selectable }))).toEqual([
      { id: 'chatgpt-plus', priceCents: 13000, selectable: true },
      { id: 'chatgpt-pro-5x', priceCents: 66000, selectable: true },
      { id: 'chatgpt-pro-20x', priceCents: 115000, selectable: true },
      { id: 'chatgpt-pro-50x-ph', priceCents: 335000, selectable: true },
    ]);
  });
  it('formats cents consistently and resolves valid product IDs', () => {
    expect(money(findProduct('chatgpt-plus')!.priceCents!)).toBe('130');
    expect(money(findProduct('chatgpt-pro-20x')!.priceCents!)).toBe('1,150');
    expect(money(findProduct('chatgpt-pro-50x-ph')!.priceCents!)).toBe('3,350');
    expect(findProduct('unknown')).toBeUndefined();
  });
});

describe('non-sensitive local selections', () => {
  it('treats corrupt and invalid storage as empty', () => {
    for (const raw of [null, 'invalid', '{}', '[null, 1, {"priceCents": 0}]']) expect(parseSelections(raw)).toEqual([]);
  });
  it('strips private fields and rejects invalid dates and amounts', () => {
    const base = { id: 'x', productId: 'chatgpt-plus', productName: 'Plus', priceCents: 12000, createdAt: '2026-10-14T08:00:00Z', email: 'private@example.com', session: 'private' };
    const [selection] = parseSelections(JSON.stringify([base]));
    expect(selection).not.toHaveProperty('email');
    expect(selection).not.toHaveProperty('session');
    expect(parseSelections(JSON.stringify([{ ...base, createdAt: 'invalid' }]))).toEqual([]);
    expect(parseSelections(JSON.stringify([{ ...base, priceCents: -1 }]))).toEqual([]);
  });
  it('is idempotent and keeps the original price snapshot', () => {
    const product = findProduct('chatgpt-plus')!;
    const a = saveSelection(product);
    const b = saveSelection(product);
    expect(a.id).toBe(b.id);
    expect(readSelections()).toHaveLength(1);
    saveSelection({ ...product, priceCents: 14000 });
    expect(readSelections()).toHaveLength(2);
    expect(readSelections()[1].priceCents).toBe(13000);
    expect(stored.get(SELECTION_KEY)).not.toContain('email');
    removeSelection(a.id);
    expect(readSelections()).toHaveLength(1);
  });
  it('rejects unavailable products and never creates an order', () => {
    expect(() => saveSelection({ ...products[0], selectable: false })).toThrow();
    for (const priceCents of [null, 0, -1, 1.5, NaN, Infinity]) {
      expect(() => saveSelection({ ...products[0], priceCents })).toThrow();
    }
    expect(readSelections()).toEqual([]);
  });
  it('saves each confirmed plan with its actual price', () => {
    for (const product of products) {
      expect(saveSelection(product)).toMatchObject({
        productId: product.id, productName: product.name, priceCents: product.priceCents,
      });
    }
    expect(readSelections()).toHaveLength(4);
  });
  it('handles blocked storage and surfaces failed writes', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(readSelections()).toEqual([]);
    expect(() => saveSelection(findProduct('chatgpt-plus')!)).toThrow('blocked');
  });
  it('retains at most 50 valid selections', () => {
    const items = Array.from({ length: 70 }, (_, index) => ({
      id: String(index), productId: 'p', productName: 'p', priceCents: 1, createdAt: '2026-10-14',
    }));
    expect(parseSelections(JSON.stringify(items))).toHaveLength(50);
  });
});

describe('contact email', () => {
  it('requires a sensible format and length', () => {
    expect(validEmail('test@example.com')).toBe(true);
    for (const value of ['', 'wrong', 'a@b', 'a b@example.com', 'a'.repeat(255) + '@example.com']) expect(validEmail(value)).toBe(false);
  });
});
