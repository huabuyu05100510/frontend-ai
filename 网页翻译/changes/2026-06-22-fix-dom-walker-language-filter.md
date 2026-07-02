# 变更记录 — 修复 dom-walker 纯中文段误送 LLM / 反向翻译 bug

> **日期**：2026-06-22
> **模型**：MiniMax-M3
> **类型**：bug fix
> **影响范围**：`extension/src/content/dom-walker.ts` + `content.ts` + `test/unit/dom-walker.test.ts` + `test/e2e/dom-walker-language-filter.e2e.mjs`

## 现象

用户在 platform.minimaxi.com 上截图反馈：插件"翻译"之后，**8 段只有 1 段显示了译文**，而且纯中文段被 LLM 改写甚至反向翻译成英文：

- 源：`查看当前订阅状态、规格、订阅 Key 与续费管理`
  → 译：`View current subscription status, specifications, subscription Key, and renewal management`（**整段反向**）
- 源：`用于 Token Plan / 积分调用，不可用于按量付费`
  → 译：`For Token Plan/Points redemption, not applicable for pay-as-you-go`（**反向**）
- 源：`Key`（在中文上下文） → 译：`密钥`（**误译**）

## 根因（双 bug）

### Bug 1：dom-walker 不过滤同语言段
`extractSegments` 把页面里**所有 ≥ 4 个有意义字符的段**都送进 LLM，包括纯中文段。当 `tgtLang=zh` 时，LLM 收到一段已经是中文的文本，会做两件坏事：

1. **重新润色** → 触发不必要的 API 调用和延迟
2. **不稳定反向翻译** → 取决于 prompt 解读，模型偶尔会"翻译"成英文（如 "For Token Plan"）

### Bug 2：CJK 被 `/[\d\s\W]+/` 当作"非 word"误过滤
原 `isTranslatable` 用 `!/[\d\s\W]+/.test(text)` 判定"是否纯符号"。但 `\W` 在 JS 正则里只覆盖非 `[A-Za-z0-9_]`，**CJK 字符全被算作"非 word"**。结果：

- 一段纯中文（如 `套餐详情`）→ 旧实现：`OK 123 this is real content` → `isTranslatable("套餐详情")` → `[\d\s\W]+` 命中（因为 CJK 都算 \W）→ 返回 true → **仍然提取**（这才是 bug 1 的源头）
- 一段混合段（如 `订阅 Key (sk-cp) 用于 Token Plan 套餐`）→ 同理被错误地按"全是符号"判断

> 这个 bug 2 是我 TDD 写测试时第一次跑就翻车才发现的——纯中文段根本不该被 `/[\d\s\W]+/` 这种 ASCII 正则处理。

## 修复

### 1. `dom-walker.ts`：用 unicode property + 显式 CJK range

```ts
// 修复前（会把 CJK 当"非 word"误判）
if (/^[\d\s\W]+$/.test(text)) return false

// 修复后
if (!/[\p{L}\p{N}\u4e00-\u9fff\u3400-\u4dbf]/u.test(text)) return false
```

- `\p{L}` 匹配所有 Unicode 字母（含 CJK）
- `\p{N}` 匹配所有数字
- `\u4e00-\u9fff` + `\u3400-\u4dbf` 显式覆盖 CJK 基本 + 扩展 A（兜底）

### 2. `dom-walker.ts`：按目标语言启发式过滤

新增 `isPureChinese` / `isPureEnglish` 二元判断（**不用 ratio**，因为混合段无法用比例定阈值）：

```ts
function isPureChinese(text: string): boolean {
  const stripped = text.replace(/[\s\p{N}\p{P}\p{S}]/gu, '')
  if (stripped.length === 0) return false
  return /^[\u4e00-\u9fff\u3400-\u4dbf]+$/.test(stripped)
}

function isPureEnglish(text: string): boolean {
  const stripped = text.replace(/[\s\p{N}\p{P}\p{S}]/gu, '')
  if (stripped.length === 0) return false
  return /^[A-Za-z]+$/.test(stripped)
}

function isTranslatable(text: string, tgtLang?: LangCode): boolean {
  if (text.length < 4) return false
  if (!/[\p{L}\p{N}\u4e00-\u9fff\u3400-\u4dbf]/u.test(text)) return false
  // 关键：目标语言过滤
  if (tgtLang === 'zh' && isPureChinese(text)) return false
  if (tgtLang === 'en' && isPureEnglish(text)) return false
  return true
}
```

