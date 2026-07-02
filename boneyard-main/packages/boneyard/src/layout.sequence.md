# layout.ts 时序图

> 覆盖每一行代码逻辑，按调用链展开。

---

## 架构概述

```
compileDescriptor()  ← 冷路径：一次性解析、准备文本、建编译树
computeLayout()      ← 热路径：复用编译树，按宽度做算术布局
```

---

## 1. 主入口：`computeLayout`（第 198-220 行）

```mermaid
sequenceDiagram
    autonumber
    participant Caller as 外部调用方
    participant CL as computeLayout
    participant CD as compileDescriptor
    participant LCN as layoutCompiledNode
    participant CB as cloneBones
    participant R as round()

    Caller->>CL: computeLayout(input, width, name?)
    Note over CL: L203: const compiled = compileDescriptor(input)
    CL->>CD: compileDescriptor(input)
    CD-->>CL: CompiledSkeletonDescriptor

    Note over CL: L204: const fragment = layoutCompiledNode(compiled, width)
    CL->>LCN: layoutCompiledNode(compiled, width)
    LCN-->>CL: LayoutFragment { height, bones[] }

    Note over CL: L205: const bones = cloneBones(fragment.bones)
    CL->>CB: cloneBones(fragment.bones)
    CB-->>CL: 深拷贝骨架数组（L443: map({...bone})）

    Note over CL: L207-211: 遍历 bones 找最大 bottom = b.y + b.h
    loop 每条 bone
        CL->>CL: maxBottom = max(maxBottom, b.y + b.h)
    end

    Note over CL: L213-219: 组装返回值
    CL->>R: round(maxBottom)
    R-->>CL: 精度修正（L467: Math.round(n*100)/100，NaN→0）
    CL-->>Caller: SkeletonResult { name, viewportWidth, width, height, bones }
```

**L203** — 调用 `compileDescriptor(input)`，将原始 `SkeletonDescriptor` 转换为带缓存的 `CompiledSkeletonDescriptor`。编译是"冷路径"，只做一次；如果传入的本就是编译态对象，则直接复用（或在源数据变更时自动重编译）。

**L204** — 拿到编译树后，调用 `layoutCompiledNode(compiled, width)` 执行真正的布局计算，返回 `LayoutFragment { height, bones[] }`。`bones` 是一组坐标已相对于容器原点定好的骨架矩形。

**L205** — 立即对 `fragment.bones` 做深拷贝（`cloneBones`，内部是 `map({...bone})`），防止调用方持有的引用污染内部缓存数据。

**L207-211** — 遍历拷贝出来的 `bones` 数组，逐条计算 `b.y + b.h`（即每条骨架的下边界），取最大值得到 `maxBottom`。这是整个骨架的实际内容高度，不依赖容器声明高度，而是由实际排布结果决定。

**L213-219** — 组装最终返回值 `SkeletonResult`：将 `maxBottom` 经 `round()`（`Math.round(n*100)/100`，非有限数归零）精度修正后作为 `height`，连同 `name`、`viewportWidth`、`width`、`bones` 一起返回给调用方。

---

## 2. 编译阶段：`compileDescriptor`（第 133-182 行）

