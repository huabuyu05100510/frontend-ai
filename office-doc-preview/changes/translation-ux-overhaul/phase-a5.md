# Phase A.5 — 翻译标注响应头可观测性（server）

> 模型：claude-sonnet-4-6
> 分支：`feature/design-overhaul`
> 日期：2026-07-02

## 目标

为 `/api/translate/annotation` 三端点（POST/GET/DELETE）补齐标准化可观测响应头，
供 Phase A.6 前端链路追踪、CI 灰度对比、用户文档示例引用。

## 范围

仅 server 端点，不触碰 `annotate.mjs`（格式转换标注模块）、不触碰
`annotation-schema.mjs`（编码逻辑保持原样）。

## 修改清单

### 1. `server/src/router.mjs`

| 函数 | 新增响应头 | 新增日志行 |
|---|---|---|
| `handleAnnotationCreate` (≈line 1736) | `X-Translate-Annotation-Id`、`X-Translate-Annotation-Kind`、`X-Translate-Annotation-Updated-At` | `[translate-annotation ISO] task=... kind=... action=add segId=... id=...` |
| `handleAnnotationList` (≈line 1768) | `X-Translate-Annotation-Count`、`X-Translate-Annotation-Task-Id`（空文件 / 非空两路径都设置） | `[translate-annotation ISO] task=... action=list count=...` |
| `handleAnnotationDelete` (≈line 1826) | `X-Translate-Annotation-Removed-Id`、`X-Translate-Annotation-Task-Id` | `[translate-annotation ISO] task=... action=delete id=...` |

- 旧的 `X-Annotation-Id / Kind / Count / Removed` 响应头全部保留（向后兼容）。
- 旧的 `console.log('[annotation-create/list/delete] ...')` 也保留，便于现有日志抓取规则。
- `X-Translate-Annotation-Updated-At` 取 `annotation.createdAt`（encode() 在创建时设置
  `Date.now()`，与"createdAt 即 updatedAt"语义一致；schema 没有独立的 updatedAt 字段）。

### 2. 新测试 `server/test/translate-annotation-headers.test.mjs`

8 个测试覆盖：
- POST 返回 `X-Translate-Annotation-Id / Kind / Updated-At`
- POST 三种 kind 全部正确返回 Kind 头
- GET 返回 `X-Translate-Annotation-Count` (=N) 与 `X-Translate-Annotation-Task-Id`
- GET 缺省 `taskId` 时返回 `standalone`
- DELETE 返回 `X-Translate-Annotation-Removed-Id`

## 验收

- 新增测试：`8/8 PASS`（`npx vitest run test/translate-annotation-headers.test.mjs`）
- 现有测试：`10/10 PASS`（`npx vitest run test/translate-annotation.test.mjs`）
- 全量 server 套件（剔除无关的 `image-search.test.mjs` 既有缺失模块故障）：
  `42 files / 519 tests PASS`
- 基线对比：511 → 519（+8）

## 不在范围

- 前端 `useAnnotation` 读取新 header（Phase A.3 已 done，无需重写）
- E2E/Visual 回归（Phase D 范围）
- 任何 schema 字段新增（保持 0 改动向后兼容）

## 已知遗留

`test/image-search.test.mjs` 在改动前就失败（引用不存在的
`src/image-search.mjs`）。与本次工作无关，建议另开分支处理。