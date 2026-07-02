/**
 * SkeletonTranspiler v2 - 极简精确还原骨架屏
 * 核心理念：完整保留布局结构，文本渐变化，O(1) DOM复杂度
 */

class SkeletonTranspiler {
  constructor(options = {}) {
    this.options = {
      preserveLayout: options.preserveLayout ?? true, // 保留flex/grid布局
      minHeight: options.minHeight ?? 4,             // 最小检测高度
      textToGradient: options.textToGradient ?? true, // 文本转渐变
      ...options
    };
  }

  /**
   * 主入口
   */
  transpile(element = document.body) {
    const startTime = performance.now();

    // Phase 1: 布局镜像 - 提取所有可见元素的布局信息
    const layoutTree = this.extractLayout(element);

    // Phase 2: 拓扑剪枝 - 移除冗余包装
    const prunedTree = this.pruneTree(layoutTree);

    // Phase 3: 生成锚点
    const anchors = this.createAnchors(prunedTree, element.getBoundingClientRect());

    // Phase 4: 生成骨架HTML
    const code = this.generateSkeletonCode(anchors);

    const stats = {
      totalNodes: this.countNodes(prunedTree),
      leafNodes: this.countLeafNodes(prunedTree),
      prunedCount: this.countPruned(layoutTree, prunedTree),
      time: (performance.now() - startTime).toFixed(1) + 'ms'
    };

    return { layoutTree: prunedTree, anchors, code, stats };
  }

  /**
   * Phase 1: 递归提取布局
   */
  extractLayout(element, parentLayout = null) {
    if (!element) return null;

    const tag = element.tagName?.toLowerCase();
    if (!tag || this.isIgnoredTag(tag)) return null;

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    // 跳过不可见元素
    if (!this.isVisible(rect, style)) return null;

    // 提取布局属性
    const layout = this.extractLayoutProps(style, rect);

    // 判断是否为叶子节点
    const isLeaf = this.isLeafElement(element, style);
    const hasText = this.hasTextContent(element);

    const node = {
      id: `ske-${Math.random().toString(36).substr(2, 9)}`,
      tag,
      rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
      layout,
      isLeaf,
      hasText,
      gradient: null,
      children: []
    };

    // 文本节点生成渐变
    if (isLeaf && hasText && this.options.textToGradient) {
      node.gradient = this.textToGradient(node, style);
    }

    // 递归处理子节点
    if (!isLeaf && element.children && element.children.length > 0) {
      node.children = Array.from(element.children)
        .map(child => this.extractLayout(child, layout))
        .filter(n => n !== null);
    }

    return node;
  }

  /**
   * 提取布局属性
   */
  extractLayoutProps(style, rect) {
    const layout = {};
    const display = style.display;

    // display
    if (display !== 'block') layout.display = display;
    if (display === 'flex' || display === 'inline-flex') {
      if (style.flexDirection !== 'row') layout.flexDirection = style.flexDirection;
      if (style.flexWrap !== 'nowrap') layout.flexWrap = style.flexWrap;
      if (style.justifyContent !== 'flex-start') layout.justifyContent = style.justifyContent;
      if (style.alignItems !== 'stretch') layout.alignItems = style.alignItems;
      if (style.alignContent !== 'normal') layout.alignContent = style.alignContent;
      if (style.gap !== 'normal') layout.gap = style.gap;
    }
    if (display === 'grid' || display === 'inline-grid') {
      if (style.gridTemplateColumns !== 'none') layout.gridTemplateColumns = style.gridTemplateColumns;
      if (style.gridTemplateRows !== 'none') layout.gridTemplateRows = style.gridTemplateRows;
      if (style.gap !== 'normal') layout.gap = style.gap;
    }

    // position & z-index
    if (style.position !== 'static') layout.position = style.position;
    if (style.zIndex !== 'auto') layout.zIndex = parseInt(style.zIndex);

    // margin
    const m = this.parseDir(style.marginTop, style.marginRight, style.marginBottom, style.marginLeft);
    if (m.any) layout.margin = m;

    // padding
    const p = this.parseDir(style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft);
    if (p.any) layout.padding = p;

    // size
    if (rect.height > this.options.minHeight) {
      layout.height = rect.height;
    }
    if (rect.width > 0) {
      layout.width = rect.width;
    }

    return layout;
  }

