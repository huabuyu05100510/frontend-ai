# Tasks: Multimodal AI Render Engine

## 1. Core Infrastructure

- [ ] 1.1 Create `src/core/types.ts` with all type definitions (Rect, Point, Position, Annotation, InteractionState, KernelEvent, FieldConfig, OCRTemplate, Paragraph, ParagraphMapping)
- [ ] 1.2 Implement `src/core/EventBus.ts` — typed pub/sub with emit/on/once/clear, handler exception isolation
- [ ] 1.3 Implement `src/core/StateMachine.ts` — 8 interaction states with transition table, illegal transition warning
- [ ] 1.4 Implement `src/core/AnnotationStore.ts` — CRUD, batch status, confidence filter, page range query, undo (20-step)
- [ ] 1.5 Implement `src/layers/SVGLayer.ts` — wavy underline, annotation box, text label, resize handles, highlight, preview rect

## 2. Coordinate Adapters

- [ ] 2.1 Create `src/adapters/CoordAdapter.ts` — abstract interface with toScreenRects/hitTest/rangeSearch/invalidate/destroy
- [ ] 2.2 Implement `src/adapters/ImageCoordAdapter.ts` — pixel-to-screen with scale factor, R-Tree, ResizeObserver auto-invalidate
- [ ] 2.3 Implement `src/adapters/DocumentCoordAdapter.ts` — page-to-screen with per-page scale, cross-page boundary isolation
- [ ] 2.4 Implement `src/adapters/TextCoordAdapter.ts` — offset-to-screen via createRange+getClientRects, font change invalidation

## 3. Utility Functions

- [ ] 3.1 Create `src/utils/coord.ts` — normalizeRect, rectArea, scaleRect, rectToClientRect, clientPointToRelative, rectsOverlap
- [ ] 3.2 Create `src/utils/svg.ts` — makeSVGElement, wavyPathD (amplitude 1.5px, wavelength 5px), setAttrs
- [ ] 3.3 Create `src/utils/measure.ts` — measureTextWidth via OffscreenCanvas (Worker-safe)
- [ ] 3.4 Create `src/utils/rtree.ts` — SpatialIndex class wrapping rbush (load, rebuild, hitTest with tolerance, rangeSearch)

## 4. Common UI Components

- [ ] 4.1 Implement `src/components/ErrorBoundary.tsx` — fallback UI, onError/onRetry props, stack overflow protection
- [ ] 4.2 Implement `src/components/LoadingSkeleton.tsx` — canvas/text/image variants, pulse animation, prefers-reduced-motion
- [ ] 4.3 Implement `src/components/EmptyState.tsx` — icon + title + description + action button
- [ ] 4.4 Implement `src/components/Toast.tsx` — 4 types (success/error/warning/info), auto-dismiss 3s, max 3 concurrent

## 5. Translation Dual-Column Scene

- [ ] 5.1 Implement `src/renderers/TextLayer.ts` — transparent DOM text layer with scaleX correction, selectionchange toggle
- [ ] 5.2 Implement `src/scenes/translation/ParagraphMapper.ts` — build alignment map, binary search lookup
- [ ] 5.3 Implement `src/scenes/translation/ScrollSyncBridge.ts` — bidirectional scroll sync with lock flag + 500ms timeout
- [ ] 5.4 Implement `src/scenes/translation/DualColumnLayout.tsx` — 4-state loading, pdfium Worker integration, virtual page pool (6 pages max, LRU, 50MB single-page downgrade)
- [ ] 5.5 Add wasm load failure handling — 10s timeout, retry with cache-bust, max 2 retries

## 6. Inspection Annotation Scene

