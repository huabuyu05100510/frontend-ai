# 如何“加深”：从调API到解决无npm包的核心问题

> 核心结论：**“浅”= 调API + 展示结果。“深”= 解决一个没有现成npm包能解决的工程问题。**

---

## 先看你现在每个项目“浅”在哪

| 项目 | 现在做的事 | 本质 | 面试官怎么看 |
|------|----------|------|------------|
| 在哪儿 | 上传图片 → 调多模态API → 展示结果 | API壳 | “不就是调了个接口？” |
| 行中导游 | 路线→ POI匹配 → 调LLM生成剧本 → 调TTS → 播放 | API壳 | “这不都是后端干的活？” |
| 协同编辑器 | Yjs + Tiptap 搭了个Demo | 库的Demo | “npm install 谁不会？” |
| AI图搜 | 还没做 | 空 | “PPT项目？” |

**每一个项目的“前端工作”，都没有超过「npm install + 搭壳子」的层次。这就是你感觉不够深的原因。**

---

## 什么是“深”：一个判断标准

**你做的事情，有现成的npm包能解决吗？**

- 能 → 浅（你是npm包的消费者）
- 不能 → 深（你是工程问题的解决者）

举几个例子：

| 做的事 | 有npm包吗？ | 深浅 |
|--------|-----------|------|
| 用Tiptap搭富文本编辑器 | 有，Tiptap | 浅 |
| 在Tiptap里插入自定义变量标签(${xxx})，删除时整体删除，禁止内部编辑 | 没有 | 深（你写了VariableMention扩展） |
| 用next.js做一个页面 | 有 | 浅 |
| 10万条数据不卡顿地滚动 | 有虚拟滚动库，但处理动态高度+流式插入+缓冲区调优没有现成方案 | 深 |
| 调LLM API生成文本 | 有 | 浅 |
| LLM边生成边展示，且支持中途取消、重试、分支选择、步骤可视化 | 没有 | 深 |
| 调地图API展示定位 | 有 | 浅 |
| 实现“路线实时变化 vs 音频内容预生产”的冲突调度 | 没有 | 深 |

**你已经在Agent编排项目、协同编辑器里做了一些“深”的事情（VariableMention扩展、Kahn算法调度、SSE乱序处理），但没有把它们讲成故事，也没有在在哪儿和行中导游里做类似的深度。**

---

## 每个项目具体怎么加深

### 项目一：「在哪儿」— 从“调API”变成“AI推理可视化引擎”

#### 现有的“浅”版本

```
用户上传照片 → fetch('/api/identify', { image }) → 等3秒 → 展示结果文字 + 地图卡片
```

你的前端代码大概长这样：

```tsx
// 浅版本 —— 你只写了UI壳子
function IdentifyPage() {
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleUpload = async (file) => {
    setLoading(true)
    const res = await fetch('/api/identify', { body: file })  // ← 核心逻辑全在后端
    setResult(await res.json())
    setLoading(false)
  }

  return (
    <div>
      <Uploader onUpload={handleUpload} />
      {loading && <Spinner />}
      {result && <ResultCard result={result} />}
    </div>
  )
}
```

**问题：前端没有任何技术含量。后端返回什么就展示什么。调API谁都会。**

#### 加深后的版本

核心思路：**把AI的每一步推理过程，变成前端的交互资产。**

后端不是一次返回结果，而是通过SSE逐步推送推理过程：

```
SSE Event 1:  推理步骤开始 → {"step": "image_analysis", "status": "running"}
SSE Event 2:  识别到建筑风格 → {"step": "image_analysis", "findings": [{"type": "architecture", "value": "南方骑楼", "bbox": [120, 80, 200, 180]}]}
SSE Event 3:  识别到文字 → {"step": "image_analysis", "findings": [{"type": "text", "value": "粵", "bbox": [300, 150, 350, 200]}]}
SSE Event 4:  图像分析完成 → {"step": "image_analysis", "status": "done"}
SSE Event 5:  开始网络搜索 → {"step": "web_search", "query": "骑楼 棕榈树 街区 粵"}
SSE Event 6:  搜索到候选1 → {"step": "web_search", "candidate": {"name": "广州上下九", "lat": 23.12, "lng": 113.25}}
SSE Event 7:  搜索到候选2 → {"step": "web_search", "candidate": {"name": "厦门中山路", "lat": 24.45, "lng": 118.08}}
SSE Event 8:  细节对比 → {"step": "detail_compare", "finding": "招牌字体匹配广州样式"}
SSE Event 9:  确认结果 → {"step": "finalize", "location": {"name": "广州上下九步行街", "lat": 23.12, "lng": 113.25}}
```

