# 2026-06-24 — 三份技术方案批量产出

## 模型
Claude (Sonnet 4.5)

## 改动
- `docs/local-translation-tech-plan-V1.1.md` — 翻译方案修正版
  - 模块 A/B 解耦
  - MVP 走路径 B（后端 PyTorch，不量化，不依赖 WebGPU）
  - D1-D2 spike 先验证 attention 导出
- `docs/image-search-tech-plan-V1.md` — 图搜方案
  - Chinese-CLIP 浏览器内推理（不调豆包）
  - hnswlib-wasm 索引 + 地理分片
  - 复用 attention-visualizer 做图像区域高亮
  - 数据集：TripAdvisor + Unsplash（避开滴滴 IP）
- `docs/shared-tech-stack.md` — 共享技术栈
  - 5 个共享 lib（webgpu-engine / attention-visualizer / model-cache / streaming-inference / backend-detector）
  - 70% 代码复用率
  - 证明前端 ML 工程抽象能力

## 关键决策
1. **MVP 不依赖 WebGPU / 量化**（路径 B，1-2 周可验证）
2. **图搜完全独立于滴滴**（公开数据 + 开源模型，IP 干净）
3. **共享 lib 抽象**（70% 复用率是简历亮点）

## V1 文档归档
- `local-translation-tech-plan-V1.md` — 被 V1.1 替代（架构错误）

## 待执行
- D1 spike：本地跑 PyTorch + opus-mt-en-zh，验证 attention 矩阵导出
- spike 通过 → Phase 1
- spike 失败 → 改用 NLLB-200 或 Bergamot
