import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const envPath = resolve(projectRoot, '.env');
if (existsSync(envPath)) loadEnvFile(envPath);

const port = Number(process.env.API_PORT || 5182);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('API_PORT must be an integer between 1 and 65535.');

export const config = {
  host: process.env.API_HOST || '127.0.0.1',
  port,
  databasePath: resolve(projectRoot, process.env.DATABASE_PATH || 'server/data/store.sqlite'),
};
