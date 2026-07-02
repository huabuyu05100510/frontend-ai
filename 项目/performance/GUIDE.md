# 前端性能调度决策手册

## 第一步：诊断

```
打开 Chrome DevTools → Performance → 录制操作

找到 Long Task（红色角标，> 50ms）
         ↓
这个 Long Task 是什么？
         ↓
┌────────────────────────────────────────────────────┐
│  React 状态更新导致的大量重渲染                         │  → 走 React 方案
├────────────────────────────────────────────────────┤
│  JS 计算（数组处理、格式转换、解析）                      │  → 走 Worker 方案
├────────────────────────────────────────────────────┤
│  多个任务堆在一起，优先级不同                            │  → 走调度器方案
├────────────────────────────────────────────────────┤
│  低优先级任务（统计、预加载）混在主流程里                   │  → 走 idle 方案
└────────────────────────────────────────────────────┘
```

---

## 第二步：选方案

### React 项目

| 症状 | 方案 | 代码 |
|---|---|---|
| 搜索框输入时列表重渲染卡顿 | `useDeferredValue` | 见下 |
| 点击按钮后 UI 长时间无响应 | `startTransition` | 见下 |
| 某个状态更新不紧急 | `startTransition` | 见下 |
| 大列表渲染 | `startTransition` + 虚拟列表 | 见下 |

```tsx
// 搜索过滤卡顿 → useDeferredValue
function SearchList({ query }: { query: string }) {
  const deferredQuery = useDeferredValue(query); // 渲染用 deferred 值
  const results = useMemo(() => filter(data, deferredQuery), [deferredQuery]);
  return <List items={results} />;
}

// 非紧急状态更新 → startTransition
function App() {
  const [tab, setTab] = useState('home');
  return (
    <button onClick={() => startTransition(() => setTab('dashboard'))}>
      切换到大数据面板（不阻塞当前 UI）
    </button>
  );
}
```

---

### 通用场景（使用 scheduler.ts）

#### 场景 1：大数组批量渲染（最常见）

**症状**：挂载 5000 个列表项，页面白屏 / 卡顿
**方案**：`chunk()` 分片渲染

```ts
import { chunk } from './scheduler';

// ❌ 一次性渲染，阻塞主线程
items.forEach(item => container.appendChild(render(item)));

// ✅ 分片渲染，每 50 条让出一次主线程
await chunk(items, (item) => {
  container.appendChild(render(item));
}, { chunkSize: 50 });
```

---

#### 场景 2：搜索 / 翻页（需要取消上一批）

**症状**：用户快速输入，旧的渲染任务和新的互相干扰
**方案**：`TaskGroup`

```ts
import { TaskGroup } from './scheduler';

const group = new TaskGroup();

searchInput.addEventListener('input', async (e) => {
  group.reset(); // 取消上一次搜索的所有任务

  const results = await search(e.target.value);

  // 分批渲染结果，可被下次 reset() 取消
  group.chunk(results, (item) => {
    list.appendChild(renderItem(item));
  });
});
```

---

#### 场景 3：LLM 流式输出（停止生成时取消高亮/公式任务）

**症状**：代码高亮、KaTeX 渲染阻塞用户交互
**方案**：`TaskGroup` + `schedule('background')`

```ts
import { TaskGroup } from './scheduler';

const renderGroup = new TaskGroup();

// token 渲染（用户可见，优先级高）
onToken((token) => {
  renderGroup.schedule('user-visible', () => appendToken(token));
});

// 代码高亮（CPU 密集，放到 background）
onCodeBlockComplete((code, lang) => {
  renderGroup.schedule('background', () => {
    const highlighted = Prism.highlight(code, lang);
    updateCodeBlock(highlighted);
  });
});

// 停止生成 → 取消所有待执行的高亮/公式任务
stopBtn.onclick = () => renderGroup.cancel();
```

---

#### 场景 4：后台低优先级任务（不影响用户操作）

**症状**：埋点上报、预加载等任务占用主线程
**方案**：`idle()`

```ts
import { idle } from './scheduler';

// 页面加载完成后，利用浏览器空闲时间做这些事
idle(() => sendPageViewAnalytics());
idle(() => prefetchNextPage());
idle(() => warmupCache(userId));
```

---

#### 场景 5：单个异步任务，需要明确优先级

**症状**：某个任务不知道放在哪
**方案**：`schedule()`

```ts
import { schedule } from './scheduler';

// 路由切换时，非当前页的渲染推迟
const task = schedule('user-visible', () => renderOffscreenPanel());

// 用户离开前取消
onLeave(() => task.cancel());
```

---

### CPU 密集型计算

**症状**：数据处理 > 100ms（解析、加密、图像处理）
**方案**：Web Worker（不在 scheduler.ts 范围内，但这是首选）

```ts
// worker.ts
self.onmessage = ({ data }) => {
  const result = heavyCompute(data); // 不阻塞主线程
  self.postMessage(result);
};

// main.ts
const worker = new Worker('./worker.ts', { type: 'module' });
worker.postMessage(inputData);
worker.onmessage = ({ data }) => renderResult(data);
```

**判断标准**：任务 > 50ms 且不需要访问 DOM → 用 Worker

---

## 速查表

| 场景 | 首选方案 | 备选 |
|---|---|---|
| React 非紧急渲染 | `startTransition` | `useDeferredValue` |
| React 搜索过滤 | `useDeferredValue` | `startTransition` |
| 大数组分批渲染 | `chunk()` | `startTransition` |
| 需要批量取消 | `TaskGroup` | AbortController × N |
| 空闲任务 | `idle()` | `schedule('background')` |
| CPU 密集计算 | Web Worker | `chunk()` |
| 单任务优先级控制 | `schedule()` | setTimeout |
| 长任务内部让出 | `scheduler.yield()` | MessageChannel |

---

## 常见误区

| 误区 | 正确做法 |
|---|---|
| 所有异步都用 `setTimeout(fn, 0)` | 区分优先级，嵌套 setTimeout 有 4ms 最小延迟 |
| 自己实现 min-heap 调度器 | 先用 `scheduler.postTask`，原生 API 优先 |
| CPU 密集任务用 chunk 分片 | 超过 50ms 的纯计算应该用 Web Worker |
| 什么都塞进 `useEffect` | 副作用分优先级，低优先级用 `idle()` |
| startTransition 包所有更新 | 只包非紧急更新，紧急更新（如输入框受控值）不要包 |

---

## 判断一个任务是否"紧急"

```
用户正在等待这个更新的视觉反馈？
  是 → user-blocking / user-visible（或 startTransition 之外）
  否 → background / idle（或 startTransition 之内）

这个任务会直接影响用户当前操作的流畅性？
  是 → 同步或 user-blocking
  否 → 可以调度
```
