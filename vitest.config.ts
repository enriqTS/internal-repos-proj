import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      shared: resolve(__dirname, './shared/src'),
    },
  },
  test: {
    globals: true,
    include: ['**/*.{test,spec}.{ts,tsx}'],
  },
});
