import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    protocol: 'src/protocol.ts',
    CardRegistry: 'src/CardRegistry.ts',
    ProviderAdapter: 'src/ProviderAdapter.ts',
    StreamConsumer: 'src/StreamConsumer.ts',
    runtime: 'src/runtime.ts',
    react: 'src/react.ts',
    'adapters/openai-compatible': 'src/adapters/openai-compatible.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2020',
  platform: 'neutral',
  // React 是 peerDep；不打包进 dist
  external: ['react'],
});
