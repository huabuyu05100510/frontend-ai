# 在哪儿 + 行中导游：14年专家的代表作深度实施方案

> 目标：从"调API的壳"升级为"解决无npm包可解的工程难题"
> 核心方法：把PRD里的每一行需求，翻译成具体的前端技术挑战

---

## 一、两个项目现在的真实状态

读完PRD和技术方案后，现状非常清楚：

### 在哪儿 — 现状

```
小程序端:
  用户选图 → wx.chooseImage() → wx.uploadFile() → 等后端返回 → 展示文字+地图卡片

后端:
  接收图片 → 调多模态模型 → 提取特征 → 网络搜索 → POI匹配 → 返回结果
```

**前端做的所有事：** 调了3个微信API（chooseImage、uploadFile、showLoading），渲染了一个markdown卡片和一个map组件。代码量约150行。

### 行中导游 — 现状

```
前端:
  获取GPS → 发给后端 → 收到音频URL列表 → 用<audio>顺序播放

后端:
  接收路线 → Haversine POI匹配 → LLM生成剧本 → TTS合成 → 返回音频URL
```

**前端做的所有事：** 一个GPS定时器，一个`<audio>`标签的播放列表。代码量约200行。

### 核心问题

两个项目的前端**都不是在解决技术问题，而是在等后端返回数据**。这就像你去面试说"我主导了XX项目"，面试官问"你具体做了什么"，你只能说"我负责对接接口"。

**14年专家的级别应该是：你写的东西，后端、算法、产品、甚至其他前端同事都替代不了。**

---

## 二、在哪儿：从"上传等结果"到"AI推理可视化引擎"

### 2.1 PRD里藏着真正的技术需求

重读PRD这一段：

> 推理逻辑链要能根据难易情况调整
> 当场景比较复杂时（无标识建筑、无提示）：
>   多轮分析 → 多轮网络搜索 → 基于图片细节去分析、搜索、推理
> 当场景相对比较简单时（有标注建筑，需求不重推理）：
>   简单的需求分析 → 网络搜索 → 返回结果

> 推理首token：1-2s
> 简单case不能超过3s，中等case不能超过10s，复杂case不能超过15s

**这意味着什么？推理不是一个API调用，而是一个多步骤、有分支、时长不确定的Agent过程。** 前端不能只是"等"，而是要**实时展示AI正在做什么、发现了什么、为什么得到这个结论**。

### 2.2 竞品分析暴露的核心机会

你的PRD竞品结论是最有价值的洞察：

| 竞品 | 强在哪 | 缺什么 | = 你的机会 |
|------|--------|--------|-----------|
| 夸克 | 准确率70% | 推理过程黑盒 | 把黑盒变透明 |
| o3 | 推理能力强 | 纯文本输出，无地图 | 地图+图片联动 |
| 点点 | 回复格式好 | 没有推理展示 | 推理步骤可视化 |
| 小度想想 | 推理+地图都有 | 无图片细节标注 | 图片上标注检测到的视觉线索 |

**没有任何竞品同时做到了：推理可视化 + 地图卡片 + 图片细节标注 + 小程序流式体验。这就是你的完整差异化。**

### 2.3 具体技术方案：架构设计

```
┌─────────────────────────────────────────────────────────┐
│                     小程序前端                            │
│                                                         │
│  ┌──────────────────┐   ┌──────────────────────────┐   │
│  │  ReasoningEngine │   │  ImageAnnotationLayer    │   │
│  │  (推理状态机)     │   │  (Canvas图片标注层)       │   │
│  │                  │   │                          │   │
│  │  管理多步推理的   │   │  在图片上实时绘制：       │   │
│  │  状态转换和展示   │   │  - 检测到的文字高亮框     │   │
│  │  - pending       │   │  - 建筑风格区域标注       │   │
│  │  - analyzing     │   │  - 植物/地标特征标记      │   │
│  │  - searching     │   │  - 候选地点置信度热力图   │   │
│  │  - comparing     │   │                          │   │
│  │  - finalizing    │   └──────────────────────────┘   │
│  │  - done/failed   │                                   │
│  └────────┬─────────┘   ┌──────────────────────────┐   │
│           │             │  MapCandidateView         │   │
│           │             │  (候选地点地图视图)        │   │
│           │             │                          │   │
│  ┌────────┴─────────┐   │  推理中间步骤产生2-3个    │   │
│  │ StreamingClient  │   │  候选地点 → 地图上显示    │   │
│  │ (流式协议层)      │   │  为散点 → 逐步缩圈到     │   │
│  │                  │   │  最终确认位置             │   │
│  │  小程序不支持SSE  │   └──────────────────────────┘   │
│  │  → WebSocket模拟  │                                   │
│  │  → 分片轮询降级   │                                   │
│  └──────────────────┘                                   │
└─────────────────────────────────────────────────────────┘
```

### 2.4 具体代码：你要写的文件和类