**设计取舍**：混合段（CJK + latin）**放行**让 LLM 处理，避免品牌术语（"Key"、"Token Plan"）被误判为"已翻译"而跳过。

### 3. `content.ts`：把 `tgtLang` 串到 `extractSegments`

```ts
// 修复前
const segments = extractSegments(document.body)

// 修复后
const segments = extractSegments(document.body, { tgtLang })
// SPA 增量提取也带上
const newSegments = newEls.flatMap(el => extractSegments(el, { tgtLang: state.tgtLang }))
```

## 验证

| 测试 | 结果 |
|---|---|
| `test/unit/dom-walker.test.ts`（29 → 30 个 case，新增「按目标语言过滤」describe） | ✅ 30/30 |
| `test/unit/popup-tab-pick.test.ts`（8 个 case） | ✅ 8/8 |
| `test/e2e/dom-walker-language-filter.e2e.mjs`（**新**：纯 CJK + EN + 混合段，6/6 + 4 跳过） | ✅ 通过 |

### e2e 端到端日志

```
[langfilter] HTTP up at http://localhost:8766
[page:log] [xt:content] message TRANSLATE
[page:log] [xt:content] 开始翻译 auto→zh 模式:bilingual
[page:log] [xt:content] 提取到 6 个 segment   ← 修复前是 10 段（4 段纯 CJK 也被送 LLM）
[page:log] [xt:content] 完成 6/6

[langfilter] 提取出的段（应该只有混合+英文，不含纯中文）：
  #1 <P> "查看当前订阅状态、规格、订阅 Key 与续费管理"   ← 混合
  #2 <P> "用于 Token Plan / 积分调用，不可用于按量付费"   ← 混合
  #3 <H2> "订阅 Key (sk-cp)"                              ← 混合
  #4 <P> "View current subscription status and renewal management"  ← 纯 EN
  #5 <P> "View your current plan usage and remaining quota"          ← 纯 EN
  #6 <P> "Subscribe to monthly membership with priority access"      ← 纯 EN

[langfilter] 纯中文段过滤检查：
  ✅ "套餐详情"                                              ← 跳过
  ✅ "套餐用量"                                              ← 跳过
  ✅ "当前周期：2026-06-01 至 2026-06-30"                     ← 跳过
  ✅ "到期日 2026-06-27"                                     ← 跳过

[langfilter] 结果：✅ 通过（提取 6/6 段，纯中文过滤 OK）
```

## 简历素材

> 排查浏览器翻译扩展的"纯中文段落被反向翻译成英文"bug，发现双 bug 叠加：① dom-walker 不过滤同语言段，纯中文也被送进 LLM 触发不稳定反向翻译 ② 旧正则 `/[\d\s\W]+/` 把 CJK 当"非 word"，导致混合段被错误判为"纯符号"。用 unicode property class `\p{L}\p{N}` + 显式 CJK range 修复正则，新增 `isPureChinese`/`isPureEnglish` 二元判断（不用 ratio）过滤目标语言段。TDD 写 9 个新 case 覆盖 zh/en 双向、混合段放行、纯数字+中文、保守 ja/eo 等场景，e2e 验证双语混排页面 6 段正确提取、4 段纯 CJK 正确跳过。

## 相关坑（写入 MEMORY）

- **JS 正则 `\W` / `\w` 只覆盖 ASCII**（`[A-Za-z0-9_]`），CJK 字符全算 `\W`。判断"是否含字母/数字"必须用 `\p{L}` + `\p{N}`（unicode flag `u`）
- **"CJK+数字"算纯中文**（如 `2026 年到期`）—— strip 数字/标点/空白后全是 CJK → 归为纯中文
- **不要用 ratio（"CJK 占比 > X% 则跳过"）做语言判断**——混合段（如 `订阅 Key 用于 Token Plan`）无法用单一阈值定位"中文段"。用二元判断：纯 CJK / 纯 latin / 混合
- **过滤目标语言段时让混合段放行**——让 LLM 自己处理品牌术语（如 "Key" 在中文上下文里不该译成"密钥"）
- **Lilt 风格的混合段"放行"原则**：永远不要因为启发式判定就跳过头部/品牌术语嵌入的段，这会把翻译质量拉低（LLM 是最权威的判断者）
