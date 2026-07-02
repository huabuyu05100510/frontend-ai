import defaultConfig from './config';
import localforage from './localforage';
import {
  requestIdleCallbackWithPolyfill,
  cancelIdleCallbackWithPolyfill,
} from './requestIdleCallbackWithPolyfill';

export default class generateSkeleton {
  constructor(props) {
    const root = props.root || document.body;
    root.id = root.id || 'ske';
    this.rootPositionInfo = root.getBoundingClientRect(); //根元素信息 主要计算灰色块的相对位置 相对宽度 相对高度等
    this.isInterrupted = false;
    this.nodeQueue = [{ node: root, skeId: root.id, pid: 0 }]; //skeId用于块级隐藏,pid用于合并重叠的div块
    this.minW = props.minW || defaultConfig.minW;
    this.minH = props.minH || defaultConfig.minH;
    this.minGapW = props.minGapW || defaultConfig.minGapW;
    this.minGapH = props.minGapH || defaultConfig.minGapH;
    this.defaultColor = props.defaultColor || defaultConfig.defaultColor;
    this.borderRadius = props.borderRaduis || defaultConfig.borderRaduis;
    this.boxes = []; //灰色块
    this.bgs = []; //背景块
    this.borders = []; //线条块
    this.id = props.id;
    this.taskId = '';
  }

  isBackgroundSet(node) {
    if (!(node.nodeType === Node.ELEMENT_NODE)) {
      //不是元素节点不能获取样式
      return;
    }
    const style = window.getComputedStyle(node);
    return (
      style.background !== 'rgba(0, 0, 0, 0)' ||
      style.backgroundImage !== 'none' ||
      style.backgroundColor !== 'rgba(0, 0, 0, 0)'
    );
  }

  isImgBgSet(node) {
    if (!(node.nodeType === Node.ELEMENT_NODE)) {
      //不是元素节点不能获取样式
      return;
    }
    const styles = window.getComputedStyle(node);
    const EXT_REG = /\.(jpeg|jpg|png|gif|svg|webp)/
    const GRADIENT_REG = /gradient/
    const hasImgBg=EXT_REG.test(styles.background) || EXT_REG.test(styles.backgroundImage)||GRADIENT_REG.test(styles.background)||GRADIENT_REG.test(styles.backgroundImage)
    return !!hasImgBg
  }