```
src/
├── engine/
│   ├── ReasoningEngine.ts        # 推理状态机（核心）
│   ├── StreamingClient.ts        # 流式协议适配层
│   ├── eventTypes.ts             # 事件类型定义
│   └── stepRegistry.ts           # 步骤类型注册（可扩展）
├── components/
│   ├── ReasoningPanel/
│   │   ├── index.tsx             # 推理面板主组件
│   │   ├── StepTimeline.tsx      # 步骤时间线
│   │   ├── AnalysisStep.tsx      # 图像分析步骤渲染
│   │   ├── SearchStep.tsx        # 网络搜索步骤渲染
│   │   ├── CompareStep.tsx       # 候选对比步骤渲染
│   │   └── FinalizeStep.tsx      # 最终结果步骤渲染
│   ├── ImageCanvas/
│   │   ├── index.tsx             # Canvas标注层主组件
│   │   ├── useBBoxDrawing.ts     # 边界框绘制Hook
│   │   └── annotationTypes.ts    # 标注类型
│   └── MapView/
│       ├── CandidateMap.tsx      # 候选地点地图
│       └── useMapAnimation.ts    # 缩圈动画Hook
├── hooks/
│   ├── useReasoningStream.ts     # 推理流订阅Hook
│   └── useImageAnnotation.ts     # 图片标注联动Hook
└── utils/
    ├── bbox.ts                   # 边界框坐标转换
    └── confidence.ts             # 置信度计算与可视化
```

### 2.5 核心代码骨架

#### 2.5.1 事件协议设计（这是你跟后端约定的接口）

```ts
// eventTypes.ts —— 定义AI推理的每一步会产生什么事件
// 这本身就是技术设计工作，不是后端决定的

// 推理步骤类型
type ReasoningStepType =
  | 'image_analysis'    // 图像分析：检测文字、建筑、植物等视觉特征
  | 'web_search'        // 网络搜索：基于分析结果搜索候选地点
  | 'candidate_match'   // 候选匹配：将搜索结果与POI库比对
  | 'detail_compare'    // 细节对比：在多个候选中缩小范围
  | 'finalize'          // 确认结果

// 每个步骤的状态
type StepStatus = 'pending' | 'running' | 'done' | 'failed'

// SSE事件（小程序用WebSocket模拟）
interface ReasoningEvent {
  sequence: number           // 事件序号，保证顺序
  timestamp: number          // 服务端时间戳

  // 步骤生命周期事件
  | { type: 'step_start',  stepId: string, stepType: ReasoningStepType }
  | { type: 'step_done',   stepId: string }

  // 图像分析事件：在图片上发现了什么
  | { type: 'visual_finding',
      stepId: string,
      finding: {
        category: 'text' | 'architecture' | 'plant' | 'landmark' | 'style' | 'entity'
        value: string                    // 例如："粵"、"骑楼风格"、"棕榈树"
        bbox?: [number,number,number,number]  // 图片上的边界框 [x,y,w,h] 归一化0-1
        confidence: number               // 置信度 0-1
      }
    }

  // 搜索事件：搜到了候选地点
  | { type: 'candidate_found',
      stepId: string,
      candidate: {
        id: string, name: string, city: string,
        lat: number, lng: number,
        matchReason: string,       // "建筑风格匹配"
        confidence: number
      }
    }

  // 对比事件：某个候选被排除了
  | { type: 'candidate_eliminated',
      stepId: string,
      candidateId: string,
      reason: string               // "招牌字体不匹配，更接近广州样式"
    }

  // 最终结果
  | { type: 'result_final',
      location: {
        name: string, address: string, city: string,
        lat: number, lng: number,
        confidence: number,
        description: string,
        nearbyPOIs: POIInfo[],
        transportInfo: TransportInfo
      }
    }

  // 错误
  | { type: 'error', stepId?: string, message: string, recoverable: boolean }
}
```

**为什么这算"深"？** 因为你定义的不是一个简单API的请求/响应格式，而是一个**多步骤推理过程的流式事件协议**。这需要你理解AI推理的每一步会产生什么信息，然后设计对应的前端交互。后端同学不会设计这个协议——他们只会返回最终结果。

#### 2.5.2 推理状态机（核心引擎）

