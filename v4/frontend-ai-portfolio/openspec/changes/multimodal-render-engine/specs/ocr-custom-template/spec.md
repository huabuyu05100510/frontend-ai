# OCR Custom Template Specification

## ADDED Requirements

### Requirement: Draw Tool with State Machine

The DrawTool SHALL allow users to draw rectangular regions on an image. It SHALL follow a state machine flow: idle → drawing_ready → drawing → config_open → idle. Rectangles with area < 400px² SHALL be rejected as misclicks.

#### Scenario: Activate drawing mode

- **WHEN** the user clicks the [画框+] toolbar button
- **THEN** the cursor SHALL change to `crosshair`
- **AND** the state SHALL be `drawing_ready`

#### Scenario: Draw rectangle with valid area

- **WHEN** the user mousedown at (100, 100), drag to (300, 250), and mouseup
- **THEN** a dashed blue preview rectangle SHALL be shown during drag
- **AND** on mouseup, `normalizeRect(start, end)` SHALL produce `{x:100, y:100, w:200, h:150}`
- **AND** since area (30000) >= 400px², the preview SHALL solidify to a gray border box
- **AND** `EventBus.emit(FIELD_CONFIG_OPEN, tempId, rect)` SHALL be triggered
- **AND** the ConfigPanel SHALL open

#### Scenario: Draw rectangle with invalid area

- **WHEN** the user draws a rectangle with area < 400px² (e.g., 10×20 = 200px²)
- **THEN** the preview SHALL be removed
- **AND** a Toast SHALL display "选择区域过小，请重新绘制"
- **AND** state SHALL reset to `drawing_ready` (not idle)

#### Scenario: Cancel drawing with Escape

- **WHEN** the user presses Escape during drawing
- **THEN** the preview rectangle SHALL be removed
- **AND** state SHALL reset to idle
- **AND** cursor SHALL return to default

### Requirement: Resize Handles and Move

Selected field boxes SHALL display 8 resize handles (circles at corners and edge midpoints). Dragging handles SHALL resize the box with a minimum size of 20×20px. Dragging the box interior SHALL move it.

#### Scenario: Show resize handles on selection

- **WHEN** a field annotation box is clicked (hitTest returns fieldId)
- **THEN** `SVGLayer.showResizeHandles(fieldId)` SHALL be called
- **AND** 8 blue circle handles SHALL appear at the bbox corners and edge midpoints
- **AND** the ConfigPanel SHALL open for the selected field

#### Scenario: Corner resize

- **WHEN** the user drags the SE handle from the original bbox `{x:100, y:100, w:200, h:150}`
- **AND** the mouse moves 50px right and 30px down
- **THEN** the new bbox SHALL be `{x:100, y:100, w:250, h:180}`
- **AND** the resize SHALL be previewed in real-time during drag

#### Scenario: Minimum size constraint

- **WHEN** the user drags a resize handle such that the new width would be < 20px
- **THEN** the width SHALL be clamped to 20px
- **AND** similarly for height < 20px the height SHALL be clamped to 20px

#### Scenario: Move entire box

- **WHEN** the user drags the box interior (not a handle) by 15px right and 10px down
- **THEN** the bbox SHALL shift by the same delta
- **AND** the label SHALL move with the box

#### Scenario: Click empty area deselects

- **WHEN** the user clicks on the image where no field box exists
- **THEN** resize handles SHALL be hidden
- **AND** the ConfigPanel SHALL close
- **AND** state SHALL return to idle

### Requirement: Field Configuration Panel

The ConfigPanel SHALL allow users to configure field properties: name, data type, required flag, and validation regex. The save button SHALL be disabled when the field name is empty.

#### Scenario: Open config panel for new field

- **WHEN** `EventBus.emit(FIELD_CONFIG_OPEN, tempId, rect)` is triggered after drawing
- **THEN** the ConfigPanel SHALL open with empty form fields
- **AND** the [保存字段] button SHALL be disabled (field name empty)
- **AND** the [删除字段] button SHALL be hidden (new field, not yet saved)

#### Scenario: Open config panel for existing field

- **WHEN** an existing field box is clicked
- **THEN** the ConfigPanel SHALL open with the field's current values pre-filled
- **AND** both [保存字段] and [删除字段] buttons SHALL be visible

#### Scenario: Save field with validation

- **WHEN** the user fills in the field name "发票号码" and clicks [保存字段]
- **THEN** the form SHALL validate (field name is non-empty)
- **AND** `EventBus.emit(FIELD_SAVED, config)` SHALL be triggered
- **AND** the SVGLayer SHALL update the box to active style with the field name label
- **AND** the field SHALL be added to the TemplateManager

#### Scenario: Save button disabled with empty name

- **WHEN** the field name input is empty or only whitespace
- **THEN** the [保存字段] button SHALL be disabled
- **AND** an inline error SHALL display "请输入字段名"

#### Scenario: Delete field with confirmation

- **WHEN** the user clicks [删除字段]
- **THEN** `window.confirm('确认删除字段「{name}」？')` SHALL be shown
- **WHEN** the user confirms
- **THEN** `EventBus.emit(FIELD_DELETED, fieldId)` SHALL be triggered
- **AND** the SVGLayer SHALL remove the box
- **AND** the field SHALL be removed from the TemplateManager
- **AND** the ConfigPanel SHALL close

### Requirement: Template CRUD

The TemplateManager SHALL support creating, reading, updating, and deleting OCR templates. Templates SHALL be persisted to localStorage. The system SHALL prevent data loss on accidental navigation.

#### Scenario: Save template

- **WHEN** `saveTemplate('发票识别', '增值税发票识别模板')` is called
- **THEN** an `OCRTemplate` object SHALL be created with all current fields, timestamp, and a generated ID
- **AND** the template SHALL be saved to `localStorage` under key `ocr-templates`
- **AND** a Toast SHALL display "模板已保存"

#### Scenario: Load template

- **WHEN** `loadTemplate(template)` is called
- **THEN** all fields from the template SHALL be loaded into the editor
- **AND** the SVGLayer SHALL render all field boxes
- **AND** the image SHALL be replaced with the template's sample image

#### Scenario: Draft auto-save

- **WHEN** the user has unsaved field changes
- **THEN** a draft SHALL be auto-saved to `localStorage` every 30 seconds
- **AND** the draft key SHALL be `ocr-template-draft`

#### Scenario: beforeunload protection

- **WHEN** the user attempts to close the tab or navigate away with unsaved changes
- **THEN** the browser's `beforeunload` dialog SHALL be triggered
- **AND** the message SHALL indicate "有未保存的模板，确定离开？"

### Requirement: Keyboard Micro-Adjustment

Selected field boxes SHALL support keyboard arrow keys for precise position adjustment. Arrow keys SHALL move the box by 1px, and Shift+Arrow keys SHALL move by 10px.

#### Scenario: Arrow key movement

- **WHEN** a field box is selected and the user presses ArrowRight
- **THEN** the bbox SHALL move 1px to the right
- **AND** the SVGLayer SHALL update the box and label positions

#### Scenario: Shift+Arrow accelerated movement

- **WHEN** a field box is selected and the user presses Shift+ArrowDown
- **THEN** the bbox SHALL move 10px down
- **AND** the AnnotationStore SHALL be updated with the new position