- [ ] 6.1 Implement `src/scenes/inspection/DecorationPlugin.ts` — ProseMirror DecorationSet, 5 error type classes (wavy-red/orange/blue/green/purple), muted class
- [ ] 6.2 Implement `src/scenes/inspection/ErrorPanel.tsx` — summary badges, filter tabs, error cards with accept/ignore, keyboard navigation
- [ ] 6.3 Implement `src/scenes/inspection/useInspection.ts` — shared hook, F8/Shift+F8 navigation, 500ms debounce API call
- [ ] 6.4 Implement `src/scenes/inspection/InspectionText.tsx` — ProseMirror editor + DecorationPlugin + ErrorPanel
- [ ] 6.5 Implement `src/scenes/inspection/InspectionDocument.tsx` — pdfium Worker + SVG wavy overlay + ErrorPanel, zoom rebuild
- [ ] 6.6 Implement error tooltip — auto-position (flip on overflow), hover/click accept/ignore

## 7. OCR General Scene

- [ ] 7.1 Implement `src/renderers/ImageRenderer.ts` — img load, display scale, ResizeObserver
- [ ] 7.2 Implement `src/scenes/ocr-general/TextResultPanel.tsx` — ordered text list, low-confidence display (opacity 0.4 + ⚠️), copy single/all
- [ ] 7.3 Implement `src/scenes/ocr-general/OCRGeneralView.tsx` — 4-state loading, ImageRenderer + SVGLayer + TextResultPanel, bidirectional hover
- [ ] 7.4 Implement OCR timeout handling — 20s AbortController, partial results render, image switch cancel

## 8. OCR Custom Template Scene

- [ ] 8.1 Implement `src/scenes/ocr-custom/DrawTool.ts` — crosshair cursor, preview rect, 400px² minimum area, ESC cancel
- [ ] 8.2 Implement `src/scenes/ocr-custom/ResizeTool.ts` — 8 handles with correct cursors, 20×20px minimum, box move
- [ ] 8.3 Implement `src/scenes/ocr-custom/ConfigPanel.tsx` — field form (name/type/required/regex), save disabled when empty, delete confirm
- [ ] 8.4 Implement `src/scenes/ocr-custom/TemplateManager.ts` — CRUD, localStorage persistence, draft auto-save
- [ ] 8.5 Implement `src/scenes/ocr-custom/TemplateEditor.tsx` — toolbar, image + SVG + ConfigPanel, beforeunload protection
- [ ] 8.6 Implement keyboard micro-adjustment — Arrow keys 1px, Shift+Arrow 10px

## 9. Performance & Monitoring

- [ ] 9.1 Implement `src/hooks/useRenderTiming.ts` — performance.mark/measure wrapper, P50/P95 calculation
- [ ] 9.2 Implement `src/hooks/useMemoryMonitor.ts` — Chrome performance.memory sampling, 300MB threshold, ring buffer
- [ ] 9.3 Implement `src/monitoring/performance.ts` — semantic mark helpers (pdf:first-page, ocr:recognize, annotation:hitTest)
- [ ] 9.4 Implement `src/monitoring/error-tracking.ts` — ErrorReporter interface, default console fallback, Sentry injection point

## 10. Accessibility

- [ ] 10.1 Add ARIA attributes to all annotation elements (role, aria-label, aria-describedby, aria-live)
- [ ] 10.2 Implement keyboard navigation (F8, Shift+F8, Escape, Tab, Enter, Arrow keys)
- [ ] 10.3 Add color-blind safe patterns for all 5 error types (solid/dashed/dotted/double/thick)
- [ ] 10.4 Implement prefers-reduced-motion support (disable all transitions/animations)
- [ ] 10.5 Implement focus management (move focus on panel open, return on close)

## 11. Integration & Polish

- [ ] 11.1 Create `src/styles/annotations.css` — all wavy classes, annotation box styles, resize handles, preview rect, GPU compositing
- [ ] 11.2 Create `src/index.ts` — export all scene components and core types
- [ ] 11.3 Implement `src/hooks/useAnnotationSync.ts` — EventBus ↔ React state bridge
- [ ] 11.4 Implement `src/hooks/useKeyboardNav.ts` — global keyboard shortcut registration
- [ ] 11.5 Implement `src/hooks/useAutoSave.ts` — 30s interval draft auto-save to localStorage
- [ ] 11.6 Write integration tests for all 8 capability specs
- [ ] 11.7 Performance profiling — verify first-page ≤ 2s P50, hover ≤ 16ms, memory ≤ 300MB