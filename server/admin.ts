import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { OrderError } from './orders.ts';
import { dummyPasswordHash, hashPassword, verifyPassword } from './passwords.ts';
import { adminPermissions, hasAdminPermission, impliedAdminPermissions } from '../src/types/admin.ts';
import type { AdminAccount, AdminPermission, AdminRole, AdminSession } from '../src/types/admin.ts';
export { hashPassword as hashAdminPassword } from './passwords.ts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const accountFields = 'username, role, permissions, created_at';
export const validAdminUsername = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{3,40}$/.test(value);
export const validNewAdminPassword = (value: unknown): value is string => typeof value === 'string' && value.length >= 10 && value.length <= 128;
const isPermission = (value: unknown): value is AdminPermission => typeof value === 'string' && Object.hasOwn(adminPermissions, value);

function fromRow(row: Record<string, unknown>): AdminAccount {
  const permissions: unknown = JSON.parse(String(row.permissions));
  return { username: String(row.username), role: row.role === 'super_admin' ? 'super_admin' : 'admin',
    permissions: Array.isArray(permissions) ? permissions.filter(isPermission) : [], createdAt: String(row.created_at) };
}

function readAccess(input: Record<string, unknown>): { role: AdminRole; permissions: AdminPermission[] } {
  const { role, permissions } = input;
  if ((role !== 'admin' && role !== 'super_admin') || !Array.isArray(permissions) || !permissions.every(isPermission)) {
    throw new OrderError(400, 'INVALID_ADMIN_ACCESS', '请选择有效的管理员角色和权限。');
  }
  const grants = role === 'admin' ? permissions : [];
  return { role, permissions: [...new Set([...grants, ...impliedAdminPermissions(grants)])] };
}

export function insertAdminAccount(db: DatabaseSync, username: string, passwordHash: string, role: AdminRole, permissions: AdminPermission[] = []) {
  return db.prepare(`INSERT INTO admin_accounts(username,password_hash,created_at,role,permissions) VALUES (?,?,?,?,?)
    ON CONFLICT(username) DO NOTHING`).run(username, passwordHash, new Date().toISOString(), role, JSON.stringify(permissions)).changes > 0;
}

function authenticated(account: AdminAccount): AdminSession {
  const { username, role, permissions } = account;
  return { configured: true, authenticated: true, username, role, permissions };
}

