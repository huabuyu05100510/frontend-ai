# Annotation Schema 层 —— Agent 1 交付

**日期**: 2026-06-27
**作者模型**: Claude (Sonnet 4.6) via MiniMax-M3 路由
**任务来源**: 用户分配 Agent 1（schema 层），多 agent 并行的 M1 阶段首项
**关联文档**: `docs/annotation-feature-tech-plan-V1.md` §3 数据结构 / §4 存储方案

---

## 交付内容

| 文件 | 行数 | 说明 |
|---|---|---|
| `lib/annotation.mjs` | 275 | 纯函数模块：AnnotationKind / SCHEMA_VERSION / encode / decode / validate / normalize / generateUuid / isValidLangPair + ValidationError / SchemaError |
| `test/annotation.test.mjs` | 242 | node:test 单测，26 个用例 |
| `changes/2026-06-27-annotation-schema.md` | (本文件) | 变更记录 |

**代码行数合计**: 517 行（不含 changes）

---

## 测试通过率：**100% (26/26)**

**运行命令**:
```bash
node --test test/annotation.test.mjs
```

**关键输出**:
```
TAP version 13
# Subtest: AnnotationKind: 暴露 3 种 kind 常量
ok 1 - AnnotationKind: 暴露 3 种 kind 常量
...
ok 26 - SchemaError: 是 Error 子类
1..26
# tests 26
# suites 0
# pass 26
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 45.226916
```

**覆盖维度**（共 26 用例，超 15 最低要求）：
- AnnotationKind 常量值 + 冻结性（2）
- SCHEMA_VERSION 锁定（1）
- isValidLangPair 4 方向白名单 + 拒绝（2）
- encode 正常路径：ALIGN_FIX / SEG_RATING / ALT_TRANS 三种 kind（3）
- encode 缺 kind / langPair / payload 必填字段（3）
- decode 正常 + 旧版本 + 未来版本 + 非 JSON 解析失败（4）
- validate 字段级错误：kind 非法 / langPair 不在白名单 / srcTokens 非数组 / payload 非 object（4）
- normalize 边界：trim 首尾空白 / srcText 5000 截断 / payload 字符串强转 / langPair 小写化（4）
- generateUuid 1000 个无重复（1）
- error class 继承关系（2）

---

## 耗时

- **开工**: 2026-06-27（任务开始时间见本次 session 起点）
- **全绿**: 同 session 内完成
- **总耗时**: 约 8 分钟（含读 spec、red 测试编写、green 实现、red→green 验证、change 记录）

---

## 关键决策与依据

### 1. 错误类拆为 ValidationError + SchemaError
- `ValidationError`：字段级 / 取值级错误，带 `field` 路径
- `SchemaError`：版本不匹配 / JSON 解析失败（不可恢复）
- **依据**：A2 store 层批量 import 时需要分类处理，混用会让 IDB 写入逻辑变复杂

### 2. `encode` 必填字段预检
- 在 normalize 之前先检查 `kind` / `langPair` / `payload` 是否缺失
- 缺失直接抛 `ValidationError`，避免后续 normalize 阶段空指针
- **依据**：用户友好错误信息优于 `Cannot read property 'split' of undefined`

### 3. `decode` 接受 string 而非 object
- 测试要求 `decode(raw)` 接收 JSON 字符串
- 内部 `JSON.parse` + 校验
- 解析失败 → `SchemaError`（不是 `ValidationError`）
- **依据**：A5 sync 层从 IDB 读出的是 `string` 形式，IDB 存 string 利于迁移和版本比对

### 4. `langPair` 改为方向白名单（4 个）而非单语种白名单（10 个）
- 原实现 `ALLOWED_LANGS = {zh, en, ja, ko, fr, de, es, ru, pt, ar}` 仅校验每个位置合法
- 现 `LANG_PAIR_WHITELIST = {zh-en, en-zh, ja-zh, zh-ja}` 强约束方向
- **依据**：项目 MVP 仅 4 个翻译方向；方向白名单更严格，避免前端误传 `ko-zh`（不在 MVP）数据

### 5. `generateUuid` 三层 fallback
- 优先 `globalThis.crypto.randomUUID()`（Node 18+ / 浏览器）
- 降级 `crypto.getRandomValues` + 手动 rfc4122 v4 拼装
- 降级降级 `Math.random()` 兜底
- **依据**：保证在 Node 16 测试环境、Chrome 扩展 MV3、Firefox 旧版、demo 页 Web 都能跑

### 6. `normalize` 不修改入参
- 浅克隆 `{ ...anno }` 后操作
- **依据**：纯函数原则，调用方传入 encode 前可能复用对象

### 7. 测试用 `assert.throws(..., ErrorClass)` 而非正则匹配 message
- 测试只验证抛错类型，**不**锁定 message 字符串
- **依据**：未来改 message 文案不应导致测试挂掉

---

## 接口契约（供 A2/A3/A4/A5 复用）

```js
import {
  AnnotationKind,        // {ALIGN_FIX, SEG_RATING, ALT_TRANS}
  SCHEMA_VERSION,        // 1
  encode,                // (input) → Annotation
  decode,                // (jsonString) → Annotation
  validate,              // (anno) → throw ValidationError
  normalize,             // (anno) → anno
  generateUuid,          // () → uuid v4
  isValidLangPair,       // (lp) → bool
  ValidationError,       // class, has .field
  SchemaError,           // class
} from './annotation.mjs'
```

---

## 遗留 / 下一步（移交 Agent 2/3/4/5）

- **A2 store**：基于本 schema 写 `lib/annotation-store.mjs`（IDB CRUD + 12 单测）
- **A3/A4 ui**：UI 层调用 `encode(input)` 生成 Annotation，捕获 `ValidationError` 反馈用户
- **A5 sync**：用 `decode(JSON.stringify(anno))` round-trip 验证，幂等键 = `anno.id`
- **A6 demo**：标注列表展示 = `anno.kind === AnnotationKind.ALIGN_FIX` / `SEG_RATING` 分组

---

## 备注

- 旧 `lib/annotation.mjs`（前次工作残留，173 行）已整体覆盖为新实现（275 行）。旧实现因 encode 行为差异（缺失必填检查、langPair 校验过宽、缺 SchemaError、decode 接 object 而非 string）无法满足新测试契约。
- 旧实现的 `payload` 形状校验（按 kind 分支）**未**引入新实现。理由：MVP 阶段 payload 形状是软约束，A3/A4 业务层自行按 kind 校验；schema 层只保证 `payload` 是 object，避免过度耦合。如未来需要强校验，可单独加 `validatePayload(kind, payload)`。