```ts
// ReasoningEngine.ts —— 这是整个项目最核心的前端代码

interface ReasoningState {
  // 当前推理会话
  sessionId: string

  // 所有步骤，按顺序排列
  steps: ReasoningStep[]

  // 当前活跃步骤索引
  activeStepIndex: number

  // 图像分析结果：在图片上发现了什么
  visualFindings: VisualFinding[]

  // 候选地点列表（动态变化：增、删、更新置信度）
  candidates: Map<string, CandidateInfo>

  // 推理是否完成
  isComplete: boolean

  // 最终结果
  finalResult: LocationResult | null

  // 错误信息
  error: ErrorInfo | null
}

interface ReasoningStep {
  id: string
  type: ReasoningStepType
  status: StepStatus
  startTime: number
  endTime?: number
  // 该步骤产生的数据
  data: StepData
}

class ReasoningEngine {
  private state: ReasoningState
  private listeners: Set<(state: ReasoningState) => void> = new Set()

  constructor() {
    this.state = this.createInitialState()
  }

  // 核心方法：处理每一个流式事件，更新状态
  dispatch(event: ReasoningEvent): void {
    switch (event.type) {
      case 'step_start':
        this.handleStepStart(event)
        break
      case 'step_done':
        this.handleStepDone(event)
        break
      case 'visual_finding':
        this.handleVisualFinding(event)
        break
      case 'candidate_found':
        this.handleCandidateFound(event)
        break
      case 'candidate_eliminated':
        this.handleCandidateEliminated(event)
        break
      case 'result_final':
        this.handleResultFinal(event)
        break
      case 'error':
        this.handleError(event)
        break
    }

    // 通知所有订阅者（React组件）
    this.notify()
  }

  private handleVisualFinding(event: VisualFindingEvent): void {
    // 将识别到的视觉特征添加到当前分析步骤
    const step = this.state.steps.find(s => s.id === event.stepId)
    if (!step) return

    step.data.findings.push(event.finding)

    // 同步更新全局visualFindings（给Canvas标注层用）
    this.state.visualFindings.push({
      ...event.finding,
      stepId: event.stepId,
    })
  }

  private handleCandidateFound(event: CandidateFoundEvent): void {
    // 新候选地点出现 → 地图上加一个标记
    this.state.candidates.set(event.candidate.id, {
      ...event.candidate,
      status: 'active',
    })
  }

  private handleCandidateEliminated(event: CandidateEliminatedEvent): void {
    // 候选被排除 → 地图上该标记消失（带动画）
    const c = this.state.candidates.get(event.candidateId)
    if (c) {
      c.status = 'eliminated'
      c.eliminationReason = event.reason
    }
  }

  // 订阅状态变化（React组件通过这个接入）
  subscribe(listener: (state: ReasoningState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // —— 以下方法体现了真正的设计 ——

  // 根据推理复杂度预估总步骤数
  estimateTotalSteps(): number {
    const hasAnalysis = this.state.steps.some(s => s.type === 'image_analysis')
    const hasSearch = this.state.steps.some(s => s.type === 'web_search')
    const hasCompare = this.state.steps.some(s => s.type === 'detail_compare')

    // 简单case：只有analysis + finalize
    // 复杂case：analysis → search → compare → finalize
    let count = 1 // finalize
    if (hasAnalysis) count++
    if (hasSearch) count++
    if (hasCompare) count++
    return count
  }

  // 获取当前进度百分比（给进度条用）
  getProgress(): number {
    if (this.state.isComplete) return 1
    const total = this.estimateTotalSteps()
    const done = this.state.steps.filter(s => s.status === 'done').length
    // 当前步骤的部分进度（running状态按50%算）
    const runningBonus = this.state.steps.some(s => s.status === 'running') ? 0.5 : 0
    return Math.min((done + runningBonus) / total, 0.95)
  }

  // 用户是否可以干预当前推理？
  canIntervene(): boolean {
    // 在搜索步骤中如果候选太多，用户可以手动缩小范围
    const searchStep = this.state.steps.find(s => s.type === 'web_search')
    if (searchStep?.status === 'done') {
      return this.state.candidates.size > 3
    }
    return false
  }
}
```

**为什么这算"深"？**
- 这是**你自己设计的状态机**，不是npm包
- 每个事件→状态转换的逻辑是你定义的
- 进度预估、用户干预时机判断——这些都是工程判断
- 这个类有约300行，是纯逻辑代码，和UI框架无关

#### 2.5.3 Canvas图片标注层（小程序独有的挑战）

```ts
// useBBoxDrawing.ts —— 在图片上实时标注AI检测到的特征

// 小程序里Canvas和Web的Canvas API不完全一样，有很多坑：
// 1. 小程序Canvas是离屏的，需要手动触发渲染
// 2. 坐标体系不同（rpx vs px）
// 3. 图片加载是异步的，需要等onLoad

interface BBoxAnnotation {
  id: string
  bbox: [number, number, number, number]  // 归一化坐标 [x, y, w, h]
  label: string                            // 标注文字
  category: 'text' | 'architecture' | 'plant' | 'landmark'
  color: string                            // 不同类别不同颜色
  opacity: number                          // 透明度（新标注闪烁效果）
  timestamp: number                        // 用于动画
}

function useBBoxDrawing(
  canvasId: string,       // 小程序Canvas的id
  imagePath: string,       // 用户上传的图片路径
  annotations: BBoxAnnotation[]
) {
  // 核心挑战：
  // 1. 归一化bbox → Canvas实际坐标的转换
  //    （因为图片在Canvas中的实际渲染尺寸 != 图片原始尺寸）
  // 2. 标注的动画效果（新标注闪烁提示、旧标注渐隐）
  // 3. 多个标注重叠时的布局避让
  // 4. 小程序Canvas不支持CSS动画，所有动画要手动用requestAnimationFrame

  const draw = useCallback(() => {
    const ctx = wx.createCanvasContext(canvasId)

    annotations.forEach(ann => {
      // 计算实际坐标
      const [x, y, w, h] = denormalizeBBox(ann.bbox, canvasWidth, canvasHeight)

      // 绘制标注框
      ctx.setStrokeStyle(ann.color)
      ctx.setLineWidth(2)
      ctx.strokeRect(x, y, w, h)

      // 绘制标签背景
      ctx.setFillStyle(ann.color)
      ctx.fillRect(x, y - 20, ctx.measureText(ann.label).width + 8, 20)

      // 绘制标签文字
      ctx.setFillStyle('#fff')
      ctx.setFontSize(12)
      ctx.fillText(ann.label, x + 4, y - 6)

      // 动画效果：新标注的透明度从1→0.7，模拟闪烁
      if (Date.now() - ann.timestamp < 2000) {
        ctx.setGlobalAlpha(0.5 + 0.5 * Math.sin(Date.now() / 200))
      }
    })

    ctx.draw()

    // 持续动画循环（仅当有待消隐的标注时）
    if (annotations.some(a => Date.now() - a.timestamp < 2000)) {
      requestAnimationFrame(draw)
    }
  }, [annotations, canvasId])

  return { draw }
}
```

