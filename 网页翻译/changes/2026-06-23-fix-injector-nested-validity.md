# 2026-06-23 · P0-3 injector HTML5 合法嵌套

> 模型：Claude (Sonnet 4.5)

## 现象
`extension/src/content/injector.ts:72-78` 永远 `document.createElement('span')` 作为译文容器，再 `srcEl.parentNode!.insertBefore(tgtEl, srcEl.nextSibling)`。当 segment 是 `<li>/<td>` 时：
- `<ul><li data-xt-id=s1>` →译文变成 `<ul><li>原文</li><span>译文</span></ul>`，UL 直接含 SPAN 是 HTML5 非法嵌套
- 浏览器做 mutation correction 自动修正（典型：把 span 推到 ul 外面），CLS 飙升、布局错乱
- 现有 `injector.test.ts` 全用 `<p>` + body 父亲，**完全没覆盖真实容器**

## 根因
`<span>` 是 inline 元素，不是所有 parent 都允许；不同 parent 容器的合法子元素集合不同（UL 只允许 LI、TR 只允许 TD/TH、P 只允许 phrasing、TABLE 只允许 caption/colgroup/thead/tbody/tfoot/tr）。injector 对父容器无感知。

## 修复
1. **`injector.ts`**：新增 `chooseWrapper(srcEl)`，根据 `srcEl.parentElement.tagName` + `srcEl.tagName` 决定 wrapper：
   | parent / srcEl | wrapper tag | variant class |
   |---|---|---|
   | UL / OL | `<li>` | `xt-translation--li` |
   | TR | `<td>` | `xt-translation--td` |
   | P / SPAN / A / EM / STRONG / ...（phrasing） | `<span>` | `xt-translation--inline` |
   | DIV / BODY / SECTION / ARTICLE / MAIN / ... | `<div>` | `xt-translation--block` |
   | srcEl 是 THEAD/TBODY/TFOOT/TR，或 parent 是 TABLE/THEAD/TBODY/TFOOT | 跳过 + warn | — |

2. **`content.css`**：新增 `.xt-translation--li/--td/--block/--inline` 4 个变体，分别处理 list-item/table-cell/block/inline 的展示。
3. **`docs/browser-extension-tech-plan-V1.md` 4.4 节**：同步描述 + 加 "2026-06-23 更新" 注释，示例代码改用 `chooseWrapper(seg.node)`。
4. **结构化日志**：每次 inject 打 `{event:'inject bilingual', segmentId, parentTag, wrapperTag, variant}`；不支持的容器组合打 warn（带 srcTag/parent 字段）。

## 验证（自己跑通）
```
$ cd extension && npx vitest run test/unit/injector.test.ts
 Test Files  1 passed (1)
      Tests  19 passed (19)
```

新增 8 个用例（HTML5 合法嵌套 describe 块）：
- UL/LI 容器 → wrapper LI、parent UL、`ul > span` 选择器 0 命中
- OL/LI 容器 → wrapper LI、parent OL
- TR/TD 容器 → wrapper TD、parent TR、`tr > span` 选择器 0 命中
- DIV/P 容器 → wrapper DIV、parent DIV
- P/SPAN（phrasing）→ wrapper SPAN、parent P、`p > div` 选择器 0 命中（关键：P 不能含 DIV）
- srcEl 是 TBODY → 跳过 + warn 触发，无 wrapper 插入
- srcEl 是 TABLE 本身 → sibling DIV 走 body（合法）
- 流式 append 在 LI wrapper 下仍正常 + restore() 清理所有 wrapper

> 测试用 `document.querySelectorAll('ul > span, ul > div').length === 0` 这类 child combinator 选择器直接断言 HTML5 合法性，等价于 validator 检查。

全量 vitest：5/6 文件 pass（73 个测试 72 pass）。唯一失败 `translator.test.ts:194 结果顺序` 是 **pre-existing flaky**：mock 的 `content.slice(-2)` 生成非法 JSON，parseSseDelta 返回空被当 rate-limit 触发指数退避（1s→2s→4s→8s 累计 15s 超时）。该测试不导入 injector、本次未触碰 translator.ts，与本改动无关。建议后续单独修。

## 简历素材
- HTML5 嵌套合法性：injector 容器感知，按父元素选 LI/TD/DIV/SPAN，杜绝 mutation correction 引起的 CLS 与布局抖动
- 结构化决策日志（JSON line），每个 inject 决策可观测可追踪；不支持的容器组合显式 warn 而非静默失败
- CSS 变体分离：`xt-translation--li/--td/--block/--inline`，同一份译文样式在不同容器中自适应
- TDD：先写 8 个嵌套合法性用例，跑红 → 改 `chooseWrapper` → 跑绿

## 相关坑
- jsdom 不会对 HTML5 非法嵌套做 mutation correction（浏览器才做），所以单测必须用 `parent > child` CSS 选择器显式断言合法性，不能依赖 parser 抛错
- "srcEl 是 TABLE 本身" ≠ "srcEl 在 TABLE 内部"：前者 wrapper DIV 落到 body（合法 sibling），后者才需要特殊处理。最初测试假设错了，把 table-as-srcEl 当成 skip 用例
- phrasing parent 集合（P/SPAN/A/EM/STRONG/B/I/CODE/Q/CITE/SUB/SUP/LABEL/SMALL/U/S）必须显式枚举，否则 P 内插 DIV 仍然非法（P 只接受 phrasing content）
