import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

function readVersion(binary) {
  const result = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 3000, windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : '';
}

export function selectNodeRuntime({
  env = process.env, executable = process.execPath, version = process.version,
  home = homedir(), platform = process.platform, probe = readVersion,
} = {}) {
  const supported = value => /^v(\d+)\./.test(value) && Number(value.match(/^v(\d+)\./)[1]) >= 24;
  if (env.WUSAN_NODE_BINARY) {
    if (supported(probe(env.WUSAN_NODE_BINARY))) return env.WUSAN_NODE_BINARY;
    throw new Error('WUSAN_NODE_BINARY must point to a working Node.js 24 or later executable.');
  }
  if (supported(version)) return executable;
  const name = platform === 'win32' ? 'node.exe' : 'node';
  const candidates = [
    join(home, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'bin', name),
    ...(env.PATH || '').split(platform === 'win32' ? ';' : delimiter).filter(Boolean).map(dir => join(dir, name)),
  ];
  for (const candidate of new Set(candidates)) {
    if (candidate !== executable && supported(probe(candidate))) return candidate;
  }
  throw new Error(`Node.js 24 or later is required; the current runtime is ${version}. Install Node.js 24, or set WUSAN_NODE_BINARY to its executable, then rerun this command.`);
}
