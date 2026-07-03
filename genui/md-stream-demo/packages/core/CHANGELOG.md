# Changelog

All notable changes to `@a2ui-stream/core` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-04

### Added
- `StreamPart` discriminated union: 9 part types across 4 families (text / tool-call / card / terminal).
- Type guards: `isTextDelta`, `isToolCallPart`, `isCardPart`, `isTerminal`.
- SSE wire `encodePart` / `decodePart` with identity property tests.
- `Part` factory namespace for safe part construction.
- `CardRegistry`: schema-driven card registration with strict mode.
- `ProviderAdapter` interface + `createMockProvider` for offline demos.
- `StreamConsumer` pure reducer + `consumeStream` with AbortSignal support.
- `runtime` layer: `runStream` + `resolveCardViews` for end-to-end business integration.
- `adapters/openai-compatible`: one implementation covering OpenAI / MiniMax / DeepSeek / Qwen / 豆包 / Kimi / GLM.
- `react` entry: `useA2UIStream` hook based on `useSyncExternalStore`.
- 70 vitest tests, including 3 property tests guarding the three cross-business invariants (stream-equivalence / partial-safe / abort-no-loss).
- Zero runtime dependencies. Framework-agnostic core; React is optional peer dependency.
