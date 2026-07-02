# 2026-06-23 · P0-2 XSS 三层防御

> 模型：Claude (Sonnet 4.5)

## 现象
review 发现 XSS 链路有 3 处可被注入：

1. `demo.html:319` `sourcePane.innerHTML = html` —— 用户在 `#htmlInput` 粘贴 `<script>` / `<img onerror>` 时直接注入主面板
2. `lib/dom-renderer.mjs:40-43` 只对属性值做 5 字符 escape，**未拦 `javascript:` 协议**、**未拦 `onerror=/onload=` 等 on* 事件 handler**、**未做 tag 白名单**
3. `lib/placeholder.mjs` 内部另有一份相同 `escapeAttr`，两份漂移

## 根因
- escapeAttr 只解决属性值里的 HTML 实体注入，**完全不覆盖 URL 协议、事件 handler、危险 tag**
- demo 用 `innerHTML` 显示用户原文，把"原始 HTML 文本"当成"可执行 HTML"

## 修复（三层防御）
1. **新建 `lib/sanitize.mjs`**：统一白名单/黑名单/URL 过滤原语
   - `TAG_WHITELIST`：p/span/a/em/ul/li/td/table/...（不含 script/iframe/object/embed/svg/math）
   - `ATTR_DENYLIST`：style/srcset/formaction/xlink:href/data-src
   - `sanitizeUrl(url)`：放行 http/https/mailto/tel/相对路径/`#`/`?`/`//`；拒绝 `javascript:` / `vbscript:` / `data:` / 含控制字符
   - `sanitizeAttrs(attrs, hooks)`：剔除 `on*` 大小写不敏感、ATTR_DENYLIST、对 URL_ATTRS 调 sanitizeUrl；拒绝时触发 hooks.onDeny 打日志
   - `escapeAttr/escapeText/isTagAllowed`
2. **新建 `lib/sanitize-html.mjs`**：浏览器侧 DOM-based 兜底（用 DOMParser 解析后 walk+clean），对 tag/attr/url 三层过滤；不依赖 CDN
3. **`lib/dom-renderer.mjs`**：renderHTML 中改用 sanitizeAttrs + tag 白名单 + 内嵌 JSON 日志（拒绝 tag/attr 时打 warn，带上下文）
4. **`lib/placeholder.mjs`**：decode 输出端同上；删除内部 escapeAttr，统一从 sanitize.mjs 引入
5. **`demo.html`**：
   - `sourcePane.textContent = html`（原文以纯文本显示，不再注入）
   - `targetPane.innerHTML = sanitizeHtmlString(result.html)`（白名单兜底）
   - import `/lib/sanitize-html.mjs`

## 验证（自己跑通）
```
$ node --test test/sanitize.test.mjs test/dom-renderer.test.mjs test/placeholder.test.mjs test/segment-encoder.test.mjs test/span-projector.test.mjs
# tests 70  pass 70  fail 0

$ node --test test/xss.e2e.test.mjs
# tests 2  pass 2  fail 0
```

xss.e2e 实测日志（浏览器侧 sanitize 拒绝清单，结构化 JSON）：
```
{"component":"sanitize-html","msg":"url denied","tag":"a","attr":"href","val":"javascript:alert(1)"}
{"component":"sanitize-html","msg":"attr denied","tag":"img","attr":"onerror"}
{"component":"sanitize-html","msg":"tag denied","tag":"script"}
{"component":"sanitize-html","msg":"tag denied","tag":"iframe"}
{"component":"sanitize-html","msg":"attr denied","tag":"div","attr":"style"}
```

恶意用例输入 → 输出对照：
| 输入 | 输出 |
|---|---|
| `<a href="javascript:alert(1)">x</a>` | `<a>x</a>` |
| `<img src="/x.png" onerror="alert(1)">` | `<img src="/x.png">` |
| `<p>ok</p><script>alert(1)</script>` | `<p>ok</p>` |
| `<a href="https://ok.com/path">good</a>` | **保留原样** |
| `<a href="/rel/path">rel</a>` | **保留原样** |

`test/xss.e2e.test.mjs` 第二条用例还断言「整页无 alert dialog 触发」，端到端证明 `<script>` / `javascript:` 在 demo 真实页面里都没执行。

## 简历素材
- 三层 HTML 输出消毒：tag 白名单 + attr 黑名单（on*/style/srcset）+ URL 协议白名单（拒绝 javascript:/vbscript:/data:）
- DOM-based sanitizer（DOMParser + walk+clean）独立于 LLM 输出，覆盖 demo / 扩展两端
- 结构化拒绝日志（JSON line，带 component/tag/attr/val 字段），每个被拒条目可追踪
- 6 处统一原语 + 2 处消费点，杜绝 escapeAttr 漂移

## 相关坑
- JSDoc 里 `on*/style` 的 `*/` 会提前关闭注释块，Node 直接 SyntaxError（`Invalid or unexpected token`）。改成 `on 前缀 / style` 中文描述
- 控制字符（`java\tscript:` / `http://x\x00`）必须**在任何协议判断之前**先拒，否则白名单协议（`http:`）会被 `\x00` 后缀绕过
- playwright `page.on('dialog', ...)` 可断言「alert 未触发」反证 `<script>` 没跑
- 旧 `dom-renderer.test.mjs:96` 题为「属性值 XSS 转义」其实是断言 `javascript:` 被保留 —— 这正是 bug 自证；本次 review 一并改测试断言为「应被剔除」
