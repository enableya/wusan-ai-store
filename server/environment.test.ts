import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from './environment.ts';

function workspace(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), 'wusan-environment-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, '.env'), 'ALIPAY_ENV=sandbox\nALIPAY_ENABLED=true\nDATABASE_PATH=server/data/store.sqlite\n');
  return root;
}

test('production runtime never inherits sandbox values from the legacy .env', t => {
  const root = workspace(t);
  const env = { NODE_ENV: 'production', ALIPAY_ENV: 'production', ALIPAY_ENABLED: 'false', DATABASE_PATH: '/var/lib/wusan-ai-store/store.sqlite' };
  assert.equal(loadEnvironment(root, env).file, null);
  assert.equal(env.ALIPAY_ENABLED, 'false');
  assert.throws(() => loadEnvironment(root, { NODE_ENV: 'production' }), /ALIPAY_ENV=production/);
});

test('explicit sandbox file isolates the database and fails closed when missing or mismatched', t => {
  const root = workspace(t);
  assert.throws(() => loadEnvironment(root, { WUSAN_PROFILE: 'sandbox' }), /missing/);
  writeFileSync(join(root, '.env.sandbox.local'), 'ALIPAY_ENV=sandbox\nDATABASE_PATH=server/data/sandbox.sqlite\n');
  const env: NodeJS.ProcessEnv = { WUSAN_PROFILE: 'sandbox' };
  loadEnvironment(root, env);
  assert.equal(env.DATABASE_PATH, 'server/data/sandbox.sqlite');
  assert.throws(() => loadEnvironment(root, { WUSAN_PROFILE: 'sandbox', ALIPAY_ENV: 'production' }), /does not match/);
});

test('explicit files preserve process overrides and production refuses shared databases', t => {
  const root = workspace(t);
  writeFileSync(join(root, 'production.env'), 'ALIPAY_ENV=production\nALIPAY_ENABLED=false\nDATABASE_PATH=/var/lib/wusan-ai-store/store.sqlite\n');
  const env: NodeJS.ProcessEnv = { WUSAN_PROFILE: 'production', WUSAN_ENV_FILE: 'production.env', ALIPAY_ENABLED: 'true' };
  loadEnvironment(root, env);
  assert.equal(env.ALIPAY_ENABLED, 'true');
  for (const path of ['server/data/store.sqlite', 'server/data/sandbox.sqlite']) {
    assert.throws(() => loadEnvironment(root, { ...env, DATABASE_PATH: path }), /database/);
  }
  assert.throws(() => loadEnvironment(root, { WUSAN_PROFILE: 'staging' }), /WUSAN_PROFILE/);
  assert.throws(() => loadEnvironment(root, { WUSAN_PROFILE: 'production', ALIPAY_ENV: 'production' }), /DATABASE_PATH/);
  assert.throws(() => loadEnvironment(root, { ALIPAY_ENV: 'production' }), /DATABASE_PATH/);
});

test('production preflight reports absent key files without exposing inline secrets or creating a database', t => {
  const root = workspace(t);
  const secret = 'DO_NOT_PRINT_THIS_PRIVATE_VALUE';
  const file = join(root, 'production.env');
  const database = join(root, 'production.sqlite');
  writeFileSync(file, `ALIPAY_ENV=production\nALIPAY_ENABLED=false\nDATABASE_PATH=${database}\nPUBLIC_SITE_URL=https://store.example.com\nALIPAY_NOTIFY_URL=https://store.example.com/api/payments/alipay/notify\nALIPAY_APP_ID=2021000000000001\nALIPAY_SELLER_ID=2088000000000001\nALIPAY_PRIVATE_KEY=${secret}\nALIPAY_PRIVATE_KEY_PATH=${root}/missing.key\n`, { mode: 0o600 });
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./payment-check.ts', import.meta.url))], {
    env: { PATH: process.env.PATH, WUSAN_PROFILE: 'production', WUSAN_ENV_FILE: file }, encoding: 'utf8',
  });
  assert.equal(child.status, 1, child.stderr);
  const report = JSON.parse(child.stdout);
  assert.equal(report.configurationChecksPassed, false);
  assert.equal(report.environment, 'production');
  assert.ok(report.checks.some((check: { name: string; passed: boolean }) => check.name === 'private_key_file' && !check.passed));
  assert.doesNotMatch(child.stdout + child.stderr, new RegExp(secret));
  assert.throws(() => statSync(database));
});