**为什么这算"深"？**
- 小程序Canvas的坐标转换是一个真实的技术问题（不是调个API就行）
- 标注动画需要理解Canvas的渲染机制
- 这和Web端Canvas完全不是一回事——纯前端经验壁垒

#### 2.5.4 流式协议适配层

```ts
// StreamingClient.ts —— 小程序不支持SSE，需要自己实现

// 微信小程序的网络限制：
// 1. 不支持EventSource API
// 2. wx.request 不支持 streaming response
// 3. WebSocket 有连接数限制（最多2个并发）

// 三种降级策略：

// 策略1：WebSocket（首选）
class WebSocketStream {
  private ws: Weex.WebSocket
  private buffer: string = ''

  connect(url: string, onEvent: (event: ReasoningEvent) => void): void {
    this.ws = wx.connectSocket({ url })

    this.ws.onMessage((res) => {
      // WebSocket消息可能不是完整的事件边界
      this.buffer += res.data

      // 按换行符分割，处理粘包
      const lines = this.buffer.split('\n')
      this.buffer = lines.pop() || ''  // 最后一行可能不完整

      lines.forEach(line => {
        if (line.trim()) {
          try {
            const event = JSON.parse(line)
            onEvent(event)
          } catch {
            // 格式错误，跳过
          }
        }
      })
    })
  }
}

// 策略2：分片轮询（降级）
class PollingStreamAdapter {
  private timer: number | null = null
  private lastSeq: number = -1

  // 关键设计：轮询间隔不是固定的
  // 简单case（2-3s出结果）→ 用500ms间隔（最多4-6个请求）
  // 复杂case（10-15s出结果）→ 用1s间隔（最多15个请求）
  // 自适应：根据后端第一次返回的estimatedComplexity调整
  getPollingInterval(complexity: 'simple' | 'medium' | 'complex'): number {
    switch (complexity) {
      case 'simple': return 500
      case 'medium': return 800
      case 'complex': return 1000
    }
  }

  startPolling(sessionId: string, onEvent: (event: ReasoningEvent) => void): void {
    const poll = async () => {
      const res = await wx.request({
        url: `/api/reasoning/${sessionId}/events?since=${this.lastSeq}`,
        method: 'GET',
      })

      const events: ReasoningEvent[] = res.data
      events.forEach(e => {
        onEvent(e)
        this.lastSeq = Math.max(this.lastSeq, e.sequence)
      })

      // 自适应调整下次轮询间隔
      const complexity = this.detectComplexity(events)
      this.timer = setTimeout(poll, this.getPollingInterval(complexity))
    }

    poll()
  }
}
```

**为什么这算"深"？**
- 你解决了一个**真实的平台限制问题**（小程序不支持SSE）
- 三种策略的选型和降级是工程判断
- 自适应轮询间隔设计——这是算法+工程的结合

### 2.6 最终用户看到的交互流程

```
用户上传一张「广州街头骑楼」照片

界面变化：
┌─────────────────────────────────────────────┐
│                                             │
│   [用户上传的图片]                           │
│   ┌─────────────────────────────┐           │
│   │                     ┌──────┐│           │
│   │     骑楼建筑        │ 粵  ││ ← Canvas标注│
│   │   ╭──────────╮    └──────┘│           │
│   │   │ 建筑风格  │  [棕榈树]  │           │
│   │   ╰──────────╯            │           │
│   └─────────────────────────────┘           │
│                                             │
│   推理过程                         进度 60% │
│   ┌─────────────────────────────┐           │
│   │ ✅ 图像分析    已完成  0.8s  │           │
│   │   识别到：骑楼、粵字、棕榈树 │           │
│   │                             │           │
│   │ ⏳ 网络搜索    进行中  1.2s  │  ← 动画   │
│   │   搜索"骑楼 棕榈树 粵 街区" │           │
│   │                             │           │
│   │ ○ 候选对比    等待中        │           │
│   │                             │           │
│   │ ○ 确认结果    等待中        │           │
│   └─────────────────────────────┘           │
│                                             │
│   [地图区域]                                │
│   ┌─────────────────────────────┐           │
│   │    ●广州上下九  (92%)       │           │
│   │         ●厦门中山路 (78%)   │           │
│   │   最终确认：📍上下九步行街   │           │
│   │   ┌─────────────────────┐   │           │
│   │   │ 距你 3.2km         │   │           │
│   │   │ 🚇 地铁6号线直达   │   │           │
│   │   │ 🕐 全天开放        │   │           │
│   │   └─────────────────────┘   │           │
│   └─────────────────────────────┘           │
└─────────────────────────────────────────────┘
```

