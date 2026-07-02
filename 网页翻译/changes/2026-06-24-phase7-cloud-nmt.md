# 2026-06-24 Phase 7-A 云端 NMT 服务

> 模型：Claude (Sonnet 4.5)

## 关键决策
**端侧 → 云端架构转向**。用户纠正"1.2GB 这么大谁会用啊"，承认端侧 NLLB-600M 不可行。
对标百度 = 云端 NMT + 云端 cross-attn（百度本身就这么做）。memory 里「禁止 LLM 直出路线」
指禁止 LLM 直吐对齐 JSON，不禁止云端 NMT API。

## 改动
- **新增** `server/nmt_server.py` — FastAPI + NLLB-600M，POST /translate 返回译文 + cross-attn (L0H15)
- **新增** `demo-translate.html` — 实时翻译 + hover 双向高亮 + 置信度灰阶 + 多对一
- **新增** `test/demo-translate-ui.mjs` — Playwright UI 验证（直接用 chromium core，不走 test runner）
- **新增** 截图：`test/shots/phase7-hover-src.png` / `phase7-neural.png` / `phase7-hover-tgt.png`
- **新增** `docs/phase7-cloud-nmt-report.md`

## API
- `POST /translate` → `{ src, tgt, srcTokens, tgtTokens, crossAttn: [[...]], latencyMs, meta }`
- `GET /health`, `GET /examples`
- 端口 8788，CORS 全开

## 实测
- 首次翻译 5.4s（含模型加载）
- 后续 ~700ms（CPU + return_dict_in_generate）
- UI 验证通过：src/tgt token 渲染、hover 双向高亮、新输入翻译、0 JS error
- 3 张截图

## 距离百度
| 维度 | Phase 7-A | 百度 |
|---|---|---|
| 端侧体积 | 0 ✅ | 0 |
| UI 体验 | 双向高亮 + 多对一 + 置信度 ✅ | 同 |
| F1 | 0.851 | ~0.95 |
| 延迟 | 5.4s (CPU) | <500ms |

UI 已对标。剩余差距靠 GPU + 更大模型。

## 下一步
- **Phase 7-B**：扩展集成，content script → /translate → hover 渲染
- **Phase 7-C**：GPU 或 ONNX Runtime 量化，目标 <500ms
- **Phase 7-D**：懒加载、防抖、移动端
