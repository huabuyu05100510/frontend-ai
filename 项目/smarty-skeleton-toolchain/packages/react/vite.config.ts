import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import path from 'path';

export default defineConfig({
  plugins: [react(), dts({ insertTypesEntry: true })],
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: 'SmartySkeleton',
      fileName: (format) => `index.${format}.js`,
      formats: ['es', 'umd']
    },
rollupOptions: {
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  output: {
    globals: { 
      react: 'React', 
      'react-dom': 'ReactDOM', 
      'react/jsx-runtime': 'jsxRuntime',
      'react/jsx-dev-runtime': 'jsxDevRuntime'
    }
  }
}}

});
