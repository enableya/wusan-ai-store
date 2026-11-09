import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const directory = await mkdtemp(join(tmpdir(), 'wusan-order-tests-'));
try {
  const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.storefront.config.ts', 'orders.spec.ts', ...process.argv.slice(2)], {
    stdio: 'inherit', env: { ...process.env, E2E_DATABASE_PATH: join(directory, 'store.sqlite') },
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
  process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
} finally { await rm(directory, { recursive: true, force: true }); }