```mermaid
sequenceDiagram
    autonumber
    participant CL as computeLayout
    participant CD as compileDescriptor
    participant ICD as isCompiledDescriptor
    participant EFC as ensureFreshCompiled
    participant FP as fingerprintDescriptor
    participant Cache as compiledDescriptorCache<br/>(WeakMap, L55)
    participant RS as resolveSides
    participant IL as isLeaf
    participant PS as prepareWithSegments<br/>(@chenglou/pretext)
    participant GITW as getIntrinsicTextWidth
    participant WLR as walkLineRanges

    CL->>CD: compileDescriptor(input)

    Note over CD: L136: 若 input 已是编译态
    CD->>ICD: isCompiledDescriptor(input)
    Note over ICD: L65-67: 检查 __compiled === true
    ICD-->>CD: true / false

    alt 已是 CompiledSkeletonDescriptor（L136）
        CD->>EFC: ensureFreshCompiled(desc)
        Note over EFC: L123: nextFP = fingerprintDescriptor(desc.source)
        EFC->>FP: fingerprintDescriptor(desc.source)
        FP-->>EFC: 指纹字符串
        Note over EFC: L124: 若指纹未变，直接返回缓存
        alt 指纹相同
            EFC-->>CD: 原 compiled（命中缓存）
        else 指纹变更（源数据被修改）
            EFC->>CD: compileDescriptor(desc.source)（重新编译）
        end
    else 原始 SkeletonDescriptor
        Note over CD: L138-142: 查 WeakMap 缓存
        CD->>Cache: compiledDescriptorCache.get(desc)
        Cache-->>CD: cached / undefined

        alt 有缓存（L139-142）
            CD->>FP: fingerprintDescriptor(desc)
            FP-->>CD: nextFingerprint
            Note over CD: L141: 若指纹未变，返回缓存
            CD-->>CL: cached（命中缓存）
        else 无缓存或指纹变更
            Note over CD: L144: sourceFingerprint = fingerprintDescriptor(desc)
            CD->>FP: fingerprintDescriptor(desc)
            FP-->>CD: sourceFingerprint

            Note over CD: L145: padding = resolveSides(desc.padding)
            CD->>RS: resolveSides(desc.padding)
            Note over RS: L57-61: undefined→全0; number→四边相同; Partial→逐字段
            RS-->>CD: Sides { top, right, bottom, left }

            Note over CD: L146: margin = resolveSides(desc.margin)
            CD->>RS: resolveSides(desc.margin)
            RS-->>CD: Sides

            Note over CD: L147-158: 文本指标（仅 text+font+lineHeight 同时存在时）
            alt desc.text && desc.font && desc.lineHeight（L148）
                CD->>PS: prepareWithSegments(desc.text, desc.font)
                Note over PS: 外部库：分词、段落准备
                PS-->>CD: PreparedTextWithSegments

                CD->>GITW: getIntrinsicTextWidth(prepared)
                Note over GITW: L78-83: walkLineRanges 以极大宽度走一遍，取最宽行 width
                GITW->>WLR: walkLineRanges(prepared, MAX_SAFE_INTEGER, cb)
                WLR-->>GITW: 回调每行，收集 line.width
                GITW-->>CD: intrinsicWidth（不含 padding）

                Note over CD: L152-155: 拼 textMetrics<br/>intrinsicWidth += padding.left+right<br/>singleLineThreshold = lineHeight * 1.5
                CD-->>CD: textMetrics 就绪
            else
                CD-->>CD: textMetrics = undefined
            end

            Note over CD: L160-178: 构造 CompiledSkeletonDescriptor
            CD->>IL: isLeaf(desc)
            Note over IL: L70: desc.leaf===true<br/>L71: desc.text!==undefined<br/>L72: 有height且无children<br/>L73: 有aspectRatio且无children
            IL-->>CD: boolean

            Note over CD: L174: contentSized = width===undefined && (有textMetrics || leaf===true)

            Note over CD: L175: 递归编译所有子节点
            loop 每个 child in desc.children
                CD->>CD: compileDescriptor(child)（递归）
            end

            Note over CD: L177: layoutCache = new Map()（每个节点独立缓存）

            Note over CD: L180: compiledDescriptorCache.set(desc, compiled)
            CD->>Cache: set(desc, compiled)

            CD-->>CL: CompiledSkeletonDescriptor
        end
    end
```

---

## 3. 布局缓存层：`layoutCompiledNode`（第 222-233 行）

