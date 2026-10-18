import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Article, Faq, HomeContent, Product } from '../src/types/catalog.ts';
import { products } from './seed/catalog.ts';
import { articles, faqs, home } from './seed/content.ts';
import * as previousContent from './seed/content-v2.ts';
import { migrateContent } from './content-migration.ts';

export function openDatabase(filename: string) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename, { timeout: 5000 });
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    db.exec('BEGIN IMMEDIATE');
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (version > 5) throw new Error('Database schema is newer than this server supports.');
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
    if (version < 3) {
      db.exec(`CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        owner_hash TEXT NOT NULL,
        email TEXT NOT NULL,
        snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
        status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'closed')),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        paid_at TEXT,
        trade_no TEXT UNIQUE,
        idempotency_key TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
        terms_version TEXT NOT NULL DEFAULT '2026-10-17',
        UNIQUE (owner_hash, idempotency_key)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS orders_owner_created ON orders(owner_hash, created_at DESC);`);
      for (const [key, oldValue, newValue] of [
        ['home', previousContent.home, home], ['faqs', previousContent.faqs, faqs], ['articles', previousContent.articles, articles],
      ] as const) {
        const row = db.prepare('SELECT value FROM content WHERE key = ?').get(key);
        if (row) db.prepare('UPDATE content SET value = ? WHERE key = ?').run(
          JSON.stringify(migrateContent(JSON.parse(row.value as string), oldValue, newValue)), key);
      }
      db.exec('PRAGMA user_version = 3');
    }
    if (version < 4) {
      db.exec(`CREATE TABLE IF NOT EXISTS alipay_notify_events (
        event_key TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
        notify_id TEXT NOT NULL, trade_no TEXT NOT NULL, event_type TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS payment_refunds (
        request_no TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
        amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), reason TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'success')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      PRAGMA user_version = 4;`);
    }
    if (version < 5) {
      db.exec(`CREATE TABLE IF NOT EXISTS admin_accounts (
        username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS admin_sessions (
        token_hash TEXT PRIMARY KEY, username TEXT NOT NULL REFERENCES admin_accounts(username) ON DELETE CASCADE,
        expires_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS admin_sessions_expiry ON admin_sessions(expires_at);
      CREATE TABLE IF NOT EXISTS product_clicks (
        id INTEGER PRIMARY KEY, event_id TEXT NOT NULL, product_id TEXT NOT NULL,
        product_name TEXT NOT NULL, visitor_hash TEXT NOT NULL,
        environment TEXT NOT NULL CHECK(environment IN ('sandbox','production')), created_at TEXT NOT NULL,
        UNIQUE(environment, product_id, event_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS product_clicks_range ON product_clicks(environment, created_at);
      CREATE INDEX IF NOT EXISTS product_clicks_visitor ON product_clicks(visitor_hash, product_id, environment, created_at);
      PRAGMA user_version = 5;`);
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
