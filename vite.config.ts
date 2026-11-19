import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/fotos-pdf/',
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  test: { include: ['tests/**/*.test.ts'] },
});
