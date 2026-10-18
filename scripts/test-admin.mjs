import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const directory = await mkdtemp(join(tmpdir(), 'wusan-admin-e2e-'));
try {
  const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.admin.config.ts'], {
    cwd: new URL('../', import.meta.url), stdio: 'inherit', env: { ...process.env, E2E_ADMIN_DB: join(directory, 'store.sqlite') },
  });
  const stop = () => child.kill('SIGTERM');
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  process.exitCode = code ?? 1;
} finally { await rm(directory, { recursive: true, force: true }); }
