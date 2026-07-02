# W1-1 现状盘点报告

> **日期**：2026-06-25
> **模型**：Claude (Sonnet 4.5)
> **目的**：网页翻译项目「做好」前的现状摸底

---

## 1. 项目结构概览

```
网页翻译/
├── extension/        # Chrome MV3 扩展（React 19 + Vite）
├── lib/              # 纯函数模块（对齐算法、placeholder、span-projector 等）
├── server/           # Phase 7 自建 NMT 服务（Python）
├── server.mjs        # 旧版 demo 服务（端口 8787）
├── spike/            # phase3/5/6 实验脚本（PyTorch）
├── benchmark/        # 对齐算法 benchmark
├── test/             # node:test + Playwright 测试
├── docs/             # 文档（Phase 1-7 报告都在）
├── changes/          # 变更记录
├── demo*.html        # 3 个独立 demo 页面
└── package.json      # 根包，依赖残缺
```

## 2. 核心代码量

| 模块 | 行数 | 状态 |
|---|---|---|
| `extension/src/content/` | 702 | 完整 |
| `extension/src/background/` | 471 | 完整 |
| `extension/src/popup/` | 250 | 完整 |
| `lib/` | 2357 | 完整但**未接入扩展** |
| `server/nmt_server.py` | - | 完整（Phase 7）|
| **总计** | **~3500+** | |

## 3. ⚠️ 关键发现：4 周做的对齐代码**完全没接入扩展**

**这是最大的问题**。

| 已有（lib/） | 在扩展里用了吗 |
|---|---|
| `labse-simalign.mjs`（LaBSE+SimAlign, F1=0.841） | ❌ 未接入 |
| `marian-crossattn-aligner.mjs`（Route C, F1=0.704） | ❌ |
| `ensemble-aligner.mjs`（A+C 加权投票, F1=0.781） | ❌ |
| `span-projector.mjs`（Lilt §4.3 + prefix-sum） | ❌ |
| `placeholder.mjs`（⟦tN:tag⟧ codec） | ❌ |
| `segment-encoder.mjs` | ❌ |
| `aligned-translator.mjs` | ❌ |
| `word-aligner.mjs` | ❌ |
| `kv-aligner.mjs` | ❌ |

扩展目前的 `injector.ts` 只做最基础的事：**把译文 textContent 塞到一个新元素里，原文后面**。没有 hover、没有对齐、没有跨段可视化。

**Phase 1-7 的所有算法工作都没流到产品里**——这是必须先修的。

## 4. 扩展现有功能（确实做了的）

✅ MV3 service worker + content script 完整架构
✅ React 19 + Vite 构建
✅ DOM 段落抽取（dom-walker.ts，含语言检测）
✅ 翻译批调度（scheduler.ts，每批并发）
✅ 双语注入（injector.ts，bilingual + translation-only 两种模式）
✅ MiniMax API 集成（translator.ts）
✅ chrome.storage.local 翻译缓存
✅ SPA 路由支持（MutationObserver）
✅ Popup UI（React）
✅ 状态浮层（shadow DOM 注入，可见状态）
✅ Hot reload（dev 模式自动重载）
✅ 合法嵌套处理（P/UL/TR → LI/TD/SPAN）

**扩展本身是个完整可用的翻译扩展，只是没有「对齐 + hover」**。

## 5. 严重问题清单

### 🔴 P0：API key 硬编码泄漏
`extension/src/background/background.ts:7`：
```ts
const HARDCODED_API_KEY = 'sk-cp-CTTWiVtvGm0OBw1iL4B1FK7eeoJngFK36tTV4PCnTrTaFfkRd098Bqx0gEahgvezGKyB8yl-3GGYtYjVmvntyEIeusrcyTsdXu_VFv6pIA_wpwCv6tL2TRM'
```
注释说「已外泄，部署前必须轮换」，但**仓库里依然有这个 key**。如果代码上 git/公开，立刻泄漏。

### 🟡 P1：根 package.json 没有 test 脚本
```json
"scripts": { "test": "echo \"Error: no test specified\" && exit 1" }
```
lib/ 有 14 个 `.test.mjs` 文件，但**没有可运行的测试入口**。CI/回归全断。

### 🟡 P1：扩展 README 是默认 Vite 模板
没说怎么 dev / build / 加载到浏览器。新人/面试官打开看不懂。

### 🟡 P1：lib/ 与扩展是两套代码
扩展用 TypeScript，lib/ 是 .mjs。**lib/ 的 ESM 能否被扩展打包进去没验证**。可能要建桥接层或重写。

### 🟢 P2：dist/ 可能过期
`extension/dist/` 存在但不知何时 build 的，hotreload.txt 是 dev 模式产物。

### 🟢 P2：3 个 demo 页面（demo.html / demo-aligned.html / demo-translate.html）跟扩展脱节
各自独立，维护负担。

## 6. Phase 1-7 已有资产

### 算法（lib/）
- ✅ Route A LaBSE+SimAlign（F1=0.841）
- ✅ Route C cross-attn L0H15（F1=0.851）
- ✅ Ensemble 加权投票（F1=0.781）
- ✅ Placeholder codec（XSS 安全）
- ✅ Span-projector（Lilt §4.3 + prefix-sum）
- ✅ Segment-encoder（DOM → 翻译单元）

### 服务（server/）
- ✅ FastAPI + NLLB-600M（端口 8788）
- ✅ POST /translate 返回译文 + cross-attn 矩阵

### 测试 fixture（test/fixtures/）
- ✅ NLLB cross-attn 各 head（L0H15/L1H4/L1H10/L2H4）
- ✅ LaBSE embeddings
- ✅ 8 cases 金标准（align-gold.json）

### 文档（docs/, changes/）
- ✅ Phase 3/5/6/7 报告
- ✅ 变更记录完整

## 7. W1 接下来的优先级建议

**调整原 W1 任务顺序**：

| 原计划 | 调整后 | 理由 |
|---|---|---|
| W1-2 扩展本地跑起来 | ✅ 保留 | 必须先确认扩展能 build + 加载 |
| W1-3 翻译后端选型 | ✅ 保留 | 决定走 MiniMax（已有 key）还是切 GPT |
| W1-4 5 站点 e2e | ⏸ 推迟到 W1-5 之后 | 先把 hover 对齐接上再测站点更有意义 |
| **W1-5 alignment 接入** | 🔼 **提到 W1-2 之后** | 这是最大缺口，必须早做 |
| **新增 W1-2.5**：修 API key 泄漏 | 🔴 P0 | 不能留 |
| **新增 W1-2.6**：补 test 脚本 | 🟡 P1 | 回归测试要能跑 |

## 8. 「做好」最小可行定义（重新明确）

扩展 build 成功 → 加载到 Chrome → 在 BBC 一篇真实文章上：
1. ✅ 能抽出段落、调 API、注入双语
2. ✅ hover 任一词，能看到对齐高亮（**用上 Phase 1-7 的 alignment**）
3. ✅ 0 JS error
4. ✅ 截图存档

**达成这个 = W1 完成**。后面 W2-W4 是把"能跑"变成"50+ 站点稳定 + 性能数据 + 可观测"。

---

## 下一步

立即执行 W1-2：扩展本地 build + 加载验证。
