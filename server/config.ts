import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from './environment.ts';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const environment = loadEnvironment(projectRoot);

const port = Number(process.env.API_PORT || 5182);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('API_PORT must be an integer between 1 and 65535.');

export const config = {
  host: process.env.API_HOST || '127.0.0.1',
  port,
  databasePath: resolve(projectRoot, process.env.DATABASE_PATH || 'server/data/store.sqlite'),
};
