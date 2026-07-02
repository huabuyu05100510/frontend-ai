# Inspection Annotation Specification

## ADDED Requirements

### Requirement: ProseMirror Decoration for Text Inspection

The DecorationPlugin SHALL render error annotations as CSS wavy underlines in a ProseMirror editor. Each error type SHALL use a distinct color and pattern combination. ProseMirror SHALL automatically remap decoration positions when the user edits text.

#### Scenario: Apply error decorations

- **WHEN** `setAnnotations([error1, error2])` is called with spelling and grammar errors
- **THEN** a `DecorationSet` SHALL be created with `Decoration.inline()` for each error
- **AND** the spelling error SHALL have class `wavy-red` (color #ff4d4f, solid wavy)
- **AND** the grammar error SHALL have class `wavy-orange` (color #fa8c16, dashed wavy)
- **AND** the Transaction SHALL be returned for the editor to apply

#### Scenario: Auto remap on text edit

- **WHEN** the user edits text before an error annotation
- **THEN** ProseMirror SHALL automatically remap the error's `from` and `to` offsets
- **AND** no manual coordinate recalculation SHALL be needed

#### Scenario: Remove decoration on accept

- **WHEN** `removeDecoration('e1')` is called
- **THEN** a Transaction SHALL be returned that removes the decoration with id 'e1'
- **AND** the editor SHALL apply the transaction to remove the wavy underline

#### Scenario: Mute decoration on ignore

- **WHEN** `setDecorationMuted('e1')` is called
- **THEN** the decoration's class SHALL change to `wavy-muted` (color #d9d9d9, opacity 0.5)
- **AND** the text content SHALL remain unchanged

### Requirement: Document Inspection with Canvas + SVG

For document inspection, errors SHALL be rendered as SVG wavy underlines overlaid on the Canvas-rendered document. The DocumentCoordAdapter SHALL convert page-space error coordinates to screen-space for SVG positioning.

#### Scenario: Error overlay on document pages

- **WHEN** inspection errors are loaded for a PDF document
- **THEN** `DocumentCoordAdapter.toScreenRects()` SHALL be called for each error annotation
- **AND** `SVGLayer.addWavyUnderline()` SHALL be called with the returned DOMRect values
- **AND** cross-line errors SHALL produce multiple wavy path segments

#### Scenario: Zoom triggers coordinate rebuild

- **WHEN** the document zoom level changes
- **THEN** `DocumentCoordAdapter.invalidate()` SHALL be called
- **AND** all SVG wavy underline positions SHALL be recalculated
- **AND** the R-Tree SHALL be rebuilt

### Requirement: Error Panel

The ErrorPanel SHALL display a categorized, filterable list of error cards with accept/ignore actions. It SHALL support keyboard navigation and real-time count updates.

#### Scenario: Error panel rendering

- **WHEN** errors are loaded into the AnnotationStore
- **THEN** the panel SHALL display a summary bar with counts per error type (color-coded badges)
- **AND** a filter tab bar SHALL allow filtering by type (All / Spelling / Grammar / Punctuation / Number / Political)
- **AND** error cards SHALL show: error text (highlighted), type label, suggestion (if any), [Accept] and [Ignore] buttons

#### Scenario: Accept error from panel

- **WHEN** the user clicks [Accept] on an error card
- **THEN** the editor SHALL replace the error text with the suggestion
- **AND** the annotation SHALL be removed from the AnnotationStore
- **AND** the error card SHALL be removed from the panel
- **AND** the error count badge SHALL decrement by 1

#### Scenario: Ignore error from panel

- **WHEN** the user clicks [Ignore] on an error card
- **THEN** the annotation's status SHALL change to 'ignored'
- **AND** the wavy underline SHALL become muted (gray, reduced opacity)
- **AND** the error card SHALL become grayed out but remain visible
- **AND** the text content SHALL NOT be modified

#### Scenario: Click card scrolls to document position

- **WHEN** the user clicks an error card
- **THEN** `EventBus.emit(SCROLL_TO, errorId)` SHALL be triggered
- **AND** the document SHALL scroll to the error's page and position
- **AND** the SVGLayer SHALL highlight the error with `setHighlight(id, true, 'selected')`

### Requirement: Error Tooltip

A tooltip SHALL appear on hover over error annotations, showing the error type, original text, suggestion, and accept/ignore buttons. The tooltip SHALL auto-position to avoid viewport overflow.

#### Scenario: Tooltip on hover

- **WHEN** the user hovers over a wavy underline
- **THEN** a tooltip SHALL appear at the mouse position (offset right and down)
- **AND** the tooltip SHALL display: error type label + original text + suggestion + [Accept] [Ignore] buttons
- **AND** `EventBus.emit(ANNOTATION_HOVER, errorId)` SHALL be triggered

#### Scenario: Tooltip viewport overflow flip

- **WHEN** the tooltip would overflow the right viewport edge
- **THEN** it SHALL flip to appear on the left side of the mouse
- **WHEN** the tooltip would overflow the bottom viewport edge
- **THEN** it SHALL flip to appear above the mouse

### Requirement: Keyboard Navigation in Inspection

The inspection scene SHALL support F8 (next error) and Shift+F8 (previous error) for error navigation. Escape SHALL close the tooltip.

#### Scenario: F8 navigates to next error

- **WHEN** the user presses F8
- **THEN** the next error (by document offset) SHALL be scrolled into view
- **AND** the SVGLayer SHALL highlight the next error
- **AND** the ErrorPanel SHALL scroll to and highlight the corresponding error card

#### Scenario: Shift+F8 navigates to previous error

- **WHEN** the user presses Shift+F8
- **THEN** the previous error SHALL be scrolled into view
- **AND** if at the first error, the behavior SHALL wrap to the last error

#### Scenario: Escape closes tooltip

- **WHEN** the user presses Escape while a tooltip is visible
- **THEN** the tooltip SHALL close
- **AND** all highlights SHALL be cleared