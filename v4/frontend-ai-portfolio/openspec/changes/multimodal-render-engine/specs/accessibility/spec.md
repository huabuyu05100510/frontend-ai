# Accessibility Specification

## ADDED Requirements

### Requirement: Keyboard Navigation

All interactive elements SHALL be reachable via keyboard. Scene-specific keyboard shortcuts SHALL be documented and consistent across the application.

#### Scenario: Tab order for error panel

- **WHEN** the user presses Tab in the inspection scene
- **THEN** focus SHALL move through: editor → error panel → first error card → [Accept] → [Ignore] → next error card
- **AND** each focusable element SHALL have a visible focus ring (outline or box-shadow)

#### Scenario: F8 navigates to next error

- **WHEN** the user presses F8 in the inspection scene
- **THEN** the next error SHALL be scrolled into view
- **AND** the SVGLayer SHALL highlight the error with `setHighlight(id, true, 'selected')`
- **AND** the screen reader SHALL announce "第 {N} 个错误，{type}：{original text}"

#### Scenario: Shift+F8 navigates to previous error

- **WHEN** the user presses Shift+F8
- **THEN** the previous error SHALL be scrolled into view
- **AND** if at the first error, wrap to the last error

#### Scenario: Escape cancels current operation

- **WHEN** the user presses Escape
- **THEN** in inspection: tooltip SHALL close and highlights SHALL clear
- **AND** in OCR custom: drawing SHALL cancel and ConfigPanel SHALL close
- **AND** in all scenes: any open dropdown or modal SHALL close

#### Scenario: Arrow key micro-adjustment in template editor

- **WHEN** a field box is selected and the user presses ArrowRight
- **THEN** the box SHALL move 1px to the right
- **WHEN** the user presses Shift+ArrowRight
- **THEN** the box SHALL move 10px to the right

### Requirement: ARIA Annotations

All annotation elements SHALL have appropriate ARIA attributes for screen reader accessibility. Recognition boxes SHALL have `aria-label` describing their content. Error annotations SHALL use `role="mark"`.

#### Scenario: OCR recognition box ARIA

- **WHEN** a recognition box is rendered
- **THEN** the `<g>` element SHALL have `role="img"`
- **AND** it SHALL have `aria-label="识别区域：{text content}"`
- **AND** it SHALL have `aria-describedby` referencing the corresponding result panel entry ID

#### Scenario: Error annotation ARIA

- **WHEN** a wavy underline error is rendered
- **THEN** the element SHALL have `role="mark"`
- **AND** it SHALL have `aria-label="{error type}：{original text}"`
- **AND** it SHALL have `data-suggestion="{suggestion}"` for tooltip context

#### Scenario: Error panel ARIA

- **WHEN** the error panel renders
- **THEN** the panel SHALL have `role="complementary"` and `aria-label="错误列表面板"`
- **AND** the status summary SHALL have `role="status"` and `aria-live="polite"`
- **AND** error count changes SHALL be announced: "共检测到 {N} 个错误"

#### Scenario: Screen reader announcement on accept

- **WHEN** an error suggestion is accepted
- **THEN** the aria-live region SHALL announce "已接受建议，{error type} 已修正，剩余 {N} 个错误"

### Requirement: Color Accessibility

Error type colors SHALL be distinguishable by both color and pattern. The system SHALL support red-green color blindness by providing distinct wavy line patterns for each error type.

#### Scenario: Pattern distinction for error types

- **WHEN** error annotations are rendered
- **THEN** spelling errors SHALL use solid wavy underline (#ff4d4f)
- **AND** grammar errors SHALL use dashed wavy underline (#fa8c16) with `text-decoration-skip-ink: none`
- **AND** punctuation errors SHALL use dotted wavy underline (#1890ff) via SVG pattern
- **AND** number errors SHALL use double wavy underline (#52c41a) with 1px offset
- **AND** political errors SHALL use thick wavy underline (#722ed1) with `text-decoration-thickness: 3px`

#### Scenario: Color + pattern combined

- **WHEN** a user with red-green color blindness views the error annotations
- **THEN** each error type SHALL be distinguishable by its unique wavy line pattern alone
- **AND** the color SHALL provide additional visual distinction for users without color blindness

### Requirement: Reduced Motion

The system SHALL respect the user's `prefers-reduced-motion` system preference. All animations and transitions SHALL be disabled when this preference is set.

#### Scenario: Reduced motion disables animations

- **WHEN** the user's system has `prefers-reduced-motion: reduce`
- **THEN** all annotation box hover transitions SHALL be set to `transition: none`
- **AND** all `scaleX()` hover animations SHALL be disabled
- **AND** the `@keyframes pulse` animation for loading skeletons SHALL be disabled
- **AND** toast enter/exit animations SHALL be instant

#### Scenario: Normal motion behavior

- **WHEN** the user's system has `prefers-reduced-motion: no-preference`
- **THEN** annotation boxes SHALL animate on hover with `transition: transform 150ms ease`
- **AND** loading skeletons SHALL pulse with `@keyframes pulse` (1.5s cycle)
- **AND** toast messages SHALL slide in with 200ms ease-out animation

### Requirement: Focus Management

Focus SHALL be managed during panel open/close and scene transitions. When a panel opens, focus SHALL move to the first interactive element. When a panel closes, focus SHALL return to the triggering element.

#### Scenario: Focus moves to config panel on open

- **WHEN** the ConfigPanel opens after drawing a field
- **THEN** focus SHALL move to the field name input
- **AND** the input SHALL be ready for immediate typing

#### Scenario: Focus returns on panel close

- **WHEN** the ConfigPanel closes (via Escape or save)
- **THEN** focus SHALL return to the last selected field box or the toolbar
- **AND** the user SHALL be able to continue keyboard navigation without losing position