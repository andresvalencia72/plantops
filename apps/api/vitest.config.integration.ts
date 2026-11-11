import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    include: ['test/**/*.integration-spec.ts'],
    fileParallelism: false,
    hookTimeout: 20_000,
    testTimeout: 20_000,
  },
});
