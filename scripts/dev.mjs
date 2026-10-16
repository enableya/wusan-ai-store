import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { config, projectRoot } from '../server/config.ts';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const api = spawn(process.execPath, ['server/index.ts'], { cwd: projectRoot, stdio: 'inherit' });
let vite;
let stopped = false;
function stop(code = 0) {
  if (stopped) return;
  stopped = true;
  api.kill();
  vite?.kill();
  process.exitCode = code;
}
api.once('error', (error) => { console.error(error.message); stop(1); });
api.once('exit', (code) => { if (!stopped) stop(code || 1); });
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

for (let attempt = 0; attempt < 50 && !stopped; attempt += 1) {
  await delay(100);
  if (api.exitCode !== null) break;
  try {
    const host = config.host === '0.0.0.0' ? '127.0.0.1' : config.host;
    const response = await fetch(`http://${host}:${config.port}/api/health`, { signal: AbortSignal.timeout(500) });
    if (!response.ok) continue;
    vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', ...args], {
      cwd: projectRoot, stdio: 'inherit',
    });
    vite.once('error', (error) => { console.error(error.message); stop(1); });
    vite.once('exit', (code) => { if (!stopped) stop(code || 0); });
    break;
  } catch { /* Wait for the API process to bind its port. */ }
}
if (!vite && !stopped) { console.error('API did not become ready.'); stop(1); }
