/**
 * Trinity Transpiler Engine
 *
 * Three core processing layers:
 * 1. Topological Mirroring Layer - Layout topology extraction with path compression DFS
 * 2. Zero-CLS Anchoring Layer - Static height anchoring to prevent CLS
 * 3. Style Isomorphism Layer - CSS generation preserving original layout constraints
 */

// ============================================================================
// Types & Interfaces
// ============================================================================

export type LayoutMode = 'flex' | 'grid' | 'flow' | 'absolute' | 'static';

export type PositionInfo = {
  l: number;  // left
  t: number;  // top
  w: number;  // width
  h: number;  // height
  r?: number; // right
  b?: number; // bottom
};

export type ComputedLayout = {
  display: LayoutMode;
  flexDirection?: string;
  flexWrap?: string;
  justifyContent?: string;
  alignItems?: string;
  flexGap?: string;
  gridTemplateColumns?: string;
  gridTemplateRows?: string;
  gap?: string;
  position?: string;
  inset?: PositionInfo;
  margin: PositionInfo;
  padding: PositionInfo;
};

export type TopologyNode = {
  id: string;
  rect: PositionInfo;
  computedLayout: ComputedLayout;
  children: TopologyNode[];
  isRedundantWrapper: boolean;
  originalElement?: Element;
};

export type AnchorSpec = {
  nodeId: string;
  staticHeight: number;
  minHeight: number;
  maxHeight: number;
  contentHeight: number;
  aspectRatio?: string;
};

export type SkeletonBox = {
  positionInfo: PositionInfo;
  borderRadius?: string;
  backgroundColor?: string;
  borderWidth?: string;
  borderStyle?: string;
  borderColor?: string;
  noChild?: boolean;
};

export type TrinityOutput = {
  topology: TopologyNode;
  anchors: AnchorSpec[];
  skeletonDSL: {
    boxes: SkeletonBox[];
    bgs: SkeletonBox[];
    borders: SkeletonBox[];
    width: number;
    height: number;
  };
  cssOutput: string;
  stats: {
    originalNodeCount: number;
    prunedWrapperCount: number;
    finalNodeCount: number;
    clsPreventionCount: number;
  };
};

// ============================================================================
// Layer 1: Topological Mirroring (Path Compression DFS)
// ============================================================================

function getLayoutMode(el: Element): LayoutMode {
  const style = window.getComputedStyle(el);
  const display = style.display;

  if (display === 'grid') return 'grid';
  if (display === 'flex') return 'flex';
  if (display === 'flow') return 'flow';
  if (display === 'absolute' || display === 'fixed') return 'absolute';
  return 'static';
}

function getComputedLayout(el: Element): ComputedLayout {
  const style = window.getComputedStyle(el);
  const display = getLayoutMode(el);

  const margin = {
    l: parseFloat(style.marginLeft) || 0,
    t: parseFloat(style.marginTop) || 0,
    w: parseFloat(style.marginRight) || 0,
    h: parseFloat(style.marginBottom) || 0,
  };

  const padding = {
    l: parseFloat(style.paddingLeft) || 0,
    t: parseFloat(style.paddingTop) || 0,
    w: parseFloat(style.paddingRight) || 0,
    h: parseFloat(style.paddingBottom) || 0,
  };

  const layout: ComputedLayout = {
    display,
    margin,
    padding,
  };

  if (display === 'flex') {
    layout.flexDirection = style.flexDirection;
    layout.flexWrap = style.flexWrap;
    layout.justifyContent = style.justifyContent;
    layout.alignItems = style.alignItems;
    layout.flexGap = style.gap;
  }

  if (display === 'grid') {
    layout.gridTemplateColumns = style.gridTemplateColumns;
    layout.gridTemplateRows = style.gridTemplateRows;
    layout.gap = style.gap;
  }

  if (display === 'absolute' || display === 'fixed') {
    layout.position = display;
    layout.inset = {
      l: parseFloat(style.left) || 0,
      t: parseFloat(style.top) || 0,
      w: parseFloat(style.right) || 0,
      h: parseFloat(style.bottom) || 0,
    };
  }

  return layout;
}

function rectsMatch(a: DOMRect, b: DOMRect, tolerance: number = 1): boolean {
  return (
    Math.abs(a.left - b.left) <= tolerance &&
    Math.abs(a.top - b.top) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  );
}