**前端要做的事完全不同了：**

```tsx
// 深版本 —— 你写的是一个推理过程可视化引擎

interface ReasoningStep {
  id: string
  type: 'image_analysis' | 'web_search' | 'detail_compare' | 'finalize'
  status: 'pending' | 'running' | 'done'
  findings: Finding[]
  candidates: GeoPoint[]
}

function IdentifyPage() {
  const [steps, setSteps] = useState<ReasoningStep[]>([])
  const [activeStepIndex, setActiveStepIndex] = useState(0)
  const imageRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    const es = new EventSource('/api/identify/stream')

    es.addEventListener('step_start', (e) => {
      const data = JSON.parse(e.data)
      setSteps(prev => [...prev, { ...data, status: 'running', findings: [], candidates: [] }])
    })

    es.addEventListener('finding', (e) => {
      const data = JSON.parse(e.data)
      setSteps(prev => prev.map(s =>
        s.id === data.stepId
          ? { ...s, findings: [...s.findings, data] }
          : s
      ))
      // 关键：图片上实时标注识别到的区域
      if (data.bbox) {
        drawBBoxOnImage(imageRef.current!, data.bbox, data.value)
      }
    })

    es.addEventListener('candidate', (e) => {
      const data = JSON.parse(e.data)
      setSteps(prev => prev.map(s =>
        s.id === data.stepId
          ? { ...s, candidates: [...s.candidates, data] }
          : s
      ))
    })

    es.addEventListener('step_done', (e) => {
      const data = JSON.parse(e.data)
      setSteps(prev => prev.map(s =>
        s.id === data.stepId ? { ...s, status: 'done' } : s
      ))
      setActiveStepIndex(i => i + 1)
    })

    return () => es.close()
  }, [])

  return (
    <div className="identify-layout">
      {/* 左侧：原图 + 实时标注 */}
      <div className="image-panel">
        <img ref={imageRef} src={uploadedImage} />
        <BBoxOverlay />  {/* Canvas层，叠加在图片上 */}
      </div>

      {/* 右侧：推理步骤可视化 */}
      <div className="reasoning-panel">
        <ReasoningTimeline steps={steps} activeIndex={activeStepIndex} />

        {/* 当前步骤的详情 */}
        {steps[activeStepIndex]?.type === 'image_analysis' && (
          <ImageAnalysisDetail findings={steps[activeStepIndex].findings} />
        )}
        {steps[activeStepIndex]?.type === 'web_search' && (
          <MapCandidateView
            candidates={steps[activeStepIndex].candidates}
            highlight={steps[activeStepIndex].candidates.length === 1 ? steps[activeStepIndex].candidates[0] : undefined}
          />
        )}
        {steps[activeStepIndex]?.type === 'finalize' && (
          <FinalResultCard location={finalResult} confidence={0.87} />
        )}
      </div>
    </div>
  )
}
```

**这就是“深”的差距：**

| 浅版本 | 深版本 |
|--------|--------|
| 1个API调用 | SSE流式事件处理（6种事件类型） |
| 1个loading spinner | 4步推理的实时动画展示 |
| 无图片交互 | Canvas叠加层，bbox实时标注 |
| 1个结果卡片 | 候选地点从N个逐步缩圈到1个的动画 |
| 代码量约100行 | 代码量约1000行+，涉及SSE解析、Canvas绘图、地图联动、状态机 |

**面试时可以Demo的完整流程：**
1. 上传一张街景照片
2. 照片上开始出现标注框：“识别到骑楼建筑风格”“识别到‘粵’字样”“识别到棕榈树”
3. 右侧推理面板逐步骤展开
4. 地图上出现2个候选点（广州、厦门）→ 对比分析 → 厦门候选消失，广州确认
5. 最终定位卡片弹出，附带距离、交通方式、周边推荐

**整个流程没有任何npm包能帮你做。这就是“深”。**

---

### 项目二：「行中导游」— 从“播放音频”变成“动态音频调度引擎”

#### 现有的“浅”版本

```
后端算好路线→POI→剧本→TTS → 前端收到一堆音频URL → 按顺序播放
```

你的前端代码大概是个带进度条的音频播放器。**任何人都能在一下午写出来。**

#### 加深后的版本

核心挑战：**路线会实时变化，但音频内容是提前生成的，两者存在天然冲突。**

产品需求是：
- 每15分钟的内容分3段，每5分钟一段
- 播放到第2段时，触发第4段的生产
- 路线变更时，后续未播放内容全部作废，重新生产

