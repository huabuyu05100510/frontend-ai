# translate-realtime-align-annotate 实时翻译 + 词级对齐 + 标注反馈

> 模型：claude-sonnet-4-6

## 背景
- 用户要求："文本翻译需要支持 实时翻译 以及词级对齐 和标注 反馈功能 参考./网页翻译"
- 参考：`/Users/didi/Downloads/前端AI/网页翻译/`（含 ONNX MarianMT 词对齐 700MB - 已弃用）

## 集成范围（已落地）

### 1. 后端 5 新端点

| 端点 | 用途 | 关键头 |
|------|------|--------|
| `POST /api/translate/realtime` | 单段实时翻译（轻量，绕过段分割/分页/渲染产物） | `X-Translate-Engine`/`X-Translate-Ms`/`X-Translate-Provider`/`X-Translate-Chars` |
| `POST /api/translate/align` | 词级对齐（Myers 替代 700MB ONNX） | `X-Align-Engine`/`X-Align-Ms`/`X-Align-Pairs` |
| `POST /api/translate/annotation` | 创建标注（3 类：align_fix/seg_rating/alt_trans） | `X-Annotation-Id`/`X-Annotation-Kind` |
| `GET /api/translate/annotation?taskId=xxx` | 列出标注 | `X-Annotation-Count` |
| `DELETE /api/translate/annotation?taskId=xxx&id=yyy` | 删除标注 | `X-Annotation-Removed` |

**实时翻译**：直接复用 `translateAI()` — 单段、无段分割/分页/渲染产物。响应含 `{target, charMap, engine, provider, ms}`，比 `/api/inspect/translate` 轻。

**词级对齐**：
- 算法 = `segmentWords(src)` + `segmentWords(tgt)` + `myersDiffArray()`
- equal → 1:1 对齐（score=1.0）
- 相邻 delete+insert → 1:1 配对（score=0.5）
- 多余的 delete/insert 不入 pairs
- 替代 `lib/word-aligner.mjs` 的 700MB ONNX MarianMT 模型；零依赖，<5ms

**标注反馈**：移植 `lib/annotation.mjs` schema 层（简化版）：
- 新模块 `server/src/annotation-schema.mjs`：3 类 kind、SCHEMA_VERSION=1、validate/normalize/encode/decode、uuid、langPair 白名单
- 持久化：`DERIVED_DIR/translate-annotations/<taskId>.jsonl`（append-only，按行 JSON）
- 简化点：去掉 url/domPath 强依赖（前端只传 taskId+segmentId，后端派生）

### 2. 前端 RealtimeTranslateMode
新增 TranslationPage 子菜单「实时翻译」（BoltIcon）：

| 能力 | 说明 |
|------|------|
| Debounced 输入 | 500ms debounce → 自动调 `/api/translate/realtime` |
| 双栏词级对齐 | 原文 token + 译文 token 双区显示 |
| Hover 联动 | 悬停 src token → 高亮匹配的 tgt token；反向同理 |
| 标注弹窗 | 点击译文/工具按钮 → 弹出 3 类反馈表单 |
| 标注列表 | 显示已提交标注（kind badge + 摘要 + 删除按钮） |
| 语言切换 | src↔tgt 互换，清空结果触发重新翻译 |

**视觉**：
- src token：灰底，hover 时联动 tgt token 黄色高亮（#fff7e6 + #faad14 border）
- tgt token：紫色 primary-bg，hover 时联动 src token 绿色高亮（#f6ffed + #52c41a border）
- 标注 kind 配色：align_fix 紫 / seg_rating 黄 / alt_trans 绿
- 弹窗：固定定位蒙层，420-540px 宽，圆角 12px + 阴影

### 3. 标注类型
| kind | 含义 | payload 字段 |
|------|------|--------------|
| `align_fix` | 修正词级对齐（用户认为某 src token 应对齐到另一个 tgt token） | `{from:[srcIdx], to:[tgtIdx]}` |
| `seg_rating` | 段落评分 | `{rating: 1-5, comment?: string}` |
| `alt_trans` | 备选翻译建议 | `{alternative: string}` |

## 测试
- 后端 `npx vitest run`：**350 pass / 26 files**（含新增 17 tests）
  - `translate-realtime.test.mjs` 7 tests：400 缺参 / 200 正常 + 响应头
  - `translate-annotation.test.mjs` 10 tests：CRUD + 校验
- 前端 `npx vitest run`：**222 pass / 22 files**（含新增 6 tests）
  - `RealtimeTranslateMode.test.tsx` 6 tests：菜单/输入/debounce/语言切换/对齐/弹窗提交
- `npx tsc --noEmit`：通过

## 设计决策

### 为什么不移植 ONNX 词对齐？
`lib/word-aligner.mjs` 使用 Xenova/opus-mt-en-zh ONNX 模型（700MB+），浏览器加载成本极高、首屏延迟 > 5s。本方案用 **Myers 词级 diff**：
- 零依赖（复用 `server/src/diff.mjs`）
- <5ms 响应
- 适合实时翻译场景（每次输入都重新对齐）
- 准确度低于 MarianMT cross-attention，但对"hover 联动 + 标注修正"场景够用——用户可通过 `align_fix` 标注反馈纠错，形成训练数据闭环

### 实时端点 vs inspect 端点
- `/api/inspect/translate` 重：返回 segments/paragraphBlocks/pages/meta + 渲染产物，适合文档翻译
- `/api/translate/realtime` 轻：直接 `translateAI()` 出 `{target, charMap}`，适合输入框 debounce 场景

### 标注 schema 简化
原版（`lib/annotation.mjs`）要求 `url`/`domPath` 强约束（浏览器扩展场景）。本应用是 SPA，taskId + segmentId 已能唯一定位，故：
- `url` 派生为 `task://taskId`
- `domPath` 派生为 `seg:segmentId`
- 前端不传 url/domPath，后端补默认值

### 持久化
- JSONL（append-only）→ 比完整 JSON 重写快
- 按 taskId 分文件：`translate-annotations/<taskId>.jsonl`
- 删除时若文件清空则 unlink，否则重写

## 顶级交互细节
- 输入 debounce 500ms（避免打字中频繁请求）
- hover 联动使用 onMouseEnter/Leave + Set 索引，无重渲染开销（useRef Map 缓存）
- 标注弹窗蒙层 click 关闭，内容 stopPropagation
- 评分用 ★ 按钮 1-5（颜色 faad14/d9d9d9）
- 改译必填校验（disabled 状态）
- 标注列表带 kind badge（圆角 8px + 白字）

## 文件清单
**后端**：
- `server/src/annotation-schema.mjs`（NEW）
- `server/src/router.mjs`（+5 routes / +5 handlers）
- `server/test/translate-realtime.test.mjs`（NEW）
- `server/test/translate-annotation.test.mjs`（NEW）

**前端**：
- `web/src/pages/TranslationPage.tsx`（+RealtimeTranslateMode ~340 行）
- `web/src/design/icons.tsx`（+BoltIcon）
- `web/test/RealtimeTranslateMode.test.tsx`（NEW）
