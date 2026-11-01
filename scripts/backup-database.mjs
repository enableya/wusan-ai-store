import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, lstat, readdir, unlink, chmod } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
if (args.length !== 2) throw new Error('Usage: backup-database.mjs <database> <protected-output-directory>');
const source = resolve(args[0]);
const directory = resolve(args[1]);
const info = await lstat(source);
if (!info.isFile() || info.isSymbolicLink()) throw new Error('Expected a regular source database.');
await mkdir(directory, { recursive: true, mode: 0o700 });
const destinationInfo = await lstat(directory);
if (!destinationInfo.isDirectory() || destinationInfo.isSymbolicLink()) throw new Error('Expected a real backup directory.');
const filename = `wusan-${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.sqlite`;
const path = join(directory, filename);
const db = new DatabaseSync(source, { readOnly: true });
try { await backup(db, path); } finally { db.close(); }
if (process.platform !== 'win32') await chmod(path, 0o600);
const check = new DatabaseSync(path);
try {
  // Make the snapshot self-contained; no WAL/SHM files are needed for restore.
  check.exec('PRAGMA journal_mode = DELETE');
  if (check.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('Backup integrity check failed.');
} finally { check.close(); }
// Rotate only this tool's dated backups after a new, verified snapshot exists.
const cutoff = Date.now() - 14 * 86400000;
for (const name of await readdir(directory)) {
  if (!/^wusan-\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9]{8}\.sqlite$/.test(name)) continue;
  const candidate = join(directory, name);
  const entry = await lstat(candidate);
  if (candidate !== path && entry.isFile() && !entry.isSymbolicLink() && entry.mtimeMs < cutoff) await unlink(candidate);
}
console.log(JSON.stringify({ backup: filename, integrity: 'ok' }));
