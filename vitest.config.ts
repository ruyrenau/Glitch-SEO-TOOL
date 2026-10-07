import path from 'path';
import { defineConfig } from 'vitest/config';

const pkg = (name: string) => path.resolve(__dirname, `packages/${name}/src/index.ts`);
const testDb = path.resolve(__dirname, '.tmp/test.db').split(path.sep).join('/');

export default defineConfig({
  resolve: {
    alias: {
      '@glitch/core': pkg('core'),
      '@glitch/config': pkg('config'),
      '@glitch/log-parser': pkg('log-parser'),
      '@glitch/crawler': pkg('crawler'),
      '@glitch/db': pkg('db'),
      '@glitch/schema-engine': pkg('schema-engine'),
      '@glitch/content-engine': pkg('content-engine'),
      '@glitch/connectors': pkg('connectors'),
      '@glitch/testing': path.resolve(__dirname, 'packages/testing/src/index.ts')
    }
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    globalSetup: ['./scripts/test-global-setup.ts'],
    env: { DATABASE_URL: `file:${testDb}`, DEMO_MODE: 'false', LOG_LEVEL: 'silent', NODE_ENV: 'test' },
    fileParallelism: false,
    testTimeout: 30_000
  }
});
