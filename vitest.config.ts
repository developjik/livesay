import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Some sandboxes ship without /etc/hosts, so "localhost" does not resolve;
  // pinning the dev-server host keeps `vitest run` working there and in CI alike.
  server: {
    host: '127.0.0.1',
    hmr: false,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
    api: false,
  },
});
