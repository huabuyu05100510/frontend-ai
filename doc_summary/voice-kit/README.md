# voice-kit

> Cross-platform voice interaction platform — sedimented from real ByteDance / iFlytek voice products.
> Cross-platform: Web (PC + H5) + Electron + Taro mini-program (interfaces reserved).
> 10 voice scenarios · 4 technical pillars · 3 AI providers (Doubao / Zhipu / MiniMax).

## Pillars

1. **AudioWorklet + SharedArrayBuffer zero-copy ring buffer** — stable 20ms frame cadence under main-thread jank.
2. **`responseId`-gated Barge-in FSM + TLA+ formal spec** — atomic 4-step interrupt, no stale audio leak.
3. **`chunk_id` RTT echo protocol + HDR Histogram** — p99 error ≤1% at any sample size.
4. **Time-scheduled dual-AudioContext playback queue** — eliminates TTS gaps/clicks via `nextStartTime` monotonic scheduling.

## Scenarios (first phase)

- `scene-converse` — 豆包 AI 对话 (Barge-in)
- `scene-transcribe` — 飞书会议实时字幕 (long-session stability)
- `scene-input` — 输入法短语音 (VAD endpointing)

## Providers

- `provider-doubao` — 火山引擎 (ASR/TTS/Realtime)
- `provider-zhipu` — 智谱 GLM (ASR/TTS/LLM)
- `provider-minimax` — MiniMax (ASR/TTS/Realtime)

## Layout

```
voice-kit/
├── packages/
│   ├── core-*           Pure platform-agnostic core (types/utils/transport/observability/protocol)
│   ├── provider-*       AI provider adapters (Doubao/Zhipu/MiniMax)
│   ├── scene-*          Scenario orchestration (converse/transcribe/input)
│   ├── adapter-web      Browser implementations (AudioWorklet/SAB/AudioContext)
│   ├── react            Framework bindings
│   └── ui-headless      Unstyled UI primitives
└── apps/
    ├── gateway          Node.js signing gateway (HMAC + token issuance)
    └── playground-web   Vite + React demo
```

## Develop

```bash
pnpm install
pnpm dev           # start playground + gateway
pnpm test          # run all tests
pnpm typecheck     # tsc --noEmit across packages
```

Set credentials in `.env` (see `.env.example`).

## Status

🚧 Phase 1 — scaffold + 3 scenarios + 3 providers in progress.
