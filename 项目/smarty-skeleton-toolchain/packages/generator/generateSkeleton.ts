import defaultConfig from './config';
import localforage from './localforage';
import {
  requestIdleCallbackWithPolyfill,
  cancelIdleCallbackWithPolyfill,
} from './requestIdleCallbackWithPolyfill';

type PositionInfo = { l: number; t: number; r: number; b: number; w: number; h: number; };
type BoxInfo = {
  positionInfo: PositionInfo;
  pid: number;
  skeId: string;
  borderRadius: string;
  background?: string;
  backgroundColor?: string;
  noChild?: boolean;
  merged?: boolean;
};
type TraverseNodeInfo = {
  node: Node;
  skeId: string;
  pid: number;
  positionInfo?: PositionInfo;
  pPositionInfo?: PositionInfo;
  noChild?: boolean;
};

export default class generateSkeleton {
  private rootPositionInfo: DOMRect;
  private isInterrupted = false;
  private nodeQueue: TraverseNodeInfo[];
  private minW: number;
  private minH: number;
  private minGapW: number;
  private minGapH: number;
  private defaultColor: string;
  private borderRadius: string;
  private boxes: BoxInfo[] = [];
  private bgs = '';
  private borders = '';
  private id?: string;
  private taskId?: number;

  constructor(props: { root?: HTMLElement; minW?: number; minH?: number; minGapW?: number; minGapH?: number; defaultColor?: string; borderRadius?: string; id?: string; }) {
    const root = props.root ?? document.body;
    root.id = root.id || 'ske';
    this.rootPositionInfo = root.getBoundingClientRect();
    this.nodeQueue = [{ node: root, skeId: root.id, pid: 0 }];
    this.minW = props.minW ?? defaultConfig.minW;
    this.minH = props.minH ?? defaultConfig.minH;
    this.minGapW = props.minGapW ?? defaultConfig.minGapW;
    this.minGapH = props.minGapH ?? defaultConfig.minGapH;
    this.defaultColor = props.defaultColor ?? defaultConfig.defaultColor;
    this.borderRadius = props.borderRadius ?? defaultConfig.borderRadius;
    this.id = props.id;
  }

