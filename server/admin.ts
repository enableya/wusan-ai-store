import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { OrderError } from './orders.ts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key)));
export async function hashAdminPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${(await derive(password, salt)).toString('hex')}`;
}
async function verify(password: string, encoded: string) {
  const [method, salt, hash] = encoded.split(':');
  if (method !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(hash || '')) return false;
  return timingSafeEqual(await derive(password, salt), Buffer.from(hash, 'hex'));
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
    const session = db.prepare('SELECT username FROM admin_sessions WHERE token_hash = ? AND expires_at > ?').get(digest(value), new Date().toISOString());
    return session ? String(session.username) : null;
  }
  return {
    origin, current,
    session(request: IncomingMessage) {
      const username = current(request);
      return { configured: !!db.prepare('SELECT 1 FROM admin_accounts LIMIT 1').get(), authenticated: !!username, ...(username ? { username } : {}) };
    },
    require(request: IncomingMessage) {
      const user = current(request);
      if (!user) throw new OrderError(401, 'ADMIN_REQUIRED', '请先登录管理后台。');
      return user;
    },
    async login(request: IncomingMessage, response: ServerResponse, input: Record<string, unknown>) {
      if (typeof input.username !== 'string' || !/^[a-zA-Z0-9_-]{3,40}$/.test(input.username) || typeof input.password !== 'string' || input.password.length < 1 || input.password.length > 128) throw new OrderError(401, 'INVALID_LOGIN', '账号或密码不正确。');
      const row = db.prepare('SELECT password_hash FROM admin_accounts WHERE username = ?').get(input.username);
      const dummy = `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`;
      if (!await verify(input.password, row ? String(row.password_hash) : dummy) || !row) throw new OrderError(401, 'INVALID_LOGIN', '账号或密码不正确。');
      const value = randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ? OR token_hash = ?').run(new Date().toISOString(), digest(token(request)));
        db.prepare('INSERT INTO admin_sessions VALUES (?, ?, ?)').run(digest(value), input.username, expires);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      cookie(response, value, 8 * 60 * 60);
      return { configured: true, authenticated: true, username: input.username };
    },
    logout(request: IncomingMessage, response: ServerResponse) {
      db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(digest(token(request)));
      cookie(response, '', 0);
      return { authenticated: false };
    },
  };
}
