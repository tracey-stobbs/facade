import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    setupFiles: path.resolve(__dirname, 'tests', 'setup', 'cleanup.ts'),
    exclude: ['dist/**'], // exclude compiled test artifacts
    testTimeout: 15000,
  }
});
