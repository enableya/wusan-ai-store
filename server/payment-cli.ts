import { config } from './config.ts';
import { openDatabase } from './database.ts';
import { createAlipayGateway } from './alipay.ts';
import { refundRepository } from './refunds.ts';

const [action, orderId, requestNo, amount, reason] = process.argv.slice(2);
if (!['refund', 'refund-query'].includes(action)) {
  console.error('Usage: npm run payment -- refund ORDER_ID REQUEST_NO AMOUNT REASON | refund-query REQUEST_NO');
  process.exitCode = 1;
} else {
  const db = openDatabase(config.databasePath);
  try {
    const refunds = refundRepository(db, createAlipayGateway());
    console.log(JSON.stringify(action === 'refund-query' ? await refunds.query(orderId) : await refunds.request(orderId, requestNo, amount, reason)));
  } catch (error) {
    // Payment adapter masks SDK details; never print response bodies, signatures or keys.
    console.error(error instanceof Error ? error.message : 'Payment operation failed.');
    process.exitCode = 1;
  } finally { db.close(); }
}
