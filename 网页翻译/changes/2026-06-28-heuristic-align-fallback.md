# 2026-06-28 hover + 标注修复：启发式对齐降级

## 问题
LaBSE 服务（`127.0.0.1:8788`）不可用时，`background.ts` 发送 `ALIGN_ERROR`，
导致 `wrapTokens()` 永远不调用，`[data-xt-tok]` spans 不创建，
hover 高亮和标注 ✏️ 候选词完全失效。

## 根因
架构强依赖本地 ML 服务（~500MB ONNX 模型需手动下载启动），
不适合生产/普通用户场景。

## 修复
`background.ts` `handleAlignQuery()` catch 块改为：
1. `tokenizeSimple(text)`：CJK 逐字切词，拉丁/符号按空格切词
2. `heuristicAlign(src, tgt, segId)`：对角线位置映射（`src[i] → tgt[floor(i*tgtLen/srcLen)]`）
3. 发送 `ALIGN_RESPONSE`（不再是 `ALIGN_ERROR`）

另加 3s AbortController 超时，LaBSE 不在线时快速失败不阻塞。

## 测试
- `align-integration.test.ts` 更新 "fetch 失败" case：期望 ALIGN_RESPONSE + heuristic tokens
- `npx vitest run` → 209/209 ✓
- `npm run build` → ✓ built in 147ms

## 影响
- **解决**：无本地服务时 hover 和标注恢复可用
- **代价**：对齐精度降到启发式水平（F1 ~0.3-0.4 vs LaBSE 0.851）
- **用户感知**：hover 高亮仍有视觉反馈，词对应准确度较低但不影响翻译主流程
