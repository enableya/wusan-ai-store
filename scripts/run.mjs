import { spawn } from 'node:child_process';
import { delimiter, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectNodeRuntime } from './node-runtime.mjs';

// This entry point stays compatible with Node 16 so TypeScript is only loaded by Node 24+.
try {
  const runtime = selectNodeRuntime();
  const args = process.argv.slice(2);
  if (!args.length) throw new Error('Provide a Node.js script or option to run.');
  if (runtime !== process.execPath) console.log(`[Wusan] Using ${runtime}`);
  const child = spawn(runtime, args, {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    stdio: 'inherit',
    env: { ...process.env, PATH: `${dirname(runtime)}${delimiter}${process.env.PATH || ''}` },
  });
  const interrupt = () => child.kill('SIGINT');
  const terminate = () => child.kill('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  child.once('error', error => { console.error(error.message); process.exitCode = 1; });
  child.once('exit', (code, signal) => {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
  });
} catch (error) {
  console.error(`[Wusan] ${error.message}`);
  process.exitCode = 1;
}
