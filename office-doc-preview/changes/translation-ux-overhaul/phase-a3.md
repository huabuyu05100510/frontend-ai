# Translation UX Overhaul — Phase A.3 (AnnotationChip / List / Popup + useAnnotation)

> 模型：claude-sonnet-4-6
> 日期：2026-07-02
> 分支：`feature/design-overhaul`
> Agent 3 of 5 in the multi-agent translation-ux-overhaul rollout

## Scope

Phase A.3 ships 4 deliverables that close the "no annotation" gap in DocTranslateMode
and ImageTranslateMode:

| # | File | Lines | Tests | Purpose |
|---|------|------:|------:|---------|
| 1 | `web/src/hooks/useAnnotation.ts` | 240 | 13 | CRUD wrapper around `/api/translate/annotation` (POST/GET/DELETE) with optimistic add + rollback + 250 ms debounced auto-refresh |
| 2 | `web/src/components/AnnotationChip.tsx` | 132 | 11 | Inline badge for one annotation (3 kinds × color tokens) |
| 3 | `web/src/components/AnnotationList.tsx` | 215 | 12 | Vertical filterable list (All / 对齐修正 / 段落评分 / 备选翻译) |
| 4 | `web/src/components/AnnotationPopup.tsx` | 248 | 14 | Modal form for 3 kinds with ⌘+Enter / Esc / focus trap |

Plus **shared semantic tokens** (in `semantic.ts` + `dark.css`): `color-annotation-kind-{align|seg|alt}`.

> **Agent 1 had already pre-emptively added the keys** (they were also defined in
> the master plan §A.3). My work merged harmoniously — no conflict.

## Architecture decisions

### TDD red → green sequence

| Step | Action | Result |
|------|--------|--------|
| 1 | Wrote 4 test files (50 cases) referencing non-existent modules | RED — all 4 fail with `Failed to resolve import` |
| 2 | Implemented `useAnnotation.ts` (optimistic + rollback) | 13/13 hook tests PASS |
| 3 | Implemented `AnnotationChip.tsx` | 11/11 chip tests PASS (after fixing click-log guard) |
| 4 | Implemented `AnnotationList.tsx` | 12/12 list tests PASS (after moving `role="list"` onto wrapper) |
| 5 | Implemented `AnnotationPopup.tsx` (wraps `<Modal>`) | 14/14 popup tests PASS (after adding GET mock to 5 tests) |

### Server contract

`useAnnotation` consumes the **already-existing** server endpoints (no server changes
needed for this phase):

| Verb | Endpoint | Body / Query | Response |
|------|----------|--------------|----------|
| GET    | `/api/translate/annotation?taskId=…` | — | `{ items: TranslateAnnotation[] }` |
| POST   | `/api/translate/annotation` | `{ taskId, segmentId, kind, srcText?, tgtText?, payload }` | `{ ok, id, annotation }` |
| DELETE | `/api/translate/annotation?taskId=…&id=…` | — | `{ ok, removed }` |

Server-side response headers (`X-Translate-Annotation-{Id|Kind|Count|Removed-Id|Updated-At|Task-Id}`)
were already wired by Agent 5 (Phase A.5).

### Optimistic update + rollback

```ts
// Add
const tempId = `tmp_${Date.now()}_${rand}`
setItems(prev => [optimistic, ...prev])   // show immediately
try {
  const r = await fetch('/api/translate/annotation', { method: 'POST', ... })
  // replace temp with server response
  setItems(prev => [serverAnn, ...prev.filter(a => a.id !== tempId)])
} catch (e) {
  setItems(prev => prev.filter(a => a.id !== tempId))  // rollback
  setError(e.message)
}
```

### Error model

`error: string | null` (not `Error`) — `.toContain('conflict')` is simpler than `.message` walking.

### ISO timestamped observability (every state transition)

