var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
import defaultConfig from './config';
import localforage from './localforage';
import { requestIdleCallbackWithPolyfill, cancelIdleCallbackWithPolyfill, } from './requestIdleCallbackWithPolyfill';
var generateSkeleton = /** @class */ (function () {
    function generateSkeleton(props) {
        var _a, _b, _c, _d, _e, _f, _g;
        this.isInterrupted = false;
        this.boxes = [];
        this.bgs = '';
        this.borders = '';
        var root = (_a = props.root) !== null && _a !== void 0 ? _a : document.body;
        root.id = root.id || 'ske';
        this.rootPositionInfo = root.getBoundingClientRect();
        this.nodeQueue = [{ node: root, skeId: root.id, pid: 0 }];
        this.minW = (_b = props.minW) !== null && _b !== void 0 ? _b : defaultConfig.minW;
        this.minH = (_c = props.minH) !== null && _c !== void 0 ? _c : defaultConfig.minH;
        this.minGapW = (_d = props.minGapW) !== null && _d !== void 0 ? _d : defaultConfig.minGapW;
        this.minGapH = (_e = props.minGapH) !== null && _e !== void 0 ? _e : defaultConfig.minGapH;
        this.defaultColor = (_f = props.defaultColor) !== null && _f !== void 0 ? _f : defaultConfig.defaultColor;
        this.borderRadius = (_g = props.borderRadius) !== null && _g !== void 0 ? _g : defaultConfig.borderRadius;
        this.id = props.id;
    }
    generateSkeleton.prototype.isBackgroundSet = function (node) {
        if (!(node instanceof HTMLElement))
            return false;
        var style = window.getComputedStyle(node);
        return style.background !== 'rgba(0, 0, 0, 0)' || style.backgroundImage !== 'none' || style.backgroundColor !== 'rgba(0, 0, 0, 0)';
    };
    generateSkeleton.prototype.isImgBgSet = function (node) {
        if (!(node instanceof HTMLElement))
            return false;
        var styles = window.getComputedStyle(node);
        var EXT_REG = /\.(jpeg|jpg|png|gif|svg|webp)/;
        var GRADIENT_REG = /gradient/;
        return EXT_REG.test(styles.background) || EXT_REG.test(styles.backgroundImage) || GRADIENT_REG.test(styles.background) || GRADIENT_REG.test(styles.backgroundImage);
    };
    generateSkeleton.prototype.getIsVisible = function (node) {
        if (!(node instanceof HTMLElement))
            return false;
        var style = window.getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };
    generateSkeleton.prototype.hasBorder = function (node) {
        if (!(node instanceof HTMLElement))
            return false;
        var style = window.getComputedStyle(node);
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
    };
    generateSkeleton.prototype.getIsInEnumableTags = function (_a) {
        var node = _a.node;
        var enumElements = ['audio', 'button', 'canvas', 'code', 'img', 'input', 'pre', 'svg', 'i', 'a', 'figure', 'textarea', 'video', 'xmp'];
        return !!node.nodeName && enumElements.includes(node.nodeName.toLowerCase());
    };
    generateSkeleton.prototype.getPercentPositionInfo = function (positionInfo) {
        var _a = this.rootPositionInfo, _b = _a.width, width = _b === void 0 ? window.innerWidth : _b, _c = _a.height, height = _c === void 0 ? window.innerHeight : _c;
        var l = positionInfo.l, t = positionInfo.t, r = positionInfo.r, b = positionInfo.b;
        var w = r - l;
        var h = b - t;
        var _d = this.rootPositionInfo, rL = _d.left, rT = _d.top;
        return { l: ((l - rL) / width) * 100, t: ((t - rT) / height) * 100, r: ((r - rL) / width) * 100, b: ((b - rT) / height) * 100, w: (w / width) * 100, h: (h / height) * 100 };
    };
    generateSkeleton.prototype.getPositionStyles = function (positionInfo) {
        var l = positionInfo.l, t = positionInfo.t, w = positionInfo.w, h = positionInfo.h;
        return ["position: absolute", "width:".concat(w, "%"), "height:".concat(h, "%"), "left:".concat(l, "%"), "top:".concat(t, "%")];
    };
    generateSkeleton.prototype.getPositionInParent = function (_a) {
        var _b, _c, _d, _e, _f, _g, _h, _j;
        var node = _a.node, props = _a.props, type = _a.type;
        if (!(node instanceof HTMLElement))
            return undefined;
        var rect = node.getBoundingClientRect();
        var left = rect.left, top = rect.top, right = rect.right, bottom = rect.bottom;
        if (type === 'text') {
            var style = window.getComputedStyle(node);
            left += parseInt(style.paddingLeft);
            top += parseInt(style.paddingTop);
            right -= parseInt(style.paddingRight);
            bottom -= parseInt(style.paddingBottom);
        }
        var l = (_c = (_b = props.pPositionInfo) === null || _b === void 0 ? void 0 : _b.l) !== null && _c !== void 0 ? _c : left;
        var t = (_e = (_d = props.pPositionInfo) === null || _d === void 0 ? void 0 : _d.t) !== null && _e !== void 0 ? _e : top;
        var r = (_g = (_f = props.pPositionInfo) === null || _f === void 0 ? void 0 : _f.r) !== null && _g !== void 0 ? _g : right;
        var b = (_j = (_h = props.pPositionInfo) === null || _h === void 0 ? void 0 : _h.b) !== null && _j !== void 0 ? _j : bottom;
        if (top > b || left > r || bottom < t || right < l)
            return undefined;
        var positionInfo = { l: Math.max(left, l), t: Math.max(top, t), r: Math.min(right, r), b: Math.min(bottom, b), w: 0, h: 0 };
        positionInfo.w = positionInfo.r - positionInfo.l;
        positionInfo.h = positionInfo.b - positionInfo.t;
        if (positionInfo.w < this.minW || positionInfo.h < this.minH)
            return undefined;
        return positionInfo;
    };
    generateSkeleton.prototype.createDiv = function (_a) {
        var node = _a.node, skeId = _a.skeId, pid = _a.pid, positionInfo = _a.positionInfo, noChild = _a.noChild;
        var style = window.getComputedStyle(node);
        this.boxes.push({ positionInfo: positionInfo, pid: pid, skeId: skeId, borderRadius: this.borderRadius, background: style.background, backgroundColor: style.backgroundColor, noChild: noChild });
    };
    generateSkeleton.prototype.addBgsAndBorder = function (_a) {
        var node = _a.node, skeId = _a.skeId, positionInfo = _a.positionInfo, type = _a.type;
        var style = window.getComputedStyle(node);
        var positionStyles = this.getPositionStyles(this.getPercentPositionInfo(positionInfo));
        var stylesInfo = positionStyles.concat(["border-width:".concat(style.borderWidth), "border-style:".concat(style.borderStyle), "border-color:".concat(style.borderColor), "border-radius:".concat(style.borderRadius), "background-color:".concat(style.backgroundColor), "background:".concat(style.background)]).join(';');
        this.bgs += "<div style=\"".concat(stylesInfo, "\"> </div>");
    };
    generateSkeleton.prototype.performTraverseNode = function (_a) {
        var _this = this;
        var _b;
        var node = _a.node, skeId = _a.skeId, pid = _a.pid, props = __rest(_a, ["node", "skeId", "pid"]);
        if (!node || this.isInterrupted)
            return;
        if (!(node instanceof HTMLElement || node instanceof Text))
            return;
        if (node instanceof Text && !((_b = node.textContent) === null || _b === void 0 ? void 0 : _b.trim().length))
            return;
        if (node instanceof HTMLElement && !this.getIsVisible(node))
            return;
        var fullProps = __assign(__assign({}, props), { node: node, skeId: skeId !== null && skeId !== void 0 ? skeId : '', pid: pid !== null && pid !== void 0 ? pid : 0 });
        var positionInParent = this.getPositionInParent({ node: node, props: fullProps });
        if (!positionInParent)
            return;
        var hasImgBg = node instanceof HTMLElement ? this.isImgBgSet(node) : false;
        var hasChildText = node.childNodes && Array.from(node.childNodes).some(function (n) { var _a; return n.nodeType === Node.TEXT_NODE && ((_a = n.textContent) === null || _a === void 0 ? void 0 : _a.trim().length); });
        var isInEnumableTags = node instanceof HTMLElement ? this.getIsInEnumableTags({ node: node }) : false;
        var hasChildNodes = node.hasChildNodes();
        if (hasChildText || isInEnumableTags || hasImgBg || !hasChildNodes) {
            if (node instanceof HTMLElement)
                this.createDiv({ node: node, skeId: skeId, pid: pid, positionInfo: positionInParent, noChild: !hasChildNodes });
            return;
        }
        var hasBg = node instanceof HTMLElement ? this.isBackgroundSet(node) : false;
        var hasBorder = node instanceof HTMLElement ? this.hasBorder(node) : false;
        if (hasBg || hasBorder)
            this.addBgsAndBorder({ node: node, skeId: skeId, positionInfo: positionInParent, type: hasBg ? 'bg' : 'border' });
        var children = node.childNodes;
        var currentPid = pid + 1;
        children.forEach(function (currentNode) {
            var newSkeId = skeId + (currentNode instanceof HTMLElement ? currentNode.id : '');
            _this.nodeQueue.push({ node: currentNode, skeId: newSkeId, pid: currentPid, pPositionInfo: positionInParent });
        });
    };
    generateSkeleton.prototype.performWorkUnit = function () {
        var _this = this;
        if (this.isInterrupted)
            return;
        if (!this.nodeQueue.length)
            return this.saveSke();
        this.taskId = requestIdleCallbackWithPolyfill(function (deadline) {
            var currentNodeInfo;
            while (deadline.timeRemaining() > 0 && (currentNodeInfo = _this.nodeQueue.shift())) {
                _this.performTraverseNode(currentNodeInfo);
            }
            _this.performWorkUnit();
        });
    };
    generateSkeleton.prototype.saveSke = function () {
        var _a;
        if (this.isInterrupted)
            return;
        var mergedBoxes = [];
        var blockDom = '';
        for (var i = 0; i < this.boxes.length; i++) {
            if (this.boxes[i].merged)
                continue;
            mergedBoxes.push(this.boxes[i]);
            var percentPositionInfo = this.getPercentPositionInfo(this.boxes[i].positionInfo);
            var positionStyles = this.getPositionStyles(percentPositionInfo);
            blockDom += "<div class=\"skeleton-common\" style=\"".concat(positionStyles.join(';'), ";border-radius:").concat(this.boxes[i].borderRadius, "\"></div>");
        }
        var skes = this.bgs + this.borders + blockDom;
        var _b = this.rootPositionInfo, width = _b.width, height = _b.height;
        saveLocal(skes, width, height, (_a = this.id) !== null && _a !== void 0 ? _a : '');
        return skes;
    };
    generateSkeleton.prototype.cancelTask = function () {
        this.isInterrupted = true;
        if (this.taskId)
            cancelIdleCallbackWithPolyfill(this.taskId);
    };
    return generateSkeleton;
}());
export default generateSkeleton;
function saveLocal(cacheDOM, width, height, id) {
    var boxStyles = ["position: relative", "width:".concat(width, "px"), "height:".concat(height, "px")];
    var cacheString = "<div style=\"".concat(boxStyles.join(';'), "\"><style>.skeleton-common{position:absolute;background:#f4f4f4 linear-gradient(90deg,rgba(0,0,0,0.06) 50%,rgba(0,0,0,0.15) 50%,rgba(0,0,0,0.06) 63%);background-size:400% 100%;animation-name:loading;animation-duration:1.4s;animation-timing-function:ease;animation-iteration-count:infinite}@keyframes loading{0%{background-position:100% 50%}to{background-position:0% 50%}}</style>").concat(cacheDOM, "</div>");
    var path = window.location.origin + window.location.pathname;
    var key = path + '-' + id + '-' + window.innerWidth + '-' + window.innerHeight;
    localStorage.setItem(key, JSON.stringify({ width: "".concat(width, "px"), height: "".concat(height, "px"), hasCache: true }));
    localforage.setItem(key, cacheString);
}