---

## 三、行中导游：从"播放音频"到"动态内容调度引擎"

### 3.1 PRD里藏着真正的技术需求

重读PRD这几句话：

> 动态生成内容：每次提前生产3个阶段或至少能持续15分钟的内容
> 每份内容讲解到第二阶段或持续了5分钟之后，生产下一个15分钟的内容

> 当路线发生变化时：
> 需要重新进行POI讲解内容匹配，获得新的后续路线list
> 按照新的路线list规划新的大纲
> 基于新的大纲生成内容

> 文本时长严格匹配用户路线行程时间

**这里有三个技术挑战：**

1. **滑动窗口调度**：永远保持"已播1段 + 正在播1段 + 已缓存1段 + 生产中1段"的4段窗口
2. **路线变化冲突**：内容是按旧路线生产的，但车已经偏离了。正在播的内容要不要中断？已缓存但没播的内容怎么办？
3. **时长匹配**：生成的文本时长必须严格等于路线经过该POI的时间，但LLM生成是不可控的——这是一个约束优化问题

### 3.2 技术方案：AudioScheduler 状态机

```
                    ┌────────────────────────────────┐
                    │        AudioScheduler           │
                    │                                 │
   GPS ──────────→ │  ┌──────────────────────────┐  │
   (1Hz)           │  │      RouteMonitor         │  │
                    │  │  计算偏离度               │  │
                    │  │  触发路线变更事件          │  │
                    │  └──────────┬───────────────┘  │
                    │             │                   │
                    │             ▼                   │
                    │  ┌──────────────────────────┐  │
                    │  │    SegmentWindow          │  │
                    │  │                           │  │
                    │  │  [seg1] [seg2] [seg3] [x] │  │
                    │  │  已播   播放中  已缓存  生产中│  │
                    │  │                           │  │
                    │  │  seg2.played > 80%        │  │
                    │  │    → 触发seg4生产          │  │
                    │  │    → seg1淘汰(释放内存)    │  │
                    │  │    → 窗口右移              │  │
                    │  └──────────┬───────────────┘  │
                    │             │                   │
                    │             ▼                   │
                    │  ┌──────────────────────────┐  │
                    │  │    FallbackStrategy       │  │
                    │  │                           │  │
                    │  │  生产延迟 > 阈值           │  │
                    │  │    → 插入过渡音乐           │  │
                    │  │  网络断开                  │  │
                    │  │    → 播放本地缓存通用介绍    │  │
                    │  │  所有降级方案都用尽         │  │
                    │  │    → 优雅静默               │  │
                    │  └──────────────────────────┘  │
                    └────────────────────────────────┘
```

### 3.3 具体代码

#### 3.3.1 RouteMonitor（路线偏离检测）

```ts
// RouteMonitor.ts —— 不是调地图API，是真正的计算逻辑

interface RoutePoint {
  lat: number
  lng: number
  timestamp: number
  speed: number       // km/h
  heading: number     // 方向角
}

class RouteMonitor {
  // 原路线（生成内容时的快照）
  private originalRoute: RoutePoint[] = []

  // GPS历史（最近N个点）
  private gpsHistory: RoutePoint[] = []
  private readonly HISTORY_SIZE = 30

  // 偏离阈值
  private readonly DEVIATION_THRESHOLD_METERS = 200
  private readonly DEVIATION_CONFIRM_COUNT = 5   // 连续5个点都偏离才触发

  // 偏离检测：当前GPS与原始路线的距离
  checkDeviation(currentPos: RoutePoint): RouteDeviation {
    this.gpsHistory.push(currentPos)
    if (this.gpsHistory.length > this.HISTORY_SIZE) {
      this.gpsHistory.shift()
    }

    // 1. 计算当前点到原路线的最短距离
    const minDistance = this.minDistanceToRoute(currentPos, this.originalRoute)

    // 2. 连续N个点都偏离 → 确认偏离，触发路线变更
    if (minDistance > this.DEVIATION_THRESHOLD_METERS) {
      const recentDeviations = this.gpsHistory.slice(-this.DEVIATION_CONFIRM_COUNT)
        .filter(p => this.minDistanceToRoute(p, this.originalRoute) > this.DEVIATION_THRESHOLD_METERS)

      if (recentDeviations.length >= this.DEVIATION_CONFIRM_COUNT) {
        return {
          type: 'confirmed',
          distance: minDistance,
          newRoute: this.estimateNewRoute(currentPos),
        }
      }

      return { type: 'suspected', distance: minDistance }
    }

    return { type: 'on_track' }
  }

  // 线到点的最短距离（对折线的每一段计算）
  private minDistanceToRoute(point: RoutePoint, route: RoutePoint[]): number {
    let minDist = Infinity
    for (let i = 0; i < route.length - 1; i++) {
      const dist = this.pointToSegmentDistance(
        point.lat, point.lng,
        route[i].lat, route[i].lng,
        route[i+1].lat, route[i+1].lng
      )
      minDist = Math.min(minDist, dist)
    }
    return minDist
  }

  // 点到线段的距离（Haversine公式）
  private pointToSegmentDistance(
    lat: number, lng: number,
    lat1: number, lng1: number,
    lat2: number, lng2: number
  ): number {
    // ... 向量投影 + Haversine计算
  }
}
```

