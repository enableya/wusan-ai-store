import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const staging = await mkdtemp(join(tmpdir(), 'wusan-deploy-'));
const bundle = join(staging, 'wusan-ai-store');
const files = [];

async function copy(relative) {
  const source = join(root, relative);
  const info = await lstat(source);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Expected a regular file: ${relative}`);
  const destination = join(bundle, relative);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  files.push({ path: relative.replaceAll('\\', '/'), sha256: createHash('sha256').update(await readFile(source)).digest('hex') });
}

async function copyTree(relative, include, recursive = false) {
  const info = await lstat(join(root, relative));
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Expected a regular directory: ${relative}`);
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not packaged: ${join(relative, entry.name)}`);
    if (entry.isDirectory()) {
      // Only compiled frontend assets are recursive; server/data is never traversed.
      if (recursive) await copyTree(join(relative, entry.name), include, true);
    } else if (include(entry.name)) await copy(join(relative, entry.name));
  }
}

try {
  await lstat(join(root, 'dist/index.html'));
  for (const relative of ['package.json', 'package-lock.json', 'scripts/run.mjs', 'scripts/node-runtime.mjs', 'scripts/profile.mjs',
    'deploy/production.env.example', 'deploy/frontend.env.example', 'deploy/wusan-api.service',
    'deploy/nginx-https.conf', 'deploy/nginx-preview.conf', 'deploy/sandbox.env.example', 'docs/deployment.md', 'docs/alipay.md', 'docs/admin.md']) await copy(relative);
  await copyTree('dist', () => true, true);
  for (const relative of ['server', 'server/seed', 'src/types']) {
    await copyTree(relative, name => name.endsWith('.ts') && !name.endsWith('.test.ts'));
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  await writeFile(join(bundle, 'release.json'), JSON.stringify({
    createdAt: new Date().toISOString(), node: '>=24',
    configuration: 'Use deploy/production.env.example with payments disabled for the initial deployment.',
    files,
  }, null, 2) + '\n');
  const outputDirectory = join(root, 'artifacts/deploy');
  await mkdir(outputDirectory, { recursive: true });
  const output = join(outputDirectory, `wusan-ai-store-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.tgz`);
  const tar = spawnSync('tar', ['-czf', output, '-C', staging, 'wusan-ai-store'], { encoding: 'utf8' });
  if (tar.status !== 0) throw new Error(`Could not create deployment archive: ${tar.stderr || tar.error?.message || 'tar failed'}`);
  console.log(`Deployment archive: ${output}`);
  console.log(`${files.length} files; local environment, sandbox credentials, dependencies and database are excluded.`);
} finally {
  // Only remove the private temporary directory created by this invocation.
  await rm(staging, { recursive: true, force: true });
}