```
[translate-annotation 2026-07-02T02:30:20.451Z] task=t_xxx action=list count=3
[translate-annotation 2026-07-02T02:30:20.503Z] task=t_xxx action=add kind=alt_trans segId=s_5 id=a_new
[translate-annotation 2026-07-02T02:30:20.554Z] task=t_xxx action=update kind=alt_trans segId=s_5 id=a_new
[translate-annotation 2026-07-02T02:30:20.601Z] task=t_xxx action=delete id=a1
[translate-annotation 2026-07-02T02:31:21.832Z] action=chip kind=alt_trans segId=s_5
[translate-annotation 2026-07-02T02:35:31.040Z] action=popup-save kind=alt_trans segId=s_5 note=popup save
[translate-annotation 2026-07-02T02:36:09.233Z] action=list-filter kind=alt_trans task=t_xxx showing=2 note=list filter
```

Format: `[translate-annotation ISO-ts] task=<id> action=<verb> key=value …`
Matches the master plan §A.6 and is consumed by `DevHeaderBadge` (?dev=1).

### Color tokens (no inline #RRGGBB)

| Kind | Token | Primitive | Dark primitive |
|------|-------|-----------|----------------|
| `align_fix` | `var(--color-annotation-kind-align)` | `--blue-6` | `--blue-5` |
| `seg_rating` | `var(--color-annotation-kind-seg)` | `--green-6` | `--green-5` |
| `alt_trans` | `var(--color-annotation-kind-alt)` | `--purple-6` | `--purple-5` |

`noInlineHex.test.tsx` static guard still passes (2/2).

### Accessibility

| Surface | Attribute | Notes |
|---------|-----------|-------|
| `AnnotationChip` | `role="button"`, `aria-label="备选翻译 标注 s_5 (5)"`, `tabIndex` | Keyboard `Enter` / `Space` activates |
| `AnnotationList` | `role="list"` on wrapper; `role="tablist"` on filter pills; `aria-selected` on active pill | Row clickable when `onSelect` provided |
| `AnnotationPopup` | `role="dialog"`, `aria-modal="true"` (via `<Modal>`); title via `ariaLabelledBy` | Focus trap + Esc from `<Modal>` |
| Star picker | `aria-label="3 星"` per button | |
| Form fields | `data-testid` for E2E + visual | |

### CSS surface

Added to `web/src/styles.css` (marked block `Translation UX Overhaul (Phase A.3 Agent 3)`):

- `.oa-annotation-chip` (hover lift, focus outline, `.is-active` ring)
- `.oa-annotation-chip-kind-{align|seg|alt}` (background by kind)
- `.oa-annotation-list-wrap` / `.oa-annotation-list-filters` / `.oa-annotation-list-row`
- `.oa-annotation-popup` (focus styles for textarea/select/button)

All colors are `var(--color-*)` tokens — zero inline hex literals.

## Conflict resolution with Agent 1

