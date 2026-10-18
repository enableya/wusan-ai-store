import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [profile, action, ...args] = process.argv.slice(2);
const targets = { dev: 'scripts/dev.mjs', api: 'server/index.ts', check: 'server/payment-check.ts' };
if (!['sandbox', 'production'].includes(profile) || !Object.hasOwn(targets, action) || (profile === 'production' && action === 'dev')) {
  console.error('Usage: profile.mjs sandbox dev|check | production api|check');
  process.exitCode = 1;
} else {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const env = { ...process.env, WUSAN_PROFILE: profile };
  env.WUSAN_ENV_FILE ||= profile === 'sandbox' ? `${root}.env.sandbox.local` : '/etc/wusan-ai-store/production.env';
  if (profile === 'production') env.NODE_ENV = 'production';
  const child = spawn(process.execPath, [targets[action], ...args], { cwd: root, env, stdio: 'inherit' });
  const interrupt = () => child.kill('SIGINT');
  const terminate = () => child.kill('SIGTERM');
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  child.once('error', () => { console.error('Could not launch the selected profile.'); process.exitCode = 1; });
  child.once('exit', (code, signal) => {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
  });
}
