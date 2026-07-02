# 技术方案: SessionRecorder 完整化

## 现状
`packages/adapter-web/src/session-recorder.ts` 已有骨架：
- SessionRecorder<A>: record(action, audioChunk?) fire-and-forget
- SessionReplayer<A>: replay(reducer, initialState) → 确定性回放
- listSessions() 静态方法

## 缺失部分
1. **UI 播放控制器**：无法在 playground 里可视化回放
2. **音频回放**：replay 只跑 reducer，没有把 audioChunk 送回播放器
3. **会话列表管理**：无法删除/导出/导入
4. **压测模式**：无法加速回放（x2/x5/x100）用于 stress test
5. **断点调试**：无法在回放中暂停、步进单条 action

## 完整实现方案

### 增强 SessionReplayer
`packages/adapter-web/src/session-recorder.ts` (补充 replayWithControl 方法)

```typescript
export interface ReplayOptions<S, A> {
  realtime?: boolean;   // 按原始时间间隔. Default: true
  speed?: number;       // 回放速度倍率. Default: 1
  onBeforeAction?: (action: A, state: S, index: number) => boolean | Promise<boolean>;
  onAfterAction?: (action: A, state: S, index: number) => void;
  onAudioChunk?: (chunk: ArrayBuffer, timestamp: number) => void;
  signal?: AbortSignal;
}

// 在 SessionReplayer 中补充:
async replayWithControl<S>(
  reducer: (state: S, action: A) => S,
  initialState: S,
  opts: ReplayOptions<S, A> = {},
): Promise<S> {
  const events = await this.loadEvents();
  let state = initialState;
  let prevTs = events[0]?.timestamp ?? Date.now();

  for (let i = 0; i < events.length; i++) {
    if (opts.signal?.aborted) break;

    const ev = events[i];

    // 实时延迟
    if (opts.realtime !== false && i > 0) {
      const delay = (ev.timestamp - prevTs) / (opts.speed ?? 1);
      await new Promise<void>((r) => setTimeout(r, delay));
    }
    prevTs = ev.timestamp;

    // 断点回调
    if (opts.onBeforeAction) {
      const shouldContinue = await opts.onBeforeAction(ev.action, state, i);
      if (!shouldContinue) break;
    }

    state = reducer(state, ev.action);

    if (ev.audioChunk && opts.onAudioChunk) {
      opts.onAudioChunk(ev.audioChunk, ev.timestamp);
    }

    opts.onAfterAction?.(ev.action, state, i);
  }

  return state;
}

// 会话管理
static async deleteSession(storage: IStorage, sessionId: string): Promise<void> {
  // 删除该 sessionId 的所有 events + meta
}

static async exportSession(storage: IStorage, sessionId: string): Promise<Blob> {
  // 序列化为 JSON blob，含 meta + events + audio chunks (base64)
}

static async importSession(storage: IStorage, blob: Blob): Promise<string> {
  // 解析导入，写入 IndexedDB，返回新 sessionId
}
```

### React Hook: useSessionReplay
`apps/playground-web/src/hooks/useSessionReplay.ts`

```typescript
export function useSessionReplay<S, A>(
  sessionId: string,
  reducer: (s: S, a: A) => S,
  initialState: S,
) {
  const [state, setState] = useState(initialState);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<'idle' | 'playing' | 'paused' | 'done'>('idle');
  const [speed, setSpeed] = useState(1);
  const abortRef = useRef<AbortController | null>(null);

  const play = useCallback(async () => {
    abortRef.current = new AbortController();
    setStatus('playing');
    const replayer = new SessionReplayer<A>(storage, sessionId);
    await replayer.replayWithControl(reducer, initialState, {
      speed,
      signal: abortRef.current.signal,
      onBeforeAction: async (_action, s, i) => {
        setIndex(i);
        setState(s);
        return true;
      },
    });
    setStatus('done');
  }, [sessionId, speed]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStatus('idle');
  }, []);

  return { state, index, status, speed, setSpeed, play, stop };
}
```

### SessionReplayDemo 页面
`apps/playground-web/src/scenes/SessionReplayDemo.tsx`

```tsx
// 功能:
// 1. 左侧: 会话列表 (listSessions) + 删除/导出按钮
// 2. 右侧: 回放控制 (play/stop, 速度 x1/x2/x5/x100)
// 3. 中间: 实时 state 树展示 (JSON diff)
// 4. 底部: action 时间轴 (当前 index 高亮)
```

### 压测模式
```typescript
// CI 中: speed=100, 无 UI, 验证 reducer 无崩溃
// 10分钟对话 = 6秒内完成全量 reducer 验证
// 配合 property test: 验证最终 state 满足所有不变量
```

## 文件改动清单
1. `packages/adapter-web/src/session-recorder.ts` — 补充 replayWithControl, delete/export/import
2. `apps/playground-web/src/hooks/useSessionReplay.ts` — 新建 React Hook
3. `apps/playground-web/src/scenes/SessionReplayDemo.tsx` — 新建 Demo 页面
4. `packages/adapter-web/src/__tests__/session-recorder.test.ts` — 新建单元测试

## 简历叙事
**中文版:**
> 完善 SessionRecorder/SessionReplayer 系统：扩展回放引擎支持可控速率（x1~x100）、逐步执行（断点回调）和音频流重放，配套 React Hook + 可视化控制台实现对话录制→回放→压测完整闭环；100x 速率压测可在 6 秒内完整重放 10 分钟对话的 reducer 状态链，结合 property test 自动验证无状态回归。

**英文版:**
> Completed the SessionRecorder/SessionReplayer system: extended the replay engine with controllable speed (1x–100x), step-by-step execution (breakpoint callbacks), and audio chunk replay; built a React hook and visual control console for a full record→replay→stress-test workflow. At 100x speed, a 10-minute conversation's reducer state chain replays in 6 seconds, with property tests automatically verifying no state regression.