  private isBackgroundSet(node: Node): boolean {
    if (!(node instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(node);
    return style.background !== 'rgba(0, 0, 0, 0)' || style.backgroundImage !== 'none' || style.backgroundColor !== 'rgba(0, 0, 0, 0)';
  }

  private isImgBgSet(node: Node): boolean {
    if (!(node instanceof HTMLElement)) return false;
    const styles = window.getComputedStyle(node);
    const EXT_REG = /\.(jpeg|jpg|png|gif|svg|webp)/;
    const GRADIENT_REG = /gradient/;
    return EXT_REG.test(styles.background) || EXT_REG.test(styles.backgroundImage) || GRADIENT_REG.test(styles.background) || GRADIENT_REG.test(styles.backgroundImage);
  }

  private getIsVisible(node: Node): boolean {
    if (!(node instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  private hasBorder(node: Node): boolean {
    if (!(node instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(node);
    return style.borderTopColor !== 'rgba(0, 0, 0, 0)' ||
           style.borderRightColor !== 'rgba(0, 0, 0, 0)' ||
           style.borderBottomColor !== 'rgba(0, 0, 0, 0)' ||
           style.borderLeftColor !== 'rgba(0, 0, 0, 0)' ||
           style.borderTopWidth !== '0px' ||
           style.borderRightWidth !== '0px' ||
           style.borderBottomWidth !== '0px' ||
           style.borderLeftWidth !== '0px' ||
           style.borderTopStyle !== 'none' ||
           style.borderRightStyle !== 'none' ||
           style.borderBottomStyle !== 'none' ||
           style.borderLeftStyle !== 'none';
  }

  private getIsInEnumableTags({ node }: { node: Node }): boolean {
    const enumElements = ['audio','button','canvas','code','img','input','pre','svg','i','a','figure','textarea','video','xmp'];
    return !!node.nodeName && enumElements.includes(node.nodeName.toLowerCase());
  }

  private getPercentPositionInfo(positionInfo: PositionInfo): PositionInfo {
    const { width = window.innerWidth, height = window.innerHeight } = this.rootPositionInfo;
    const { l, t, r, b } = positionInfo;
    const w = r - l;
    const h = b - t;
    const { left: rL, top: rT } = this.rootPositionInfo;
    return { l: ((l - rL) / width)*100, t: ((t - rT)/height)*100, r: ((r-rL)/width)*100, b: ((b-rT)/height)*100, w: (w/width)*100, h: (h/height)*100 };
  }

  private getPositionStyles(positionInfo: PositionInfo): string[] {
    const { l, t, w, h } = positionInfo;
    return [`position: absolute`, `width:${w}%`, `height:${h}%`, `left:${l}%`, `top:${t}%`];
  }

  private getPositionInParent({ node, props, type }: { node: Node; props: TraverseNodeInfo; type?: 'text' | 'block' }): PositionInfo | undefined {
    if (!(node instanceof HTMLElement)) return undefined;
    const rect = node.getBoundingClientRect();
    let { left, top, right, bottom } = rect;
    if (type === 'text') {
      const style = window.getComputedStyle(node);
      left += parseInt(style.paddingLeft);
      top += parseInt(style.paddingTop);
      right -= parseInt(style.paddingRight);
      bottom -= parseInt(style.paddingBottom);
    }
    const l = props.pPositionInfo?.l ?? left;
    const t = props.pPositionInfo?.t ?? top;
    const r = props.pPositionInfo?.r ?? right;
    const b = props.pPositionInfo?.b ?? bottom;
    if (top > b || left > r || bottom < t || right < l) return undefined;
    const positionInfo: PositionInfo = { l: Math.max(left,l), t: Math.max(top,t), r: Math.min(right,r), b: Math.min(bottom,b), w:0, h:0 };
    positionInfo.w = positionInfo.r - positionInfo.l;
    positionInfo.h = positionInfo.b - positionInfo.t;
    if (positionInfo.w < this.minW || positionInfo.h < this.minH) return undefined;
    return positionInfo;
  }

  private createDiv({ node, skeId, pid, positionInfo, noChild }: { node: HTMLElement; skeId: string; pid: number; positionInfo: PositionInfo; noChild?: boolean }) {
    const style = window.getComputedStyle(node);
    this.boxes.push({ positionInfo, pid, skeId, borderRadius: this.borderRadius, background: style.background, backgroundColor: style.backgroundColor, noChild });
  }

  private addBgsAndBorder({ node, skeId, positionInfo, type }: { node: HTMLElement; skeId: string; positionInfo: PositionInfo; type: 'bg'|'border' }) {
    const style = window.getComputedStyle(node);
    const positionStyles = this.getPositionStyles(this.getPercentPositionInfo(positionInfo));
    const stylesInfo = positionStyles.concat([`border-width:${style.borderWidth}`, `border-style:${style.borderStyle}`, `border-color:${style.borderColor}`, `border-radius:${style.borderRadius}`, `background-color:${style.backgroundColor}`, `background:${style.background}`]).join(';');
    this.bgs += `<div style="${stylesInfo}"> </div>`;
  }

  private performTraverseNode({ node, skeId, pid, ...props }: TraverseNodeInfo) {
    if (!node || this.isInterrupted) return;
    if (!(node instanceof HTMLElement || node instanceof Text)) return;
    if (node instanceof Text && !node.textContent?.trim().length) return;
    if (node instanceof HTMLElement && !this.getIsVisible(node)) return;

    const fullProps: TraverseNodeInfo = { ...props, node, skeId: skeId??'', pid: pid??0 };
    const positionInParent = this.getPositionInParent({ node, props: fullProps });
    if (!positionInParent) return;

    const hasImgBg = node instanceof HTMLElement ? this.isImgBgSet(node) : false;
    const hasChildText = node.childNodes && Array.from(node.childNodes).some(n => n.nodeType===Node.TEXT_NODE && n.textContent?.trim().length);
    const isInEnumableTags = node instanceof HTMLElement ? this.getIsInEnumableTags({ node }) : false;
    const hasChildNodes = node.hasChildNodes();

    if (hasChildText || isInEnumableTags || hasImgBg || !hasChildNodes) {
      if (node instanceof HTMLElement) this.createDiv({ node, skeId, pid, positionInfo: positionInParent, noChild: !hasChildNodes });
      return;
    }

    const hasBg = node instanceof HTMLElement ? this.isBackgroundSet(node) : false;
    const hasBorder = node instanceof HTMLElement ? this.hasBorder(node) : false;

    if (hasBg || hasBorder) this.addBgsAndBorder({ node: node as HTMLElement, skeId, positionInfo: positionInParent, type: hasBg?'bg':'border' });

    const children = node.childNodes;
    const currentPid = pid + 1;
    children.forEach(currentNode => {
      const newSkeId = skeId + (currentNode instanceof HTMLElement ? currentNode.id : '');
      this.nodeQueue.push({ node: currentNode, skeId: newSkeId, pid: currentPid, pPositionInfo: positionInParent });
    });
  }

  performWorkUnit() {
    if (this.isInterrupted) return;
    if (!this.nodeQueue.length) return this.saveSke();

    this.taskId = requestIdleCallbackWithPolyfill((deadline) => {
      let currentNodeInfo;
      while (deadline.timeRemaining()>0 && (currentNodeInfo=this.nodeQueue.shift())) {
        this.performTraverseNode(currentNodeInfo);
      }
      this.performWorkUnit();
    });
  }

  saveSke() {
    if (this.isInterrupted) return;
    const mergedBoxes: BoxInfo[] = [];
    let blockDom = '';
    for (let i=0;i<this.boxes.length;i++){
      if (this.boxes[i].merged) continue;
      mergedBoxes.push(this.boxes[i]);
      const percentPositionInfo = this.getPercentPositionInfo(this.boxes[i].positionInfo);
      const positionStyles = this.getPositionStyles(percentPositionInfo);
      blockDom += `<div class="skeleton-common" style="${positionStyles.join(';')};border-radius:${this.boxes[i].borderRadius}"></div>`;
    }
    const skes = this.bgs + this.borders + blockDom;
    const { width, height } = this.rootPositionInfo;
    saveLocal(skes, width, height, this.id ?? '');
    return skes;
  }

  cancelTask() {
    this.isInterrupted = true;
    if (this.taskId) cancelIdleCallbackWithPolyfill(this.taskId);
  }
}

function saveLocal(cacheDOM: string, width: number, height: number, id: string) {
  const boxStyles = [`position: relative`, `width:${width}px`, `height:${height}px`];
  const cacheString = `<div style="${boxStyles.join(';')}"><style>.skeleton-common{position:absolute;background:#f4f4f4 linear-gradient(90deg,rgba(0,0,0,0.06) 50%,rgba(0,0,0,0.15) 50%,rgba(0,0,0,0.06) 63%);background-size:400% 100%;animation-name:loading;animation-duration:1.4s;animation-timing-function:ease;animation-iteration-count:infinite}@keyframes loading{0%{background-position:100% 50%}to{background-position:0% 50%}}</style>${cacheDOM}</div>`;
  const path = window.location.origin + window.location.pathname;
  const key = path + '-' + id + '-' + window.innerWidth + '-' + window.innerHeight;
  localStorage.setItem(key, JSON.stringify({ width: `${width}px`, height: `${height}px`, hasCache: true }));
  localforage.setItem(key, cacheString);
}