这不是一个播放器。这是一个**动态调度引擎**，需要管理的是一个**滑动窗口**：

```
时间轴上的窗口管理：

    已播放       正在播      预生产        待生产
  ├──────────┼──────────┼─────────────┼──────────
  segment_1  segment_2  segment_3     (触发生产中)
  ✅已缓存    ▶播放中     ✅已缓存       ⏳生成中...

  如果此时路线变更：
  ├──────────┼──────────┼─ ─ ─ ─ ─ ─ ┼──────────
  segment_1  segment_2  作废！重新匹配  重新规划
  ✅已缓存    ▶播完这5分钟再切换       → 新路线POI → 新剧本 → 新TTS
```

**你真正要写的是这个状态机：**

```ts
// 这不是一个播放器，这是一个调度引擎

type SegmentStatus = 'idle' | 'generating' | 'cached' | 'playing' | 'played' | 'abandoned'

interface AudioSegment {
  id: string
  poiList: POI[]                // 这段覆盖的POI
  audioUrl: string | null       // 生成完才有
  textContent: string | null    // 剧本文字
  duration: number              // 预估时长(ms)
  status: SegmentStatus
}

interface ScheduleState {
  windowSize: number             // 窗口大小，默认3段
  segments: AudioSegment[]       // 窗口内的所有段
  currentIndex: number           // 当前播放到的索引
  routeSnapshot: RoutePoint[]    // 生成内容时的路线快照
  isDirty: boolean               // 路线是否已经变化
}

class AudioScheduler {
  private state: ScheduleState
  private audioPlayer: AudioPlayer
  private onProduceRequest: (segments: AudioSegment[]) => Promise<void>

  // 核心方法1：路线变更时触发
  async onRouteChanged(newRoute: RoutePoint[]) {
    const deviation = this.calculateDeviation(this.state.routeSnapshot, newRoute)

    if (deviation < THRESHOLD) return // 微小偏移忽略

    this.state.isDirty = true

    // 已播放的段保留，正在播放的播完当前段，未播放的全部作废
    this.state.segments.forEach((seg, i) => {
      if (i > this.state.currentIndex) {
        seg.status = 'abandoned'
      }
    })

    // 基于新路线重建后续段
    const newPOIList = await rematchPOIs(
      newRoute.slice(this.state.currentIndex),
      this.state.segments[this.state.currentIndex].poiList
    )

    // 触发新内容生产
    await this.refillWindow(newPOIList)
    this.state.isDirty = false
  }

  // 核心方法2：播放到窗口边缘时触发，补充窗口
  private async refillWindow(newPOIList: POI[]) {
    // 计算需要补充几个段
    const needToProduce = this.state.segments.filter(
      s => s.status === 'idle' || s.status === 'abandoned'
    )

    // 标记为生产中
    needToProduce.forEach(s => s.status = 'generating')

    // 触发后端生产（可能耗时10-30秒）
    await this.onProduceRequest(needToProduce)

    // 生产完成
    needToProduce.forEach(s => s.status = 'cached')
  }

  // 核心方法3：播放进度回调
  onPlaybackProgress(currentTime: number) {
    const currentSeg = this.state.segments[this.state.currentIndex]

    // 当前段快播完了（剩余<30秒），且下一段还没内容 → 紧急降级
    if (currentSeg.duration - currentTime < 30000) {
      const nextSeg = this.state.segments[this.state.currentIndex + 1]
      if (nextSeg && nextSeg.status === 'generating' && currentTime / currentSeg.duration > 0.85) {
        // 播放到85%时下一段还没生成完毕 → 插入过渡音乐
        this.insertTransitionMusic()
      }
    }

    // 当前段播完
    if (currentTime >= currentSeg.duration) {
      currentSeg.status = 'played'
      this.state.currentIndex++

      // 窗口滑动，触发补充
      if (this.needsRefill()) {
        this.refillWindow(this.state.routeSnapshot)
      }

      // 如果是dirty状态，说明路线已变更过，切换时处理
      if (this.state.isDirty) {
        this.handleDirtyTransition()
      }
    }
  }
}
```

**这就是“深”的差距：**

| 浅版本 | 深版本 |
|--------|--------|
| `<audio>` 标签 + 播放列表 | 动态调度引擎：滑动窗口 + 状态机 + 降级策略 |
| 路线变更 = 直接切歌 | 路线变更 = 计算偏离度 → 播完当前段 → 无缝切换 |
| 无缓存策略 | 3段预加载窗口 + LRU淘汰 + 弱网自适应 |
| 一个组件搞定 | AudioScheduler类 + AudioPlayer类 + RouteMonitor类 + 地图同步类 |
| 约150行 | 约800行+ |

