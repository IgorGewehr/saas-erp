import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    alias: {
      // Específico antes do genérico — espelha tsconfig paths (@/contracts/* → lib/contracts/*).
      '@/contracts': path.resolve(__dirname, 'lib/contracts'),
      '@': path.resolve(__dirname, '.'),
    },
  },
  resolve: {
    alias: {
      '@/contracts': path.resolve(__dirname, 'lib/contracts'),
      '@': path.resolve(__dirname, '.'),
    },
  },
});
