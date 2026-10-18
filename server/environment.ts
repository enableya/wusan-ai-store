import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

// Explicit profiles never fall back to another profile's local configuration.
export function loadEnvironment(root: string, env: NodeJS.ProcessEnv = process.env) {
  const profile = env.WUSAN_PROFILE;
  if (profile && !['sandbox', 'production'].includes(profile)) throw new Error('WUSAN_PROFILE must be sandbox or production.');
  const production = profile === 'production' || env.NODE_ENV === 'production' || env.ALIPAY_ENV === 'production';
  let file: string | null = null;
  if (env.WUSAN_ENV_FILE) file = resolve(root, env.WUSAN_ENV_FILE);
  else if (profile === 'sandbox') file = resolve(root, '.env.sandbox.local');
  else if (!production && existsSync(resolve(root, '.env'))) file = resolve(root, '.env');
  if (file) {
    if (!existsSync(file)) throw new Error('Environment file is missing. Create the selected profile file or set WUSAN_ENV_FILE.');
    const values = parseEnv(readFileSync(file, 'utf8'));
    for (const [key, value] of Object.entries(values)) if (env[key] === undefined) env[key] = value;
  }
  if (profile && env.ALIPAY_ENV !== profile) throw new Error('Selected profile does not match ALIPAY_ENV; refusing to mix payment environments.');
  if ((production || env.NODE_ENV === 'production') && env.ALIPAY_ENV !== 'production') throw new Error('Production runtime requires ALIPAY_ENV=production.');
  if (file === resolve(root, '.env') && env.ALIPAY_ENV === 'production') throw new Error('Production configuration must be explicit; do not use the legacy .env file.');
  if ((profile || env.ALIPAY_ENV === 'production') && !env.DATABASE_PATH) throw new Error('A payment profile requires a separate DATABASE_PATH.');
  if (env.ALIPAY_ENV === 'production' && env.DATABASE_PATH && ['server/data/store.sqlite', 'server/data/sandbox.sqlite'].some(path => resolve(root, path) === resolve(root, env.DATABASE_PATH!))) {
    throw new Error('Production must not use the legacy or sandbox database.');
  }
  return { profile: profile || env.ALIPAY_ENV || 'sandbox', file };
}