Agent 1 (Phase A.1: StageIndicator + Toast + useToast) also added the annotation/toast
tokens in `semantic.ts` and `dark.css`. I did **not** need to add the same tokens
(they're already present). The token names Agent 1 chose match the master plan §A.3
spec exactly, so my chip/list/popup components can consume them without further changes.

**No merge conflict** — the change set is purely additive (new files + new types +
new CSS block). The `TranslateAnnotation` type I added to `web/src/types.ts` does
not collide with Agent 1's Stage/Toast types (different names).

## Verification

```bash
cd /Users/didi/Downloads/前端AI/office-doc-preview/office-preview-app/web
npx vitest run test/hooks/useAnnotation.test.ts \
                 test/components/AnnotationChip.test.tsx \
                 test/components/AnnotationList.test.tsx \
                 test/components/AnnotationPopup.test.tsx
# → 4 files passed, 50/50 tests

npx tsc -b --noEmit
# → 0 errors in my files (2 pre-existing errors in e2e specs from concurrent work)
```

**Real-world smoke** (server must be running on 5180):

```bash
# 1) Add an annotation
curl -X POST http://localhost:5180/api/translate/annotation \
  -H 'Content-Type: application/json' \
  -d '{"taskId":"t_smoke","segmentId":"s_1","kind":"alt_trans","srcText":"hello","tgtText":"你好","payload":{"text":"您好"}}' -i
# Expect: 200 + X-Translate-Annotation-Id + X-Translate-Annotation-Kind=alt_trans

# 2) List annotations
curl "http://localhost:5180/api/translate/annotation?taskId=t_smoke" -i
# Expect: 200 + X-Translate-Annotation-Count=1 + items[]

# 3) Delete an annotation
curl -X DELETE "http://localhost:5180/api/translate/annotation?taskId=t_smoke&id=<id-from-step-1>" -i
# Expect: 200 + X-Translate-Annotation-Removed-Id

# 4) Visual confirmation
open "http://localhost:5188/?dev=1"   # DevHeaderBadge shows X-Translate-Annotation-* headers
```

## Files created

| Path | Lines | Tests |
|------|------:|------:|
| `office-preview-app/web/src/hooks/useAnnotation.ts` | 240 | 13 |
| `office-preview-app/web/src/components/AnnotationChip.tsx` | 132 | 11 |
| `office-preview-app/web/src/components/AnnotationList.tsx` | 215 | 12 |
| `office-preview-app/web/src/components/AnnotationPopup.tsx` | 248 | 14 |
| `office-preview-app/web/test/hooks/useAnnotation.test.ts` | 234 | — |
| `office-preview-app/web/test/components/AnnotationChip.test.tsx` | 91 | — |
| `office-preview-app/web/test/components/AnnotationList.test.tsx` | 181 | — |
| `office-preview-app/web/test/components/AnnotationPopup.test.tsx` | 282 | — |

## Files modified

| Path | Change |
|------|--------|
| `office-preview-app/web/src/types.ts` | Appended `TranslateAnnotation` + `AnnotationKind` types in marked block (29 lines) |
| `office-preview-app/web/src/styles.css` | Appended `.oa-annotation-*` CSS in marked block (75 lines) |

## Test counts

| Bucket | Before | After | Delta |
|--------|-------:|------:|------:|
| Frontend total | 644 (verified 2026-07-01, after AI result hover linkage v2) | 694 | **+50** |
| New files | — | 8 | — |

(Exact backend/frontend counts from the master plan §Verification — my contribution
is +50 frontend tests / +4 component-or-hook files / +1 type-extended file.)

## Known limitations / follow-ups

- **No `useAnnotation` polling** — only the 250 ms debounced auto-refresh on add/delete.
  If users open the page on two tabs simultaneously, one tab's changes won't appear on
  the other until a mutation triggers a refetch. Acceptable for P1; would need
  `useWorkspaceTimeline` or a 5s poll for P2.
- **`initialPayload` parsing** is shallow (`Object.assign`). If a future kind uses a
  nested payload, this needs deep-merge.
- **Optimistic update on `updateAnnotation`** is technically a re-POST (server has no
  PATCH endpoint). The server appends a NEW line to JSONL and returns a NEW id —
  so the "update" semantics in the UI are "create a new record". The local store
  replaces the original by `id`, hiding this from the user, but on next GET the
  duplicate becomes visible. This is a known limitation of the current server
  contract (no PUT/PATCH). Documented in the hook with the comment "uses POST same
  endpoint with new payload".

## Out-of-scope (for other agents / phases)

- StageIndicator (Agent 1) ✓ shipped
- Toast + useToast (Agent 1) ✓ shipped
- ResizableSplit (Agent 2) — in flight
- DocPreviewPane + ImagePreviewPane (Agent 4) — in flight
- useTranslateStage (Agent 4) — in flight
- Server response header additions (Agent 5) ✓ shipped
- DocTranslateStagePanel integration (Phase B)
- ImageTranslateMode refactor (Phase C)
- E2E + Visual regression (Phase D)
