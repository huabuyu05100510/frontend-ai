# 2026-06-25 W1-5 词级对齐 hover UI 接入

> **模型**：Claude (Sonnet 4.5)

## 决策

把 Phase 1-7 的 LaBSE SimAlign 对齐成果（Route A，F1=0.841）接进扩展的 hover UI。
用户翻译后，鼠标悬停原文/译文的某个 token，对侧所有对应 token 同步高亮 ——
Phase 1-7 的对齐代码（2357 行 lib/）原本完全游离于扩展之外，现在第一次跑通。

## 架构

```
content script              background SW              LaBSE server (8788)
─────────────────           ────────────────           ────────────────────
[chunk done]──┐                                                │
              │ ALIGN_QUERY                                     │
              ├──────→  handleAlignQuery ──→ POST /align ───────┤
              │                                                │
              │       ALIGN_RESPONSE (srcTokens, tgtTokens,     │
              │       alignments)                               │
              ←──────                            ←───────────────┤
[injector.applyAlignment]                                       │
  - 切 src/tgt 为 token spans (data-xt-tok/seg/idx)              │
[setupHoverDelegation mouseover]                                │
  - 查 alignmentCache[segId]                                     │
  - 给当前 span 加 .xt-hover-active                              │
  - 给配对的另一侧 spans 加 .xt-hover-pair                        │
```

## 改动

- **新增** `server/labse_server.mjs`（~170 行）
  - HTTP server on :8788，懒加载 Xenova/LaBSE
  - `POST /align { src, tgt, strategy }` → `{ srcTokens, tgtTokens, alignments, took }`
  - `GET /health` 健康检查
  - 复用 `lib/labse-simalign.mjs`（Route A，F1=0.841）
- **改** `extension/src/shared/types.ts`
  - 新增 `AlignmentResult` 接口
  - 新增 `ALIGN_QUERY` / `ALIGN_RESPONSE` / `ALIGN_ERROR` 三种 message
- **改** `extension/src/background/background.ts`
  - 新增 `handleAlignQuery()` — proxy 到 LaBSE server + `chrome.storage.local` 缓存（key: `xt_align::{segmentId}`）
  - `onMessage` 监听 `ALIGN_QUERY`
- **改** `extension/src/content/injector.ts`
  - 新增 `applyAlignment(segId, result)` — 把 src/tgt 元素切成 token spans
  - 新增 `wrapTokens(el, tokens, side, segId)` helper
  - 新增 `unwrapTokens()` — restore 时调用
  - 三个新 attr：`data-xt-tok`（src/tgt）、`data-xt-seg`、`data-xt-idx`
- **改** `extension/src/content/content.ts`
  - bilingual 模式下 chunk.done → 自动 `requestAlignment`
  - `handleAlignResponse` / `handleAlignError`
  - `setupHoverDelegation()` 全局事件委托 mouseover/mouseout → 高亮配对 token
- **改** `extension/src/content/content.css`
  - `[data-xt-tok]` 默认 hover 浅蓝
  - `.xt-hover-active`（当前）深蓝白字
  - `.xt-hover-pair`（配对）橙色
  - 暗色模式适配
- **新增** `extension/test/unit/injector-alignment.test.ts`（8 测试）
  - tgt/src token span 切分、幂等、unwrap、英文空格保留
  - hover 配对查找逻辑（一对一 / 多对一 / 无匹配）
- **新增** `extension/test/unit/align-integration.test.ts`（3 测试）
  - chrome.* mock 下完整胶水验证
  - ALIGN_QUERY → fetch /align → ALIGN_RESPONSE
  - cache 命中不重复 fetch
  - fetch 失败 → ALIGN_ERROR
  - AlignmentResult → token span + hover 配对（端到端）

## 验证

### LaBSE server smoke
```bash
$ curl -X POST http://127.0.0.1:8788/align -H 'Content-Type: application/json' \
    -d '{"src":"I love you","tgt":"我爱你"}'
{
  "srcTokens": ["I","love","you"],
  "tgtTokens": ["我","爱","你"],
  "alignments": [
    {"srcIdx":0,"tgtIdx":0,"score":0.9279},
    {"srcIdx":1,"tgtIdx":1,"score":0.9241},
    {"srcIdx":2,"tgtIdx":2,"score":0.9143}
  ]
}
```

### 单测全绿（108/108 通过）
```bash
$ npx vitest run
  Test Files  9 passed (8 + 1 skipped)
  Tests  108 passed | 1 skipped
  Duration  7s
```
新增的 11 个对齐测试（injector-alignment 8 + align-integration 3）全过；
其他 96 个原有测试无回归（仅 1 个无关的 translator timeout flake）。

### 扩展构建
```bash
$ npm run build
  ✓ built in 153ms
  background.ts 7.96 kB
  content.ts   13.54 kB
```

### Playwright e2e（环境受限）
Chrome 149 + Playwright MV3 service worker attach 在本机不稳定（SW 不注册），
改用 chrome.* mock 集成测试覆盖胶水逻辑（见 align-integration.test.ts）。
真实浏览器 hover 截图验证待 e2e 环境修复后补。

## 性能 / 体验

- 对齐**懒触发**：每段 chunk.done 才请求；同一段重复请求用 `pendingAlign` 集合去重
- **chrome.storage.local 缓存**：同段重译不重复打模型
- **首次模型加载**：~7s（Xenova/LaBSE ~500MB ONNX），加载后单次 align ~20-150ms
- token span 不影响布局（inline 元素，padding 0-1px）
- 暗色模式自动适配

## 已知遗留

- alignment server 是本地独立进程，正式部署需考虑：①打包进扩展 ONNX runtime（之前 Phase 7 已知大体积问题）；②改用浏览器内 ort-web 跑（牺牲首屏速度换部署便利）；③保留 server 模式仅 dev 用
- LaBSE 短句（如 "I love you"）会输出"过度对齐"（"The" 对多个汉字），可加 score 阈值过滤；当前全保留以利于召回
- popup 还没暴露"对齐开关"，hover 是默认行为，对齐失败静默降级到无 hover
- W1-4 5 站矩阵因 Playwright SW attach 问题未跑完，待修复环境后补
