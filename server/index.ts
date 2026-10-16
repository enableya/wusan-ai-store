import { createApiServer } from './app.ts';
import { config } from './config.ts';
import { openDatabase } from './database.ts';

const db = openDatabase(config.databasePath);
const server = createApiServer(db);
server.on('error', (error) => {
  console.error('API startup failed:', error.message);
  db.close();
  process.exitCode = 1;
});
server.listen(config.port, config.host, () => {
  console.log(`Wusan API: http://${config.host}:${config.port}/api/health`);
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close(() => { db.close(); });
  server.closeIdleConnections();
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
