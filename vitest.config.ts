import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Use forks (child_process) instead of threads (worker_threads).
    // better-sqlite3 is a native addon that cannot load in worker_threads
    // because the ABI differs from what vitest embeds. Fork pool inherits
    // the same Node binary and works cleanly with native modules.
    pool: 'forks',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
  resolve: {
    alias: {
      '@': './src',
    },
  },
});
