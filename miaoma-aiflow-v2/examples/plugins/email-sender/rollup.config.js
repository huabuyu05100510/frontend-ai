import commonjs from '@rollup/plugin-commonjs'
import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'

export default [
    // 执行器打包 (后端逻辑)
    {
        input: 'src/index.ts',
        output: {
            file: 'dist/executor.umd.js',
            format: 'umd',
            name: 'EmailSenderPlugin',
            exports: 'named',
            globals: {
                react: 'React',
            },
        },
        plugins: [
            resolve({
                browser: true,
            }),
            commonjs(),
            typescript({
                tsconfig: './tsconfig.json',
                declaration: true,
                declarationDir: 'dist',
            }),
        ],
        external: ['react'],
    },

    // 组件打包 (前端 UI)
    {
        input: 'src/components/index.tsx',
        output: {
            file: 'dist/components.umd.js',
            format: 'umd',
            name: 'EmailSenderComponents',
            exports: 'named',
            globals: {
                react: 'React',
                'react/jsx-runtime': 'jsxRuntime',
            },
        },
        plugins: [
            resolve({
                browser: true,
            }),
            commonjs(),
            typescript({
                tsconfig: './tsconfig.json',
                declaration: false,
            }),
        ],
        external: ['react', 'react/jsx-runtime'],
    },
]
