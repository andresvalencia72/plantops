import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.integration-spec.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    hookTimeout: 20_000,
    testTimeout: 20_000,
  },
});
