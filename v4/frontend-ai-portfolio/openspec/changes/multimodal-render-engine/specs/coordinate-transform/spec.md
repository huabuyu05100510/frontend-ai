# Coordinate Transform Specification

## ADDED Requirements

### Requirement: Image Coordinate Adapter

ImageCoordAdapter SHALL convert pixel-space coordinates (relative to image natural size) to screen-space DOMRect values. The adapter SHALL maintain a scale factor computed as `container.offsetWidth / image.naturalWidth` and SHALL rebuild on resize.

#### Scenario: Pixel coordinates to screen coordinates

- **WHEN** `toScreenRects` is called with a `PixelPosition` having `bbox: {x:100, y:200, w:300, h:400}` and image scale is `0.5`
- **THEN** the returned DOMRect SHALL have `x: 50 + containerBCR.left`, `y: 100 + containerBCR.top`, `width: 150`, `height: 200`
- **AND** floating-point precision SHALL be within ±0.5px

#### Scenario: Scale recalculation on container resize

- **WHEN** the container element is resized (ResizeObserver fires)
- **THEN** the adapter SHALL recalculate `scale = container.offsetWidth / image.naturalWidth`
- **AND** the R-Tree spatial index SHALL be rebuilt
- **AND** all registered annotations SHALL have their screen rects recalculated

### Requirement: Document Coordinate Adapter

DocumentCoordAdapter SHALL convert page-space coordinates (page number + page-relative bbox in points) to screen-space DOMRect values. Each page has its own scale factor computed as `pageElement.offsetWidth / pageWidthPt`.

#### Scenario: Page coordinate to screen coordinate

- **WHEN** `toScreenRects` is called with a `PagePosition` having `page: 0, bbox: {x:72, y:72, w:468, h:648}` and page scale is `1.5`
- **THEN** the returned DOMRect SHALL be relative to the page element's viewport position
- **AND** `DOMRect.x SHALL equal pageBCR.left + 72 * 1.5`
- **AND** `DOMRect.y SHALL equal pageBCR.top + 72 * 1.5`

#### Scenario: Cross-page boundary isolation

- **WHEN** an annotation on page 1 has `bbox.y: 830` (near page bottom, page height 842pt)
- **THEN** `toScreenRects` SHALL return a DOMRect positioned within page 1's viewport
- **AND** the annotation SHALL NOT appear in page 2's viewport

#### Scenario: Rebuild on page zoom

- **WHEN** the document zoom level changes
- **THEN** `invalidate()` SHALL be called
- **AND** all page scales SHALL be recalculated
- **AND** all SVG annotation elements SHALL be repositioned
- **AND** the R-Tree SHALL be rebuilt with new screen coordinates

### Requirement: Text Coordinate Adapter

TextCoordAdapter SHALL convert character-offset positions to screen-space DOMRect values using `document.createRange()` and `getClientRects()`. The adapter SHALL handle multi-line text by returning multiple DOMRect segments.

#### Scenario: Single-line offset to screen rect

- **WHEN** `toScreenRects` is called with an `OffsetPosition` spanning characters 5 to 15 on a single line
- **THEN** a single DOMRect SHALL be returned covering the text range on screen

#### Scenario: Multi-line offset to screen rects

- **WHEN** `toScreenRects` is called with an `OffsetPosition` spanning characters that cross a line break
- **THEN** multiple DOMRect values SHALL be returned (one per line segment)
- **AND** adjacent rects with vertical gap < 2px SHALL be merged into a single rect

#### Scenario: Font change invalidation

- **WHEN** the document font changes (via `document.fonts.ready` or MutationObserver)
- **THEN** the adapter SHALL wait for two `requestAnimationFrame` cycles to allow layout to stabilize
- **AND** then SHALL recalculate all cached offset-to-node mappings

### Requirement: R-Tree Spatial Index

The spatial index SHALL support hit testing with configurable tolerance and range search. When multiple bounding boxes overlap at the hit point, the index SHALL return the annotation with the smallest area.

#### Scenario: Single hit test with tolerance

- **WHEN** `hitTest` is called with a point 1.5px away from the closest annotation bbox edge
- **THEN** the annotation ID SHALL be returned (within 2px tolerance)
- **AND** `null` SHALL be returned if the nearest bbox is > 2px away

#### Scenario: Overlapping boxes hit test

- **WHEN** `hitTest` is called at a point where two annotation bboxes overlap
- **THEN** the annotation with the smaller bounding box area SHALL be returned
- **AND** this ensures the most precise match is selected

#### Scenario: Range search for box selection

- **WHEN** `rangeSearch` is called with a selection rectangle
- **THEN** all annotation IDs whose bboxes intersect the selection rectangle SHALL be returned
- **AND** annotations completely outside the rectangle SHALL NOT be included

### Requirement: Coordinate Transform Pipeline

The coordinate transform pipeline SHALL convert model-output coordinates through a fixed chain: normalized/model coordinates → physical pixels → CSS display coordinates → viewport coordinates. Each step SHALL be reversible for debugging purposes.

#### Scenario: Full pipeline for image coordinates

- **WHEN** model outputs normalized coordinates `{x:0.1, y:0.2, w:0.3, h:0.4}` for a 1920×1080 image displayed at 960px wide
- **THEN** physical pixels SHALL be `{x:192, y:216, w:576, h:432}`
- **AND** CSS coordinates SHALL be `{x:96, y:108, w:288, h:216}`
- **AND** viewport coordinates SHALL include the container's getBoundingClientRect offset