```mermaid
sequenceDiagram
    autonumber
    participant Parent as 上层调用
    participant LCN as layoutCompiledNode
    participant NWK as normalizeWidthKey
    participant LC as desc.layoutCache<br/>(Map per node)
    participant CLF as computeLayoutFragment

    Parent->>LCN: layoutCompiledNode(desc, availableWidth)

    Note over LCN: L226: cacheKey = normalizeWidthKey(availableWidth)
    LCN->>NWK: normalizeWidthKey(availableWidth)
    Note over NWK: L461-464: 非有限数→0<br/>Math.round(width*1000)/1000（3位小数精度）
    NWK-->>LCN: cacheKey

    Note over LCN: L227: 查按宽度分组的布局缓存
    LCN->>LC: get(cacheKey)
    LC-->>LCN: cached / undefined

    alt 缓存命中（L228）
        LCN-->>Parent: cached LayoutFragment
    else 未命中
        Note over LCN: L230: fragment = computeLayoutFragment(desc, cacheKey)
        LCN->>CLF: computeLayoutFragment(desc, cacheKey)
        CLF-->>LCN: LayoutFragment

        Note over LCN: L231: desc.layoutCache.set(cacheKey, fragment)
        LCN->>LC: set(cacheKey, fragment)

        LCN-->>Parent: fragment
    end
```

---

## 4. 核心布局：`computeLayoutFragment`（第 235-293 行）

```mermaid
sequenceDiagram
    autonumber
    participant LCN as layoutCompiledNode
    participant CLF as computeLayoutFragment
    participant CW as clampWidth
    participant RLH as resolveLeafHeight
    participant LFR as layoutFlexRow
    participant LFC as layoutFlexColumn
    participant LB as layoutBlock
    participant OB as offsetBones
    participant R as round()

    LCN->>CLF: computeLayoutFragment(desc, availableWidth)

    Note over CLF: L239-246: 计算节点尺寸
    Note over CLF: L239: pad = desc.padding（已编译好的 Sides）
    Note over CLF: L240: mar = desc.margin
    Note over CLF: L241: nodeX = mar.left
    Note over CLF: L242: nodeY = mar.top
    Note over CLF: L243-246: nodeWidth
    CLF->>CW: clampWidth(desc.width ?? availableWidth, desc.maxWidth)
    Note over CW: L456-459: maxWidth 未定义→原值；否则 Math.min
    CW-->>CLF: nodeWidth

    Note over CLF: L247: contentX = nodeX + pad.left
    Note over CLF: L248: contentY = nodeY + pad.top
    Note over CLF: L249: contentWidth = max(0, nodeWidth - pad.left - pad.right)

    alt desc.leaf === true（L251）
        Note over CLF: L252: contentHeight = resolveLeafHeight(desc, contentWidth)
        CLF->>RLH: resolveLeafHeight(desc, contentWidth)
        RLH-->>CLF: contentHeight（像素高度）

        Note over CLF: L253: totalHeight = contentHeight + pad.top + pad.bottom
        Note over CLF: L254: boneWidth = nodeWidth（初始值）

        alt 有 textMetrics 且 contentHeight < singleLineThreshold（L256，单行文本）
            Note over CLF: L257: boneWidth = min(intrinsicWidth, nodeWidth)<br/>单行时骨架宽度收缩到文字自然宽
        end

        Note over CLF: L260-269: 返回单条 Bone
        CLF->>R: round(nodeX), round(nodeY), round(boneWidth), round(totalHeight)
        R-->>CLF: 精度修正值
        CLF-->>LCN: LayoutFragment { height: totalHeight+margins, bones: [1条] }

    else 容器节点（L272-292）
        Note over CLF: L272: innerHeight = 0
        Note over CLF: L273: childBones = []

        alt flex + row（L275）
            CLF->>LFR: layoutFlexRow(desc, contentWidth)
            LFR-->>CLF: LayoutFragment
            Note over CLF: L277: innerHeight = row.height
            CLF->>OB: offsetBones(row.bones, contentX, contentY)
            OB-->>CLF: 偏移后的子骨架
        else flex + column（L279）
            CLF->>LFC: layoutFlexColumn(desc, contentWidth)
            LFC-->>CLF: LayoutFragment
            Note over CLF: L281: innerHeight = column.height
            CLF->>OB: offsetBones(column.bones, contentX, contentY)
            OB-->>CLF: 偏移后的子骨架
        else block（L283）
            CLF->>LB: layoutBlock(desc, contentWidth)
            LB-->>CLF: LayoutFragment
            Note over CLF: L285: innerHeight = block.height
            CLF->>OB: offsetBones(block.bones, contentX, contentY)
            OB-->>CLF: 偏移后的子骨架
        end

        Note over CLF: L289-292: height = innerHeight + pad四边 + mar四边
        CLF-->>LCN: LayoutFragment { height, bones: childBones }
    end
```

