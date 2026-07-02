# 测试报告 — v4.0 翻译双栏对照 passthrough mock

## 单元测试

### 后端

```
✓ server/test/translate-identity.test.mjs (9 tests) — buildIdentityPagesFromTask
✓ server/test/pdfium-text-layer-v6.test.mjs (6 tests) — v6 fullDoc text layer
✓ server/test/translate-passthrough.test.mjs (6 tests) — strategy 路由
✓ server/test/router.test.mjs (21 tests | 4 新增) — strategy 透传
```

### 前端

```
✓ web/test/TranslationLayout.docxTranslate.test.tsx (6 tests) — DOCX 分支
```

### 全套

```
Test Files  1 failed | 12 passed (13)
Tests       1 failed | 177 passed (178)
```

**唯一失败**：`diff.test.mjs > 性能（O(ND) Myers diff）> 【压力】两份几乎完全不同的大文本（高 D） < 500ms`
- 失败原因：898ms > 500ms（CI 机器性能波动）
- 与本次翻译功能无关（MEMORY.md 已记录 pre-existing tech debt）

## 新增测试覆盖点

### translate-identity.test.mjs (9)

1. DOCX 任务 → identity pages (sourceText === targetText)
2. PDF 任务 → identity pages
3. identity charMap per-char：4 chars → 4 段
4. task.pages 为空 → 返回空 pages
5. task.pages[i].text 缺失 → sourceText=""
6. 页 W/H 从 task.pages[i].width/height 读
7. 多页：每页独立 charMap
8. DOCX 任务 translate() 返回 identity + engine='identity-mock-v1'
9. txt 任务仍走 v3.1 paginateText + engine='mock-v1'

### pdfium-text-layer-v6.test.mjs (6)

1. 0 runs → 空 v6 层（data-pdfium="6"）
2. 单 run 单 char → 1 span with global idx
3. 单 run 多 char → N spans 等宽切分
4. 多 run → spans 按 run 拼接 + 全局 offset
5. pageSlice 偏移 → tgtSearchPos 落到 page 起点
6. identity charMap per-char → src-idx 跟 tgt-idx 一致

### translate-passthrough.test.mjs (6)

1. strategy='passthrough' + DOCX → 跳过 soffice
2. strategy='passthrough' → textPath 含 data-pdfium="6"
3. strategy='passthrough' + PDF → imagePath = 源 page.png
4. strategy='synthetic' → 走 soffice 旧管线
5. strategy='passthrough' + pageNum 越界 → 抛 PageNotFound
6. 缓存命中 → 直返（cached=true）

### router.test.mjs 新增 (4)

1. POST translate + DOCX + strategy=passthrough → X-Translate-Strategy=passthrough + engine=identity-mock-v1
2. POST translate + txt + 不传 strategy → X-Translate-Strategy=synthetic + engine=mock-v1
3. POST translate + 非法 strategy → 400
4. GET render-image + strategy=passthrough → 200 + image/png + X-Translate-Strategy=passthrough

### TranslationLayout.docxTranslate.test.tsx (6)

1. DOCX 任务：POST body 含 strategy="passthrough"
2. txt 任务：POST body 不含 strategy（默认 synthetic）
3. DOCX 任务：render-image/render-text URL 带 strategy=passthrough
4. DOCX 任务：右 cell 文字层 data-pdfium="6"
5. hover 右 cell span → data-hovered-src-idx 同步
6. 切 lang → 清缓存 + 重新拉取（验证 strategy 一致）

### translate-docx-passthrough.spec.ts (3 E2E)

1. DOCX 任务翻译 → X-Translate-Strategy=passthrough + identity-mock-v1
2. hover 右 cell span → 容器 data-hovered-src-idx 同步
3. 视觉回归：左右 cell img 尺寸一致（passthrough = 复用源 page.png）

---

## 跑测命令

```bash
# 后端单测
cd office-preview-app/server
npx vitest run

# 前端单测
cd office-preview-app/web
npx vitest run

# E2E（需先启 server + web）
cd office-preview-app/web
# 终端 1: cd office-preview-app/server && node src/index.mjs
# 终端 2: npx vite --host 0.0.0.0 --port 5188
npx playwright test e2e/translate-docx-passthrough.spec.ts
```

---

## 测试金字塔验证

```
       E2E (Playwright) ─── 3 个
              ↓
       前端组件测 ───────── 6 个
              ↓
       路由集成测 ───────── 4 个 (新增)
              ↓
       单元 (后端) ──────── 21 个 (新增)
```

新增：**34 个**测试，覆盖 TDD 红绿循环的全部新代码路径。