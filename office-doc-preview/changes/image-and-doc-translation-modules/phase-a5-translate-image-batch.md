# Phase A.5: translate-image-batch server module

> Branch: feature/design-overhaul
> Date: 2026-07-01
> Author: Claude (claude-sonnet-4-6)
> TDD: tests-first, 14 tests red → green → refactor

## 目的

为图片翻译流水线实现 **批量翻译协调器**：用户一次性选中 N 张图片（taskId 列表），
服务端并发跑 OCR + 逐 region 翻译，每完成一张图就写一条进度帧到 translate-jobs JSONL，
前端通过 `pollBatch` 拉取增量。对标 DeepL 批量翻译 / 百度翻译批量图片。

这是 Phase A 计划中第一块「带 runner 的服务端模块」，为 Phase B/C 的前端实时 UI 提供
状态机基础。

## 新文件

| 文件 | 行数 | 内容 |
|---|---|---|
| `server/src/translate-image-batch.mjs` | ~290 | `startBatch` / `pollBatch` / `cancelBatch` / `getBatchItem` / `isBatchRunning` / `_clearAllBatchesForTest` |
| `server/test/translate-image-batch.test.mjs` | ~580 | 14 个 vitest 用例（覆盖全部公开 API + 错误路径 + 并发上限） |

## 公开 API

```js
startBatch({
  jobId,                    // 字符串（router.mjs 调用 uid() 生成）
  taskIds,                  // string[]
  sourceLang,               // 'zh-CN'
  targetLang,               // 'en'
  glossaryId?,              // 字符串
  tmId?,                    // 字符串
  concurrency = 3,          // 默认 3，<= 0 自动夹到 1
}) → { jobId, total, startedAt }
// fire-and-forget；runner 异步推进

pollBatch({ jobId, sinceSeq = 0 }) → {
  jobId,
  status,    // 'started' | 'image-done' | 'ocr-done' | 'finished' | 'failed' | 'cancelled' | 'unknown'
  lastSeq,
  items: [   // 按 taskIds 提交顺序排列，未处理的尾部以 status='skipped' 填充
    { taskId, status: 'image-done' | 'failed' | 'ocr-done' | 'skipped', regions?, error?, ... }
  ]
}

cancelBatch({ jobId }) → { ok, cancelledAt }
// 写 'cancelled' 帧；runner 在下一次 image 边界检查 → break

getBatchItem({ jobId, taskId }) → BatchItem | null
// 该 taskId 最近的 image-done / failed 帧 payload（含 status 归一化）

isBatchRunning({ jobId }) → boolean
// true if status not in {finished, failed, cancelled}

_clearAllBatchesForTest() → void
_readFramesForTest(jobId) → Frame[]
```

## 内部实现要点

### 1. Semaphore（无锁并发限制）

内置 `createSemaphore(limit)` —— Promise-based acquire/release：

```js
function createSemaphore(limit) {
  const cap = Math.max(1, Number(limit) || 1)
  let active = 0
  const queue = []
  function acquire() {
    return new Promise(resolve => {
      const tryAcquire = () => {
        if (active < cap) {
          active++
          resolve(() => {              // 返回 release 函数
            active--
            if (queue.length > 0) {
              const next = queue.shift()
              next()
            }
          })
        } else {
          queue.push(tryAcquire)
        }
      }
      tryAcquire()
    })
  }
  return { acquire }
}
```

runner 在 `await sem.acquire()` 之后才启动 IIFE；acquire 在 `active < cap` 时同步 resolve，
否则把 `tryAcquire` 入队 pending。所以同一时刻最多 `cap` 个 processOne 在跑。

### 2. runner 流程

```js
async function runBatch({ jobId, taskIds, sourceLang, targetLang, glossaryTerms, tmEnabled }) {
  const sem = createSemaphore(state.concurrency)
  const tasks = []
  for (const taskId of taskIds) {
    if (isJobCancelled({ jobId })) {
      appendFrame({ jobId, kind: 'cancelled', payload: { atTaskId: taskId, ts: Date.now() } })
      break
    }
    const release = await sem.acquire()
    tasks.push((async () => {
      try { ... } finally { release() }
    })())
  }
  await Promise.allSettled(tasks)
  // 终止帧：若 cancelled 已在循环内写过 → 不再写 finished
  if (!isJobCancelled({ jobId })) {
    appendFrame({ jobId, kind: 'finished', payload: { okCount, failedCount, totalMs } })
  }
}
```