---

## 5. 三种布局算法

### 5a. Block 布局（第 295-324 行）

```mermaid
sequenceDiagram
    autonumber
    participant CLF as computeLayoutFragment
    participant LB as layoutBlock
    participant LCN as layoutCompiledNode
    participant OB as offsetBones

    CLF->>LB: layoutBlock(parent, contentWidth)

    Note over LB: L299: y=0, prevMarBottom=0, prevIsText=false
    Note over LB: L304: 遍历 parent.children

    loop 每个子节点 child[i]
        alt i > 0（L307）
            Note over LB: L308: y -= min(prevMarBottom, child.margin.top)<br/>→ 外边距折叠（取两者较小值）
            Note over LB: L310: effectiveGap = max(prevMarBottom, child.margin.top)
            alt prevIsText && isText && effectiveGap < 8（L311）
                Note over LB: L312: y += 8 - effectiveGap<br/>→ 连续文本块最小间距 8px
            end
        end

        Note over LB: L316: childFragment = layoutCompiledNode(child, contentWidth)
        LB->>LCN: layoutCompiledNode(child, contentWidth)
        LCN-->>LB: LayoutFragment

        Note over LB: L317: bones.push(...offsetBones(childFragment.bones, 0, y))
        LB->>OB: offsetBones(childFragment.bones, 0, y)
        OB-->>LB: 垂直偏移后的骨架

        Note over LB: L318: y += childFragment.height（累加高度）
        Note over LB: L319: prevMarBottom = child.margin.bottom
        Note over LB: L320: prevIsText = !!child.textMetrics
    end

    LB-->>CLF: { height: y, bones }
```

### 5b. Flex Column 布局（第 326-342 行）

```mermaid
sequenceDiagram
    autonumber
    participant CLF as computeLayoutFragment
    participant LFC as layoutFlexColumn
    participant LCN as layoutCompiledNode
    participant OB as offsetBones

    CLF->>LFC: layoutFlexColumn(parent, contentWidth)

    Note over LFC: L330: gap = rowGap ?? gap ?? 0（行间距）
    Note over LFC: L331: y=0

    loop 每个子节点 children[i]
        LFC->>LCN: layoutCompiledNode(children[i], contentWidth)
        LCN-->>LFC: childFragment

        LFC->>OB: offsetBones(childFragment.bones, 0, y)
        OB-->>LFC: 偏移后骨架

        Note over LFC: L337: y += childFragment.height
        Note over LFC: L338: 非最后一项 且 height>0 → y += gap（零高子节点不加间距）
    end

    LFC-->>CLF: { height: y, bones }
```

### 5c. Flex Row 布局（第 344-419 行）