export function adminRepository(db: DatabaseSync, origin: string) {
  let secure = false;
  if (origin) {
    const url = new URL(origin);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('ADMIN_ORIGIN must be an HTTPS origin or a loopback development origin.');
    secure = url.protocol === 'https:';
  }
  const name = secure ? '__Host-wusan_admin' : 'wusan_admin';
  const cookie = (response: ServerResponse, token: string, age: number) => response.setHeader('Set-Cookie', `${name}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`);
  function token(request: IncomingMessage) {
    const matches = (request.headers.cookie || '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
    const value = matches.length === 1 ? matches[0].slice(name.length + 1) : '';
    return /^[a-f0-9]{64}$/.test(value) ? value : '';
  }
  function current(request: IncomingMessage) {
    const value = token(request);
    if (!value) return null;
    const row = db.prepare(`SELECT ${accountFields} FROM admin_accounts
      WHERE username = (SELECT username FROM admin_sessions WHERE token_hash = ? AND expires_at > ?)`)
      .get(digest(value), new Date().toISOString());
    return row ? fromRow(row) : null;
  }
  function requirePermission(request: IncomingMessage, permission: AdminPermission | 'users.manage') {
    const account = current(request);
    if (!account) throw new OrderError(401, 'ADMIN_REQUIRED', '请先登录管理后台。');
    if (!hasAdminPermission(account, permission)) throw new OrderError(403, 'ADMIN_PERMISSION_REQUIRED', '当前账号没有此操作权限。');
    return account;
  }
  function findAccount(username: string) {
    const row = db.prepare(`SELECT ${accountFields} FROM admin_accounts WHERE username = ?`).get(username);
    if (!row) throw new OrderError(404, 'ADMIN_NOT_FOUND', '管理员账号不存在。');
    return fromRow(row);
  }
  function changeOtherAccount<T>(request: IncomingMessage, username: string, change: (account: AdminAccount) => T) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const actor = requirePermission(request, 'users.manage');
      if (actor.username === username) throw new OrderError(409, 'ADMIN_SELF_UPDATE', '请由其他超级管理员管理当前登录账号。');
      const result = change(findAccount(username));
      db.exec('COMMIT');
      return result;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return {
    origin, current, requirePermission,
    session(request: IncomingMessage): AdminSession {
      const account = current(request);
      return account ? authenticated(account) : { configured: !!db.prepare('SELECT 1 FROM admin_accounts LIMIT 1').get(), authenticated: false };
    },
    listAccounts() {
      return db.prepare(`SELECT ${accountFields} FROM admin_accounts ORDER BY created_at, username`).all().map(fromRow);
    },
    async createAccount(request: IncomingMessage, input: Record<string, unknown>) {
      const { username, password } = input;
      if (!validAdminUsername(username) || !validNewAdminPassword(password)) {
        throw new OrderError(400, 'INVALID_ADMIN_ACCOUNT', '账号需为 3–40 位字母、数字、下划线或短横线，密码需为 10–128 位。');
      }
      const { role, permissions } = readAccess(input);
      const hash = await hashPassword(password);
      requirePermission(request, 'users.manage');
      if (!insertAdminAccount(db, username, hash, role, permissions)) throw new OrderError(409, 'ADMIN_EXISTS', '此管理员账号已存在。');
      return findAccount(username);
    },
    updateAccess(request: IncomingMessage, username: string, input: Record<string, unknown>) {
      const { role, permissions } = readAccess(input);
      return changeOtherAccount(request, username, () => {
        db.prepare('UPDATE admin_accounts SET role = ?, permissions = ? WHERE username = ?').run(role, JSON.stringify(permissions), username);
        return findAccount(username);
      });
    },
    deleteAccount(request: IncomingMessage, username: string, input: Record<string, unknown>) {
      return changeOtherAccount(request, username, account => {
        if (input.createdAt !== account.createdAt) throw new OrderError(409, 'ADMIN_ACCOUNT_CHANGED', '账号已变更，请刷新列表后重试。');
        db.prepare('DELETE FROM admin_accounts WHERE username = ?').run(username);
        return { deleted: true };
      });
    },
    async login(request: IncomingMessage, response: ServerResponse, input: Record<string, unknown>) {
      if (!validAdminUsername(input.username) || typeof input.password !== 'string' || input.password.length < 1 || input.password.length > 128) throw new OrderError(401, 'INVALID_LOGIN', '账号或密码不正确。');
      const row = db.prepare('SELECT password_hash FROM admin_accounts WHERE username = ?').get(input.username);
      if (!await verifyPassword(input.password, row ? String(row.password_hash) : dummyPasswordHash) || !row) throw new OrderError(401, 'INVALID_LOGIN', '账号或密码不正确。');
      const value = randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
      db.exec('BEGIN IMMEDIATE');
      let account: AdminAccount;
      try {
        const currentHash = db.prepare('SELECT password_hash FROM admin_accounts WHERE username = ?').get(input.username)?.password_hash;
        if (currentHash !== row.password_hash) throw new OrderError(401, 'INVALID_LOGIN', '账号或密码不正确。');
        account = findAccount(input.username);
        db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ? OR token_hash = ?').run(new Date().toISOString(), digest(token(request)));
        db.prepare('INSERT INTO admin_sessions VALUES (?, ?, ?)').run(digest(value), input.username, expires);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      cookie(response, value, 8 * 60 * 60);
      return authenticated(account);
    },
    logout(request: IncomingMessage, response: ServerResponse) {
      db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(digest(token(request)));
      cookie(response, '', 0);
      return { authenticated: false };
    },
  };
}
