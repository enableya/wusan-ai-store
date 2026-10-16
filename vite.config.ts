import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { config } from './server/config';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', ...(mode === 'test' ? [] : ['**/server/**'])] },
    proxy: { '/api': { target: `http://127.0.0.1:${config.port}` } },
  },
  preview: { proxy: { '/api': { target: `http://127.0.0.1:${config.port}` } } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}));