#### 3.3.2 SegmentWindow（滑动窗口调度器）

```ts
// SegmentWindow.ts —— 核心调度逻辑

enum SegmentStatus {
  IDLE = 'idle',           // 空闲，待分配
  GENERATING = 'generating', // 生产剧本中（等LLM）
  SYNTHESIZING = 'synthesizing', // 合成语音中（等TTS）
  CACHED = 'cached',       // 已缓存，可以播放
  PLAYING = 'playing',     // 正在播放
  PLAYED = 'played',       // 已播放
  ABANDONED = 'abandoned', // 已废弃（路线变更）
}

interface AudioSegment {
  id: string
  poiIds: string[]          // 覆盖的POI列表
  estimatedDuration: number // 预估时长ms
  actualDuration?: number   // 实际音频时长ms
  audioUrl?: string         // TTS完成后的URL
  textContent?: string      // 剧本原文
  status: SegmentStatus
  // 生成过程中的中间状态
  generationProgress?: {
    outline?: boolean        // 大纲完成
    content?: boolean        // 内容完成
    tts?: boolean            // TTS完成
  }
}

class SegmentWindow {
  // 窗口配置
  private readonly WINDOW_SIZE = 4      // 保持4段在窗口内
  private readonly REFILL_THRESHOLD = 0.8 // 当前段播放到80%时触发补充

  // 窗口内容
  private segments: AudioSegment[] = []

  // 当前播放位置
  private currentSegmentIndex: number = -1

  // 本轮调度关联的路线快照
  private routeSnapshot: POIInfo[] = []

  // 回调
  private onNeedProduce: (segments: AudioSegment[]) => Promise<void>
  private onPlaybackStateChange: (state: PlaybackState) => void

  // ===== 核心方法 =====

  // 初始化窗口（行程开始时调用）
  async initialize(route: POIInfo[]): Promise<void> {
    this.routeSnapshot = route

    // 将路线上的POI按5分钟一组切分为段
    // 每个POI讲解时长 = POI在路线上的经过时间
    const segmentSplits = this.splitRouteIntoSegments(route, 5 * 60 * 1000)

    // 创建前4个segment
    this.segments = segmentSplits.slice(0, this.WINDOW_SIZE).map(split => ({
      id: generateId(),
      poiIds: split.poiIds,
      estimatedDuration: split.duration,
      status: SegmentStatus.IDLE,
    }))

    // 触发前3个segment的生产
    await this.produceSegments(this.segments.slice(0, 3))
  }

  // 播放进度回调（audio timeupdate事件触发）
  onPlaybackProgress(currentTime: number): PlaybackAction | null {
    const segment = this.segments[this.currentSegmentIndex]
    if (!segment) return null

    const progress = currentTime / segment.estimatedDuration

    // ① 当前段快播完 → 检查下一段是否就绪
    if (progress >= this.REFILL_THRESHOLD) {
      const next = this.segments[this.currentSegmentIndex + 1]

      if (!next) {
        // 最后一段，检查是否需要补充窗口
        return { type: 'refill_window' }
      }

      if (next.status === SegmentStatus.GENERATING) {
        // 下一段还在生产 → 降级
        return { type: 'insert_transition', duration: 10000 } // 10秒过渡音乐
      }

      if (next.status === SegmentStatus.CACHED) {
        return { type: 'prepare_segue' } // 准备自然过渡
      }
    }

    // ② 当前段播完 → 切换到下一段
    if (currentTime >= segment.estimatedDuration) {
      segment.status = SegmentStatus.PLAYED
      this.currentSegmentIndex++

      const newSegment = this.segments[this.currentSegmentIndex]
      if (newSegment) {
        newSegment.status = SegmentStatus.PLAYING
      }

      // 窗口滑动：补充新段
      return { type: 'segment_advance', triggerRefill: this.needsRefill() }
    }

    return null
  }

  // 路线变更处理（GPS偏离触发）
  async onRouteChanged(newRoute: POIInfo[]): Promise<RouteChangeResult> {
    // 计算新旧路线的重叠度
    const overlap = this.calculateRouteOverlap(this.routeSnapshot, newRoute)

    const result: RouteChangeResult = {
      discardedSegments: [],
      keptSegments: [],
      newSegments: [],
    }

    // 已播放的段 → 保留
    // 正在播放的段 → 播完当前POI后切换
    // 已缓存但未播放的段 → 废弃
    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i]

      if (i < this.currentSegmentIndex) {
        result.keptSegments.push(seg)
      } else if (i === this.currentSegmentIndex) {
        // 正在播放的：播完当前POI（不中断正在讲的内容）
        seg.status = SegmentStatus.PLAYING
        result.keptSegments.push(seg)
      } else {
        seg.status = SegmentStatus.ABANDONED
        result.discardedSegments.push(seg)
      }
    }

    // 基于新路线重建窗口
    this.routeSnapshot = newRoute
    const newSplits = this.splitRouteIntoSegments(newRoute, 5 * 60 * 1000)

    // 从当前播放段之后开始，填充新的segment
    const newSegments = newSplits.slice(0, this.WINDOW_SIZE - result.keptSegments.length)
    result.newSegments = newSegments

    // 重建窗口
    this.segments = [
      ...result.keptSegments,
      ...newSegments.map(s => ({
        id: generateId(),
        poiIds: s.poiIds,
        estimatedDuration: s.duration,
        status: SegmentStatus.IDLE,
      })),
    ]

    // 触发新段生产
    await this.produceSegments(
      this.segments.slice(result.keptSegments.length, result.keptSegments.length + 2)
    )

    return result
  }

  // 将POI列表按时间切分为段
  private splitRouteIntoSegments(
    route: POIInfo[],
    segmentDurationMs: number
  ): { poiIds: string[], duration: number }[] {
    const segments: { poiIds: string[], duration: number }[] = []
    let currentSegment: string[] = []
    let currentDuration = 0

    for (const poi of route) {
      const poiDuration = this.estimatePOIDuration(poi)

      if (currentDuration + poiDuration > segmentDurationMs && currentSegment.length > 0) {
        segments.push({ poiIds: [...currentSegment], duration: currentDuration })
        currentSegment = []
        currentDuration = 0
      }

      currentSegment.push(poi.id)
      currentDuration += poiDuration
    }

    if (currentSegment.length > 0) {
      segments.push({ poiIds: currentSegment, duration: currentDuration })
    }

    return segments
  }

  private needsRefill(): boolean {
    const remainingSlots = this.segments.filter(
      s => s.status === SegmentStatus.IDLE || s.status === SegmentStatus.ABANDONED
    ).length

    const cachedSlots = this.segments.filter(
      s => s.status === SegmentStatus.CACHED
    ).length

    // 缓存段不足2个 → 触发补充
    return cachedSlots + remainingSlots < 2
  }
}
```

