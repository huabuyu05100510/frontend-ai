# Annotation Core Specification

## ADDED Requirements

### Requirement: EventBus Publish-Subscribe

The EventBus SHALL support typed event emission and subscription. Handlers SHALL be isolated — an exception in one handler SHALL NOT prevent other handlers from executing.

#### Scenario: Emit event to multiple subscribers

- **WHEN** `emit({type: 'ANNOTATION_HOVER', id: 'a1'})` is called
- **THEN** all registered handlers for `ANNOTATION_HOVER` SHALL be invoked
- **AND** handlers registered for other event types SHALL NOT be invoked

#### Scenario: Handler exception isolation

- **WHEN** one handler for `ANNOTATION_SELECT` throws an Error
- **THEN** the remaining handlers for `ANNOTATION_SELECT` SHALL still execute
- **AND** no exception SHALL propagate to the caller of `emit()`

#### Scenario: Unsubscribe removes handler

- **WHEN** the unsubscribe function returned by `on()` is called
- **THEN** the corresponding handler SHALL be removed from the subscriber set
- **AND** subsequent `emit()` calls SHALL NOT invoke the unsubscribed handler

#### Scenario: Once handler fires only once

- **WHEN** a handler is registered via `once()`
- **THEN** it SHALL be invoked on the first matching `emit()`
- **AND** it SHALL be automatically removed after invocation
- **AND** subsequent `emit()` calls SHALL NOT invoke it

### Requirement: StateMachine Interaction States

The StateMachine SHALL manage 8 interaction states: idle, hover, selected, multiSelected, drawing, resizing, moving, and configuring. Illegal state transitions SHALL emit a `console.warn` but SHALL NOT throw exceptions.

#### Scenario: Normal transition idle → hover → selected → idle

- **WHEN** `hover('a1')` is called in idle state
- **THEN** state SHALL transition to `{type: 'hover', annotationId: 'a1'}`
- **WHEN** `select('a1')` is then called
- **THEN** state SHALL transition to `{type: 'selected', annotationId: 'a1'}`
- **WHEN** `reset()` is called
- **THEN** state SHALL return to `{type: 'idle'}`

#### Scenario: Drawing flow with minimum area check

- **WHEN** `startDraw({x:0, y:0})` is called in idle state
- **THEN** state SHALL transition to `{type: 'drawing', startPt: {x:0,y:0}, currentPt: {x:0,y:0}}`
- **WHEN** `updateDraw({x:10, y:10})` is called
- **THEN** currentPt SHALL update to `{x:10, y:10}`
- **WHEN** `endDraw()` is called and the resulting rect area is < 400px²
- **THEN** the method SHALL return `null` and state SHALL reset to idle

#### Scenario: Drawing flow with valid area

- **WHEN** `startDraw({x:0, y:0})` and `updateDraw({x:50, y:50})` and `endDraw()` are called
- **THEN** if the resulting rect area is ≥ 400px², the method SHALL return the normalized Rect
- **AND** state SHALL transition to `{type: 'configuring', fieldId: <tempId>}`

#### Scenario: Illegal transition produces warning

- **WHEN** `updateDraw({x:10, y:10})` is called from idle state (no prior `startDraw`)
- **THEN** `console.warn` SHALL be called with `[StateMachine] illegal transition: idle → updateDraw`
- **AND** state SHALL remain idle
- **AND** no exception SHALL be thrown

#### Scenario: Resize and move states

- **WHEN** `startResize('f1', 3, originalRect)` is called from selected state
- **THEN** state SHALL transition to `{type: 'resizing', fieldId: 'f1', handleIndex: 3, originalRect}`
- **WHEN** `startMove('f1', offset, originalRect)` is called from selected state
- **THEN** state SHALL transition to `{type: 'moving', fieldId: 'f1', offset, originalRect}`

### Requirement: AnnotationStore CRUD Operations

The AnnotationStore SHALL manage the full lifecycle of annotations with typed queries and event-driven change notifications.

#### Scenario: Batch load triggers event

- **WHEN** `load([annotation1, annotation2])` is called
- **THEN** both annotations SHALL be stored in the internal Map
- **AND** EventBus SHALL emit `{type: 'ANNOTATIONS_LOADED', annotations: [annotation1, annotation2]}`

