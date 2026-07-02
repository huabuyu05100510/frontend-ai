# Trinity Transpiler - Chrome Extension

Three-layer layout transpilation engine for generating skeleton screens with zero CLS (Cumulative Layout Shift).

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `dist/` directory

## Architecture

### Layer 1: Topological Mirroring

Path compression DFS algorithm that extracts the layout skeleton while pruning redundant wrapper elements.

**Algorithm:**
- Uses DFS (Depth-First Search) to traverse the DOM tree
- Detects "redundant wrappers" by checking if a node's rect matches its parent AND has no visual styles (background, border, margin)
- Removes nodes that don't contribute to the visual layout

**Extracted Properties:**
- `display`: flex, grid, flow, absolute, static
- `flex-*`: flexDirection, flexWrap, justifyContent, alignItems, gap
- `grid-*`: gridTemplateColumns, gridTemplateRows, gap
- `position` / `inset`: for absolute/fixed positioning
- `margin` / `padding`: box model properties

### Layer 2: Zero-CLS Anchoring

Static height reservation system that prevents layout shift during content replacement.

**Implementation:**
- Measures content height at skeleton generation time
- Applies `min-height` and `max-height` constraints
- Preserves `aspect-ratio` for media elements
- Skips scrollable containers (overflow: scroll/auto)

### Layer 3: Style Isomorphism

CSS generation that preserves the original layout constraints in a compact, reusable format.

## Usage

1. Click the Trinity Transpiler icon in the Chrome toolbar
2. Navigate to any webpage
3. Click "Transpile Current Page" to analyze the layout
4. View statistics and copy CSS/DSL output

## Output Format

### CSS Output
```css
.container {
  display: flex;
  flex-direction: row;
  gap: 16px;
  min-height: 400px;
  max-height: 400px;
}
```

### Skeleton DSL
```json
{
  "boxes": [...],
  "bgs": [...],
  "borders": [...],
  "width": 1200,
  "height": 800
}
```

## API

Content script exposes messaging interface:

```javascript
// Request transpilation
chrome.runtime.sendMessage({
  type: 'TRANSPILENT_REQUEST',
  payload: { targetElement: '#root' }
});

// Get result
chrome.runtime.sendMessage({
  type: 'TRANSPILENT_GET_RESULT',
  payload: { resultKey: 'trinity-result-123456' }
});
```

## Development

```bash
npm install
npm run build
```

Build output is in `dist/` directory.
