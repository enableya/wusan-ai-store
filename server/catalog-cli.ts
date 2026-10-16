import { config } from './config.ts';
import { catalogRepository, openDatabase } from './database.ts';

const [command, id, value, ...extra] = process.argv.slice(2);
const db = openDatabase(config.databasePath);
try {
  const catalog = catalogRepository(db);
  if (command === 'list' && !id) {
    console.table(catalog.listProducts().map(({ id, name, priceCents, selectable }) => ({ id, name, priceCents, selectable })));
  } else if (command === 'price' && id && value && !extra.length) {
    if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('Price must be a positive yuan amount with at most two decimal places.');
    const [yuan, fraction = ''] = value.split('.');
    const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error('Price is out of range.');
    if (!catalog.findProduct(id)) throw new Error('Product does not exist.');
    db.prepare(`UPDATE products SET price_cents = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(cents, id);
    console.log(`${id}: CNY ${value} / month`);
  } else {
    throw new Error('Usage: npm run catalog -- list | price <product-id> <yuan>');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Catalog command failed.');
  process.exitCode = 1;
} finally {
  db.close();
}