---

### 项目三：「AI图搜」— 梳理你真正要写的代码

AI图搜如果也按“浅”版本做：调CLIP API → 展示结果网格。**又是一个壳。**

#### 真正“深”的部分：客户端向量检索引擎

这是前端代码，不是后端代码：

```ts
// 浏览器端向量检索引擎 —— 没有npm包能直接做这件事
// 它需要在浏览器里跑一个mini版向量数据库

interface VectorIndex {
  add(id: string, vector: Float32Array, metadata: ImageMeta): Promise<void>
  search(query: Float32Array, topK: number): Promise<SearchResult[]>
  delete(id: string): Promise<void>
  count(): number
}

class BrowserVectorIndex implements VectorIndex {
  private db: IDBDatabase
  private hnswGraph: HNSWGraph        // 用WASM实现HNSW索引结构
  private dim: number                  // 向量维度，CLIP ViT-B/32 是512维

  constructor(dim: number, maxElements: number) {
    this.dim = dim
    // 初始化IndexedDB存持久化向量
    // 初始化WASM模块做相似度计算
    // 构建HNSW索引图（分层navigable小世界）
  }

  async add(id: string, vector: Float32Array, metadata: ImageMeta) {
    // 1. 向量写入IndexedDB持久化
    await this.persistVector(id, vector, metadata)

    // 2. 更新HNSW索引图
    this.hnswGraph.insert(id, vector)

    // 3. 如果批量写入，每100条批量commit一次IndexedDB事务
    //    （否则浏览器会因为事务过多OOM）
  }

  async search(queryVector: Float32Array, topK: number) {
    // 1. 分层搜索，从最顶层粗搜到最底层精搜
    const candidates = this.hnswGraph.search(queryVector, topK * 3)

    // 2. 精确计算Top-K的余弦相似度
    const results = candidates.map(id => ({
      id,
      score: this.cosineSimilarity(queryVector, this.getVector(id)),
      metadata: this.getMetadata(id)
    }))

    // 3. 重排序
    return results.sort((a, b) => b.score - a.score).slice(0, topK)
  }
}
```

#### 复合搜索编辑器 —— 不是input框

```
┌─────────────────────────────────────────────────────┐
│  🔍 搜索素材                                        │
│  ┌─────────────────────────────────────────────────┐│
│  │ [@文本: 傍晚逆光的森林]  [@颜色: ████]  [+]    ││
│  │ [@风格: 电影感]  [@排除: 人物]                  ││
│  └─────────────────────────────────────────────────┘│
│  ┌─ 图片参考（拖入）──┐  ┌─ 构图参考 ──┐            │
│  │  [缩略图]           │  │ ☐ 横构图     │            │
│  │                     │  │ ☑ 竖构图     │            │
│  └────────────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────┘
```

这不是一个 `<input>` 标签，而是一套自定义的输入组件系统：
- 文本块：Tiptap内联标签，可编辑
- 颜色块：调色板弹窗 → 选色 → 渲染为色块标签
- 风格标签：下拉选择 → 渲染为标签
- 图片拖入区：DropZone → 提取CLIP embedding → 作为搜索条件
- 排除项：以删除线样式渲染

**代码涉及：Tiptap自定义Node/Extension × N、拖拽处理、Canvas取色器、React DnD。**

---

## 总结：「深」和「浅」的根本区别

| 层次 | 你在做什么 | 面试官的评价 |
|------|----------|------------|
| L0: 搭壳子 | `npm install` → 写几个组件 → 调API → 展示 | “工具人，谁都能干” |
| L1: 有选择 | 比较了几个方案，选了最合适的 | “有点经验，但也就这样” |
| L2: 有创新 | 在开源方案基础上做了自定义扩展 | “嗯，有自己的东西” ← 你的Agent编排、协同编辑器到了这个层次 |
| L3: 解决新问题 | 写了一个没有npm包能做的事情 | “这个人能解决真正的工程难题” ← **你要达到这个层次** |
| L4: 定义新范式 | 你写的东西别人开始跟着做 | “行业级影响力” |

**你现在大部分项目在L0-L1，少数在L2。你要做的是把“在哪儿”和“行中导游”推到L3。**

怎么做？记住这个标准：

> **你写的最核心的200行代码，有没有npm包能替代？如果有，就不够深。**