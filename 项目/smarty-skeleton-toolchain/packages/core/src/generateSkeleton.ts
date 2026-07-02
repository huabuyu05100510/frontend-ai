import defaultConfig from "./config";
import * as db from "./db";
import {
  requestIdleCallbackWithPolyfill,
  cancelIdleCallbackWithPolyfill,
} from "./requestIdleCallbackWithPolyfill";

export type BoxNodeDSL = {
  positionInfo: {
    l: number;
    t: number;
    r?: number;
    b?: number;
    w: number;
    h: number;
  };
  borderRadius?: string;
  background?: string;
  backgroundColor?: string;
  noChild?: boolean;
  borderWidth?: string;
  borderStyle?: string;
  borderColor?: string;
};

export type BgsDSL = BoxNodeDSL; // 背景块 HTML 字符串
export type BordersDSL = BoxNodeDSL; // 边框块 HTML 字符串

export type SkeletonDSL = {
  boxes: BoxNodeDSL[];
  bgs: BgsDSL[];
  borders: BordersDSL[];
  width: number;
  height: number;
};


function getVisibleRect(el: HTMLElement) {
  if (!el) return null;

  let visibleRect :any = el.getBoundingClientRect();
  let parent: HTMLElement | null = el.parentElement;

  while (parent) {
    const style = window.getComputedStyle(parent);
    const overflow = style.overflow + style.overflowX + style.overflowY;

    if (/(auto|scroll|hidden)/.test(overflow)) {
      const parentRect = parent.getBoundingClientRect();

      visibleRect = {
        top: Math.max(visibleRect.top, parentRect.top),
        left: Math.max(visibleRect.left, parentRect.left),
        bottom: Math.min(visibleRect.bottom, parentRect.bottom),
        right: Math.min(visibleRect.right, parentRect.right),
        width: Math.max(0, Math.min(visibleRect.right, parentRect.right) - Math.max(visibleRect.left, parentRect.left)),
        height: Math.max(0, Math.min(visibleRect.bottom, parentRect.bottom) - Math.max(visibleRect.top, parentRect.top)),
      };
    }

    parent = parent.parentElement;
  }

  return visibleRect;
}



export default class generateSkeleton {
  nodeQueue: any[];
  boxes: BoxNodeDSL[];
  bgs: BgsDSL[];
  borders: BordersDSL[];
  rootPositionInfo: DOMRect;
  minW: number;
  minH: number;
  minGapW: number;
  minGapH: number;
  defaultColor: string;
  borderRadius: string;
  isInterrupted: boolean;
  taskId: any;
  id: string;

  private resultPromise: Promise<SkeletonDSL>;
  private resolveDone: ((dsl: SkeletonDSL) => void) | null = null;

  constructor(props: any) {
    const root = props.root || document.body;
    root.id = root.id || "ske";
    this.rootPositionInfo = root.getBoundingClientRect();
    const r=getVisibleRect(root)
    const { left: rl, right: rr, top: rt, bottom: rb } = r||{};
    this.isInterrupted = false;
    console.log({ r: rr, l: rl, t: rt, b: rb },'root',root?.clientWidth,root?.clientHeight)
    this.nodeQueue = [
      {
        node: root,
        skeId: root.id,
        pid: 0,
        pPositionInfo: { r: rr, l: rl, t: rt, b: rb },
      },
    ];
    this.minW = props.minW || defaultConfig.minW;
    this.minH = props.minH || defaultConfig.minH;
    this.minGapW = props.minGapW || defaultConfig.minGapW;
    this.minGapH = props.minGapH || defaultConfig.minGapH;
    this.defaultColor = props.defaultColor || defaultConfig.defaultColor;
    this.borderRadius = props.borderRaduis || defaultConfig.borderRadius;
    this.boxes = [];
    this.bgs = [];
    this.borders = [];
    this.id = props.id;
    this.taskId = "";

    this.resultPromise = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
  }

  isBackgroundSet(style: any) {
    const bg = style.background;
    const bgColor = style.backgroundColor;

    const transparentList = ["rgba(0, 0, 0, 0)", "transparent"];

    const isColorValid = bgColor && !transparentList.includes(bgColor);

    // 图片/渐变背景判断
    const isImageBg =
      /(url|gradient)/.test(bg) || /(url|gradient)/.test(style.backgroundImage);

    return isColorValid || isImageBg;

    // return (
    //   style.background !== "rgba(0, 0, 0, 0)" ||
    //   style.backgroundImage !== "none" ||
    //   style.backgroundColor !== "rgba(0, 0, 0, 0)"
    // );
  }

  //TODO
  isImgBgSet(styles:any) {
    const EXT_REG = /\.(jpeg|jpg|png|gif|svg|webp)/;
    const GRADIENT_REG = /gradient/;
    const hasImgBg =
      EXT_REG.test(styles.background) ||
      EXT_REG.test(styles.backgroundImage) ||
      GRADIENT_REG.test(styles.background) ||
      GRADIENT_REG.test(styles.backgroundImage);
    return !!hasImgBg;
  }

