# Design: Multimodal AI Render Engine

## Context

This engine serves four AI-powered document scenarios within a React 18 + TypeScript 5 frontend: translation dual-column comparison, inspection annotation, OCR general recognition, and OCR custom template. The core challenge is overlaying AI model output (coordinates + semantic information) precisely onto original content while maintaining text copyability and interaction linkage.

**Constraints:**
- Browser-only (no Node.js server rendering)
- Must handle large PDFs (200+ pages) without memory exhaustion
- Must support real-time hover interaction at 60fps
- Three distinct coordinate systems must be unified

## Goals / Non-Goals

**Goals:**
- Unified annotation kernel shared across all 4 scenes
- Coordinate system abstraction via adapter pattern
- Pluggable scene architecture — new scenes can be added without modifying core
- Performance: first-page render ≤ 2s P50, hover response ≤ 16ms
- Accessible: keyboard navigation, ARIA, color-blind friendly

**Non-Goals:**
- Real-time collaboration (future)
- Server-side rendering of documents
- Mobile-first responsive (desktop-first, tablet secondary)
- Editing PDF content (read-only overlay)
- Export to PDF/DOCX (future)

## Decisions

### Decision 1: Three-Layer Architecture

**Choice:** Scene Layer → Annotation Kernel → Adapters + Renderers

**Rationale:** The annotation kernel (EventBus, StateMachine, AnnotationStore, SVGLayer) is shared across all 4 scenes. Scenes are isolated from each other. Adapters abstract the 3 coordinate systems. This avoids coupling between scene-specific logic and rendering infrastructure.

**Alternatives considered:**
- Monolithic per-scene: rejected due to code duplication across scenes
- Micro-frontend per scene: rejected as over-engineered for a single-page app

### Decision 2: EventBus over Redux/Zustand

**Choice:** Custom typed EventBus (pub/sub)

**Rationale:** The engine needs fine-grained event-driven communication between SVG layers, panels, and adapters. A state management library would add unnecessary abstraction — the AnnotationStore handles state, the EventBus handles cross-cutting notifications. The EventBus is ~50 lines of code with zero dependencies.

**Alternatives considered:**
- Zustand: rejected because it couples state reads with subscriptions; EventBus is purely notification
- RxJS: rejected as too heavy for the use case

### Decision 3: pdfium-wasm in Web Worker

**Choice:** pdfium-wasm compiled to WebAssembly, running in a dedicated Web Worker

**Rationale:** PDF rendering is CPU-intensive. Moving it to a Worker prevents main-thread blocking. The Worker communicates via `postMessage` transferring ImageBitmap objects (zero-copy). Virtual page pool (6 pages max) keeps memory bounded.

**Alternatives considered:**
- PDF.js: rejected due to larger bundle size and slower rendering
- Server-side rendering: rejected because it adds latency and requires a backend

### Decision 4: ProseMirror for Text Inspection

**Choice:** ProseMirror editor with Decoration plugin for wavy underlines

**Rationale:** ProseMirror's decoration system automatically remaps positions when text is edited, eliminating manual coordinate recalculation. CSS `text-decoration: underline wavy` provides native browser rendering without SVG overhead.

**Alternatives considered:**
- ContentEditable with overlay: rejected due to position drift on edit
- Monaco Editor: rejected as too heavy and not designed for annotation overlays

### Decision 5: SVG for Annotations, Canvas for Content

**Choice:** Canvas for document/image rendering, SVG overlay for annotation boxes and wavy lines

**Rationale:** Canvas is optimal for pixel-level rendering (pdfium output). SVG is optimal for interactive vector overlays (hit testing, CSS animations, hover states). The InteractionLayer is a transparent div that captures mouse events and delegates to hit testing.

**Alternatives considered:**
- All-Canvas: rejected because hit testing and CSS animations are harder on Canvas
- All-SVG: rejected because large documents with many text elements cause SVG performance issues

### Decision 6: R-Tree Spatial Index for Hit Testing

**Choice:** rbush library for R-Tree spatial indexing

**Rationale:** R-Tree provides O(log n) hit testing for annotation bounding boxes. The index is rebuilt on scale/layout changes. For overlapping boxes, the smallest area box is returned.

**Alternatives considered:**
- Brute force iteration: rejected for > 100 annotations
- Quadtree: rejected because R-Tree handles non-uniform distributions better

## Risks / Trade-offs

**[Risk] pdfium-wasm browser compatibility** — Safari and Firefox may have different WASM performance characteristics
→ **Mitigation:** Week 1 compatibility POC before full implementation; fallback to PDF.js if necessary

**[Risk] ProseMirror learning curve** — Complex API for decoration and transaction management
→ **Mitigation:** Allocate 1 extra day in the inspection scene schedule for ProseMirror ramp-up

**[Risk] Floating-point coordinate drift** — Multiple coordinate transformations may accumulate rounding errors
→ **Mitigation:** Spec enforces ±0.5px precision; unit tests verify transform chain end-to-end

**[Risk] Memory leaks from ImageBitmap** — Forgetting to call `.close()` on evicted bitmaps
→ **Mitigation:** Virtual page pool LRU eviction always calls `.close()`; memory monitor warns on > 300MB

**[Risk] Draft data loss in OCR template** — User closes tab with unsaved field configuration
→ **Mitigation:** `beforeunload` event + 30s auto-save to localStorage

## Migration Plan

This is a new engine — no migration from existing code is required. It is designed to be integrated as a standalone module:

1. **Phase 1:** Core infrastructure (Week 1)
2. **Phase 2:** Translation dual-column (Week 2-3)
3. **Phase 3:** Inspection annotation (Week 4-5)
4. **Phase 4:** OCR general (Week 6-7)
5. **Phase 5:** OCR custom template (Week 8-9)
6. **Phase 6:** Integration, performance, polish (Week 10)

**Rollback:** Each scene is independent — if one scene has issues, others are unaffected. The engine is not a breaking change to the existing application.

## Open Questions

1. **WebSocket real-time sync?** — Should annotation changes be broadcast to other users in real-time? (Future consideration, not in scope)
2. **Offline support?** — Should the engine work offline with cached models? (Requires model quantization, not in scope)
3. **Mobile responsive?** — Dual-column layout is desktop-first. Mobile layout would need a stacked design. (Deferred)
4. **Custom annotation types?** — Should third-party scenes be able to register custom annotation types? (Plugin API design needed)
5. **Export to annotated PDF?** — Should the engine support exporting documents with annotations burned in? (Future feature)