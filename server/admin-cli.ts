import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { isAbsolute, relative, sep } from 'node:path';
import { config, projectRoot } from './config.ts';
import { openDatabase } from './database.ts';
import { insertAdminAccount, validAdminUsername, validNewAdminPassword } from './admin.ts';
import { hashPassword, verifyPassword } from './passwords.ts';

const [action, username, flag, file, ...extra] = process.argv.slice(2);
const fromStdin = flag === '--password-stdin' && file === undefined;
if (action !== 'create' || !validAdminUsername(username) || extra.length || (!fromStdin && (flag !== '--credentials-file' || !file))) {
  console.error('Usage: npm run admin -- create USERNAME --credentials-file /protected/path.txt | --password-stdin');
  process.exitCode = 1;
} else {
  const db = openDatabase(config.databasePath);
  let created = false;
  try {
    const password = fromStdin ? readFileSync(0, 'utf8').replace(/\r?\n$/, '') : randomBytes(24).toString('base64url');
    if (!validNewAdminPassword(password)) throw new Error('The password must contain 10–128 characters.');
    const existing = db.prepare('SELECT role, password_hash FROM admin_accounts WHERE username = ?').get(username);
    if (existing) {
      if (!fromStdin || existing.role !== 'super_admin' || !await verifyPassword(password, String(existing.password_hash))) {
        throw new Error('This administrator already exists; no changes made.');
      }
      console.log('Super administrator already initialized.');
    } else {
      const hash = await hashPassword(password);
      if (!fromStdin) {
        const location = relative(projectRoot, file);
        if (!isAbsolute(file) || !(location === '..' || location.startsWith(`..${sep}`) || isAbsolute(location))) throw new Error('Credentials must be written to an absolute path outside the project directory.');
        writeFileSync(file, `伍叁 AI 管理后台\n账号：${username}\n密码：${password}\n入口：/admin\n请保管此文件，不要提交到代码仓库或发到聊天。\n`, { flag: 'wx', mode: 0o600 });
        created = true;
      }
      if (!insertAdminAccount(db, username, hash, 'super_admin')) throw new Error('This administrator already exists; no changes made.');
      console.log(fromStdin ? 'Super administrator initialized.' : 'Administrator created. Initial credentials are in the specified owner-only file.');
    }
  } catch (error) {
    if (created) rmSync(file);
    console.error(error instanceof Error ? error.message : 'Could not create administrator.');
    process.exitCode = 1;
  } finally { db.close(); }
}
