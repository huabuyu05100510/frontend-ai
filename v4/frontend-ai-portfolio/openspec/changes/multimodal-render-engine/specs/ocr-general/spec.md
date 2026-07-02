# OCR General Recognition Specification

## ADDED Requirements

### Requirement: Image Rendering and Recognition Box Overlay

The OCRGeneralView SHALL render an uploaded image and overlay recognition boxes with sequence number labels. Recognition boxes SHALL be SVG rectangles with semi-transparent fill and numbered labels.

#### Scenario: Image upload and recognition

- **WHEN** a user uploads an image file
- **THEN** the ImageRenderer SHALL create an `<img>` element with `object-fit: contain`
- **AND** the image SHALL be displayed in the left pane
- **AND** the OCR API SHALL be called with the image file
- **AND** a loading indicator SHALL be shown during API call

#### Scenario: Recognition box rendering

- **WHEN** OCR results are received with 10 regions
- **THEN** `SVGLayer.addAnnotationBox()` SHALL be called for each region with the scaled screen coordinates
- **AND** each box SHALL display a sequence number label (❶, ❷, ... ❿) in the top-left corner
- **AND** the box style SHALL use `strokeColor: '#13c2c2'` and `fillColor: 'rgba(19,194,194,0.08)'`

#### Scenario: Scale recalculation on resize

- **WHEN** the image pane is resized
- **THEN** `ImageCoordAdapter.invalidate()` SHALL be called
- **AND** the scale factor SHALL be recalculated
- **AND** all recognition boxes SHALL be repositioned

### Requirement: Bidirectional Hover Linkage

Hovering over a recognition box on the image SHALL highlight the corresponding text entry in the result panel, and vice versa. Hover events SHALL be throttled to `requestAnimationFrame` for performance.

#### Scenario: Image to panel hover

- **WHEN** the user hovers over a recognition box on the image
- **THEN** the R-Tree hitTest SHALL identify the annotation ID
- **AND** `EventBus.emit(ANNOTATION_HOVER, id)` SHALL be triggered
- **AND** the SVGLayer SHALL highlight the box (`setHighlight(id, true, 'hover')`)
- **AND** the TextResultPanel SHALL scroll to and highlight the corresponding text entry

#### Scenario: Panel to image hover

- **WHEN** the user hovers over a text entry in the result panel
- **THEN** `EventBus.emit(ANNOTATION_HOVER, id)` SHALL be triggered
- **AND** the SVGLayer SHALL highlight the corresponding recognition box on the image

#### Scenario: Hover exit clears highlights

- **WHEN** the user moves the mouse away from all recognition boxes
- **THEN** `EventBus.emit(ANNOTATION_HOVER, null)` SHALL be triggered
- **AND** all highlights SHALL be cleared from both image and panel

### Requirement: Text Result Panel

The TextResultPanel SHALL display recognized text regions in order with confidence indicators. Low-confidence results SHALL be visually distinct. The panel SHALL support individual and full-text copy.

#### Scenario: Result panel rendering

- **WHEN** OCR results are loaded
- **THEN** the panel SHALL display a header with "识别结果" title and a [复制全文] button
- **AND** each result SHALL show: sequence number + text content + confidence percentage (optional)
- **AND** results SHALL be ordered by the `order` field

#### Scenario: Low confidence display

- **WHEN** a result has `confidence < 0.3`
- **THEN** the text entry SHALL have `opacity: 0.4`
- **AND** a ⚠️ icon SHALL be displayed next to the entry with `title="识别置信度较低"`
- **AND** the text SHALL still be included in full-text copy operations

#### Scenario: Copy full text

- **WHEN** the user clicks [复制全文]
- **THEN** all region texts SHALL be concatenated in `order` sequence (newline separated)
- **AND** `navigator.clipboard.writeText(fullText)` SHALL be called
- **AND** a Toast SHALL display "已复制"

#### Scenario: Copy single entry

- **WHEN** the user clicks the copy icon on a single text entry
- **THEN** only that entry's text SHALL be copied to clipboard
- **AND** the copy icon SHALL only be visible on row hover

### Requirement: OCR Timeout and Partial Results

The OCR API call SHALL have a 20-second timeout via AbortController. Partial results SHALL be rendered if available. Switching images SHALL cancel the previous request.

#### Scenario: API timeout with partial results

- **WHEN** the OCR API times out at 20 seconds but has returned 8 of 15 regions
- **THEN** the 8 returned regions SHALL be rendered with recognition boxes and text entries
- **AND** a Toast SHALL display "识别超时，仅返回 8/15 个区域 [重试]"
- **AND** the remaining 7 positions SHALL show dashed placeholder boxes

#### Scenario: API timeout with no results

- **WHEN** the OCR API times out with no results
- **THEN** an error state SHALL be displayed
- **AND** a Toast SHALL display "识别失败，请检查网络后重试 [重试]"

#### Scenario: Image switch cancels previous request

- **WHEN** a new image is uploaded while a previous OCR request is in flight
- **THEN** the previous AbortController SHALL be aborted
- **AND** `AnnotationStore.clear()` SHALL remove all old annotations
- **AND** `SVGLayer.clear()` SHALL remove all old recognition boxes
- **AND** the old image's `URL.revokeObjectURL()` SHALL be called
- **AND** a new recognition request SHALL begin for the new image