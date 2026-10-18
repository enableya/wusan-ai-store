import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { config, projectRoot } from '../server/config.ts';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
let clientPort = 5180;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--port') clientPort = Number(args[++index]);
  else if (args[index].startsWith('--port=')) clientPort = Number(args[index].slice(7));
}

function checkPort(port, host, label) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', (error) => reject(new Error(
      error.code === 'EADDRINUSE'
        ? `${label}端口 ${host}:${port} 已被占用。`
        : `${label}端口 ${host}:${port} 无法使用：${error.message}`,
    )));
    probe.listen({ port, host, exclusive: true }, () => probe.close(resolve));
  });
}

let api;
let vite;
let readyTimer;
let stopped = false;
function stop(code = 0) {
  if (stopped) return;
  stopped = true;
  clearTimeout(readyTimer);
  api?.kill();
  vite?.kill();
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

try {
  if (!Number.isInteger(clientPort) || clientPort < 1 || clientPort > 65535) {
    throw new Error('--port 必须是 1 到 65535 之间的整数。');
  }
  if (clientPort === config.port) throw new Error('前端和后端必须使用不同端口。');
  const checks = await Promise.allSettled([
    checkPort(clientPort, '127.0.0.1', '前端'),
    checkPort(config.port, config.host, '后端'),
  ]);
  const failures = checks.filter((result) => result.status === 'rejected');
  if (failures.length) {
    throw new Error(`${failures.map((result) => result.reason.message).join('\n')}\n`
      + '请在原启动终端按 Ctrl+C 停止旧服务，再重新运行 npm run dev。\n'
      + '若需同时运行多个实例，macOS/Linux 可执行：API_PORT=5184 npm run dev -- --port 5183\n'
      + 'Windows PowerShell：$env:API_PORT=5184; npm run dev -- --port 5183');
  }
  if (!stopped) {
    api = spawn(process.execPath, ['server/index.ts'], {
      cwd: projectRoot, stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });
    api.once('error', (error) => { console.error(error.message); stop(1); });
    api.once('exit', (code) => { if (!stopped) stop(code || 1); });
    readyTimer = setTimeout(() => { console.error('API did not become ready.'); stop(1); }, 10000);
    // Only this child can signal readiness; an old server's health response is insufficient.
    api.on('message', (message) => {
      if (message?.type !== 'ready' || vite || stopped) return;
      clearTimeout(readyTimer);
      api.disconnect();
      vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', ...args], {
        cwd: projectRoot, stdio: 'inherit',
      });
      vite.once('error', (error) => { console.error(error.message); stop(1); });
      vite.once('exit', (code) => { if (!stopped) stop(code ?? 1); });
    });
  }
} catch (error) {
  console.error(`[Wusan] ${error.message}`);
  stop(1);
}