**为什么这算"深"？**
- 这是一个**纯前端逻辑引擎**，约500行代码
- 你要处理的不是"播放音频"，而是"在约束条件下调度音频的生成和播放"
- 路线偏离检测、窗口管理、降级策略——每个都是需要独立设计的子系统
- 没有任何npm包能做这件事——因为这是你产品特有的业务逻辑+工程抽象

#### 3.3.3 降级策略

```ts
// FallbackStrategy.ts —— 降级不是你失败后才处理的，而是提前设计的

enum NetworkCondition {
  STABLE,       // 网络正常
  WEAK,         // 弱网（2G/3G，或信号不稳）
  OFFLINE,      // 断网
}

class FallbackStrategy {
  private networkState: NetworkCondition = NetworkCondition.STABLE
  private localAudioCache: Map<string, string> = new Map()  // POI ID → 本地预缓存音频

  // 网络状态监测（行车场景的网速波动远大于家里/办公室）
  monitorNetwork(): void {
    wx.onNetworkStatusChange((res) => {
      this.networkState = res.isConnected
        ? (res.networkType === '2g' || res.networkType === '3g'
            ? NetworkCondition.WEAK
            : NetworkCondition.STABLE)
        : NetworkCondition.OFFLINE
    })
  }

  // 根据网络状态决定内容预生产策略
  getProductionStrategy(): ProductionStrategy {
    switch (this.networkState) {
      case NetworkCondition.STABLE:
        return {
          preProduceCount: 3,          // 预生产3段
          quality: 'high',             // 高质量内容
          audioFormat: 'mp3_192k',     // 高码率音频
        }
      case NetworkCondition.WEAK:
        return {
          preProduceCount: 1,          // 只预生产1段（省流量）
          quality: 'medium',           // 中等质量
          audioFormat: 'mp3_64k',      // 低码率
          // 弱网下优先使用本地预缓存
          preferLocalCache: true,
        }
      case NetworkCondition.OFFLINE:
        return {
          // 离线：只播放本地有缓存的POI
          preProduceCount: 0,
          quality: 'local_only',
          // 无缓存POI → 静默跳过
          skipUncachedPOI: true,
        }
    }
  }

  // 本地预缓存策略
  // 在WiFi环境下预缓存热门POI的通用讲解音频
  async preCachePopularPOIs(city: string): Promise<void> {
    if (this.networkState !== NetworkCondition.STABLE) return

    // 获取目的地城市的热门POI
    const popularPOIs = await this.fetchPopularPOIs(city)

    // 分批下载（每批5个，避免占用太多带宽）
    for (const batch of chunkArray(popularPOIs, 5)) {
      await Promise.all(batch.map(poi =>
        this.cachePOIAudio(poi.id, poi.genericAudioUrl)
      ))
    }
  }
}
```