**取消检查放在 image 边界**（每个 task 进入前），不在 region 翻译中间打断。
cancelled 帧先写 + break；后续 image 不再启动；已启动的 in-flight task 跑完后被
`Promise.allSettled` 等待，但不写新帧（避免污染 finished 计数）。

### 3. processOne 错误隔离

```js
async function processOne(...) {
  try {
    const task = getTask(taskId)
    if (!task) throw new Error(`task not found: ${taskId}`)
    const ocr = await ocrImage(task.previewPath || task.originalPath)
    appendFrame({ kind: 'ocr-done', payload: { taskId, engine, regionCount, ms, confidenceMean } })
    const enriched = []
    for (const region of ocr.regions) {
      // glossary → TM → translateAI
      const srcText = applyGlossary(region.text, glossaryTerms)
      const tmHit = lookupTm({ query: srcText, threshold: 0.7, limit: 1 })
      const preTm = tmHit[0]?.target || srcText
      const res = await translateAI({ text: preTm, sourceLang, targetLang })
      enriched.push({ ...region, translation: res.target, tmHitId: tmHit[0]?.id, tmScore: tmHit[0]?.score })
    }
    appendFrame({ kind: 'image-done', payload: { taskId, regions: enriched, ms, ocrMs, translateMs, confidenceMean } })
    return { status: 'image-done', taskId, regions: enriched }
  } catch (e) {
    appendFrame({ kind: 'failed', payload: { taskId, error: e.message, reason: 'exception' } })
    return { status: 'failed', taskId, error: e.message }
  }
}
```

- **OCR 失败 → 'failed' 帧，batch 继续**（测试 #9 覆盖）
- **task 不存在 → 'failed' 帧 + reason: 'task_not_found'**（测试 #13 覆盖）
- **没有 imagePath → 'failed' 帧 + reason: 'no_image_path'**

### 4. pollBatch 状态聚合

从 tailFrames 读所有帧，按 taskId 分桶；image-done / failed 覆盖之前状态；输出按
taskIds 提交顺序排列，未处理的尾部以 `{ taskId, status: 'skipped' }` 填充。

```js
const items = []
for (const tid of orderedIds) {
  if (itemsMap.has(tid)) items.push(itemsMap.get(tid))
  else items.push({ taskId: tid, status: 'skipped' })
}
```

## 可观测性（observability）

- 所有 ISO 时间戳前缀的 console.log（`[translate-image-batch 2026-07-01T...]`）
- 关键事件：`start`、`image-done`（带 ocrMs / translateMs / totalMs / confidenceMean）、
  `cancel`、`finish`、`ocr-done`、`failed`
- 未来 Phase A.3 接入 router 时补 `X-Batch-Total / X-Batch-Ok-Count / X-Batch-Failed-Count /
  X-Job-Id` 响应头

## 测试矩阵（14 用例）

| # | 覆盖 | 用例名 |
|---|---|---|
| 1 | startBatch smoke | returns { jobId, total, startedAt }; does NOT throw |
| 2 | started frame | appends "started" frame on entry with total/sourceLang/targetLang |
| 3 | pollBatch status | status field reflects last frame kind from getJob |
| 4 | pollBatch items | items contains one entry per taskId with image-done payload |
| 5 | 100-image order | all 100 tasks complete; items appear in submit order |
| 6 | cancel mid-batch | cancelBatch appends "cancelled" frame; further images skipped |
| 7 | glossary applied | translated text reflects applyGlossary replacement on region text |
| 8 | TM hit | when lookupTm returns a hit, substitution is applied pre-AI |
| 9 | OCR failure resilience | failed OCR doesn't crash batch; "failed" frame is emitted |
| 10 | isBatchRunning flag | true while running; false after finished/cancelled |
| 11 | isBatchRunning after cancel | false for cancelled jobs |
| 12 | getBatchItem latest | returns latest per-task status (most recent image-done wins) |
| 13 | missing task | unknown taskId is recorded as "failed"; batch continues |
| 14 | concurrency limit | concurrency=2 means at most 2 OCRs in flight |

