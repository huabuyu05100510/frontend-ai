# 标注功能技术方案 V1

**版本**: V1
**日期**: 2026-06-27
**作者模型**: claude-sonnet-4-6（MiniMax-M3 路由）
**状态**: 待评审（用户已批准先写方案、暂不编码）

---

## 0. 一句话目标

构建**用户反馈驱动的算法迭代闭环**：
**前端低摩擦标注 → 离线优先落库 → 后端聚合 → 训练数据生成 → alignment head 微调 → A/B 上线**。

对标沉浸式翻译 / 百度翻译均无此闭环，是本项目的差异化壁垒。

---

## 1. 背景与目标

### 1.1 现状
- Phase 6 NLLB-600M Route C 词对齐 F1=0.851（金标准 8 case），距百度人感 ~95% 仍差 10%
- 差距根因（memory 记录）：模型蒸馏限制 + **无 alignment head 监督训练信号**
- 当前算法是静态部署上线，无法从真实用户翻译行为中学习

### 1.2 目标
1. **采集**：在浏览器扩展内提供低摩擦标注 UI，让用户能在 hover 词对齐时修正错误
2. **存储**：用户标注离线优先落入 IndexedDB，后台 best-effort 同步至后端
3. **回流**：后端聚合后导出 JSONL，作为 alignment head 微调的监督信号
4. **迭代**：基于用户标注微调 alignment head（冻结主模型），F1 在 8-case 金标准 + 真实站点（alibaba 首页 353 段）覆盖率双 A/B
5. **可观测**：标注量 / 采纳率 / F1 三维 dashboard，新模型上线前必须过双 A/B

### 1.3 非目标（明确不做）
- 不做 NMT 翻译质量主动学习（除非标注量 ≥10k）
- 不做多用户协作标注 / 审核工作流
- 不做标注市场 / 众包平台
- 不动 encoder/decoder 主体，仅微调 attention head（Phase 8）

---

## 2. 标注类型（双类型并行）

### 2.1 类型 A：词级 alignment 修正（`ALIGN_FIX`）

**最有算法价值**，直接喂 alignment head 微调。

**触发**：
- 用户 hover 任意已对齐的 src 词 → 显示对齐气泡 + ✏️ 图标
- 点击 ✏️ → 弹出 mini popover

**交互**：
```
┌─────────────────────────────────┐
│ 原文: 我 爱 这 只 懒 懒 狗      │
│       ●     ↘                   │
│ 译文: I love this lazy dog      │
│       ●      ●    ●      ●     │
│                                 │
│ 修正对齐:                       │
│  src[3]=懒  → tgt[?]=lazy      │
│  [●lazy ○sleepy ○other___]     │
│                                 │
│  [取消]              [✓ 提交]   │
└─────────────────────────────────┘
```

**数据**：
```typescript
payload: {
  srcTokenIdx: number;           // src 分词数组的索引
  predictedTgtTokenIdx: number;  // 算法预测的 tgt token idx
  correctedTgtTokenIdx: number | null;  // 用户修正（null = "算法错，无对应词"）
  correctionKind: 'change' | 'remove' | 'add';
}
```

**UX 要点**：
- 单击提交，不阻塞翻译主流程
- 提交后立即关闭 popover，气泡改为 ✓ 状态 2s 后复原
- 支持键盘快捷键 `1-9` 快速选候选词

### 2.2 类型 B：段级 1-5 星质量评分（`SEG_RATING`）

**最容易采集、量最大**，用作翻译质量监控 + RLHF preference data。

**触发**：
- 翻译完成后，每段右上角出现 5 个空心 ☆
- FAB 浮球 idle 态增加 📊 入口聚合操作

**交互**：
```
译文段落：[This is a test sentence.]
         ★ ★ ★ ★ ★  ← 5 星，hover 高亮，点击提交
```

**数据**：
```typescript
payload: {
  rating: 1 | 2 | 3 | 4 | 5;
  // 1=完全错译 2=严重失真 3=可读但有小错 4=基本正确 5=完美
}
```

**UX 要点**：
- 评分与 alignment 修正完全独立，可同时标
- 提交后 ☆ 实心化，无反馈弹窗（低摩擦）
- 5 星评分后 24h 内同段不重复展示（避免打扰）

