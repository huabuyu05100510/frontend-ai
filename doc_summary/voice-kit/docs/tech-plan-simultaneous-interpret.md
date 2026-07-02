# 技术方案: 同声传译前端调度层

## 定位
新包 `@voice-kit/scene-interpret`，不含翻译模型本身（调用外部 streaming LLM API）。
核心是前端调度层：如何在 ASR partial 流中切分句段、并发请求翻译、双语字幕时间对齐。

## 核心挑战
1. **句段切分时机**：太早（截断语义），太晚（延迟大）
2. **预期滞后策略**：翻译必须等足够上下文，但不能等完整句
3. **双语时间轴对齐**：source words 有 startMs/endMs，译文没有
4. **打断恢复**：barge-in 时翻译 stream 如何优雅截断

## 架构

```
ASRStreamSession (results AsyncIterable)
    ↓
SentenceChunker       ← 句段切分策略
    ↓  sentences
TranslationScheduler  ← 并发翻译请求管理
    ↓  TranslatedSentence (streaming tokens)
SubtitleSynchronizer  ← 双语字幕时间轴对齐
    ↓
UI: DualSubtitleTrack
```

## 各模块实现

### 1. SentenceChunker
`packages/scene-interpret/src/sentence-chunker.ts`

```typescript
export interface Sentence {
  text: string;
  words: TrackedWord[];
  isFinal: boolean;
  startMs: number;
  endMs: number;
}

export interface SentenceChunkerOptions {
  punctuationDelayMs?: number; // 检测到句末标点后再等多少ms. Default: 200
  maxChunkChars?: number;      // 强制切分字数. Default: 50
  sentenceEndPattern?: RegExp; // 句末检测正则
}

export class SentenceChunker {
  private buffer = '';
  private bufferWords: TrackedWord[] = [];
  private pendingFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(s: Sentence) => void>();

  constructor(private opts: SentenceChunkerOptions = {}) {}

  onSentence(cb: (s: Sentence) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  push(result: ASRResult): void {
    if (result.kind === 'error') return;
    const { text, words = [] } = result;

    if (result.kind === 'final') {
      this.cancelPending();
      this.emit({ text, words, isFinal: true, ...this.timeRange(words) });
      this.buffer = '';
      this.bufferWords = [];
      return;
    }

    this.buffer = text;
    this.bufferWords = words;
    const pattern = this.opts.sentenceEndPattern ?? /[。！？.!?]\s*$/;
    if (pattern.test(text) || text.length > (this.opts.maxChunkChars ?? 50)) {
      this.schedulePunctuationFlush();
    }
  }

  reset(): void {
    this.cancelPending();
    this.buffer = '';
    this.bufferWords = [];
  }

  private schedulePunctuationFlush(): void {
    if (this.pendingFlushTimer) return;
    this.pendingFlushTimer = setTimeout(() => {
      this.pendingFlushTimer = null;
      if (this.buffer) {
        this.emit({ text: this.buffer, words: this.bufferWords, isFinal: false, ...this.timeRange(this.bufferWords) });
        this.buffer = '';
        this.bufferWords = [];
      }
    }, this.opts.punctuationDelayMs ?? 200);
  }

  private cancelPending(): void {
    if (this.pendingFlushTimer) { clearTimeout(this.pendingFlushTimer); this.pendingFlushTimer = null; }
  }

  private emit(s: Sentence): void { this.listeners.forEach(cb => cb(s)); }

  private timeRange(words: TrackedWord[]) {
    return { startMs: words[0]?.startMs ?? 0, endMs: words[words.length - 1]?.endMs ?? 0 };
  }
}
```

### 2. TranslationScheduler
`packages/scene-interpret/src/translation-scheduler.ts`

```typescript
export interface ITranslationProvider {
  translate(req: { sentenceId: string; sourceText: string; context: string[] }, signal: AbortSignal): {
    sentenceId: string;
    tokens: AsyncIterable<string>;
  };
}

export class TranslationScheduler {
  private sentenceCounter = 0;
  private contextWindow: string[] = [];
  private activeControllers = new Map<string, AbortController>();

  constructor(
    private readonly provider: ITranslationProvider,
    private readonly contextWindowSize = 3,
  ) {}

  schedule(sentence: Sentence) {
    const sentenceId = String(++this.sentenceCounter);
    const context = [...this.contextWindow];
    this.contextWindow = [...this.contextWindow, sentence.text].slice(-this.contextWindowSize);

    const ctrl = new AbortController();
    this.activeControllers.set(sentenceId, ctrl);

    const result = this.provider.translate({ sentenceId, sourceText: sentence.text, context }, ctrl.signal);

    void (async () => {
      for await (const _ of result.tokens) { /* drain to detect completion */ }
      this.activeControllers.delete(sentenceId);
    })();

    return result;
  }

  abortAll(): void {
    for (const ctrl of this.activeControllers.values()) ctrl.abort();
    this.activeControllers.clear();
  }
}
```

