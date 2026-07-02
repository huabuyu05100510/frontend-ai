# Translation Dual-Column Specification

## ADDED Requirements

### Requirement: Dual Column Layout

The DualColumnLayout component SHALL render source and target documents side by side with independent Canvas + TextLayer + SVGLayer stacks. Each pane SHALL occupy 50% width using flex layout.

#### Scenario: Document upload and initial render

- **WHEN** a user uploads a PDF/DOCX file
- **THEN** the component SHALL display a loading skeleton (gray canvas placeholder) within 200ms
- **AND** pdfium-wasm SHALL render the first page in a Web Worker
- **AND** the first page SHALL be displayed in the left pane within 2 seconds (P50)
- **AND** the `onLoad` callback SHALL be invoked after the first page renders

#### Scenario: Translation result renders in right pane

- **WHEN** the translation API returns results
- **THEN** the right pane SHALL render translated pages via the same Worker
- **AND** both panes SHALL have independent Canvas + TextLayer + SVGLayer stacks

### Requirement: Scroll Sync Bridge

The ScrollSyncBridge SHALL synchronize scrolling between left and right panes based on paragraph alignment mapping. It SHALL use a lock flag to prevent circular scroll triggers, with a 500ms timeout as a safety fallback.

#### Scenario: Left scroll triggers right scroll

- **WHEN** the user scrolls the left pane
- **THEN** the bridge SHALL find the topmost visible paragraph in the left pane
- **AND** SHALL look up the corresponding paragraph in the alignment map
- **AND** SHALL scroll the right pane to the mapped paragraph's Y position
- **AND** the scroll SHALL use `behavior: 'instant'` (not smooth)

#### Scenario: Lock prevents circular triggering

- **WHEN** a scroll event triggers a scroll on the opposite pane
- **THEN** the lock flag SHALL be set to true
- **AND** the opposite pane's scroll event SHALL be ignored while locked
- **AND** the lock SHALL be released after the next `requestAnimationFrame`

#### Scenario: No mapping found for empty area

- **WHEN** the user scrolls to an area with no mapped paragraph (e.g., page margins)
- **THEN** the opposite pane SHALL maintain its current scroll position
- **AND** `console.warn` SHALL log `ScrollSync: no mapping found for paragraph {id}`
- **AND** if the lock is held for > 500ms, it SHALL be force-unlocked

### Requirement: Transparent Text Layer

The TextLayer SHALL overlay transparent, selectable DOM text on top of the Canvas rendering. It SHALL use `opacity: 0` normally and `opacity: 0.0001` during text selection to allow native copy-paste while preventing visual interference.

#### Scenario: Text layer construction with scale

- **WHEN** `buildTextLayer(textItems, 1.5)` is called
- **THEN** a `<div>` SHALL be created with `position:absolute;inset:0;opacity:0;user-select:text`
- **AND** each TextItem SHALL produce a `<span>` with absolute positioning
- **AND** `span.style.left` SHALL equal `item.bbox.x * scale`
- **AND** `span.style.top` SHALL equal `item.bbox.y * scale`
- **AND** `span.style.fontSize` SHALL equal `item.fontSize * scale`
- **AND** `span.style.transform` SHALL include `scaleX()` to correct DOM-width vs Canvas-width discrepancy

#### Scenario: Selection visibility toggle

- **WHEN** the user starts a text selection (selectionchange fires with non-collapsed selection)
- **THEN** the text layer SHALL set `opacity: 0.0001` (selection blue highlight visible, text invisible)
- **WHEN** the selection is cleared
- **THEN** the text layer SHALL return to `opacity: 0`

### Requirement: Virtual Page Pool

The page pool SHALL maintain a maximum of 6 pages in memory (viewport ±2 + 2 pre-render). Pages outside this window SHALL be evicted via LRU, with `ImageBitmap.close()` called to release GPU memory.

#### Scenario: Page eviction on scroll

- **WHEN** the user scrolls past page 5 and the pool already contains 6 pages
- **THEN** the page farthest from the viewport SHALL be evicted
- **AND** `bitmap.close()` SHALL be called on the evicted page's ImageBitmap
- **AND** the new page entering the viewport SHALL be rendered and added to the pool

#### Scenario: Large page resolution downgrade

- **WHEN** a single page's ImageBitmap exceeds 50MB (`width * height * 4 > 50MB`)
- **THEN** the page SHALL be re-rendered at 0.5x resolution
- **AND** a `console.warn` SHALL log the downgrade

#### Scenario: Total memory cap

- **WHEN** total JS heap exceeds 300MB (`performance.memory.usedJSHeapSize`)
- **THEN** the oldest out-of-viewport page SHALL be evicted regardless of LRU distance
- **AND** a warning SHALL be logged with the current heap size

### Requirement: Paragraph Alignment Mapping

The ParagraphMapper SHALL build a bidirectional alignment map between source and target paragraphs using confidence scores from the translation API.

#### Scenario: Building alignment map

- **WHEN** `buildAlignMap(srcParagraphs, tgtParagraphs, mappings)` is called
- **THEN** a `Map<string, {leftY: number, rightY: number}>` SHALL be returned
- **AND** each source paragraph ID SHALL map to its corresponding left and right Y positions

#### Scenario: Binary search for nearest paragraph

- **WHEN** `lookupByScrollTop('left', 1500)` is called
- **THEN** the alignment map SHALL be binary-searched to find the paragraph whose Y position is closest to 1500
- **AND** the corresponding `{leftY, rightY}` entry SHALL be returned