  getIsVisible(node: Node) {
    try {
      const style = window.getComputedStyle(node as Element);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0"
      );
    } catch {
      return false;
    }
  }

  hasBorder(style: any) {
    const sides = ["Top", "Right", "Bottom", "Left"];

    return sides.some((side) => {
      const width = style[`border${side}Width`];
      const color = style[`border${side}Color`];
      const styleType = style[`border${side}Style`];

      if (width === "0px") return false;
      if (styleType === "none") return false;
      if (color === "rgba(0, 0, 0, 0)") return false;

      return true;
    });

    // return (
    //   style.borderTopColor !== "rgba(0, 0, 0, 0)" ||
    //   style.borderRightColor !== "rgba(0, 0, 0, 0)" ||
    //   style.borderBottomColor !== "rgba(0, 0, 0, 0)" ||
    //   style.borderLeftColor !== "rgba(0, 0, 0, 0)" ||
    //   style.borderTopWidth !== "0px" ||
    //   style.borderRightWidth !== "0px" ||
    //   style.borderBottomWidth !== "0px" ||
    //   style.borderLeftWidth !== "0px" ||
    //   style.borderTopStyle !== "none" ||
    //   style.borderRightStyle !== "none" ||
    //   style.borderBottomStyle !== "none" ||
    //   style.borderLeftStyle !== "none"
    // );
  }

  getIsInEnumableTags({ node }: { node: Node }) {
    const enumElements = [
      "audio",
      "button",
      "canvas",
      "code",
      "img",
      "input",
      "pre",
      "svg",
      "i",
      "a",
      "figure",
      "textarea",
      "video",
      "xmp",
    ];
    return node.nodeName && enumElements.includes(node.nodeName.toLowerCase());
  }

  // getPositionStyles(positionInfo: any) {
  //   if (!positionInfo) return [];
  //   const { l, t, w, h } = positionInfo;
  //   return [
  //     `position: absolute`,
  //     `width:${w}%`,
  //     `height:${h}%`,
  //     `left:${l}%`,
  //     `top:${t}%`,
  //   ];
  // }
  getPercentPositionInfo({ l, t, w, h }: any) {
      //TODO 这里的width height应该为容器属性
      const { width = window.innerWidth, height = window.innerHeight } =
        this.rootPositionInfo;
      const { left: rL, top: rT, width: rw, height: rh } = this.rootPositionInfo;

      return {
        l: Number((((l - rL) / width) * 100).toFixed(2)),
        t: Number((((t - rT) / height) * 100).toFixed(2)),
        w: Number(((w / rw) * 100).toFixed(2)),
        h: Number(((h / rh) * 100).toFixed(2)),
      };
    }
  
  matchLeafClass(node: any) {
    if (!node || !(node instanceof Element)) return false;

    let cls = "";

    // 情况 1：className 是普通字符串
    if (typeof node.className === "string") {
      cls = node.className.toLowerCase();
    }
    // 情况 2：className 是对象（例如 SVG 或 CSS-in-JS）
    else if (node.className && typeof node.className === "object") {
      // eg: SVGAnimatedString { baseVal: 'xxx' }
      if (typeof (node?.className as any )?.baseVal === "string") {
        cls = (node?.className as any ).baseVal?.toLowerCase();
      }
      // eg: { value: "xx yy" }
      else if (typeof (node?.className as any)?.value === "string") {
        cls = (node?.className as any)?.value?.toLowerCase();
      }
      // eg: DOMTokenList
      else if (node.classList && typeof node.classList.value === "string") {
        cls = node.classList.value.toLowerCase();
      }
    }

    if (!cls) return false;

    const LEAF_CLASS_KEYS = [
      "input",
      "btn",
      "button",
      "select",
      "dropdown",
      "tag",
      "picker",
      "pagination",
    ];

    return LEAF_CLASS_KEYS.some((key) => cls.includes(key));
  }

  performTraverseNode({ node, skeId, pid, ...props }: any) {
    if (!node || this.isInterrupted) return;
    if (!(node instanceof Element)) {
      console.warn("非元素节点", node);
      return;
    }

    // **新增：跳过 colgroup** 特殊标签不处理
    if (node.nodeName.toLowerCase() === "colgroup") return;

    // if (
    //   // (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim().length) ||
    //   !(node.nodeType === Node.ELEMENT_NODE) &&!(node.nodeType === Node.TEXT_NODE)
    //   // ||
    //   // !(node.nodeType === Node.TEXT_NODE)
    // ){
    //   return;
    // }

    //IsVisible
    const style = window.getComputedStyle(node as Element);
    if (
      style.display == "none" ||
      style.visibility == "hidden" ||
      style.opacity == "0"
    ) {
      return;
    }

    //判断是否在父元素内
    const rects = node.getBoundingClientRect();
    let { left: l, top: t, right: r, bottom: b, width: w, height: h } = rects as any;
    l = parseInt(l);
    t = parseInt(t);
    r = parseInt(r);
    b = parseInt(b);
    h = parseInt(h);
    w = parseInt(w);
    //转parseInt

    const { l: pl, t: pt, r: pr, b: pb } = props.pPositionInfo || {};
    console.log(t, pb, l, pr, b, pt, r < pl, "kkkk");
    l = Math.max(pl, l);
    t = Math.max(pt, t);
    r = Math.min(pr, r);
    b = Math.min(pb, b);
    w = Math.abs(r - l);
    h = Math.abs(b - t);
    if (t >= pb || l >= pr || b <= pt || r <= pl) {
      console.log("true kkkk");
      return;
    }

    const {
      borderRadius,
      background,
      backgroundColor,
      borderWidth,
      borderStyle,
      borderColor,
    } = style;
    //裁剪逻辑
    const hasImgBg = this.isImgBgSet(style);
    const hasChildText = Array.from(node.childNodes || []).some(
      (n: any) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim().length
    );
    const isInEnumableTags = this.getIsInEnumableTags({ node });
    const hasChildNodes = node.hasChildNodes();
    const isBlock = (node as Element).getAttribute("data-skeleton-block");
    const isMatchClass = this.matchLeafClass(node);
    if (
      isMatchClass ||
      hasChildText ||
      isBlock ||
      isInEnumableTags ||
      hasImgBg ||
      !hasChildNodes
    ) {
      let { paddingBottom, paddingLeft, paddingRight, paddingTop } = style;
      if (!isMatchClass) {
        let intB = parseInt(paddingBottom) as any;
        let intL = parseInt(paddingLeft) as any;
        let intR = parseInt(paddingRight) as any;
        let intTop = parseInt(paddingTop) as any;
        l = l + intL;
        t = t + intTop;
        r = r - intR;
        b = b - intB;
      }

      l = Math.max(pl, l);
      t = Math.max(pt, t);
      r = Math.min(pr, r);
      b = Math.min(pb, b);
      w = Math.abs(r - l);
      h = Math.abs(b - t);

      //认为叶子节点

      this.boxes.push({
        positionInfo: { l, t, w, h, r, b },
        borderRadius: this.borderRadius,
        background: backgroundColor,
        borderWidth,
        borderStyle,
        borderColor,
        noChild: !hasChildNodes,
      });

      return;
    }

    const hasBg = this.isBackgroundSet(style);
    const hasBorder = this.hasBorder(style);
    if (hasBg && hasBorder) {
      this.bgs.push({
        positionInfo: this.getPercentPositionInfo({ l, t, r, b, w, h }),
        borderRadius,
        background,
        backgroundColor,
        borderWidth,
        borderStyle,
        borderColor,
      });
    }
    if (hasBg && !hasBorder) {
      this.bgs.push({
        positionInfo: this.getPercentPositionInfo({ l, t, r, b, w, h }),
        borderRadius,
        background: background,
        backgroundColor,
      });
    }
    if (!hasBg && hasBorder) {
      this.borders.push({
        positionInfo: this.getPercentPositionInfo({ l, t, r, b, w, h }),
        borderRadius,
        background,
        backgroundColor,
        borderWidth,
        borderStyle,
        borderColor,
      });
    }

    Array.from(node.childNodes).forEach((child, idx) => {
      pid++;
      this.nodeQueue.push({
        node: child,
        skeId: skeId + (child as any).id,
        pid: pid,
        pPositionInfo: { l, t, r, b, w, h },
      });
    });
  }

  saveSke() {
    if (this.isInterrupted) return;

    const mergedBoxes: BoxNodeDSL[] = this.boxes.map((box) => ({
      ...box,
      positionInfo: this.getPercentPositionInfo(box.positionInfo),
    }));

    const dsl: SkeletonDSL = {
      boxes: mergedBoxes,
      bgs: this.bgs,
      borders: this.borders,
      width: this.rootPositionInfo.width,
      height: this.rootPositionInfo.height,
    };

 
    // 存储
    const key = `${window.location.origin + window.location.pathname}-${
      this.id
    }-${window.innerWidth}-${window.innerHeight}`;
    db.setItem(key, dsl);

    // 缓存宽高
    localStorage.setItem(
      `${key}-size`,
      JSON.stringify({ width: `${dsl.width}px`, height: `${dsl.height}px` })
    );
   this.resolveDone?.((db.compressDSL(dsl) as any));

    return dsl;
  }

  cancelTask() {
    this.isInterrupted = true;
    this.taskId && cancelIdleCallbackWithPolyfill(this.taskId);
  }

  performWorkUnit() {
    // if (this.isInterrupted) return;
    if (!this.nodeQueue.length) {
      this.saveSke();
      return;
    }
    this.taskId = requestIdleCallbackWithPolyfill((deadline: any) => {
      let currentNodeInfo;
      while (
        deadline.timeRemaining() > 0 &&
        (currentNodeInfo = this.nodeQueue.shift())
      ) {
        this.performTraverseNode(currentNodeInfo);
      }
      this.performWorkUnit();
    });
  }

  async generateAndGetResult(): Promise<SkeletonDSL> {
    this.performWorkUnit();
    return this.resultPromise;
  }

}