#### Scenario: Status change triggers typed event

- **WHEN** `setStatus('a1', 'accepted')` is called
- **THEN** the annotation's status SHALL be updated to 'accepted'
- **AND** EventBus SHALL emit `{type: 'ANNOTATION_ACCEPT', id: 'a1'}`
- **AND** `getByStatus('active')` SHALL no longer include annotation 'a1'

#### Scenario: Batch status change

- **WHEN** `setStatusBatch(['a1', 'a2'], 'accepted')` is called
- **THEN** both annotations SHALL have status 'accepted'
- **AND** ANNOTATION_ACCEPT event SHALL be emitted for each annotation
- **AND** ANNOTATIONS_LOADED SHALL NOT be emitted

#### Scenario: Confidence-based filtering

- **WHEN** `getByConfidence(0.3)` is called
- **THEN** all annotations with `content.confidence <= 0.3` SHALL be returned
- **AND** annotations with `content.confidence > 0.3` or undefined confidence SHALL NOT be included

#### Scenario: Page range query

- **WHEN** `getByPageRange(3, 5)` is called
- **THEN** only annotations with `position.kind === 'page'` and `position.page` between 3 and 5 (inclusive) SHALL be returned
- **AND** annotations with `position.kind === 'pixel'` or `position.kind === 'offset'` SHALL NOT be included

#### Scenario: Undo last status change

- **WHEN** `setStatus('a1', 'accepted')` is called followed by `undo()`
- **THEN** annotation 'a1' status SHALL revert to 'active'
- **AND** `undo()` SHALL return `true`
- **WHEN** `undo()` is called again with no history
- **THEN** it SHALL return `false`

#### Scenario: History stack overflow

- **WHEN** more than 20 status changes are made
- **THEN** the oldest history entry SHALL be removed (FIFO)
- **AND** only the most recent 20 operations SHALL be undoable

### Requirement: SVGLayer Annotation Rendering

The SVGLayer SHALL render wavy underlines, annotation boxes, text labels, and resize handles on an SVG element. All annotation elements SHALL be grouped under `g[data-id]` containers for atomic management.

#### Scenario: Wavy underline rendering

- **WHEN** `addWavyUnderline('e1', [rect1, rect2], '#ff4d4f')` is called
- **THEN** a `<g data-id="e1">` SHALL be created
- **AND** each rect SHALL produce a `<path>` with a wavy curve at `rect.bottom + 2px`
- **AND** the wave SHALL have amplitude 1.5px and wavelength 5px
- **AND** the path SHALL be stroked with color '#ff4d4f' and width 1.5px

#### Scenario: Annotation box with label

- **WHEN** `addAnnotationBox('r1', rect, {strokeColor:'#1890ff', fillColor:'rgba(24,144,255,0.1)', strokeWidth:2})` is called
- **THEN** a `<rect>` element SHALL be created inside `g[data-id="r1"]`
- **AND** the rect SHALL have `pointer-events: none`
- **WHEN** `addTextLabel('r1', rect, '发票号码', '#1890ff')` is called
- **THEN** a `<text>` element SHALL be added to the same group at the rect's top-left corner

#### Scenario: Highlight state via CSS class

- **WHEN** `setHighlight('r1', true, 'hover')` is called
- **THEN** the `g[data-id="r1"]` SHALL have class `highlight-hover` added
- **AND** no inline style SHALL be modified
- **WHEN** `setHighlight('r1', false)` is called
- **THEN** all highlight classes SHALL be removed

#### Scenario: Resize handles cursor direction

- **WHEN** `showResizeHandles('f1')` is called
- **THEN** 8 `<circle>` elements SHALL be created at the bbox corners and edge midpoints
- **AND** the NW handle SHALL have `cursor: nw-resize`
- **AND** the SE handle SHALL have `cursor: se-resize`
- **AND** the N handle SHALL have `cursor: n-resize`
- **AND** each handle SHALL have radius 5px

#### Scenario: Clear all annotations

- **WHEN** `clear()` is called
- **THEN** all child `g` elements SHALL be removed from the SVG
- **AND** the SVG SHALL be empty