  getIsVisible(node) {
    try {
      const style = window.getComputedStyle(node);
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0'
      ); //　这里可以设置最小宽度高度等 //元素本身不可见
    } catch (e) {
      console.log(e, 'ee');
    }
  }

  hasBorder(node) {
    if (!(node.nodeType === Node.ELEMENT_NODE)) {
      return;
    }
    const style = window.getComputedStyle(node);
    return (
      style.borderTopColor !== 'rgba(0, 0, 0, 0)' || // 或者其他非transparent的颜色
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
      style.borderLeftStyle !== 'none'
    );
  }

  //可枚举的节点类型
  getIsInEnumableTags({ node }) {
    const enumElements = [
      'audio',
      'button',
      'canvas',
      'code',
      'img',
      'input',
      'pre',
      'svg',
      'i',
      'a',
      'figure',
      'textarea',
      'video',
      'xmp',
    ];
    return (
      node &&
      node.nodeName &&
      enumElements.includes(node.nodeName.toLowerCase())
    );
  }

  getPositionStyles(positionInfo) {
    if (!positionInfo) {
      return;
    }
    const { l, t, w, h } = positionInfo;
    return [
      'position: absolute', //TODO
      `width:${w}%`,
      `height:${h}%`,
      `left:${l}%`,
      `top:${t}%`,
    ];
  }

  getPercentPositionInfo(positionInfo) {
    if (!positionInfo) {
      return;
    }
    const { width = window.innerWidth, height = window.innerHeight } =
      this.rootPositionInfo;
    let { l, t, w, h } = positionInfo;
    const percentPositionInfo = {};
    const { left: rL, top: rT } = this.rootPositionInfo;
    percentPositionInfo.w = Number(((w / width) * 100).toFixed(2));
    percentPositionInfo.h = Number(((h / height) * 100).toFixed(2));
    percentPositionInfo.l = Number((((l - rL) / width) * 100).toFixed(2));
    percentPositionInfo.t = Number((((t - rT) / height) * 100).toFixed(2));
    return percentPositionInfo;
  }

  getPositionInParent({ node, props, type }) {
    let { left, top, right, bottom } = node.getBoundingClientRect();
    if (type === 'text') {
      const { paddingTop, paddingBottom, paddingLeft, paddingRight } =
        window.getComputedStyle(node, null);
      left = left + parseInt(paddingLeft);
      top = top + parseInt(paddingTop);
      right = right - parseInt(paddingRight);
      bottom = bottom - parseInt(paddingBottom);
    }
    const {
      l = left,
      t = top,
      r = right,
      b = bottom,
    } = props.pPositionInfo || {}; //父元素的位置信息
    if (top > b || left > r || bottom < t || right < l) {
      return; //和父元素没有任何交集
    }

    const positionInfo = {};
    positionInfo.l = Math.max(left, l);
    positionInfo.t = Math.max(top, t);
    positionInfo.r = Math.min(right, r);
    positionInfo.b = Math.min(bottom, b); //获取在父元素视口内的区域
    positionInfo.w = Math.abs(positionInfo.r - positionInfo.l);
    positionInfo.h = Math.abs(positionInfo.t - positionInfo.b);
    if (positionInfo.w < this.minW || positionInfo.h < this.minH) {
      return; //宽度或高度太小
    }
    return positionInfo;
  }

  addBgsAndBorder({ node, skeId, positionInfo, type }) {
    if (!(node.nodeType === Node.ELEMENT_NODE)) {
      return;
    }
    const percentPositionInfo = this.getPercentPositionInfo(positionInfo);
    if (!percentPositionInfo) {
      return null;
    }
    const {
      borderRadius,
      background,
      backgroundColor,
      borderWidth,
      borderStyle,
      borderColor,
    } = window.getComputedStyle(node, null);
    const positionStyles = this.getPositionStyles(percentPositionInfo);
    const stylesInfo = positionStyles
      .concat([
        `border-width:${borderWidth}`,
        `border-style:${borderStyle}`,
        `border-color:${borderColor}`,
        `border-radius:${borderRadius}`,
        `background-color:${backgroundColor}`,
        `background:${background}`,
      ])
      .join(';');
    // const stylesInfo =
    //   type === 'bg'
    //     ? stylesArr
    //         .concat([
    //           `background-color:${backgroundColor}`,
    //           `background:${background}`,
    //         ])
    //         .join(';')
    //     : stylesArr.concat([`background:transparent`]).join(';');

    this.bgs += `<div style="${stylesInfo}"/></div>`;
  }

  // addBorders({ node, skeId, positionInfo }) {
  //   if (!(node.nodeType === Node.ELEMENT_NODE)) {
  //     return;
  //   }
  //   const percentPositionInfo = this.getPercentPositionInfo(positionInfo);
  //   if (!percentPositionInfo) {
  //     return null;
  //   }
  //   const nodeId = skeId || '';
  //   const positionStyles = this.getPositionStyles(percentPositionInfo);
  //   const {
  //     borderRadius,
  //     backgroundColor,
  //     borderWidth,
  //     borderStyle,
  //     borderColor, //变成灰色系列
  //   } = window.getComputedStyle(node, null);
  //   const stylesInfo = positionStyles
  //     .concat([
  //       `background-color:${backgroundColor}`,
  //       `border-radius:${borderRadius}`,
  //     ])
  //     .concat([
  //       `border-width:${borderWidth}`,
  //       `border-style:${borderStyle}`,
  //       `border-color:${borderColor}`,
  //     ])
  //     .join(';');
  //   this.borders += `<div  data-ske-id="${nodeId}" style="${stylesInfo}" class="skeleton-common-border"></div>`;
  // }

  createDiv({ node, skeId, pid, positionInfo, noChild }) {
    if (!node || !positionInfo || !(node.nodeType === Node.ELEMENT_NODE)) {
      return;
    }
    const {
      // borderRadius,
      background,
      backgroundColor,
    } = window.getComputedStyle(node, null);
    const newNodeInfo = {
      positionInfo,
      pid,
      skeId,
      borderRadius: this.borderRadius,
      background,
      backgroundColor,
      noChild,
    };
    this.boxes.push(newNodeInfo);
  }

  performTraverseNode({ node, skeId, pid, ...props }) {
    if (!node || this.isInterrupted) {
      return;
    }
    //只处理tag和文本类型
    if (
      ![Node.ELEMENT_NODE, Node.TEXT_NODE].includes(node.nodeType) ||
      (node.nodeType === Node.TEXT_NODE && !node.textContent.trim().length)
    ) {
      return;
    }
    if (!this.getIsVisible(node)) {
      //本身元素不可见或不在父元素范围内
      return;
    }

    //判断元素是否太小 是否在父元素视口内 获取在父元素中的位置信息
    const positionInParent = this.getPositionInParent({ node, props });
    if (!positionInParent) {
      return;
    }
   const hasImgBg=this.isImgBgSet(node)
    //TODO //是否只要包含文本child就不递归了
    const hasChildText =
      node.childNodes &&
      Array.from(node.childNodes).some(
        (n) =>
          n.nodeType === Node.TEXT_NODE &&
          n.textContent &&
          n.textContent.trim().length
      );
    //如果是一些特殊Tag 或者特殊的case 可以直接创建灰色块 不需要再进行递归
    const isInEnumableTags = this.getIsInEnumableTags({ node });
    const hasChildNodes = node.hasChildNodes();
    const info = {
      node,
      skeId,
      pid,
      positionInfo: this.getPositionInParent({
        node,
        props,
        type:
          hasChildText && node.childNodes && node.childNodes.length === 1
            ? 'text'
            : 'block',
      }),
    };
    const isBlock = node.getAttribute('data-skeleton-block');
    if (hasChildText || isBlock || isInEnumableTags||hasImgBg) {
      //只有文本去除padding
      this.createDiv(info);
      return;
    }
    if (!hasChildNodes) {
      info.noChild = !hasChildNodes; // <Col style={{width:XX}}/>
        //只有文本去除padding
        this.createDiv(info);
      return;
    }

    //添加线条应该在创建灰色块之前
    //添加背景块
    const hasBg = this.isBackgroundSet(node);
    const hasBorder = this.hasBorder(node);
    if (hasBg || hasBorder) {
      this.addBgsAndBorder({
        node,
        skeId,
        positionInfo: positionInParent,
        type: hasBg ? 'bg' : 'border',
      });
    }
    //否则就往队列里面加node
    const children = node.childNodes;
    const currentPid = pid++;
    for (let i = 0; i < children.length; i++) {
      const currentNode = children[i];
      const newSkeId = skeId + currentNode.id;
      this.nodeQueue.push({
        node: currentNode,
        skeId: newSkeId,
        pid: currentPid,
        pPositionInfo: positionInParent,
      });
    }
  }

  saveSke() {
    if (this.isInterrupted) {
      return;
    }
    const mergedBoxes = [];
    let blockDom = '';
    //先合并
    for (let i = 0; i < this.boxes.length - 1; i++) {
      if (this.boxes[i].merged || this.boxes[i].noChild) {
        continue;
      }
      const previousDivInfo = this.boxes[i].positionInfo;
      let mergedPositionInfo = {
        l: previousDivInfo.l,
        r: previousDivInfo.r,
        t: previousDivInfo.t,
        b: previousDivInfo.b,
      };
      for (let j = i + 1; j < this.boxes.length; j++) {
        if (this.boxes[j].merged) {
          continue;
        }
        const { l: l1, r: r1, t: t1, b: b1 } = mergedPositionInfo;
        const currentDivInfo = this.boxes[j];
        const { l: l2, r: r2, t: t2, b: b2 } = currentDivInfo.positionInfo;
        const dx = (r2 + l2 - r1 - l1) / 2;
        const dy = (t2 + b2 - b1 - t1) / 2;
        if (
          Math.abs(dx) < (r2 + r1 - l1 - l2 + 2 * this.minGapW) / 2 &&
          Math.abs(dy) < Math.abs(b2 + b1 - t2 - t1 + 2 * this.minGapH) / 2
        ) {
          this.boxes[j].merged = true;
          mergedPositionInfo = {
            l: Math.min(l1, l2),
            r: Math.max(r1, r2),
            t: Math.min(t1, t2),
            b: Math.max(b1, b2),
          };
        }
      }
      mergedPositionInfo.w = Math.abs(
        mergedPositionInfo.r - mergedPositionInfo.l
      );
      mergedPositionInfo.h = Math.abs(
        mergedPositionInfo.b - mergedPositionInfo.t
      );
      mergedBoxes.push({
        positionInfo: mergedPositionInfo,
        borderRadius: this.borderRadius, //都使用第一个borderRaduis
        noChild: this.boxes[i].noChild,
      });

      const positionStyles = this.getPositionStyles(
        this.getPercentPositionInfo(mergedPositionInfo)
      );
      let stylesInfo = positionStyles.concat([
        `border-radius:${this.borderRadius}`,
      ]);
      if (this.boxes[i].noChild) {
        //<div style={{width:'xx'}}/>
        stylesInfo = stylesInfo.concat([
          `background:${this.boxes[i].background}`,
          `backgroundColor:${this.boxes[i].backgroundColor}`,
        ]);
      }
      blockDom += `<div class="skeleton-common" style="${stylesInfo.join(
        ';'
      )}" ></div>`;
    }
    const skes = this.bgs + this.borders + blockDom;
    const { width, height } = this.rootPositionInfo || {};
    saveLocal(skes, width, height, this.id);
    return skes;
  }

  cancelTask() {
    this.isInterrupted = true;
    this.taskId && cancelIdleCallbackWithPolyfill(this.taskId);
  }

  performWorkUnit() {
    if (this.isInterrupted) {
      //如果中断直接返回
      return;
    }
    console.log('start', performance.now());
    // 任务执行完毕后结束递归
    if (this.nodeQueue.length === 0) {
      //遍历完成
      this.saveSke();
      return;
    }

    this.taskId = requestIdleCallbackWithPolyfill((deadline) => {
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
}

function saveLocal(cacheDOM, width, height, id) {
  // if (!cacheDOM) {
  //   return;
  // }
  const appendDiv = document.createElement('div');
  appendDiv.style.position = 'relative';
  appendDiv.style.width = `${width}px`;
  appendDiv.style.height = `${height}px`;
  appendDiv.innerHTML = cacheDOM;
  // document.body.append(appendDiv);
  const boxStyles = [
    'position: relative',
    `width:${width}px`,
    `height:${height}px`,
  ];
  const cacheString = `<div style="${boxStyles.join(
    ';'
  )}"><style> .skeleton-common{position:absolute;background:#f4f4f4 linear-gradient(90deg,rgba(0,0,0,0.06) 50%,rgba(0,0,0,0.15) 50%,rgba(0,0,0,0.06) 63%);background-size:400% 100%;animation-name:loading;animation-duration:1.4s;animation-timing-function:ease;animation-iteration-count:infinite}@keyframes loading{0%{background-position:100% 50%}to{background-position:0% 50%}}@keyframes opacity{0%{opacity:1}50%{opacity:0.4}100%{opacity:1}}</style>${cacheDOM}</div>`;
  const path = window.location.origin + window.location.pathname;
  const key =
    path + '-' + id + '-' + window.innerWidth + '-' + window.innerHeight;
  localStorage.setItem(
    key,
    JSON.stringify({
      width: `${width}px`,
      height: `${height}px`,
      hasCache: true,
    })
  );
  localforage.setItem(key, cacheString);
  console.log('end start', performance.now());
}
