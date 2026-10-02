import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'apps/**/src/**/*.{ts,tsx}',
        'apps/web/components/**/*.{ts,tsx}',
        'apps/web/lib/**/*.ts',
        'apps/web/app/**/*.{ts,tsx}',
        'packages/**/src/**/*.ts',
        'tools/**/*.ts',
      ],
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
    },
  },
});