### 2.3 类型 C（远期，不在 MVP）：替代译文（`ALT_TRANS`）

按 CLAUDE.md 规划，本期**暂不实现**，留作 Phase 9。

---

## 3. 数据结构（关键设计）

### 3.1 Annotation Schema

```typescript
// lib/annotation.mjs
export const AnnotationKind = Object.freeze({
  ALIGN_FIX: 'align_fix',
  SEG_RATING: 'seg_rating',
  ALT_TRANS: 'alt_trans',  // 远期
});

export const AnnotationSchema = {
  id: 'string',                   // uuid v4
  kind: 'AnnotationKind',
  schemaVersion: 1,

  // 来源上下文
  url: 'string',
  domPath: 'string',              // 元素 XPath（id-based 优先，缺则 nth-child）
  srcSegmentId: 'string',         // 对应 data-xt-id（用于跨刷新重定位）
  langPair: '[string, string]',   // ['zh', 'en']

  // 文本内容
  srcText: 'string',
  tgtText: 'string',
  srcTokens: 'string[]',
  tgtTokens: 'string[]',

  // 算法快照（用于计算修正幅度 / 难例挖掘）
  predicted: 'Array<[number, number]>',  // 算法输出的 alignment
  modelVersion: 'string',                // 'nllb-600m-l0h15-v1'

  // 类型特定 payload
  payload: 'object',

  // 上下文窗口（±1 段，用于训练）
  context: {
    prevSrc: 'string?',
    nextSrc: 'string?',
  },

  // 元数据
  createdAt: 'number',            // Date.now()
  appVersion: 'string',
  userAgent: 'string',
};
```

### 3.2 关键设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 主键 | `id`（uuid）而非 DOM 路径 | UUID 保证幂等；DOM 路径在重渲染时失效 |
| 重定位 | 存 `domPath` + `srcSegmentId` | 跨刷新可重新挂载 |
| 算法快照 | `predicted` 一并存 | 后续算"修正幅度"= |user - predicted|，高幅度=难例=高训练价值 |
| 上下文 | ±1 段而非整页 | 平衡训练信号与存储成本 |
| 版本化 | `schemaVersion` + `modelVersion` | 旧数据可被新模型 epoch 跳过；迁移兼容 |
| `context.prevSrc` 限长 | 每段 ≤500 字符 | 防恶意长文刷库 |

### 3.3 codec 设计（lib/annotation.mjs）

```javascript
// 纯函数：encode/decode/validate/normalize
export function encode(input) { /* → Annotation */ }
export function decode(raw) { /* raw → Annotation，校验 schemaVersion */ }
export function validate(anno) { /* 抛 ValidationError */ }
export function normalize(anno) { /* 兜底：trim、超长截断、langPair 标准化 */ }
```

所有函数**纯函数 + 无副作用**，可单元测试。

---

## 4. 存储方案

### 4.1 本地：IndexedDB（不用 chrome.storage）

```
DB: xt-annotations  (version 1)
├─ ObjectStore: annotations
│   ├─ keyPath: id
│   ├─ indexes:
│   │   ├─ by_createdAt   (createdAt)
│   │   ├─ by_synced      (synced: 0|1)
│   │   ├─ by_url         (url)
│   │   └─ by_kind        (kind)
│   └─ value: { id, createdAt, synced, payload: Annotation }
```

**为什么 IDB**：
- chrome.storage.local 限额 5MB / 10MB；IDB 无上限（实际 ~50MB+）
- IDB 支持 index 扫描，导出/统计快
- 离线优先 → 上传失败不丢

### 4.2 lib/annotation-store.mjs 抽象

```javascript
// 抽象 IDB 操作，提供纯函数 + Promise 接口
export async function openDb() { /* IDBOpenDBRequest → IDB */ }
export async function put(anno) { /* upsert */ }
export async function get(id) { /* single */ }
export async function listByCreatedAt({ limit, offset }) { /* cursor */ }
export async function listUnsynced({ limit }) { /* by_synced=0 */ }
export async function markSynced(ids) { /* bulk update */ }
export async function exportJSONL() { /* stream */ }
export async function stats() { /* { total, byKind, byLangPair, last24h } */ }
```

