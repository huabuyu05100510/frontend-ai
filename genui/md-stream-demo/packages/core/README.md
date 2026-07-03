# @a2ui-stream/core

> Streaming UI protocol & SDK for LLM apps. Framework-agnostic core with property-test-protected invariants.

`@a2ui-stream/core` is a streaming-first protocol and SDK for rendering LLM output (text, function calls, structured cards) in any UI framework. It is designed as an open alternative to [Vercel AI SDK](https://sdk.vercel.ai/) and [AG-UI Protocol](https://docs.ag-ui.com/), with three differentiators: property-test-protected invariants, field-level tool-call streaming, and zero-dependency framework-agnostic core.

## Why

LLM output is non-deterministic, multi-step, and partial. Building the UI to consume it touches four pain points that every team solves from scratch:

1. **Parsing SSE streams** across chunk boundaries (line / event / UTF-8 multi-byte)
2. **Rendering partial JSON** for Function Calls before they are complete
3. **Canceling streams** without losing what's already been generated
4. **Switching LLM providers** without rewriting the rendering layer

This SDK provides a typed `StreamPart` protocol + reducer + adapter abstractions so business code only declares card schemas and gets the rest for free.

## Quick Start

```bash
npm install @a2ui-stream/core
# or
pnpm add @a2ui-stream/core
```

### 1. Declare a card (business code, one line)

```ts
import { defineCard } from '@a2ui-stream/core/registry';

defineCard({
  name: 'guide',
  component: GuideCard, // your React/Vue/Svelte component
  perfBudget: { cls: 0.05, ttftMs: 500 },
});
```

### 2. Pick a provider

```ts
import { createMiniMaxProvider } from '@a2ui-stream/core/adapters/openai-compatible';
// or createOpenAIProvider / createDeepSeekProvider / createQwenProvider / createMockProvider
const provider = createMiniMaxProvider(apiKey, 'MiniMax-Text-01');
```

### 3. Run a stream and resolve cards

```ts
import { runStream, resolveCardViews } from '@a2ui-stream/core/runtime';

const state = await runStream({
  provider,
  messages: [{ role: 'user', content: 'Plan a route from A to B' }],
  signal: ctrl.signal,
});

const views = resolveCardViews(state);
// views: [{ id, lang, body, parseable, data, def }]
// views[0].def.component is your GuideCard; render it with views[0].data
```

### 4. (React) Live binding

```tsx
import { useA2UIStream } from '@a2ui-stream/core/react';

function Chat() {
  const { state, cancel, isStreaming } = useA2UIStream({
    provider,
    messages,
    auto: true,
  });
  return (
    <div>
      <pre>{state.text}</pre>
      {Object.values(state.cards).map((c) => (
        <CardRenderer key={c.id} view={c} />
      ))}
      {isStreaming && <button onClick={cancel}>Stop</button>}
    </div>
  );
}
```

## API

### `protocol` — `@a2ui-stream/core/protocol`

```ts
type StreamPart =
  | { type: 'text-delta'; id: string; text: string }
  | { type: 'tool-call-start'; id: string; name: string }
  | { type: 'tool-call-arg-delta'; id: string; argName: string; argPartial: string }
  | { type: 'tool-call-end'; id: string; args: unknown }
  | { type: 'card-start'; id: string; lang: string }
  | { type: 'card-delta'; id: string; body: string }
  | { type: 'card-end'; id: string }
  | { type: 'error'; code: string; message: string; retryable?: boolean }
  | { type: 'done'; usage?: { inputTokens?: number; outputTokens?: number } };
```

- `Part.*` — factory functions for each part type
- `encodePart` / `decodePart` — SSE wire format
- `isTextDelta` / `isToolCallPart` / `isCardPart` / `isTerminal` — type guards

### `registry` — `@a2ui-stream/core/registry`

- `defineCard(def)` — register a card
- `getCard(name)` — look up by name
- `listCards()` — list all registered

### `provider` — `@a2ui-stream/core/provider`

- `ProviderAdapter` interface
- `createProvider(name, gen)` — quick adapter from a generator
- `createMockProvider(responder)` — slice string into text-delta

### `runtime` — `@a2ui-stream/core/runtime`

- `runStream({ provider, messages, signal, onPart })` — end-to-end
- `resolveCardViews(state)` — project cards into render-ready views
- `consumeStream(iter, { onPart, signal })` — low-level

### `react` — `@a2ui-stream/core/react`

- `useA2UIStream({ provider, messages, auto, externalSignal })`
  - React 18+ `useSyncExternalStore` based; no useState flicker
  - Auto-cancels on unmount

### `adapters/openai-compatible`

One implementation covering OpenAI / MiniMax / DeepSeek / Qwen / 豆包 / Kimi / GLM. All these providers share the OpenAI Chat Completions streaming protocol.

- `createOpenAICompatibleProvider(opts)` — full control
- `createOpenAIProvider(apiKey, model?)`
- `createMiniMaxProvider(apiKey, model?)`
- `createDeepSeekProvider(apiKey, model?)`
- `createQwenProvider(apiKey, model?)`

## Three Invariants (property-test protected)

| Invariant | Meaning | Test |
|---|---|---|
| **stream-equivalence** | Streaming `yield` + done == one-shot payload | seeded LCG, 10 seeds × arbitrary body |
| **partial-safe** | Any prefix renders without throwing | random prefix on every body |
| **abort-no-loss** | Already-yielded parts stay in state after abort | abort at arbitrary point |

These are not features — they are the cross-business quality baseline that every consumer inherits.

## Comparison

| Capability | Vercel AI SDK v5 | AG-UI Protocol | LangChain.js | **@a2ui-stream/core** |
|---|:---:|:---:|:---:|:---:|
| StreamPart discriminated union | ✅ | ✅ | ⚠️ | ✅ |
| Field-level tool-call streaming | ⚠️ args-level | ⚠️ args-level | ❌ | ✅ arg-name |
| Partial JSON safe rendering | ⚠️ external pkg | ❌ | ❌ | ✅ built-in |
| Cross-chunk UTF-8 / SSE | ⚠️ internal | ❌ | ❌ | ✅ inline |
| Card / component registry | ⚠️ generic | ✅ | ❌ | ✅ schema-driven |
| Framework-agnostic core | ✅ | ✅ | ✅ | ✅ zero-dep |
| Property-test invariants | ❌ | ❌ | ❌ | ✅ 3 invariants |
| Abort-no-loss guarantee | ⚠️ impl | ❌ | ⚠️ | ✅ explicit contract |
| Chinese LLM ecosystem | ❌ | ❌ | ❌ | ✅ 5 providers |

## Project Maturity

**0.1.0 — experimental.** API may change before 1.0. Not recommended for production without your own testing.

## License

[MIT](./LICENSE)
