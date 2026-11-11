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
    if (version > 22) throw new Error('Database schema is newer than this server supports.');
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
    if (version < 6) {
      const columns = db.prepare('PRAGMA table_info(orders)').all().map(row => row.name);
      if (!columns.includes('contact')) db.exec('ALTER TABLE orders ADD COLUMN contact TEXT');
      if (!columns.includes('query_password_hash')) db.exec('ALTER TABLE orders ADD COLUMN query_password_hash TEXT');
      db.exec(`CREATE INDEX IF NOT EXISTS orders_contact ON orders(contact);
        CREATE TABLE IF NOT EXISTS order_access (
          order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          owner_hash TEXT NOT NULL, expires_at TEXT NOT NULL,
          PRIMARY KEY(order_id, owner_hash)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS order_access_expiry ON order_access(expires_at);
        PRAGMA user_version = 6;`);
    }
    if (version < 7) {
      db.exec(`CREATE TABLE IF NOT EXISTS voucher_inventory (
        id INTEGER PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id),
        environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
        code TEXT NOT NULL,
        priority INTEGER NOT NULL CHECK (priority IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE (environment, code)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS voucher_inventory_product ON voucher_inventory(environment, product_id);
      PRAGMA user_version = 7;`);
    }
    if (version < 8) {
      db.exec(`CREATE TABLE IF NOT EXISTS order_redemptions (
        order_id TEXT PRIMARY KEY REFERENCES orders(id),
        voucher_id INTEGER NOT NULL UNIQUE REFERENCES voucher_inventory(id),
        submit_key TEXT NOT NULL UNIQUE,
        prepared TEXT CHECK (prepared IS NULL OR json_valid(prepared)),
        account TEXT CHECK (account IS NULL OR json_valid(account)),
        preview_until INTEGER NOT NULL DEFAULT 0,
        submitted INTEGER NOT NULL DEFAULT 0 CHECK (submitted IN (0, 1)),
        result TEXT CHECK (result IS NULL OR json_valid(result)),
        claim_token TEXT
      ) STRICT;
      PRAGMA user_version = 8;`);
    }
    if (version < 9) {
      const columns = db.prepare('PRAGMA table_info(admin_accounts)').all().map(row => row.name);
      if (!columns.includes('role')) db.exec("ALTER TABLE admin_accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'super_admin'))");
      if (!columns.includes('permissions')) {
        db.exec(`ALTER TABLE admin_accounts ADD COLUMN permissions TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(permissions));
          UPDATE admin_accounts SET permissions = '["analytics.view","vouchers.view","vouchers.import","checkout.test"]';`);
      }
      db.exec('PRAGMA user_version = 9');
    }
    if (version < 10) {
      db.exec(`CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL, invite_code TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS customer_sessions (
        token_hash TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS customer_browsers (
        owner_hash TEXT NOT NULL, customer_id TEXT NOT NULL REFERENCES customers(id),
        PRIMARY KEY(owner_hash, customer_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS referral_visits (
        owner_hash TEXT PRIMARY KEY, inviter_id TEXT NOT NULL REFERENCES customers(id), expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS referral_orders (
        order_id TEXT PRIMARY KEY REFERENCES orders(id), inviter_id TEXT NOT NULL REFERENCES customers(id),
        buyer_id TEXT REFERENCES customers(id), amount_cents INTEGER NOT NULL DEFAULT 500 CHECK(amount_cents = 500),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','earned','cancelled')),
        created_at TEXT NOT NULL, earned_at TEXT,
        CHECK(buyer_id IS NULL OR buyer_id != inviter_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS referral_orders_inviter ON referral_orders(inviter_id, created_at);
      CREATE TRIGGER IF NOT EXISTS referral_payment AFTER UPDATE OF status ON orders BEGIN
        UPDATE referral_orders SET status = CASE NEW.status WHEN 'paid' THEN CASE WHEN (SELECT COALESCE(SUM(amount_cents),0) FROM payment_refunds WHERE order_id = NEW.id AND status = 'success') >= json_extract(NEW.snapshot,'$.priceCents') THEN 'cancelled' ELSE 'earned' END WHEN 'closed' THEN 'cancelled' ELSE 'pending' END,
          earned_at = CASE WHEN NEW.status = 'paid' THEN COALESCE(earned_at, NEW.paid_at) ELSE earned_at END
        WHERE order_id = NEW.id;
      END;
      CREATE TRIGGER IF NOT EXISTS referral_refund AFTER UPDATE OF status ON payment_refunds WHEN NEW.status = 'success' BEGIN
        UPDATE referral_orders SET status = 'cancelled' WHERE order_id = NEW.order_id AND
          (SELECT COALESCE(SUM(amount_cents),0) FROM payment_refunds WHERE order_id = NEW.order_id AND status = 'success') >=
          (SELECT json_extract(snapshot,'$.priceCents') FROM orders WHERE id = NEW.order_id);
      END;
      PRAGMA user_version = 10;`);
    }
    if (version < 11) {
      const columns = db.prepare('PRAGMA table_info(payment_refunds)').all().map(row => row.name);
      if (!columns.includes('confirmed_at')) {
        db.exec("ALTER TABLE payment_refunds ADD COLUMN confirmed_at TEXT");
      }
      db.exec(`UPDATE payment_refunds SET confirmed_at = updated_at WHERE status = 'success' AND confirmed_at IS NULL;
        CREATE TRIGGER IF NOT EXISTS refund_confirmed_at_update AFTER UPDATE OF status ON payment_refunds
        WHEN NEW.status = 'success' AND NEW.confirmed_at IS NULL BEGIN
          UPDATE payment_refunds SET confirmed_at = NEW.updated_at WHERE request_no = NEW.request_no;
        END;
        CREATE TRIGGER IF NOT EXISTS refund_confirmed_at_insert AFTER INSERT ON payment_refunds
        WHEN NEW.status = 'success' AND NEW.confirmed_at IS NULL BEGIN
          UPDATE payment_refunds SET confirmed_at = NEW.updated_at WHERE request_no = NEW.request_no;
        END;
        PRAGMA user_version = 11;`);
    }
    if (version < 12) {
      db.exec(`CREATE TABLE IF NOT EXISTS coupons (
        id TEXT PRIMARY KEY, code TEXT NOT NULL, environment TEXT NOT NULL CHECK(environment IN ('sandbox','production')),
        product_id TEXT REFERENCES products(id), min_cents INTEGER NOT NULL CHECK(min_cents >= 0),
        discount_cents INTEGER NOT NULL CHECK(discount_cents > 0), usage_limit INTEGER NOT NULL CHECK(usage_limit > 0),
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL,
        UNIQUE(code, environment)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS coupon_orders (coupon_id TEXT NOT NULL REFERENCES coupons(id), order_id TEXT PRIMARY KEY REFERENCES orders(id), discount_cents INTEGER NOT NULL CHECK(discount_cents > 0)) STRICT;
      CREATE INDEX IF NOT EXISTS coupon_orders_coupon ON coupon_orders(coupon_id);
      PRAGMA user_version = 12;`);
    }
    if (version < 13) {
      const columns = db.prepare('PRAGMA table_info(coupons)').all().map(row => row.name);
      if (!columns.includes('deleted_at')) db.exec('ALTER TABLE coupons ADD COLUMN deleted_at TEXT');
      db.exec('PRAGMA user_version = 13');
    }
    if (version < 14) {
      db.exec(`CREATE TABLE IF NOT EXISTS customer_staff_checkout (
        customer_id TEXT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
        admin_username TEXT NOT NULL UNIQUE REFERENCES admin_accounts(username) ON DELETE CASCADE,
        linked_at TEXT NOT NULL
      ) STRICT;
      PRAGMA user_version = 14;`);
    }
    if (version < 15) {
      db.exec(`CREATE TABLE IF NOT EXISTS referral_withdrawals (
        id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id),
        environment TEXT NOT NULL CHECK(environment IN ('sandbox','production')),
        amount_cents INTEGER NOT NULL CHECK(amount_cents >= 10),
        payee_account TEXT NOT NULL, payee_name TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','approved','processing','paid','rejected','failed')),
        idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL, reviewed_at TEXT, reviewed_by TEXT,
        paid_at TEXT, transfer_no TEXT UNIQUE, note TEXT NOT NULL DEFAULT '', app_id TEXT, seller_id TEXT,
        UNIQUE(customer_id,environment,idempotency_key)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS referral_withdrawals_customer ON referral_withdrawals(customer_id,environment,created_at DESC);
      CREATE INDEX IF NOT EXISTS referral_withdrawals_status ON referral_withdrawals(environment,status,created_at DESC);
      CREATE TABLE IF NOT EXISTS referral_withdrawal_events (
        id INTEGER PRIMARY KEY, withdrawal_id TEXT NOT NULL REFERENCES referral_withdrawals(id),
        actor TEXT NOT NULL, action TEXT NOT NULL, status TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL
      ) STRICT;
      PRAGMA user_version = 15;`);
    }
    if (version < 16) {
      if (!db.prepare('PRAGMA table_info(order_redemptions)').all().some(column => column.name === 'submitted_order_no')) db.exec('ALTER TABLE order_redemptions ADD COLUMN submitted_order_no TEXT');
      db.exec(`CREATE TABLE IF NOT EXISTS order_fulfillment_deadlines (
        order_id TEXT PRIMARY KEY REFERENCES orders(id), due_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS order_fulfillment_due ON order_fulfillment_deadlines(due_at);
      CREATE TABLE IF NOT EXISTS order_cancellations (
        order_id TEXT PRIMARY KEY REFERENCES orders(id),
        state TEXT NOT NULL CHECK(state IN ('checking','review','refund_pending','cancelled','fulfilled')),
        refund_key TEXT NOT NULL UNIQUE, voucher_id INTEGER, note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, cancelled_at TEXT,
        retry_at INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE TRIGGER IF NOT EXISTS fulfillment_deadline_payment AFTER UPDATE OF status ON orders
      WHEN NEW.status = 'paid' AND OLD.status != 'paid' AND NEW.paid_at IS NOT NULL
        AND COALESCE(json_extract(NEW.snapshot,'$.staffCheckout'),0) = 0 BEGIN
        INSERT OR IGNORE INTO order_fulfillment_deadlines VALUES (NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ',NEW.paid_at,'+30 minutes'));
      END;
      CREATE TRIGGER IF NOT EXISTS fulfillment_deadline_insert AFTER INSERT ON orders
      WHEN NEW.status = 'paid' AND NEW.paid_at IS NOT NULL
        AND COALESCE(json_extract(NEW.snapshot,'$.staffCheckout'),0) = 0 BEGIN
        INSERT OR IGNORE INTO order_fulfillment_deadlines VALUES (NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ',NEW.paid_at,'+30 minutes'));
      END;
      PRAGMA user_version = 16;`);
    }
    if (version < 17) {
      db.exec(`CREATE TABLE IF NOT EXISTS order_fulfillment_details (
        order_id TEXT PRIMARY KEY REFERENCES orders(id), voucher_id INTEGER,
        voucher_code TEXT, recharge_email TEXT
      ) STRICT;
      INSERT OR IGNORE INTO order_fulfillment_details(order_id,voucher_id,voucher_code,recharge_email)
        SELECT r.order_id,v.id,v.code,json_extract(r.account,'$.email') FROM order_redemptions r
        JOIN orders o ON o.id=r.order_id JOIN voucher_inventory v ON v.id=r.voucher_id
        AND v.environment=o.environment AND v.product_id=json_extract(o.snapshot,'$.productId');
      INSERT OR IGNORE INTO order_fulfillment_details(order_id,voucher_id,voucher_code)
        SELECT c.order_id,v.id,v.code FROM order_cancellations c JOIN orders o ON o.id=c.order_id
        JOIN voucher_inventory v ON v.id=c.voucher_id AND v.environment=o.environment
        AND v.product_id=json_extract(o.snapshot,'$.productId') AND v.created_at<=c.created_at;
      PRAGMA user_version = 17;`);
    }
    if (version < 18) {
      db.exec(`CREATE TABLE IF NOT EXISTS order_refund_reviews (
        order_id TEXT PRIMARY KEY REFERENCES orders(id),
        status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
        requested_at TEXT NOT NULL, reviewed_at TEXT, reviewed_by TEXT, reason TEXT NOT NULL DEFAULT ''
      ) STRICT;
      CREATE INDEX IF NOT EXISTS order_refund_reviews_status ON order_refund_reviews(status,requested_at);
      -- Requests already sent before this upgrade must only be reconciled, never sent again.
      INSERT OR IGNORE INTO order_refund_reviews(order_id,status,requested_at,reviewed_at,reviewed_by,reason)
        SELECT c.order_id,'approved',c.created_at,c.updated_at,'system:migration','升级前已发起退款，仅继续核对原退款单。'
        FROM order_cancellations c WHERE c.state='refund_pending'
        AND EXISTS (SELECT 1 FROM payment_refunds r WHERE r.request_no=c.refund_key AND r.order_id=c.order_id);
      UPDATE order_cancellations SET state='checking',retry_at=0,lease_until=0,
        note='开通已超时，待核实后提交后台退款审核。'
        WHERE state='refund_pending' AND NOT EXISTS (SELECT 1 FROM order_refund_reviews r WHERE r.order_id=order_cancellations.order_id);
      PRAGMA user_version = 18;`);
    }
    if (version < 19) {
      const columns = db.prepare('PRAGMA table_info(order_cancellations)').all().map(row => row.name);
      if (!columns.includes('source')) db.exec(`ALTER TABLE order_cancellations ADD COLUMN source TEXT NOT NULL DEFAULT 'timeout'
        CHECK(source IN ('timeout','customer_unpaid','customer_paid'))`);
      db.exec('PRAGMA user_version = 19;');
    }
    if (version < 20) {
      const columns = db.prepare('PRAGMA table_info(referral_withdrawals)').all().map(row => row.name);
      if (!columns.includes('payout_method')) db.exec(`ALTER TABLE referral_withdrawals ADD COLUMN payout_method TEXT NOT NULL DEFAULT 'api'
        CHECK(payout_method IN ('api','manual'))`);
      db.exec(`CREATE TABLE IF NOT EXISTS referral_manual_payouts (
        withdrawal_id TEXT PRIMARY KEY REFERENCES referral_withdrawals(id),
        started_by TEXT NOT NULL, started_at TEXT NOT NULL,
        recorded_by TEXT, recorded_at TEXT, receipt BLOB, receipt_type TEXT,
        CHECK((receipt IS NULL AND receipt_type IS NULL) OR
          (receipt IS NOT NULL AND length(receipt) BETWEEN 1 AND 524288 AND receipt_type IN ('image/png','image/jpeg')))
      ) STRICT;
      PRAGMA user_version = 20;`);
    }
    if (version < 21) {
      db.exec(`CREATE TABLE IF NOT EXISTS staff_redemption_previews (
        order_id TEXT PRIMARY KEY REFERENCES orders(id),
        account TEXT NOT NULL CHECK(json_valid(account)),
        session_hash TEXT NOT NULL,
        policy TEXT NOT NULL CHECK(json_valid(policy)),
        expires_at TEXT NOT NULL,
        lease_until INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      PRAGMA user_version = 21;`);
    }
    if (version < 22) {
      const columns = db.prepare('PRAGMA table_info(order_fulfillment_details)').all().map(column => column.name);
      if (!columns.includes('reclaimed_at')) db.exec('ALTER TABLE order_fulfillment_details ADD COLUMN reclaimed_at TEXT');
      if (!columns.includes('reclaimed_by')) db.exec('ALTER TABLE order_fulfillment_details ADD COLUMN reclaimed_by TEXT');
      db.exec('PRAGMA user_version = 22;');
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
