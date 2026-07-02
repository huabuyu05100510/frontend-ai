import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

export default [
  // Toolbar 打包
  {
    input: 'src/index.ts',
    output: [
      { file: 'dist/devtools.cjs.js', format: 'cjs', sourcemap: true },
      { file: 'dist/devtools.esm.js', format: 'esm', sourcemap: true },
      // { file: 'dist/devtools.umd.js', format: 'umd', name: 'DevTools', sourcemap: true }
    ],
    plugins: [
      resolve(),
      commonjs(),
      typescript({ tsconfig: './tsconfig.json' })
    ],
    external: []
  },

  // CLI 打包
  {
    input: 'src/cli.ts',
    output: [{ file: 'dist/cli.js', format: 'cjs', sourcemap: true }],
    plugins: [
      resolve(),
      commonjs(),
      typescript({ tsconfig: './tsconfig.json' })
    ],
    external: ['fs-extra', 'express', '@smarty-skeleton-toolchain/core', 'cors', 'path']
  },
   {
    input: 'src/index.ts', // 入口文件
    output: [{ file: 'dist/devtools.d.ts', format: 'es' }],
    plugins: [dts()]
  }
];