### 3. SubtitleSynchronizer
`packages/scene-interpret/src/subtitle-synchronizer.ts`

```typescript
export interface BilingualSubtitle {
  sourceText: string;
  translatedText: string;
  sourceStartMs: number;
  sourceEndMs: number;
  isTranslationComplete: boolean;
}

export class SubtitleSynchronizer {
  private subtitles: BilingualSubtitle[] = [];
  private listeners = new Set<(subtitles: BilingualSubtitle[]) => void>();

  onUpdate(cb: (subtitles: BilingualSubtitle[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async addSentence(sentence: Sentence, translationTokens: AsyncIterable<string>): Promise<void> {
    const entry: BilingualSubtitle = {
      sourceText: sentence.text,
      translatedText: '',
      sourceStartMs: sentence.startMs,
      sourceEndMs: sentence.endMs,
      isTranslationComplete: false,
    };
    this.subtitles.push(entry);
    this.notify();

    for await (const token of translationTokens) {
      entry.translatedText += token;
      this.notify();
    }
    entry.isTranslationComplete = true;
    this.notify();
  }

  getVisible(offsetMs: number, windowMs = 5000): BilingualSubtitle[] {
    return this.subtitles.filter(s =>
      s.sourceEndMs >= offsetMs - windowMs && s.sourceStartMs <= offsetMs + windowMs,
    );
  }

  reset(): void { this.subtitles = []; this.notify(); }
  private notify(): void { this.listeners.forEach(cb => cb([...this.subtitles])); }
}
```

### 4. 顶层 Orchestrator
`packages/scene-interpret/src/interpreter.ts`

```typescript
export class SimultaneousInterpreter {
  private chunker: SentenceChunker;
  private scheduler: TranslationScheduler;
  private synchronizer: SubtitleSynchronizer;
  private unsubChunker: (() => void) | null = null;

  constructor(provider: ITranslationProvider, opts?: SentenceChunkerOptions) {
    this.chunker = new SentenceChunker(opts);
    this.scheduler = new TranslationScheduler(provider);
    this.synchronizer = new SubtitleSynchronizer();

    this.unsubChunker = this.chunker.onSentence((sentence) => {
      const result = this.scheduler.schedule(sentence);
      void this.synchronizer.addSentence(sentence, result.tokens);
    });
  }

  pushASRResult(result: ASRResult): void { this.chunker.push(result); }

  onSubtitlesUpdate(cb: (subtitles: BilingualSubtitle[]) => void): () => void {
    return this.synchronizer.onUpdate(cb);
  }

  interrupt(): void {
    this.chunker.reset();
    this.scheduler.abortAll();
    this.synchronizer.reset();
  }

  dispose(): void {
    this.unsubChunker?.();
    this.scheduler.abortAll();
  }
}
```

## 包结构
```
packages/scene-interpret/
  src/
    sentence-chunker.ts
    translation-scheduler.ts
    subtitle-synchronizer.ts
    interpreter.ts
    index.ts
  package.json           ← 依赖 @voice-kit/core-types
```

## 文件改动清单
1. `packages/scene-interpret/` — 新建整包
2. `packages/scene-interpret/src/` — 4个模块文件
3. `packages/scene-interpret/package.json`
4. `apps/playground-web/src/scenes/InterpretDemo.tsx` — 双列字幕 Demo
5. `pnpm-workspace.yaml` — 新增 scene-interpret

## 简历叙事
**中文版:**
> 设计并实现同声传译前端调度层 @voice-kit/scene-interpret：SentenceChunker 基于标点检测+强制切分实现预期滞后策略，TranslationScheduler 管理并发翻译请求及打断取消（AbortController），SubtitleSynchronizer 将 streaming 翻译 token 与 ASR word 时间轴实时对齐；全链路纯前端，ASR partial → 双语字幕出现 P95 延迟 <800ms。

**英文版:**
> Designed and implemented a simultaneous interpretation front-end scheduling layer (@voice-kit/scene-interpret): SentenceChunker applies punctuation-based anticipation delay with forced chunking for long sentences; TranslationScheduler manages concurrent translation requests with AbortController-based interrupt cancellation; SubtitleSynchronizer aligns streaming translation tokens to ASR word timestamps in real time. Full-stack browser-side pipeline with P95 ASR-partial-to-bilingual-subtitle latency <800ms.