  parseDir(t, r, b, l) {
    const pt = parseFloat(t), pr = parseFloat(r), pb = parseFloat(b), pl = parseFloat(l);
    return {
      top: pt, right: pr, bottom: pb, left: pl,
      any: pt > 0 || pr > 0 || pb > 0 || pl > 0
    };
  }

  /**
   * Phase 2: 拓扑剪枝 - 移除与父节点完全重合且无样式的包装
   */
  pruneTree(node, parent = null) {
    if (!node) return null;

    // 深拷贝节点
    const pruned = { ...node, children: [] };

    // 检查是否应该被剪枝（提升子节点）
    if (this.shouldPrune(node, parent)) {
      // 子节点提升到父节点
      pruned.children = node.children.map(child => this.pruneTree(child, null)).filter(n => n);
      return pruned;
    }

    // 正常递归
    pruned.children = node.children.map(child => this.pruneTree(child, pruned)).filter(n => n);

    return pruned;
  }

  shouldPrune(node, parent) {
    if (!parent) return false;
    if (node.isLeaf) return false;
    if (node.hasText) return false;
    if (node.children.length === 0) return false;

    // 检查是否有独立布局（与父节点不同的display、flex属性等）
    const pLayout = parent.layout || {};
    const nLayout = node.layout || {};

    // 如果布局与父节点相同，且尺寸完全一致，则可以剪枝
    if (nLayout.display === pLayout.display || (!nLayout.display && pLayout.display === 'block')) {
      const sameSize =
        Math.abs(node.rect.w - parent.rect.w) < 3 &&
        Math.abs(node.rect.h - parent.rect.h) < 3;

      if (sameSize) {
        // 检查是否有独立样式
        const hasOwnStyles =
          nLayout.flexDirection || nLayout.flexWrap || nLayout.justifyContent ||
          nLayout.alignItems || nLayout.gap || nLayout.gridTemplateColumns ||
          nLayout.margin?.any || nLayout.padding?.any || nLayout.position !== 'static';

        return !hasOwnStyles;
      }
    }

    return false;
  }

  /**
   * Phase 3: 创建锚点（百分比定位）
   */
  createAnchors(node, parentRect, parentPercent = null) {
    if (!node) return [];

    // 计算相对于父容器的百分比
    const percent = parentRect ? {
      x: ((node.rect.x - parentRect.x) / parentRect.w * 100).toFixed(2),
      y: ((node.rect.y - parentRect.y) / parentRect.h * 100).toFixed(2),
      w: (node.rect.w / parentRect.w * 100).toFixed(2),
      h: (node.rect.h / parentRect.h * 100).toFixed(2)
    } : { x: 0, y: 0, w: 100, h: 100 };

    const anchor = {
      id: node.id,
      tag: node.tag,
      rect: node.rect,
      percent,
      layout: node.layout,
      isLeaf: node.isLeaf,
      hasText: node.hasText,
      gradient: node.gradient,
      children: []
    };

    // 递归子节点
    if (node.children && node.children.length > 0) {
      anchor.children = node.children
        .map(child => this.createAnchors(child, node.rect, percent))
        .flat();
    }

    return [anchor];
  }

  /**
   * Phase 4: 生成骨架HTML
   */
  generateSkeletonCode(anchors) {
    const flatNodes = this.flattenAnchors(anchors);

    const html = flatNodes.map(node => {
      const style = this.buildStyle(node);
      return `<div class="${node.id}" style="${style}"></div>`;
    }).join('\n');

    return html;
  }