function hasVisualStyles(el: Element): boolean {
  const style = window.getComputedStyle(el);

  // Check background
  const bgColor = style.backgroundColor;
  const hasBg = bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent';

  // Check border
  const hasBorder =
    parseFloat(style.borderTopWidth) > 0 ||
    parseFloat(style.borderRightWidth) > 0 ||
    parseFloat(style.borderBottomWidth) > 0 ||
    parseFloat(style.borderLeftWidth) > 0;

  // Check margin
  const hasMargin =
    parseFloat(style.marginTop) > 0 ||
    parseFloat(style.marginRight) > 0 ||
    parseFloat(style.marginBottom) > 0 ||
    parseFloat(style.marginLeft) > 0;

  return hasBg || hasBorder || hasMargin;
}

function isRedundantWrapper(el: Element, parentRect: DOMRect): boolean {
  const rect = el.getBoundingClientRect();

  // If rect doesn't match parent, not redundant
  if (!rectsMatch(rect, parentRect)) return false;

  // If has visual styles, not redundant
  if (hasVisualStyles(el)) return false;

  // If has meaningful content, not redundant
  const tagName = el.tagName.toLowerCase();
  const skipTags = ['html', 'body', 'head'];
  if (skipTags.includes(tagName)) return false;

  return true;
}

function getElementRect(el: Element): PositionInfo {
  const rect = el.getBoundingClientRect();
  return {
    l: rect.left,
    t: rect.top,
    w: rect.width,
    h: rect.height,
    r: rect.right,
    b: rect.bottom,
  };
}

/**
 * Path Compression DFS for Topological Mirroring
 * Extracts the layout skeleton while pruning redundant wrappers
 */
function buildTopologyDFS(
  el: Element,
  parentRect: DOMRect,
  stats: { nodeCount: number; prunedCount: number }
): TopologyNode | null {
  stats.nodeCount++;

  const rect = getElementRect(el);
  const layout = getComputedLayout(el);

  // Create node with current element
  const nodeId = `${el.tagName.toLowerCase()}-${Math.random().toString(36).substr(2, 9)}`;

  // Check if this is a redundant wrapper (Path Compression)
  const redundant = isRedundantWrapper(el, parentRect);

  if (redundant) {
    stats.prunedCount++;
  }

  const topologyNode: TopologyNode = {
    id: nodeId,
    rect,
    computedLayout: layout,
    children: [],
    isRedundantWrapper: redundant,
    originalElement: el,
  };

  // Process children
  const childElements = Array.from(el.children);
  for (const child of childElements) {
    const childNode = buildTopologyDFS(child, rect, stats);
    if (childNode && !childNode.isRedundantWrapper) {
      topologyNode.children.push(childNode);
    } else if (childNode) {
      // Flatten: promote grandchildren if wrapper was pruned
      topologyNode.children.push(...childNode.children);
    }
  }

  return topologyNode;
}

// ============================================================================
// Layer 2: Zero-CLS Anchoring (Static Height Preservation)
// ============================================================================

function calculateStaticHeight(el: Element): AnchorSpec {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);

  // Get content height (without dynamic content)
  const contentHeight = rect.height;

  // Staticize: use measured height as min-height to prevent CLS
  const minHeight = contentHeight;
  const maxHeight = contentHeight;

  // Check for aspect-ratio to preserve proportions
  const aspectRatio = style.aspectRatio;
  const computedAspectRatio = style.aspectRatio;

  return {
    nodeId: el.getAttribute('data-ske-id') || `anchor-${Math.random().toString(36).substr(2, 9)}`,
    staticHeight: minHeight,
    minHeight,
    maxHeight,
    contentHeight,
    aspectRatio: aspectRatio !== 'auto' ? aspectRatio : undefined,
  };
}

/**
 * Zero-CLS Anchoring: Ensures content replacement doesn't cause layout shift
 * Uses static height reservation and aspect-ratio preservation
 */
function buildAnchoringLayer(root: Element): AnchorSpec[] {
  const anchors: AnchorSpec[] = [];

  function traverse(el: Element) {
    const rect = el.getBoundingClientRect();

    // Only anchor meaningful content blocks
    const style = window.getComputedStyle(el);
    const isLayoutContainer =
      style.display === 'flex' ||
      style.display === 'grid' ||
      el.hasChildNodes();

    // Skip tiny elements (likely decorative)
    if (rect.height < 4 || rect.width < 4) return;

    // Skip elements with overflow scroll/auto (may have dynamic height)
    const overflowY = style.overflowY;
    if (overflowY === 'scroll' || overflowY === 'auto') return;

    anchors.push(calculateStaticHeight(el));

    Array.from(el.children).forEach(traverse);
  }

  traverse(root);
  return anchors;
}