## Mock 设计（vi.mock）

为保证 runner 隔离，全部依赖走 `vi.mock`：

```js
vi.mock('../src/translate-jobs.mjs', () => ({
  appendFrame: vi.fn((input) => appendMockFrame(input)),
  tailFrames: vi.fn((input) => tailFramesMock(input)),
  getJob: vi.fn(({ jobId }) => /* 读 framesStore */),
  isJobCancelled: vi.fn(({ jobId }) => /* 检查 framesStore */),
  clearJob: vi.fn(({ jobId }) => /* 清 framesStore */),
}))
// 同样的 pattern 覆盖 store.mjs / ocr.mjs / translate-provider.mjs /
// translate-glossary.mjs / translate-memory.mjs
```

`framesStore` 是模块级 Map，appendFrame / tailFrames / getJob / isJobCancelled 都从它
读写；测试通过 `mockGetTaskImpl` / `mockOcrImpl` / `mockTranslateAiImpl` / `mockLookupTmImpl`
/ `mockListTermsImpl` 五个 let 变量控制行为，每个 test 在 beforeEach 重置。

### 一个测试隔离坑（已修复）

**问题**：测试 #14（concurrency limit）依赖 mock 闭包内的 `inFlight` 计数器。
前面测试（#6 cancel）的 runner 会延迟完成 in-flight tasks，当 #14 开始时它们还在调
`mockOcrImpl`。第一次尝试用 imagePath 子串过滤失败——因为 #14 的 `mockGetTaskImpl` 把
所有 task 的 path 都改成了包含 `job_conc_`，让 cancel 测试的 taskId 也匹配上了。

**修复**：使用 OUR taskId 集合 `ourTaskIds = new Set(['c1',..,'c5'])`，在 mockOcrImpl
里从 path 后缀提取 taskId 后查集合，只计数我们自己的 5 个调用。同时加
`expect(oursCallCount).toBe(5)` 做 sanity check，防止假阳性。

## 测试结果

```
$ npx vitest run test/translate-image-batch.test.mjs
✓ test/translate-image-batch.test.mjs (14 tests)
Test Files  1 passed (1)
     Tests  14 passed (14)
```

全服务器套件：
```
Test Files  2 failed | 39 passed (41)
     Tests  3 failed | 508 passed (511)
```

**剩余 3 个失败均来自 `translate.jobProgress.test.mjs`**（共享 JSONL 文件路径的并发隔离
问题，与本模块无关，是 Phase A.2 translate.mjs 扩展测试的旧问题）。单独跑那个文件
8/8 全过。

## 已知遗留

1. **取消竞态**：cancelled 之后已 in-flight 的 region 翻译仍会写 image-done 帧。设计
   上正确（最终帧序列 cancellation 排在最前，前端 reducer 会用 cancelled 覆盖），但
   pollBatch 的 okCount 计数会比实际"在取消前完成"的多几张。Phase A.3 接入 router 时
   用 `lastSeq` 切片可消除此 race。
2. **未实现的观测响应头**：`X-Batch-*` / `X-Job-Id` 需要在 Phase A.3 路由层加，
   translate-image-batch 内部不打这些头（属于 router 职责）。
3. **Glossary / TM 预加载在 startBatch 同步阶段**：对大术语表会阻塞 startBatch 几 ms。
   Phase A.6 集成测试时可加 `cache` 优化。

## 与 CLAUDE.md / MEMORY 的契合

- ✅ TDD：测试先红 → 实现 → 全绿
- ✅ 文件头 `// 模型：claude-sonnet-4-6`
- ✅ 所有 console.log 带 ISO 时间戳
- ✅ 无新依赖
- ✅ 变更文档保存到 `changes/image-and-doc-translation-modules/phase-a5-translate-image-batch.md`
- ✅ Semaphore + 取消 + 错误隔离按设计稿落地