  buildStyle(node) {
    const { percent, layout, gradient, isLeaf, tag } = node;

    const styles = [
      `position: absolute`,
      `left: ${percent.x}%`,
      `top: ${percent.y}%`,
      `width: ${percent.w}%`,
      `height: ${percent.h}%`
    ];

    // 布局属性
    if (layout) {
      if (layout.display) styles.push(`display: ${layout.display}`);
      if (layout.flexDirection) styles.push(`flex-direction: ${layout.flexDirection}`);
      if (layout.flexWrap) styles.push(`flex-wrap: ${layout.flexWrap}`);
      if (layout.justifyContent) styles.push(`justify-content: ${layout.justifyContent}`);
      if (layout.alignItems) styles.push(`align-items: ${layout.alignItems}`);
      if (layout.gap) styles.push(`gap: ${layout.gap}`);
      if (layout.gridTemplateColumns) styles.push(`grid-template-columns: ${layout.gridTemplateColumns}`);
      if (layout.gridTemplateRows) styles.push(`grid-template-rows: ${layout.gridTemplateRows}`);

      if (layout.margin?.any) {
        const m = layout.margin;
        styles.push(`margin: ${m.top}px ${m.right}px ${m.bottom}px ${m.left}px`);
      }
      if (layout.padding?.any) {
        const p = layout.padding;
        styles.push(`padding: ${p.top}px ${p.right}px ${p.bottom}px ${p.left}px`);
      }
    }

    // 渐变背景
    if (gradient) {
      styles.push(`background: ${gradient}`);
      styles.push(`background-repeat: no-repeat`);
    } else if (isLeaf) {
      // 非文本叶子节点使用骨架动画
      styles.push(`background: linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%)`);
      styles.push(`background-size: 200px 100%`);
      styles.push(`animation: trinity-shimmer 1.5s infinite ease-in-out`);
    }

    return styles.join('; ');
  }

  /**
   * 文本转CSS渐变
   */
  textToGradient(node, style) {
    const lineHeight = parseFloat(style.lineHeight) || 14;
    const fontSize = parseFloat(style.fontSize) || 14;
    const padding = this.parseDir(
      style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft
    );

    const contentH = node.rect.h - padding.top - padding.bottom;
    const contentW = node.rect.w - padding.left - padding.right;

    if (contentH <= 0 || contentW <= 0) return null;

    const lineCount = Math.max(1, Math.floor(contentH / lineHeight));
    const gradients = [];

    for (let i = 0; i < lineCount; i++) {
      const y = padding.top + i * lineHeight;
      const isLast = i === lineCount - 1;
      const lineW = isLast ? contentW * 0.6 : contentW;
      const lineH = Math.min(lineHeight, contentH - i * lineHeight);

      gradients.push(
        `linear-gradient(#d0d0d0 0 0) ${padding.left}px ${y}px / ${lineW}px ${lineH}px`
      );
    }

    return gradients.join(', ');
  }

  /**
   * 工具方法
   */
  isIgnoredTag(tag) {
    return ['html', 'head', 'script', 'style', 'link', 'meta', 'noscript', 'iframe', 'template'].includes(tag);
  }

  isVisible(rect, style) {
    if (!rect || rect.width < 1 || rect.height < 1) return false;
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) === 0) return false;
    return true;
  }

  isLeafElement(element, style) {
    const tag = element.tagName?.toLowerCase();

    // 可枚举的叶子标签
    const leafTags = ['img', 'input', 'textarea', 'select', 'button', 'a',
                      'canvas', 'svg', 'video', 'audio', 'br', 'hr'];
    if (leafTags.includes(tag)) return true;

    // 有文本内容的
    if (this.hasTextContent(element)) return true;

    // 无子元素的
    if (!element.children || element.children.length === 0) return true;

    return false;
  }

  hasTextContent(element) {
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.trim();
        if (text && text.length > 0) return true;
      }
    }
    return false;
  }

  flattenAnchors(anchors) {
    const result = [];
    const traverse = (nodes) => {
      for (const node of nodes) {
        if (!node) continue;
        result.push(node);
        if (node.children && node.children.length > 0) {
          traverse(node.children);
        }
      }
    };
    traverse(anchors);
    return result;
  }

  countNodes(node) {
    if (!node) return 0;
    return 1 + (node.children || []).reduce((s, c) => s + this.countNodes(c), 0);
  }

  countLeafNodes(node) {
    if (!node) return 0;
    if (!node.children || node.children.length === 0) return 1;
    return (node.children || []).reduce((s, c) => s + this.countLeafNodes(c), 0);
  }

  countPruned(original, pruned) {
    return this.countNodes(original) - this.countNodes(pruned);
  }
}

// 浏览器环境
if (typeof window !== 'undefined') {
  window.SkeletonTranspiler = SkeletonTranspiler;
}

// Node.js环境
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SkeletonTranspiler;
}
