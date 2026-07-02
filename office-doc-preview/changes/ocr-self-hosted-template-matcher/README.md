# 自研 iocr 模板匹配（OCR Self-Hosted Template Matcher）

## 概述
对标 [百度 iocr 控制台](https://ai.baidu.com/iocr) 的两步式模板识别能力，**自研**实现"参照字段锚点 + 识别字段坐标投影"的核心算法，使用通用 OCR API（百度 `accurate_basic`）作为底座，**不再调用百度封装好的 iocr processor**。

## 功能完成度 vs 百度 iocr 控制台

| 能力 | 百度 iocr | 本实现 | 说明 |
|------|----------|--------|------|
| 画参照字段（视觉锚点）+ 填实际文字 | ✅ | ✅ | `referenceFields[].text` |
| 画识别字段（提取目标）+ 字段类型 | ✅ | ✅ | `fields[].type` |
| 单模板识别 | ✅ | ✅ | `POST /api/ocr/recognize-template` |
| 多模板批量识别 | ✅ | ⏳（共用模板切换） | 当前按 templateId 单次调用 |
| 模板训练（自动学习参照字段） | ✅ | ❌ | 当前手动画框 |
| 模板发布到云端 | ✅ | ❌ | 当前 JSON 文件本地存储 |
| 模板导入/导出 (JSON) | ✅ | ✅ | 通过 `listTemplates/getTemplate` |
| 样例图上传 | ✅ | ✅ | `sampleImageUrl` 字段 |
| 多模板匹配（自动选最佳） | ✅ | ❌ | 当前按 templateId 显式选 |
| 字段联动（值触发其他字段） | ✅ | ❌ | 当前独立提取 |

> 对标核心 **算法** 完整实现，云端训练/发布能力超出本地存储范围。

## 核心算法（自研）

### 1. 文字相似度（bigram Jaccard + 子串包含）
- 中文字符级 bigram 比较：`发票号码` vs `发票号码：`（OCR 常加冒号）仍给高分
- 子串包含：标签常被拆词/合并时仍能匹配
- 中位数聚合：中位相似度比 mean 更鲁棒，规避单个低质量匹配拖累总体评分

### 2. 坐标变换估计（中位数 + 抗离群）
- 多锚点 → 计算 (template→matched) 偏移向量集
- 用中位数（中位数 < mean 对离群点更稳定）
- 缩放 clamp 到 `[0.5, 2.0]`，避免误匹配导致 1000% 拉伸
- 单锚点退化：只有 1 个锚点也能计算，但鲁棒性下降（前端可提醒"加更多锚点"）

### 3. 阅读顺序排序（先 y 后 x）
- 同一行容差 `avgH * 0.5`，跨越多行则按 y 升序
- 横向排列的中文表格/发票行项目依然能正确拼出顺序

## 改动文件
| 文件 | 类型 | 说明 |
|------|------|------|
| `server/src/baidu-iocr.mjs` | 修改 | 新增 `recognizeGeneral()`（百度通用 OCR accurate_basic） |
| `server/src/template-matcher.mjs` | 新增 | 自研模板匹配引擎（4 个核心导出） |
| `server/src/ocr-template.mjs` | 修改 | schema 升级：`referenceFields[]` 校验 + 持久化 |
| `server/src/router.mjs` | 修改 | `handleOcrRecognizeTemplate` 重写为通用 OCR + 自研匹配双路径 |
| `server/test/template-matcher.test.mjs` | 新增 | 16 个核心算法单元测试 |
| `server/test/baidu-ocr.test.mjs` | 新增 | 3 个 access_token 缓存测试 |
| `server/test/ocr-template-reference.test.mjs` | 新增 | 8 个 referenceFields 校验测试 |
| `web/src/pages/OCRPage.tsx` | 修改 | 模板编辑模式升级为 2 步向导 + 对齐诊断面板 |

## 测试覆盖
- 服务端：30 文件 / 388 tests 全部通过（新增 27 个：模板匹配 + baidu OCR + referenceFields）
- 前端：23 文件 / 232 tests 全部通过（OCRPage 模板编辑 7 → 10 个）
- tsc 编译：无错误

## 响应示例（自研 iocr 引擎）

```json
{
  "engine": "self-hosted-iocr",
  "fields": [
    { "name": "发票号码", "value": "12345678", "confidence": 0.92, "hitCount": 1, "location": {...} },
    { "name": "开票日期", "value": "2024-03-15", "confidence": 0.88, "hitCount": 1, "location": {...} }
  ],
  "anchors": [
    { "id": "r1", "name": "发票号码标签", "text": "发票号码", "matched": true, "score": 0.95, "region": { "text": "发票号码" } },
    { "id": "r2", "name": "开票日期标签", "text": "开票日期", "matched": true, "score": 0.92, "region": { "text": "开票日期" } }
  ],
  "transform": { "offsetX": 100, "offsetY": 130, "scaleX": 1.0, "scaleY": 1.0 },
  "alignmentScore": 0.93,
  "regionsTotal": 45,
  "ms": 412,
  "isMock": false,
  "logId": 1234567890
}
```

## 响应头可观测性
- `X-OCR-Engine`: `self-hosted-iocr` | `self-hosted-iocr-mock` | `baidu-iocr`（兼容旧模板）
- `X-OCR-Ms`: 识别总耗时（含 OCR + 匹配）
- `X-OCR-Fields`: 字段数
- `X-OCR-Alignment`: 对齐质量 `[0, 1]`，前端据此配色（绿 ≥0.7 / 黄 ≥0.3 / 红 <0.3）

## 使用流程
1. OCRPage → 「+ 创建模板」
2. 第 1 步：拖拽画参照字段框 + 填写实际文字（如「发票号码」）
3. 第 2 步：拖拽画识别字段框 + 命名（如「发票号码」）
4. 保存（带 name + scenario）
5. 「模板管理」列表 → 「试一试」选已上传图片 → 看到对齐诊断 + 字段值

## 后续路线（未在本变更）
- ⏳ 多模板批量识别：服务端 API 支持一次传多张图 + 多模板
- ⏳ 自动锚点建议：基于 OCR regions 自动选相似度最高的作为新参照字段
- ⏳ 字段联动：识别字段 A 后，用其值（如身份证号）去定位另一个字段 B
- ⏳ 历史样本回放：保存每次识别时的 (region, anchor, score) 用于模型迭代