```mermaid
sequenceDiagram
    autonumber
    participant CLF as computeLayoutFragment
    participant LFR as layoutFlexRow
    participant CW as clampWidth
    participant GIW as getIntrinsicWidth
    participant LCN as layoutCompiledNode
    participant OB as offsetBones

    CLF->>LFR: layoutFlexRow(parent, contentWidth)

    Note over LFR: L348: 无子节点 → 返回空
    Note over LFR: L350: gap = columnGap ?? gap ?? 0
    Note over LFR: L351: justify = justifyContent ?? 'flex-start'
    Note over LFR: L352: align = alignItems ?? 'stretch'

    Note over LFR: L354-375: 第一遍：确定每列宽度
    loop 每个 child
        alt child.width 已定义（L359）
            LFR->>CW: clampWidth(child.width, child.maxWidth)
            CW-->>LFR: width（固定宽）
            Note over LFR: totalFixed += width
        else child.contentSized（L366，文本/leaf无显式宽）
            LFR->>GIW: getIntrinsicWidth(child, contentWidth)
            Note over GIW: L438: textMetrics→intrinsicWidth<br/>L439: width→itself<br/>L440: 否则→maxAvailable
            GIW-->>LFR: intrinsicWidth
            LFR->>CW: clampWidth(intrinsicWidth, child.maxWidth)
            CW-->>LFR: width
            Note over LFR: totalFixed += width
        else 弹性子节点（L372）
            Note over LFR: childWidths[i] = -1（待填）
            Note over LFR: flexCount++
        end
    end

    Note over LFR: L377: totalGaps = max(0, children.length-1) * gap
    Note over LFR: L378: remaining = max(0, contentWidth - totalFixed - totalGaps)
    Note over LFR: L379: flexWidth = flexCount>0 ? remaining/flexCount : 0

    Note over LFR: L381-385: 第二遍：填充弹性宽度
    loop childWidths[i] === -1
        LFR->>CW: clampWidth(flexWidth, child.maxWidth)
        CW-->>LFR: 实际弹性宽
    end

    Note over LFR: L387-389: 对每个子节点按已确定宽度布局
    loop 每个子节点
        LFR->>LCN: layoutCompiledNode(children[i], childWidths[i])
        LCN-->>LFR: childFragment
    end

    Note over LFR: L390: maxHeight = max(...fragments.height)
    Note over LFR: L391: totalUsed = sum(childWidths) + totalGaps

    Note over LFR: L393-403: justify-content 对齐计算
    alt justify === 'flex-end'（L396）
        Note over LFR: xStart = max(0, contentWidth - totalUsed)
    else justify === 'center'（L398）
        Note over LFR: xStart = max(0, (contentWidth-totalUsed)/2)
    else justify === 'space-between' && >1 child（L400）
        Note over LFR: totalChildWidth = sum(childWidths)<br/>extraGap = (contentWidth-totalChildWidth)/(n-1) - gap
    end

    Note over LFR: L406: x = xStart
    loop 每个子 fragment[i]（L408-416）
        Note over LFR: L409-411: align-items 垂直对齐
        alt align === 'center'
            Note over LFR: yOff = max(0, (maxHeight - fragment.height)/2)
        else align === 'flex-end'
            Note over LFR: yOff = max(0, maxHeight - fragment.height)
        else stretch / flex-start
            Note over LFR: yOff = 0
        end

        LFR->>OB: offsetBones(fragment.bones, x, yOff)
        OB-->>LFR: 定位后骨架

        Note over LFR: L414: x += childWidths[i]
        Note over LFR: L415: 非最后项 → x += gap + extraGap
    end

    LFR-->>CLF: { height: maxHeight, bones }
```

---

## 6. 叶节点高度：`resolveLeafHeight`（第 421-435 行）