### 4.3 后台同步策略（extension/background/sync.ts）

```typescript
// 每 30s 触发一次
// 1. listUnsynced({ limit: 50 })
// 2. POST /v1/annotations  (JSON 数组)
// 3. 成功 → markSynced(ids)
// 4. 失败 → 指数退避（30s → 1m → 5m → 30m，上限 30m）
// 5. chrome.alarms 替代 setInterval（Service Worker 会被休眠）
```

**关键**：用 `chrome.alarms` 而不是 `setInterval`，因为 MV3 Service Worker 会休眠，setInterval 不可靠。

---

## 5. 后端 API

### 5.1 端点设计

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/v1/annotations` | 批量 ingest，body=`Annotation[]`，返回 `{ accepted: number, rejected: ValidationError[] }` |
| `GET` | `/v1/annotations/stats` | 聚合统计：`{ total, byKind, byLangPair, last24h, topDomains }` |
| `GET` | `/v1/annotations/export?format=jsonl&since=<ts>` | 流式导出训练数据，Content-Type=`application/x-ndjson` |
| `GET` | `/v1/annotations/export/stats` | 当前可用于训练的样本数 + 准入门槛检查 |

### 5.2 数据库（最小可用）

复用现有 `server/` 目录（FastAPI + NLLB），新增表：

```sql
CREATE TABLE annotations (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,
  schema_version  INTEGER NOT NULL,
  url             TEXT NOT NULL,
  dom_path        TEXT NOT NULL,
  src_segment_id  TEXT NOT NULL,
  lang_pair       TEXT NOT NULL,    -- 'zh-en'
  src_text        TEXT NOT NULL,
  tgt_text        TEXT NOT NULL,
  src_tokens_json TEXT NOT NULL,    -- JSON array
  tgt_tokens_json TEXT NOT NULL,
  predicted_json  TEXT NOT NULL,
  model_version   TEXT NOT NULL,
  payload_json    TEXT NOT NULL,
  context_json    TEXT,
  created_at      INTEGER NOT NULL,
  app_version     TEXT,
  user_agent      TEXT,
  received_at     INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_kind_created ON annotations(kind, created_at);
CREATE INDEX idx_lang ON annotations(lang_pair);
CREATE INDEX idx_model ON annotations(model_version);
```

### 5.3 校验与去重

- 服务端必须做 schema 校验（不能信任客户端）
- `id` 唯一约束 → 客户端重试幂等
- 限流：单 IP 1000 req/min，超出 429

---

## 6. 算法闭环（核心价值环节）

### 6.1 Pipeline 全景

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ 用户标注 │ →  │ IDB 本地 │ →  │ 后端聚合 │ →  │ 训练数据 │ →  │ 微调模型 │
│ (前端UI) │    │ (离线优先)│    │(FastAPI)│    │(JSONL)  │    │(alignment│
└──────────┘    └──────────┘    └──────────┘    └──────────┘    │  head)  │
                                                                └────┬─────┘
                                                                     ↓
                                                                ┌──────────┐
                                                                │ A/B 验证 │
                                                                │ 8-case + │
                                                                │ alibaba  │
                                                                └────┬─────┘
                                                                     ↓
                                                                ┌──────────┐
                                                                │ 灰度发布 │
                                                                └──────────┘
```

### 6.2 Phase 8：alignment head 微调

**核心思想**（参考 awesome-align 论文）：冻结 NMT 主体，仅微调 attention head 的 query/key projection。

```python
# spike/phase8/finetune_align_head.py
# 1. 加载 NLLB-600M，提取所有 attention head 的 cross-attn
# 2. 选定目标 head：当前最强 = L0 H15（Phase 6 结论）
# 3. 数据：用户标注 JSONL
#    每条 → (src_token_idx, tgt_token_idx) 作为正样本
#    同句其他 (src_i, tgt_j) where (i,j) ≠ 用户标注 作为负样本
# 4. 冻结 encoder + decoder cross-attn 所有参数
#    仅解冻 L0 H15 的 W_q, W_k projection layer
# 5. Loss = -log(softmax(cross_attn[user_aligned_positions]))
# 6. 优化器：AdamW lr=1e-5, 5 epochs, batch_size=32
# 7. 验证：8-case 金标准 F1 + alibaba 首页 353 段 coverage
```

### 6.3 数据准入门槛

| 阶段 | 触发条件 | 行为 |
|---|---|---|
| 数据收集 | 任意 | 落库 + 上报 |
| 训练数据生成 | ≥500 条 + 跨 ≥10 URL + ≥3 lang pair | 触发 |
| 模型微调 | 准入满足 + 上次微调 ≥7d | 训练 |
| A/B 验证 | 新模型 F1 - 旧模型 F1 > 0.02 | 灰度 |
| 灰度发布 | 1 周线上 A/B 无回归 | 全量 |

### 6.4 数据质量保障

- **冲突解决**：同一 `(src_segment_id, srcTokenIdx)` 多用户标 → majority vote；冲突 > 30% 该样本弃用
- **恶意过滤**：单 IP 1 小时内 > 100 条 → 限流；同 URL 重复内容 hash → 去重
- **质量加权**：高频标注者（≥50 条）权重 2x；新用户 0.5x（防刷）

### 6.5 Phase 9（远期，标注量 ≥10k 触发）

段级 rating + 替代译文 → preference pairs → DPO/PPO 微调 NLLB decoder（不动 encoder/embedding）。

---

## 7. UI / UX 设计

### 7.1 词级 alignment 修正（A）

**注入点**：`extension/content/annotator.ts`，在 hover 词对齐气泡渲染时插入 ✏️ 图标。

**样式**：复用现有对齐气泡的 Shadow DOM，避免污染页面。

**动效**：
- 出现：fade-in 150ms
- 提交：✓ 状态 2s 后 fade-out
- 失败：抖动 200ms + toast

**键盘快捷键**：
- `1-9`：选候选词
- `Esc`：关闭
- `Enter`：提交
- `Tab`：切换下一段

### 7.2 段级评分（B）

**注入点**：每段译文容器右上角插入 5 个空心 ☆。

**样式**：固定 `position: absolute; top: -8px; right: 0; opacity: 0`，hover 段落时 `opacity: 1`。

**去打扰**：
- 24h 内同段已评 → 不再显示
- ★3 以下用户主动提交 → 不再询问
- 每周最多弹 3 次提示

### 7.3 demo 页标注面板

`demo.html` 新增 tab：**📋 我的标注**

```
┌─────────────────────────────────────┐
│ 共 47 条标注 · 上次同步 3 分钟前     │
├─────────────────────────────────────┤
│  [全部] [词级修正 23] [段级评分 24] │
├─────────────────────────────────────┤
│ ⭐⭐⭐⭐⭐ alibaba.com/product/123     │
│   "质量很好"                         │
│   [查看] [删除]                      │
├─────────────────────────────────────┤
│ ✏️ 修正 bbc.com/news/456             │
│   src[3]=懒 → tgt[3]=lazy（原本=慵） │
│   [查看] [删除]                      │
└─────────────────────────────────────┘
```

按钮：**📥 导出 JSONL**（直接给 spike/phase8 用）。

### 7.4 FAB 浮球扩展

新增 📊 入口：点击展开标注统计面板（总数、本周新增、同步状态、最近 5 条）。

---

## 8. 可观测性

### 8.1 前端埋点

`lib/logger.mjs` 增加 `annotation.*` 命名空间：

```javascript
logger.info('annotation.opened', { kind, srcSegmentId });
logger.info('annotation.submitted', { kind, durationMs, corrections });
logger.info('annotation.sync.batch', { count, success, durationMs });
logger.info('annotation.sync.failed', { error, retryIn });
```

### 8.2 后端埋点

```python
# FastAPI middleware
@app.middleware("http")
async def metrics(request, call_next):
    start = time.time()
    response = await call_next(request)
    metrics.counter(f'api.{request.url.path}.{response.status_code}').inc()
    metrics.histogram(f'api.{request.url.path}.latency').observe(time.time() - start)
    return response
```

### 8.3 Dashboard

简易 Grafana / 静态页：
- **标注量**：日 / 周 / 月，按 kind / lang pair 分组
- **采纳率**：用户修正幅度分布（|user - predicted| > 1 的占比）
- **同步状态**：待同步 / 已同步 / 失败
- **F1 趋势**：8-case 金标准历史曲线
- **训练门槛**：距离下次可微调还差多少样本

---

## 9. TDD + e2e + UI 回归计划

### 9.1 单元测试（vitest/node:test）

| 文件 | 覆盖 | 用例数 |
|---|---|---|
| `test/annotation.test.mjs` | schema 校验、normalize、encode/decode | ≥15 |
| `test/annotation-store.test.mjs` | IDB CRUD（用 fake-indexeddb）、index 查询 | ≥12 |
| `test/annotation-sync.test.mjs` | 批量上传、指数退避、幂等 | ≥8 |

### 9.2 e2e 测试（Playwright）

| 文件 | 覆盖 | 用例 |
|---|---|---|
| `test/annotation.ext.e2e.test.mjs` | 扩展内 hover → 标 → IDB → 刷新仍在 → 同步到 mock server | 5 |
| `test/annotation.demo.e2e.test.mjs` | demo 页标注面板、导出 JSONL | 3 |
| `test/annotation.xss.e2e.test.mjs` | XSS：恶意 domPath / srcText / comment | 4 |

### 9.3 UI 视觉回归

`test/shots/` 新增：
- `anno-01-align-fix-popover.png`
- `anno-02-rating-stars.png`
- `anno-03-panel.png`
- `anno-04-export.png`

### 9.4 算法 benchmark 回归

`benchmark/annotation-impact.mjs`：用用户标注的 held-out 20% 作 test，F1 提升对比基线。

---

## 10. 多 agent 任务拆解

按用户惯例"尽量 multi-agent"：

| Agent | 任务 | 交付 |
|---|---|---|
| **A1 schema** | `lib/annotation.mjs` schema + codec + 15 unit test | PR |
| **A2 store** | `lib/annotation-store.mjs` IDB CRUD + 12 unit test | PR |
| **A3 ui-align** | `extension/content/annotator.ts` 词级修正 UI + e2e | PR |
| **A4 ui-rating** | `extension/content/annotator.ts` 段级评分 UI + e2e | PR |
| **A5 sync** | `extension/background/sync.ts` + chrome.alarms | PR |
| **A6 demo** | `demo.html` 标注面板 + JSONL 导出 | PR |
| **B1 backend** | server 新增 3 端点 + DB schema + e2e | PR |
| **C1 training** | `spike/phase8/finetune_align_head.py` + benchmark | PR |
| **D1 obs** | 后端 metrics + 前端 dashboard 静态页 | PR |

并行：A1/A2 → A3/A4/A5/A6/B1（同步）→ C1/D1（依赖数据）

---

## 11. 风险与权衡

| 风险 | 严重度 | 缓解 |
|---|---|---|
| 标注数据量 < 500，长时间无法触发训练 | 高 | 留冷启动方案：few-shot prompt + LaBSE rerank；公开征集种子标注 |
| 用户标恶意/刷量 | 中 | 单 IP 限流 + 质量加权 + 异常检测（单用户标注相似度 > 0.9 报警） |
| 微调后模型退化（F1 下降） | 中 | 强制 A/B 通过门槛；旧模型作为 fallback |
| 标注 UI 破坏页面布局 | 低 | Shadow DOM 隔离；动效用 CSS transform（不触发 reflow） |
| 隐私：标注含敏感 URL/文本 | 中 | 后端 PII 检测 + 可选本地存储（不上传）开关 |
| IDB 满（罕见） | 低 | LRU 淘汰 synced=1 + 30d 前的标注 |
| 后端被刷 | 中 | API key + rate limit + 域名白名单 |

---

## 12. 里程碑与工期

| 阶段 | 内容 | 工期 | 累计 |
|---|---|---|---|
| **M0 方案** | 本文档 | 已完成 | 0 |
| **M1 数据基础** | A1 + A2（schema + IDB） | 1d | 1d |
| **M2 前端 UI** | A3 + A4 + A6（标注 UI + demo 面板） | 2d | 3d |
| **M3 同步闭环** | A5 + B1（背景同步 + 后端） | 1.5d | 4.5d |
| **M4 算法闭环** | C1（alignment head 微调 + A/B） | 1.5d | 6d |
| **M5 打磨** | D1（dashboard）+ 性能调优 + 文档 | 1d | 7d |
| **M6 灰度** | 扩展发布到 Chrome Web Store 灰度渠道 | 1d | 8d |

总投入：~8 工作日。跑通后即可讲完整闭环。

---

## 13. 后续 Roadmap（不在本期）

- **Phase 9**：替代译文采集 → DPO/PPO 微调 decoder
- **多用户协作**：标注市场 + 审核工作流
- **跨浏览器**：Firefox / Safari 扩展
- **Web 标注平台**：脱离扩展的纯网页标注工具，给标注员使用
- **自动标注**：用 GPT-4 / Claude API 生成伪标签，用户审核（半监督）

---

## 14. 验收标准（Definition of Done）

M2 验收：
- [ ] 扩展 hover 词对齐时，✏️ 可点击 → 弹出修正 popover → 提交后 IDB 有数据
- [ ] demo 页标注面板可见自己的标注，可导出 JSONL
- [ ] 全部单测 + e2e 通过
- [ ] UI 截图回归通过
- [ ] `changes/2026-MM-DD-annotation-mvp.md` 已写

M3 验收：
- [ ] 后端 ingest 端点接受并存储
- [ ] 扩展后台 30s 自动同步，断网重连后重试
- [ ] `/v1/annotations/stats` 返回正确聚合

M4 验收：
- [ ] spike/phase8 脚本能加载 JSONL 并完成 1 epoch
- [ ] 8-case 金标准 F1 比基线 ≥ +0.02
- [ ] alibaba 首页 353 段 coverage 无回归

---

## 15. 附录

### A. 参考资料
- awesome-align 论文：https://arxiv.org/abs/2101.08231
- MarianMT alignment head 选择：spike/phase3/route_c_crossattn.md
- LaBSE contextual 聚合稀释信号：memory "Phase 3-5 词对齐核心发现"
- chrome.alarms MV3 文档：https://developer.chrome.com/docs/extensions/reference/api/alarms

### B. 相关已有文件
- `lib/logger.mjs` —— 复用日志接口
- `extension/src/content/injector.ts` —— 参考 Shadow DOM 注入模式
- `extension/src/content/content.ts` —— FAB 浮球 4 态（W3 修复）
- `server/` FastAPI + NLLB —— 新增端点参考结构
- `benchmark/align-benchmark.mjs` —— 8-case 金标准 runner

### C. 决策落定（2026-06-27 用户确认）

1. ✅ **两种标注都做**：A 词级 alignment 修正 + B 段级 1-5 星评分
2. ✅ **后端分两层**：
   - **NestJS 标注聚合服务**（新增 `server/annotation/`，端口 3001，TS 全栈）
     - 与 extension 共享 `extension/src/shared/types.ts` 类型
     - Swagger 自动文档
     - SQLite 存储 annotations
   - **FastAPI NLLB 推理服务**（保留 `server/nmt_server.py`，端口 8000，不动）
   - NestJS 通过内部 HTTP 调用 FastAPI `/translate`（后续 A/B 灰度用）
3. ✅ **灰度发布策略**：
   - M3 完成 → Chrome Web Store `trustedTesters` 内测（白名单邮箱）
   - 收集 ≥100 条真实标注后 → 1% 随机放量
   - 关键指标（F1 无回归、错误率 < 0.5%、标注采纳率 > 30%）→ 10% → 50% → 100%
   - 用 Chrome Web Store Developer Dashboard → Distribution → Rollout percentage 控制
4. ✅ **标注默认开启 + 隐私可控**：
   - 首次安装：一次性 toast "启用标注以帮助算法改进？"
   - 扩展 popup 增加 `📊 参与标注改进` switch
   - 关闭后：UI 不显示、IDB 不写、同步关闭
   - 默认开启，用户随时可关
