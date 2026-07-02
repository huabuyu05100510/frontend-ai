/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import { defineConfig } from 'tsup'

const umdBanner = `
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory()
    } else if (typeof define === 'function' && define.amd) {
        define([], factory)
    } else {
        root.CurrentTimePlugin = factory()
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    var module = { exports: {} }
    var exports = module.exports
`

const umdFooter = `
    return module.exports
})
`

export default defineConfig([
    {
        name: 'executor-bundle',
        entry: {
            executor: 'src/index.ts',
        },
        format: ['cjs'],
        target: 'es2020',
        platform: 'neutral',
        bundle: true,
        sourcemap: false,
        minify: false,
        dts: false,
        clean: true,
        outDir: 'dist',
        outExtension() {
            return {
                js: '.umd.js',
            }
        },
        banner: {
            js: umdBanner,
        },
        footer: {
            js: umdFooter,
        },
    },
    {
        name: 'type-definitions',
        entry: ['src/index.ts'],
        format: ['esm'],
        target: 'es2020',
        dts: {
            only: true,
            compilerOptions: {
                declaration: true,
                emitDeclarationOnly: true,
            },
        },
        clean: false,
        outDir: 'dist',
    },
])
