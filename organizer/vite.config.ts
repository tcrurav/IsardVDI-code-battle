import { defineConfig } from 'vitest/config';
export default defineConfig({
  base: '/organizer/',
  server: { proxy: { '/api': 'http://127.0.0.1:8000' } },
  test: { environment: 'jsdom', restoreMocks: true },
});
