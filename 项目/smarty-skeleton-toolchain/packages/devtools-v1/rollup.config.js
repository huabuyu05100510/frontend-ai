import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';

export default [
  {
    input: 'src/devtools.ts',
    output: {
      file: 'dist/devtools.js',
      format: 'iife',
      name: 'SMARTY_DEVTOOLS',
      sourcemap: true,
    },
    plugins: [
      resolve(),
      commonjs(),
      json(),
      typescript({ tsconfig: './tsconfig.json' }),
      terser(),
    ],
  },
  {
    input: 'src/plugin/craPlugin.ts',
    output: {
      file: 'dist/craPlugin.cjs',
      format: 'cjs',
      sourcemap: true,
    },
    external: ['path', 'fs', 'os'],
    plugins: [
      resolve({ preferBuiltins: true }),
      commonjs(),
      json(),
      typescript({ tsconfig: './tsconfig.json' }),
    ],
  },
];