```mermaid
sequenceDiagram
    autonumber
    participant CLF as computeLayoutFragment
    participant RLH as resolveLeafHeight
    participant PTL as pretextLayout<br/>(@chenglou/pretext)

    CLF->>RLH: resolveLeafHeight(desc, contentWidth)

    alt desc.textMetrics 存在（L422，文本节点）
        RLH->>PTL: pretextLayout(prepared, contentWidth, lineHeight)
        Note over PTL: 外部库：按宽度折行，返回 { height }
        PTL-->>RLH: { height }
        RLH-->>CLF: height（自动换行后实际高度）

    else desc.height 已定义（L426，显式高度）
        Note over RLH: L427: max(0, desc.height - pad.top - pad.bottom)<br/>减去 padding 得到内容高
        RLH-->>CLF: contentHeight

    else desc.aspectRatio 已定义且有效（L430）
        Note over RLH: L431: contentWidth / aspectRatio<br/>（宽高比推算高度）
        RLH-->>CLF: height

    else 兜底（L434）
        RLH-->>CLF: 20（默认 20px）
    end
```

---

## 7. 工具函数说明

| 函数 | 位置 | 作用 |
|------|------|------|
| `resolveSides(v)` | L57-61 | `undefined`→全0；`number`→四边等值；`Partial<Sides>`→补0 |
| `isLeaf(desc)` | L69-75 | 4种判定：显式`leaf:true`、有`text`、有`height`无子、有`aspectRatio`无子 |
| `getIntrinsicTextWidth(prepared)` | L77-83 | 以无限宽跑一遍文本布局，取最宽行宽度 |
| `fingerprintValue(v)` | L90-93 | `undefined`→`''`；其他→`String(v)` |
| `fingerprintSides(v)` | L85-88 | 调用`resolveSides`后拼成`"t,r,b,l"` |
| `fingerprintDescriptor(desc)` | L95-118 | 将所有字段拼为`::`分隔字符串，子节点递归；用于检测源数据变更 |
| `getIntrinsicWidth(desc, max)` | L437-441 | textMetrics→intrinsicWidth；有width→width；否则→maxAvailable |
| `cloneBones(bones)` | L443-445 | `map({...bone})`浅拷贝，防外部修改 |
| `offsetBones(bones, dx, dy)` | L447-454 | dx/dy全0时直接cloneBones；否则加偏移量并round |
| `clampWidth(w, max)` | L456-459 | `max`未定义→原值；否则`Math.min(w, max)` |
| `normalizeWidthKey(w)` | L461-464 | 非有限数→0；`Math.round(w*1000)/1000`（3位精度，防浮点key碎片化） |
| `round(n)` | L466-469 | 非有限数→0；`Math.round(n*100)/100`（2位精度，骨架坐标） |

---

## 8. 数据流总览

```
外部调用
  │
  ▼
computeLayout(input, width, name)
  │
  ├─→ compileDescriptor(input)           ← WeakMap 缓存，指纹变化时重编译
  │     ├─ resolveSides(padding/margin)
  │     ├─ prepareWithSegments(text,font) ← 仅文本节点
  │     ├─ getIntrinsicTextWidth()        ← 仅文本节点
  │     ├─ isLeaf()
  │     └─ 递归编译子节点
  │
  ├─→ layoutCompiledNode(compiled, width) ← Map<width, fragment> 缓存
  │     └─ computeLayoutFragment()
  │           ├─ [leaf]   resolveLeafHeight() → 单条 Bone
  │           ├─ [flex-row]    layoutFlexRow()
  │           ├─ [flex-column] layoutFlexColumn()
  │           └─ [block]       layoutBlock()
  │                 └─ 递归 layoutCompiledNode(children)
  │                      └─ offsetBones(dx, dy)
  │
  ├─→ cloneBones()                        ← 防外部修改
  └─→ 计算 maxBottom → SkeletonResult
```

---

## 9. 缓存策略说明

```
compiledDescriptorCache (WeakMap, 模块级)
  key:   原始 SkeletonDescriptor 对象
  value: CompiledSkeletonDescriptor
  失效:  fingerprintDescriptor() 结果变化 → 重编译
         invalidateDescriptor() 显式清除

desc.layoutCache (Map, 每个编译节点独立)
  key:   normalizeWidthKey(availableWidth)  ← 3位精度整数
  value: LayoutFragment { height, bones[] }
  失效:  重新编译节点时 new Map()
```