// ============================================================================
// Layer 3: Style Isomorphism (CSS Output Generation)
// ============================================================================

function generateCSS(topology: TopologyNode, anchors: AnchorSpec[]): string {
  const cssRules: string[] = [];
  const anchorMap = new Map(anchors.map(a => [a.nodeId, a]));

  function processNode(node: TopologyNode, depth: number = 0): string {
    if (node.isRedundantWrapper) return '';

    const indent = '  '.repeat(depth);
    const layout = node.computedLayout;
    const anchor = anchorMap.get(node.id);

    let rule = `${indent}.${node.id} {\n`;

    // Position
    if (layout.position === 'absolute' || layout.position === 'fixed') {
      rule += `${indent}  position: ${layout.position};\n`;
      if (layout.inset) {
        rule += `${indent}  top: ${layout.inset.t}px;\n`;
        rule += `${indent}  left: ${layout.inset.l}px;\n`;
      }
    }

    // Display & Layout
    if (layout.display === 'flex') {
      rule += `${indent}  display: flex;\n`;
      if (layout.flexDirection) rule += `${indent}  flex-direction: ${layout.flexDirection};\n`;
      if (layout.flexWrap) rule += `${indent}  flex-wrap: ${layout.flexWrap};\n`;
      if (layout.justifyContent) rule += `${indent}  justify-content: ${layout.justifyContent};\n`;
      if (layout.alignItems) rule += `${indent}  align-items: ${layout.alignItems};\n`;
      if (layout.flexGap) rule += `${indent}  gap: ${layout.flexGap};\n`;
    }

    if (layout.display === 'grid') {
      rule += `${indent}  display: grid;\n`;
      if (layout.gridTemplateColumns) rule += `${indent}  grid-template-columns: ${layout.gridTemplateColumns};\n`;
      if (layout.gridTemplateRows) rule += `${indent}  grid-template-rows: ${layout.gridTemplateRows};\n`;
      if (layout.gap) rule += `${indent}  gap: ${layout.gap};\n`;
    }

    // Zero-CLS: Apply static height anchoring
    if (anchor) {
      rule += `${indent}  min-height: ${anchor.staticHeight}px;\n`;
      rule += `${indent}  max-height: ${anchor.maxHeight}px;\n`;
      if (anchor.aspectRatio) {
        rule += `${indent}  aspect-ratio: ${anchor.aspectRatio};\n`;
      }
    }

    // Box model
    if (layout.margin.l || layout.margin.t || layout.margin.w || layout.margin.h) {
      rule += `${indent}  margin: ${layout.margin.t}px ${layout.margin.w}px ${layout.margin.h}px ${layout.margin.l}px;\n`;
    }
    if (layout.padding.l || layout.padding.t || layout.padding.w || layout.padding.h) {
      rule += `${indent}  padding: ${layout.padding.t}px ${layout.padding.w}px ${layout.padding.h}px ${layout.padding.l}px;\n`;
    }

    rule += `${indent}}`;
    cssRules.push(rule);

    // Process children
    for (const child of node.children) {
      if (!child.isRedundantWrapper) {
        processNode(child, depth + 1);
      }
    }

    return rule;
  }

  processNode(topology);

  return cssRules.join('\n\n');
}

// ============================================================================
// Skeleton DSL Generation
// ============================================================================

