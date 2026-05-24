import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'bridge/test/**/*.test.ts'],
    environment: 'node',
  },
});
