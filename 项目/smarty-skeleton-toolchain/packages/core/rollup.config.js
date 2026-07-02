// core/rollup.config.js
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

export default [
  // JS 打包
  {
    input: 'src/index.ts',
    output: [
      { file: 'dist/index.esm.js', format: 'esm', sourcemap: true, generatedCode: { symbols: true } },
      { file: 'dist/index.cjs.js', format: 'cjs', sourcemap: true, interop: 'auto', generatedCode: { symbols: true } },
      { file: 'dist/index.umd.js', format: 'umd', name: 'Core', sourcemap: true, interop: 'auto', generatedCode: { symbols: true } }
    ],
    plugins: [
      resolve(),
      commonjs(),
      typescript({ tsconfig: './tsconfig.json' })
    ],
    external: []
  },

  // 类型声明
  {
    input: 'src/index.ts',
    output: [{ file: 'dist/core.d.ts', format: 'es' }],
    plugins: [dts()]
  }
];