### 3.4 最终用户感知

```
开车经过天安门时：

┌────────────────────────────────────────────┐
│                                          │
│    🎧 行中导游                             │
│    ────────────────────────────           │
│    原野：你看前面就是天安门了…              │
│    晓曼：对，这个方向看过去正好迎着光…      │
│                                          │
│    ═══════════════════ 72%               │
│    剩余 8分30秒                           │
│                                          │
│    📍 当前位置                             │
│    ┌─────────────────────────────────┐   │
│    │     ●当前                                         │
│    │     │  ← 故宫 (3分钟后)                          │
│    │     │                                             │
│    │     │  ← 景山公园 (8分钟后)                        │
│    │     │                                             │
│    │     │  ← 北海公园 (已播)                           │
│    │     │                                             │
│    │     🟢 路线正常                                    │
│    └─────────────────────────────────┘   │
│                                          │
│    [换主题] [跳过] [标记收藏]              │
│                                          │
└────────────────────────────────────────────┘

路线变更时：
    🟡 检测到路线偏离 → 已切换到最优路线
    当前段播完后自动切换至新路线内容
```

---

## 四、两个项目的技术含量对比

| 维度 | 浅版本（现在） | 深版本（目标） |
|------|-------------|-------------|
| **在哪儿 前端代码量** | ~150行 | ~1500行 |
| **在哪儿 核心挑战** | 对接3个微信API | 推理状态机 + Canvas标注 + 地图联动 + 流式协议 |
| **行中导游 前端代码量** | ~200行 | ~1200行 |
| **行中导游 核心挑战** | `<audio>`标签 | 路由偏离检测 + 滑动窗口调度 + 降级策略金字塔 |
| **可复用的基础设施** | 0 | StreamingClient, ReasoningEngine, SegmentWindow 三大引擎 |
| **面试可讲深度** | 0分钟（调API谁都会） | 每个引擎单独讲20分钟 + 整体架构讲15分钟 |

## 五、实施优先级

### 第一步（1-2周）：在哪儿推理可视化

**最优先做，因为：**
- 改造成本最小（后端只需要改推送格式，不需要改模型逻辑）
- 效果最炸裂（面试直接打开小程序Demo）
- 竞品全都没做，100%差异化
- 做完后StreamingClient和ReasoningEngine直接复用到另外两个项目

**具体要写的代码：**
1. `eventTypes.ts` — 事件协议定义（和算法/后端同学对齐）
2. `StreamingClient.ts` — WebSocket + 轮询降级
3. `ReasoningEngine.ts` — 推理状态机
4. `ReasoningPanel/` — 推理步骤可视化UI
5. `useBBoxDrawing.ts` — Canvas图片标注

### 第二步（2-3周）：行中导游动态调度

1. `AudioScheduler.ts` — 调度状态机
2. `RouteMonitor.ts` — 路线偏离检测
3. `SegmentWindow.ts` — 滑动窗口管理
4. `FallbackStrategy.ts` — 降级策略

### 第三步（持续）：AI图搜

基于前两个项目沉淀的引擎，构建AI图搜平台。

---

## 六、面试时怎么讲

**2分钟快速版：**

> 我最近的核心工作是构建了一个「AI推理可视化引擎」。传统的AI产品都是输入等结果——黑盒体验。我把AI的多步推理过程——图像分析发现了什么、搜索了什么、怎么一步步排除候选、最终确认位置——全部实时可视化出来。技术上，我设计了一套推理事件协议、一个流式协议适配层（小程序不支持SSE需要自己实现）、以及一个推理状态机来管理所有交互状态。竞品里没有任何一家做到这个程度。

**15分钟深入版的开头：**

> 我想深入讲一下「在哪儿」这个项目的技术架构。表面上它是一个"上传图片识别地点"的小程序，但我在做之前深入研究了所有竞品——夸克、豆包、点点、o3——发现一个共同的缺口：所有人的AI推理过程都是黑盒。所以我把这个项目定位成"让用户看见AI是怎么推理的"。

> 我先设计了一套推理事件协议，把AI的多步推理拆解成6种流式事件：step_start、visual_finding、candidate_found、candidate_eliminated、result_final、error。然后在小程序里实现了对应的流式处理——因为小程序不支持SSE，我做了WebSocket+轮询的降级方案。

> 前端核心是一个推理状态机 ReasoningEngine，管理从图像分析到结果确认的完整生命周期。每一步识别到的视觉特征通过Canvas标注层实时绘制在用户上传的图片上——文字高亮框、建筑风格区域标注、植物特征标记。地图上候选地点从多个散点逐步缩圈到最终确认位置。

> 这个设计带来的效果是：即使AI识别率只有70%——这是目前多模态模型的技术上限——用户也能通过推理过程判断结果是否可信。如果推理路径合理，用户会信任结果；如果推理路径有疑点，用户会自主验证。这种可解释性在AI产品中是稀缺的，也是这个项目最有价值的前端创新。
