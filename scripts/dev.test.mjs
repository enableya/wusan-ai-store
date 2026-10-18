import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

async function reserve(t) {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { server, port: server.address().port };
}

async function launch(t, apiPort, clientPort, extraEnv = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'wusan-dev-'));
  const child = spawn(process.execPath, ['scripts/dev.mjs', '--port', String(clientPort)], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, API_HOST: '127.0.0.1', API_PORT: String(apiPort), DATABASE_PATH: join(dir, 'store.sqlite'), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const closed = once(child, 'close');
  const deadline = setTimeout(() => child.kill(), 20000);
  t.after(async () => {
    child.kill();
    await closed;
    clearTimeout(deadline);
    await rm(dir, { recursive: true, force: true });
  });
  return { child, closed, output: () => output };
}

for (const occupied of ['client', 'api', 'both']) {
  test(`reports ${occupied} port conflicts before starting either child`, { timeout: 25000 }, async t => {
    const api = await reserve(t);
    const client = await reserve(t);
    if (occupied === 'client') await new Promise(resolve => api.server.close(resolve));
    if (occupied === 'api') await new Promise(resolve => client.server.close(resolve));
    const dev = await launch(t, api.port, client.port);
    const [code] = await dev.closed;
    assert.equal(code, 1, dev.output());
    if (occupied !== 'client') assert.match(dev.output(), new RegExp(`后端端口 127.0.0.1:${api.port} 已被占用`));
    if (occupied !== 'api') assert.match(dev.output(), new RegExp(`前端端口 127.0.0.1:${client.port} 已被占用`));
    assert.match(dev.output(), /API_PORT=5184 npm run dev -- --port 5183/);
    assert.doesNotMatch(dev.output(), /Wusan API:|VITE v|EADDRINUSE/);
    if (occupied !== 'client') assert.equal(api.server.listening, true);
    if (occupied !== 'api') assert.equal(client.server.listening, true);
  });
}

test('starts the frontend and API proxy, rejects a duplicate, and releases both ports on shutdown', { timeout: 25000 }, async t => {
  const api = await reserve(t);
  const client = await reserve(t);
  await Promise.all([api, client].map(({ server }) => new Promise(resolve => server.close(resolve))));
  const dev = await launch(t, api.port, client.port);
  const url = `http://127.0.0.1:${client.port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(300) });
      if (response.ok) { ready = true; break; }
    } catch { /* Wait for Vite and the API proxy. */ }
    if (dev.child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, dev.output());
  assert.match(await (await fetch(url)).text(), /<div id="root">/);
  const duplicate = await launch(t, api.port, client.port);
  assert.equal((await duplicate.closed)[0], 1, duplicate.output());
  assert.match(duplicate.output(), /前端端口/);
  assert.match(duplicate.output(), /后端端口/);
  assert.equal((await fetch(`${url}/api/health`)).status, 200);
  dev.child.kill('SIGTERM');
  assert.equal((await dev.closed)[0], 0, dev.output());
  for (const port of [api.port, client.port]) {
    const probe = createServer();
    probe.listen(port, '127.0.0.1');
    await once(probe, 'listening');
    await new Promise(resolve => probe.close(resolve));
  }
});

test('does not start Vite if the new API fails to initialize', { timeout: 25000 }, async t => {
  const api = await reserve(t);
  const client = await reserve(t);
  await Promise.all([api, client].map(({ server }) => new Promise(resolve => server.close(resolve))));
  const dev = await launch(t, api.port, client.port, { DATABASE_PATH: tmpdir() });
  assert.equal((await dev.closed)[0], 1, dev.output());
  assert.doesNotMatch(dev.output(), /VITE v|Local:/);
});
