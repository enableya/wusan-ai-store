import { writeFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { isAbsolute, relative } from 'node:path';
import { config, projectRoot } from './config.ts';
import { openDatabase } from './database.ts';
import { hashAdminPassword } from './admin.ts';

const [action, username, flag, file] = process.argv.slice(2);
if (action !== 'create' || !/^[a-zA-Z0-9_-]{3,40}$/.test(username || '') || flag !== '--credentials-file' || !file) {
  console.error('Usage: npm run admin -- create USERNAME --credentials-file /protected/path.txt');
  process.exitCode = 1;
} else {
  const db = openDatabase(config.databasePath);
  let created = false;
  try {
    if (!isAbsolute(file) || !relative(projectRoot, file).startsWith('..')) throw new Error('Credentials must be written to an absolute path outside the project directory.');
    if (db.prepare('SELECT 1 FROM admin_accounts WHERE username = ?').get(username)) throw new Error('This administrator already exists; no changes made.');
    const password = randomBytes(24).toString('base64url');
    const hash = await hashAdminPassword(password);
    writeFileSync(file, `伍叁 AI 管理后台\n账号：${username}\n密码：${password}\n入口：/admin\n请保管此文件，不要提交到代码仓库或发到聊天。\n`, { flag: 'wx', mode: 0o600 });
    created = true;
    db.prepare('INSERT INTO admin_accounts VALUES (?,?,?)').run(username, hash, new Date().toISOString());
    console.log('Administrator created. Initial credentials are in the specified owner-only file.');
  } catch (error) {
    if (created) rmSync(file);
    console.error(error instanceof Error ? error.message : 'Could not create administrator.');
    process.exitCode = 1;
  } finally { db.close(); }
}
