import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Article, Faq, HomeContent, Product } from '../src/types/catalog.ts';
import { products } from './seed/catalog.ts';
import { articles, faqs, home } from './seed/content.ts';

export function openDatabase(filename: string) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename, { timeout: 5000 });
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    db.exec('BEGIN IMMEDIATE');
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (version > 2) throw new Error('Database schema is newer than this server supports.');
    if (version === 0) {
      db.exec(`
        CREATE TABLE products (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          category TEXT NOT NULL CHECK (category IN ('Plus', 'Pro')),
          price_cents INTEGER CHECK (price_cents IS NULL OR price_cents BETWEEN 1 AND 9007199254740991),
          selectable INTEGER NOT NULL CHECK (selectable IN (0, 1)),
          active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
          sort_order INTEGER NOT NULL,
          currency TEXT NOT NULL CHECK (currency = 'CNY'),
          period_months INTEGER NOT NULL CHECK (period_months > 0),
          presentation TEXT NOT NULL CHECK (json_valid(presentation)),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          CHECK (selectable = 0 OR price_cents IS NOT NULL)
        ) STRICT;
        CREATE TABLE content (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL CHECK (json_valid(value))
        ) STRICT;
      `);
      const insert = db.prepare(`INSERT INTO products
        (id, name, category, price_cents, selectable, sort_order, currency, period_months, presentation)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      products.forEach(({ id, name, category, priceCents, selectable, currency, periodMonths, ...presentation }, index) => {
        insert.run(id, name, category, priceCents, Number(selectable), index, currency, periodMonths, JSON.stringify(presentation));
      });
      const content = db.prepare('INSERT INTO content (key, value) VALUES (?, ?)');
      content.run('home', JSON.stringify(home));
      content.run('faqs', JSON.stringify(faqs));
      content.run('articles', JSON.stringify(articles));
      db.exec('PRAGMA user_version = 1');
    }
    if (version < 2) {
      db.prepare(`UPDATE products
        SET presentation = json_set(presentation, '$.mark', 'Plus'),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND json_extract(presentation, '$.mark') = ?`).run('chatgpt-plus', '+');
      db.exec('PRAGMA user_version = 2');
    }
    db.exec('COMMIT');
    return db;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* Initialization may fail before a transaction starts. */ }
    db.close();
    throw error;
  }
}

type ProductRow = {
  id: string; name: string; category: Product['category']; price_cents: number | null;
  selectable: number; currency: Product['currency']; period_months: number; presentation: string;
};

function productFromRow(row: ProductRow): Product {
  return {
    ...JSON.parse(row.presentation),
    id: row.id, name: row.name, category: row.category, priceCents: row.price_cents,
    selectable: Boolean(row.selectable), currency: row.currency, periodMonths: row.period_months,
  };
}

export function catalogRepository(db: DatabaseSync) {
  function readContent<T>(key: string): T {
    const row = db.prepare('SELECT value FROM content WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) throw new Error(`Missing content: ${key}`);
    return JSON.parse(row.value) as T;
  }
  return {
    listProducts(category?: string) {
      const rows = category
        ? db.prepare('SELECT * FROM products WHERE active = 1 AND category = ? ORDER BY sort_order, id').all(category)
        : db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY sort_order, id').all();
      return (rows as unknown as ProductRow[]).map(productFromRow);
    },
    findProduct(id: string) {
      const row = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(id);
      return row ? productFromRow(row as unknown as ProductRow) : undefined;
    },
    home: () => readContent<HomeContent>('home'),
    faqs: () => readContent<Faq[]>('faqs'),
    articles: () => readContent<Article[]>('articles'),
  };
}