function generateSkeletonDSL(topology: TopologyNode, rootRect: DOMRect): TrinityOutput['skeletonDSL'] {
  const boxes: SkeletonBox[] = [];
  const bgs: SkeletonBox[] = [];
  const borders: SkeletonBox[] = [];

  function traverse(node: TopologyNode, parentRect: PositionInfo) {
    if (node.isRedundantWrapper) {
      node.children.forEach(child => traverse(child, parentRect));
      return;
    }

    const rect = node.rect;
    const layout = node.computedLayout;
    const style = node.originalElement
      ? window.getComputedStyle(node.originalElement)
      : null;

    const box: SkeletonBox = {
      positionInfo: {
        l: ((rect.l - parentRect.l) / parentRect.w) * 100,
        t: ((rect.t - parentRect.t) / parentRect.h) * 100,
        w: (rect.w / parentRect.w) * 100,
        h: (rect.h / parentRect.h) * 100,
      },
      borderRadius: style?.borderRadius,
      backgroundColor: style?.backgroundColor,
    };

    // Categorize: boxes for content, bgs for backgrounds, borders for outlines
    if (style) {
      const hasBg = style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent';
      const hasBorder =
        parseFloat(style.borderTopWidth || '0') > 0 ||
        parseFloat(style.borderRightWidth || '0') > 0 ||
        parseFloat(style.borderBottomWidth || '0') > 0 ||
        parseFloat(style.borderLeftWidth || '0') > 0;

      if (hasBg && hasBorder) {
        bgs.push({ ...box, borderWidth: style.borderWidth, borderStyle: style.borderStyle, borderColor: style.borderColor });
      } else if (hasBg) {
        bgs.push(box);
      } else if (hasBorder) {
        borders.push({ ...box, borderWidth: style.borderWidth, borderStyle: style.borderStyle, borderColor: style.borderColor });
      } else if (node.children.length === 0) {
        // Leaf nodes without styling become skeleton boxes
        boxes.push(box);
      }
    }

    node.children.forEach(child => traverse(child, rect));
  }

  traverse(topology, rootRect);

  return {
    boxes,
    bgs,
    borders,
    width: rootRect.width,
    height: rootRect.height,
  };
}

// ============================================================================
// Main Trinity Transpiler
// ============================================================================

export class TrinityTranspiler {
  private root: Element;
  private stats = {
    originalNodeCount: 0,
    prunedWrapperCount: 0,
    finalNodeCount: 0,
    clsPreventionCount: 0,
  };

  constructor(root: Element | null = null) {
    this.root = root || document.body;
  }

  /**
   * Execute the Trinity Transpilation process
   * Returns complete output including topology, anchors, skeleton DSL, and CSS
   */
  transpile(): TrinityOutput {
    // Layer 1: Topological Mirroring
    const topologyStart = performance.now();
    const topology = this.buildTopology();
    const topologyTime = performance.now() - topologyStart;

    // Layer 2: Zero-CLS Anchoring
    const anchoringStart = performance.now();
    const anchors = this.buildAnchoring();
    const anchoringTime = performance.now() - anchoringStart;

    // Layer 3: Style Isomorphism
    const cssStart = performance.now();
    const cssOutput = generateCSS(topology, anchors);
    const cssTime = performance.now() - cssStart;

    // Generate Skeleton DSL
    const skeletonDSL = generateSkeletonDSL(topology, this.root.getBoundingClientRect());

    // Calculate final stats
    this.stats.finalNodeCount = this.countNodes(topology);
    this.stats.clsPreventionCount = anchors.length;

    console.log(`[Trinity] Layer timings:`, {
      topologicalMirroring: `${topologyTime.toFixed(2)}ms`,
      zeroCLSAnchoring: `${anchoringTime.toFixed(2)}ms`,
      styleIsomorphism: `${cssTime.toFixed(2)}ms`,
    });

    return {
      topology,
      anchors,
      skeletonDSL,
      cssOutput,
      stats: { ...this.stats },
    };
  }

  private buildTopology(): TopologyNode {
    const stats = { nodeCount: 0, prunedCount: 0 };
    const topology = buildTopologyDFS(this.root, this.root.getBoundingClientRect(), stats);
    this.stats.originalNodeCount = stats.nodeCount;
    this.stats.prunedWrapperCount = stats.prunedCount;
    return topology || {
      id: 'root',
      rect: getElementRect(this.root),
      computedLayout: getComputedLayout(this.root),
      children: [],
      isRedundantWrapper: false,
      originalElement: this.root,
    };
  }

  private buildAnchoring(): AnchorSpec[] {
    return buildAnchoringLayer(this.root);
  }

  private countNodes(node: TopologyNode): number {
    let count = node.isRedundantWrapper ? 0 : 1;
    for (const child of node.children) {
      count += this.countNodes(child);
    }
    return count;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

export function extractLayoutInfo(el: Element): {
  layout: ComputedLayout;
  topology: TopologyNode;
  anchors: AnchorSpec[];
} {
  const layout = getComputedLayout(el);
  const stats = { nodeCount: 0, prunedCount: 0 };
  const topology = buildTopologyDFS(el, el.getBoundingClientRect(), stats);
  const anchors = buildAnchoringLayer(el);

  return { layout, topology: topology!, anchors };
}

export { TrinityTranspiler as default };
