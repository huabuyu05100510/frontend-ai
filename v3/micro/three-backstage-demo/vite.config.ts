import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shell': path.resolve(__dirname, 'src/shell'),
      '@modules': path.resolve(__dirname, 'src/modules'),
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@menu': path.resolve(__dirname, 'src/menu'),
      '@auth': path.resolve(__dirname, 'src/auth'),
      '@config': path.resolve(__dirname, 'src/config'),
      '@router': path.resolve(__dirname, 'src/router'),
    },
  },
  server: {
    port: 5180,
    host: '127.0.0.1',
    strictPort: false,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'system-a': ['./src/modules/system-a'],
          'system-b': ['./src/modules/system-b'],
          'system-c': ['./src/modules/system-c'],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**'],
    },
  },
});