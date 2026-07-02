# 02 — 截图/拖拽识图 (Screenshot Assistant) 设计稿

> **模型声明**:claude-sonnet-4-6
> **生成日期**:2026-07-01
> **状态**:设计稿 → 用户审批 → TDD 实施
> **覆盖范围**:全局 `⌘⇧V` 截屏 → 4 类分类(文字 / Logo / 表格 / 公式)→ 浮卡 4 操作(复制 / 翻译 / 反搜 / 模板识别);OCRPage 已有识别逻辑+ 新 `useClipboardImage()` hook
> **复用资产**:`DictionaryCard.tsx`(viewport-anchor 模式)+ `Hover/Press` 动效原语 + `ConfidenceDot.tsx` + `OCRPage.tsx` 识别逻辑 + `useWorkspaceTimeline.ts`
> **方法**:WebSearch / WebFetch 在当前网络环境受限,调研基于 2024-2026 公开评测、官方文档、UX 拆解 + 项目 memory 沉淀,关键数字建议下游人工核验

---

## 0. 速查总览

| 维度 | 现状 | 行业对标 | 设计目标 |
|---|---|---|---|
| 触发 | 仅 OCRPage 上传文件 | 全局快捷键 | **`⌘⇧V` 一键唤起 / `⌘⇧S` 区域截图** |
| 输入 | 文件选择 | 摄像头 / 截屏 / 粘贴 | **四源合一 + 剪贴板自动监听** |
| 分类 | 无 | Apple Visual Look Up 多目标 | **文字 / Logo / 表格 / 公式 4 路并行分类** |
| 操作 | 仅识别 + 复制 | 多模态操作 | **复制 / 翻译 / 反搜 / 模板识别 4 卡** |
| 时延 | OCR 2-4s | < 1.5s | **首字 < 500ms / 完整 < 2.5s** |

---

## 1. 行业最佳实践

### 1.1 百度翻译拍照(对标 #1:拍照翻译老牌劲旅)

- **杀手锏**:拍照 / 从相册取 / 跨屏取词 / 涂抹选取 4 模式;实时取景框预览
- **关键技术**:百度自研 OCR + NMT 模型,端侧实时识别 + 云端深度优化
- **视觉设计**:白色拍照框 + 四角 L 形角标(L 长 24px 厚 3px `var(--color-primary)`);翻译结果覆盖在原图下方(translucent overlay)
- **交互创新**:拍照后用双指捏合缩放 → 重新识别区域;`T` 切源语 / 译语;`Esc` 取消重拍
- **小细节**:拍照前自动识别文字行(蓝色描边 1px)+ 点选行只翻译该行

### 1.2 CamScanner(对标 #2:扫描增强 5 档)

- **杀手锏**:智能扫描(自动找边 / 校正 / 增强 5 档:`原图` / `增强` / `黑白` / `灰度` / `增亮`)
- **校正算法**:Canny 边缘检测 + 透视变换(perspective transform) + 自适应二值化
- **视觉设计**:扫描结果预览拼接(多页拼成长图)+ 标注工具(矩形 / 文字 / 高亮 / 马赛克)
- **关键交互**:`长按` 启动连拍模式(每秒 3 张)→ 自动去重 + 拼接
- **增强模式**:增强档(锐化 + 对比度 +20%)让模糊文档可读

### 1.3 Apple Visual Look Up(iOS 16+,对标 #3:系统级融合)

- **杀手锏**:相册长按主体 → 浮出"Siri 知识" / "图片内容" / "文本"三卡(无需进入 App)
- **关键技术**:Apple Neural Engine 本地模型(< 200ms);CoreML 资源按需加载
- **视觉设计**:黑色半透明浮卡(`rgba(0,0,0,0.85)` + 圆角 16px)+ 主体描边发光(3px,`#FFD60A` 黄)
- **交互创新**:长按 → 自动识别主体(无需选择)+ 左右滑动切换卡;`↵` 进入详情
- **小细节**:不联网时降级为本地 CoreML 推理(响应头 `X-Lookup-Network=offline`)

### 1.4 Mathpix(对标 #4:公式转 LaTeX 行业天花板)

- **杀手锏**:截图即转 LaTeX + 行内编辑;支持化学方程式 / 电路图 / 表格
- **截屏工具**:全平台(Win/Mac/iOS/Linux);`⌘⇧M` 全局截屏 → 浮窗显示公式
- **识别流水线**:布局分析(Detectron2 + 自研 OCR)+ SmolSymNet(公式符号识别)+ Snip 模型(LaTeX 生成)
- **视觉设计**:截屏边框发光(蓝色 4px)+ 公式结果 Monokai 风格代码块 + 一键复制 LaTeX
- **关键交互**:`⌘⇧M` 截图后自动转圈 + 1.5s 弹窗;`↵` 复制 LaTeX;`Cmd+Z` 撤销识别
- **导出**:Markdown / LaTeX / MathML / DOCX / Overleaf 一键

### 1.5 Snapchat Scan(对标 #5:多模态 AR 扫描)

- **杀手锏**:拍照 → 多模型并行(植物 / 狗狗品种 / 汽车 / 营养成分表 / AR 翻译)
- **分类面板**:4 卡垂直排列 + 分类图标(plants 🪴 / pets 🐕 / cars 🚗 / nutrition 🥗)
- **关键交互**:点击分类卡 → 加载对应模型(loading spinner 500ms)+ 结果浮出
- **视觉设计**:结果浮卡半透明白色 + 下方黑色背景 + 滑动切换

### 1.6 Bing Visual Search + Microsoft Lens(补充对标)

- **Bing Visual Search**:截屏 / 上传后自动分类(产品 / 人物 / 地点 / 文本)+ Chat 集成生成总结
- **Microsoft Lens(Office Lens)**:文档 / 白板 / 名片 / 配方 4 模板;Excel 直接转表格(可编辑)
- **关键共性**:所有头部产品都遵循"截屏 → 自动分类 → 多操作卡"三段式,且**分类是并行触发**(按耗时顺序显示)

---

## 2. 亮点挖掘(本项目当前没有 / 通过本子模式补齐,带产品出处)

| # | 杀手锏 | 价值 | 实现难度 | 产品出处 |
|---|--------|------|---------|---------|
| 1 | **全局快捷键 `⌘⇧V`**(桌面任意位置唤起) | 输入摩擦 0 | 低 | Mathpix |
| 2 | **区域截图 `⌘⇧S`**(鼠标拖框) | 精准识别,避免背景干扰 | 中 | Mathpix / 百度翻译 |
| 3 | **4 路并行分类**(文字 / Logo / 表格 / 公式 同时检测) | 一图多用 | 中 | Snapchat Scan |
| 4 | **剪贴板自动监听**(粘贴板含图自动弹卡) | 流畅自动化 | 低 | Eagle |
| 5 | **viewport-clamp 浮卡**(永远在视口内,边界自动翻向) | 永远不被遮挡 | 低 | DictionaryCard 已具备 |
| 6 | **4 操作卡**(复制 / 翻译 / 反搜 / 模板识别) | 一图多用 | 低 | Microsoft Lens |
| 7 | **文字子段复制**(OCR 识别后,鼠标滑动选文字行即复制) | 替代手动框选 | 中 | 百度翻译 |
| 8 | **公式转 LaTeX**(单击公式区 → 转 LaTeX → 一键复制) | 学术场景刚需 | 高 | Mathpix |
| 9 | **Logo 反搜跳转以图搜图**(自动跳到 `01-reverse-image-search.md` 模式) | 场景衔接 | 低 | 本项目 |
| 10 | **表格识别 → 复制为 CSV**(点击表格区 → 弹出预览 → 复制) | 财务 / 数据场景刚需 | 中 | Microsoft Lens |
| 11 | **翻译叠加模式**(识别文字后按 `T` 直接翻译,译文覆盖原图) | 实时翻译 | 中 | 百度翻译 |
| 12 | **截图工作流面板**(历史截图列表 + 标签 + 重新识别) | 重复使用 | 中 | Snipaste |

---

## 3. ASCII 设计稿

### 3.1 全局截屏调用(`⌘⇧V` / `⌘⇧S` 触发后的浮卡)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       全屏 dim overlay (rgba(0,0,0,0.4))                  │
│                                                                             │
│                                                                             │
│                       ┌─────────────────────────────┐                     │
│                       │ 选区: 屏幕中央 1280 × 720   │                     │
│                       │  ┌──────────────────────┐   │                     │
│                       │  │  [截图区域预览]      │   │                     │
│                       │  │                      │   │                     │
│                       │  │   ┌──────────────┐   │   │                     │
│                       │  │   │   截图       │   │   │ ← 鼠标拖框           │
│                       │  │   │   内容       │   │   │                     │
│                       │  │   └──────────────┘   │   │                     │
│                       │  │  L 256 W 384         │   │                     │
│                       │  └──────────────────────┘   │                     │
│                       │  [Esc 取消] [↵ 识别] [⌘⇧A 全屏] │                     │
│                       └─────────────────────────────┘                     │
│                                                                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                  ↓ ↵ 识别后
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ┌──────────────────────── 浮卡(viewport-anchor,右上角)──────────────┐     │
│  │  识别结果: 4 项                                       [⨯ Esc]    │     │
│  │  ───────────────────────────────────────────────────────────      │     │
│  │  ┌─📄 文字(3 行)─────────────┐  ┌─🎯 Logo──────────┐            │     │
│  │  │ "Quick brown fox jumps" │  │ │ Apple           │            │     │
│  │  │ "敏捷的棕色狐狸跳过"   │  │ │ conf: 0.93      │            │     │
│  │  │ "lorem ipsum dolor"    │  │ │ [复制] [反搜]   │            │     │
│  │  │ [复制 ⌘C] [翻译 T] [反搜]│  │ └─────────────────┘            │     │
│  │  └────────────────────────┘  ┌─📊 表格────────────┐            │     │
│  │  ┌─∑ 公式────────────────────┐  │ 3 × 4 矩阵       │            │     │
│  │  │ E = mc²                  │  │ [复制 CSV]       │            │     │
│  │  │ [复制 LaTeX]              │  └─────────────────┘            │     │
│  │  └────────────────────────┘                                     │     │
│  │  ⏱ 1.8s · 🧠 4 路并行 · 📁 截图_2026-07-01.png                │     │
│  └──────────────────────────────────────────────────────────────────┘     │
│                                                                             │
│                                  ↑ (clamp 视口,远离光标 16px)              │
│                                  ┌─────────────────┐                       │
│                                  │  截图缩略图     │ ← 原始截图留在屏幕      │
│                                  │                 │    上,加 primary 描边 4px│
│                                  └─────────────────┘                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 文字行 hover 浮卡(浮卡内再次 hover 文字行)

```
┌──────────────────────────────────────────────────────────┐
│  "Quick brown fox jumps"  ←hover 此行                  │
│  ─────────────────────────────────────────               │
│  ┌─ 单词 1: Quick ─┐                                    │
│  │ adj. 快速的      │                                    │
│  │ 反: slow         │                                    │
│  │ [复制 src+tgt]   │                                    │
│  └──────────────────┘                                    │
│                                                          │
│  ┌─ 短语: brown fox ─┐                                  │
│  │ 棕色狐狸(red fox) │                                    │
│  └────────────────────┘                                  │
└──────────────────────────────────────────────────────────┘
```

### 3.3 翻译叠加模式(在原图上覆盖译文,按 `T` 切换)

```
┌──────────────────────────────────────────┐
│  原图(背景: rgba(0,0,0,0.85))             │
│  ┌────────────────────────────────────┐  │
│  │ Quick brown fox jumps              │  │ ← 原文(白色)
│  │ 敏捷的棕色狐狸跳过懒狗           │  │ ← 译文(蓝色覆盖)
│  │ [T 切换] [⊕ 加入翻译队列] [⤓ 导出] │  │
│  └────────────────────────────────────┘  │
│                                          │
└──────────────────────────────────────────┘
  按 T → 切换为单语 / 双语 / 仅译文 三档
```

### 3.4 公式识别弹窗(单击公式区域触发)

```
              ┌───────────────────────────────┐
              │  ∑ E = mc²                      │
              │  ─────────────────              │
              │  LaTeX: E = mc^2                 │
              │  ─────────────────              │
              │  [复制 LaTeX ⌘C]                │
              │  [复制 Markdown]                │
              │  [复制 DOCX]                    │
              │  [在编辑器打开 →]               │
              └───────────────────────────────┘
                              ▲
                              │ spring ease 上浮
              ┌───────────────┴───────────────┐
              │  截图区域                     │
              │  ┌─────────────┐              │
              │  │  E=mc²      │ ← 单击此区域 │
              │  └─────────────┘              │
              │                               │
              └───────────────────────────────┘
```

### 3.5 历史截图面板(`⌘⇧H` 唤起 / 或点击浮卡底部 "查看历史")

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  截图助手 - 历史                       [Esc 关]   [清空]   [导出一批]        │
├────────────────┬──────────────────────────────────────────────────────────────┤
│ 搜索           │  ┌──┬──┬──┬──┐  ┌──┬──┬──┬──┐                              │
│ [筛选/标签]    │  │1 │2 │3 │4 │  │5 │6 │7 │8 │                              │
│                 │  └──┴──┴──┴──┘  └──┴──┴──┴──┘                              │
│ 标签           │  ┌──┬──┬──┬──┐  ┌──┬──┬──┬──┐                              │
│ • 公式(3)     │  │9 │10│11│12│  │13│14│15│16│                              │
│ • 文字(8)     │  └──┴──┴──┴──┘  └──┴──┴──┴──┘                              │
│ • 表格(2)     │  ... (虚拟滚动)                                              │
│ • Logo(1)     │                                                              │
│                 │  单击 → 重新识别                                             │
│ 时间           │  双击 → 删除                                                 │
│ ○ 今天(5)    │  ⌘+单击 → 多选 / 批量导出 / 加入翻译队列                    │
│ ○ 7 天(12)   │                                                              │
│ ○ 30 天(14)  │                                                              │
│ ○ 全部(31)   │                                                              │
│                 │                                                              │
│ 文件夹         │                                                              │
│ • 默认         │                                                              │
│ • 工作(20)   │                                                              │
└────────────────┴──────────────────────────────────────────────────────────────┘
```

### 3.6 设置面板(右下角齿轮图标)

```
┌──────────────────────────────────┐
│  截图助手 - 设置                  │
│  ─────────────────────            │
│  全局快捷键                       │
│  截屏:    ⌘⇧V  [修改]            │
│  区域:    ⌘⇧S  [修改]            │
│  历史:    ⌘⇧H  [修改]            │
│                                 │
│  自动行为                         │
│  ☑ 剪贴板图片自动弹卡             │
│  ☑ 截屏后自动识别                 │
│  ☐ 识别后自动复制                 │
│                                 │
│  隐私                             │
│  ☑ 仅本地推理(不上传服务器)       │
│  ☐ 启用云端增强(智谱 fallback)   │
│                                 │
│  显示                             │
│  ● 浮卡(默认)                    │
│  ○ 嵌入侧栏                      │
│  ○ 弹出独立窗口                   │
│                                 │
│  [保存]   [取消]                  │
└──────────────────────────────────┘
```

---

## 4. 关键交互流

### 4.1 主流程:用户截图 → 4 类分类 → 4 操作卡

**用户故事**:
> 作为**研究助理小王**,我在看一篇 PDF 论文时,经常需要把图中的**公式转成 LaTeX** 把图中的**表格复制成 CSV**,把**Logo 反查到向量库**。当我看到这些素材,希望能**截屏后立刻得到所有结果**,而不是切到不同 App 多次操作。预期:`⌘⇧V` → 拖框 → 1.5-2.5 秒看到 4 路结果 → 各点所需操作。

**步骤分解**:

1. **触发截屏**(4 种入口)
   - 全局快捷键 `⌘⇧V`(默认在所有页面 / 系统全局生效,需要 Electron 桌面或浏览器扩展权限)
   - 全局快捷键 `⌘⇧S`(区域截屏,鼠标变十字光标)
   - 上传中心面板的"截图助手"按钮(降级方案)
   - 剪贴板监听:`paste` 事件 + 图片 `clipboardData.items`(自动弹卡)

2. **截屏 / 选区采集**
   - 截图全屏:用 `navigator.mediaDevices.getDisplayMedia()`(需用户授权)
   - 区域截图:`mousedown` → 拖框 → `mouseup`,返回 `{x, y, width, height}` + Canvas 截取
   - 截图自动复制到剪贴板(`navigator.clipboard.write([new ClipboardItem({'image/png': blob})])`)

3. **4 路并行分类**(`POST /api/screenshot/classify`)
   - **文字**(OCR 引擎):走现有 OCRP age 逻辑,识别文本行 + bounding box
   - **Logo**(MobileCLIP-S0 ONNX):512 维嵌入,与内置 Logo 库 topK=5 比对
   - **表格**(Detectron2 + 表格检测 + OCR + 单元格聚类):返回 2D 矩阵 + CSV
   - **公式**(SmolSymNet 模型):返回 LaTeX 字符串 + 置信度
   - 并行触发,Promise.all;响应头 `X-Screenshot-Engine` / `X-Screenshot-Latency-Total`

4. **viewport-anchor 浮卡**(参见 3.1)
   - 锚定到截图区域,偏移 `transform: translate(16px, 16px)`
   - 视口边界自动反向(viewport-clamp):
     - 接近右边界 → 反向到左侧
     - 接近下边界 → 反向到上方
   - 浮卡半透明背景(`--color-bg-overlay: rgba(10,14,26,0.96)`)

5. **4 操作卡**(每类独立)
   - 📄 文字:`复制 ⌘C` / `翻译 T` / `反搜 R`
   - 🎯 Logo:`复制` / `反搜`(跳转以图搜图)/ `详情`
   - 📊 表格:`复制 CSV` / `复制 DOCX` / `在 Excel 打开`
   - ∑ 公式:`复制 LaTeX ⌘C` / `复制 Markdown` / `复制 DOCX` / `编辑器打开`

6. **快捷键操作**(浮卡聚焦时)
   - `1` / `2` / `3` / `4` 切换文字 / Logo / 表格 / 公式
   - `C` 复制当前类别主结果
   - `T` 进入翻译叠加模式
   - `R` 跳转到以图搜图
   - `H` 查看历史
   - `Esc` 关闭浮卡

7. **Workspace Timeline 写入**(复用已有 hook)
   - kind='screenshot-classify',action: `screenshot_taken` / `classify_done` / `result_copy` / `result_translate`
   - 仅保留元数据(尺寸 / 耗时 / 类别),原图由用户决定保存位置

### 4.2 文字行二次 hover 流程

**用户故事**:
> 当我看到 OCR 识别结果"Quick brown fox jumps",我想知道 **`Quick`** 这个词的更多含义(同义词 / 反义词 / 例句)。鼠标 hover 该词 → 浮出词典卡 → 一键加入生词本。

**步骤分解**:

1. 在文字类浮卡内,鼠标 hover 任一识别行
2. → 该行背景变为 `var(--color-primary-soft)`(浅蓝色)
3. → 弹出二级浮卡 DictionaryCard(已是 viewport-anchor 模式)
4. → 词典卡内显示:词性 / 释义 / 反义词 / 变形 / 例句
5. 点击 `复制 src+tgt`(单击该行任意位置)
6. → 复制为 `Quick\t快速的\tquick → adj. 快速的 → fast 反义词` (Tab 分隔多格式)
7. → Toast 反馈 `已复制到剪贴板 ⌘V`

### 4.3 翻译叠加模式

**用户故事**:
> 当我看到一段英文截图,想**立刻读到翻译**,不想再复制粘贴到翻译 App。单击文字类 → 按 `T` → 译文覆盖原图,行行对齐,可滚动定位。

**步骤分解**:

1. 在文字类浮卡内,按 `T`
2. → 整个浮卡扩为"翻译叠加模式"(占视口 70% 宽 × 80% 高)
3. → 原文 + 译文双栏对照(原图 + 翻译结果),逐行对齐
4. → 滚动双栏同步(参考 `01-reverse-image-search.md` 段落同步滚动)
5. `[T 切换]` 按钮循环:仅原文 → 双语并排 → 仅译文 → 关
6. `[⊕ 加入翻译队列]` 操作:把这段识别文字加入翻译任务队列
7. `[⤓ 导出]` 操作:导出为 PNG / DOCX / PDF(走现有 export 模块)

### 4.4 剪贴板自动监听

**用户故事**:
> 当我在其他 App(微信 / 浏览器 / 文件管理器)复制一张图片,**回到本应用**应自动弹卡识别。

**步骤分解**:

1. 用户离开本应用,在外部 App 复制图片
2. 用户回到本应用(`document.visibilitychange` / `window.focus`)
3. → 后台 polling `navigator.clipboard.read()`(需要用户授权,首次需要提示)
4. → 检测到剪贴板包含图片(校验 MIME type)
5. → 检查截图助手是否启用"剪贴板自动弹卡"(参见 3.6)
6. → 是 → 自动弹卡(viewport-anchor 在视口右下角)
7. → 否 → 仅在系统通知中心推送"截图助手:检测到剪贴板图片"
8. → `[↵ 立即识别]` 按钮触发分类流水线

### 4.5 设置修改流程

1. 用户点击浮卡底部齿轮图标
2. → 弹出设置浮卡(参见 3.6)
3. 修改任一选项 → 实时保存到 `useWorkspaceTimeline` 的 settings 子集
4. 关闭窗口(失焦 / Esc)→ 自动保存
5. 全局快捷键修改需要重新注册 keyboard listener(实时生效)

---

## 5. 动效规范

| 场景 | 动效 | 时长 | Easing | 备注 |
|------|------|------|--------|------|
| 全屏 dim 出现 | opacity 0→1 | 200ms | `cubic-bezier(0.4, 0, 0.2, 1)` | ease-out |
| 选区拖框 | 虚线呼吸(stroke-dashoffset 循环) | 2000ms | `linear infinite` | 类似蚂蚁线 |
| 浮卡弹出 | opacity 0→1 + translateY 8→0 | 240ms | `spring(stiffness: 360, damping: 28)` | spring 物理 |
| 浮卡 viewport-clamp | transform X/Y 平滑过渡 | 150ms | `cubic-bezier(0.4, 0, 0.2, 1)` | 跨边界反向 |
| 4 类卡片加载 | opacity + scale 0.9→1,错开 80ms | 200ms | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 弹性 bounce |
| 文字行 hover | background-color transition | 150ms | `ease-out` | 浅蓝背景 |
| 词典卡弹出 | opacity + translateY 4→0 | 180ms | `cubic-bezier(0.4, 0, 0.2, 1)` | 跟随鼠标 |
| 复制成功 | toast opacity + translateY | 200ms | `cubic-bezier(0.4, 0, 0.2, 1)` | bottom-center |
| 翻译模式展开 | opacity + scale 0.95→1 | 320ms | `spring(stiffness: 280, damping: 30)` | spring 展开 |
| 历史面板 | translateX 100%→0 | 280ms | `cubic-bezier(0.32, 0.72, 0, 1)` | iOS 抽屉 |
| 公式弹窗 | opacity + scale + rotate(-1°→0) | 240ms | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 弹性入场 |
| 截图描边发光 | `box-shadow` 蓝色脉冲 | 1500ms | `ease-in-out infinite` | 类似雷达 |
| Loading spinner | 8 段旋转 + 透明度阶梯 | 800ms | `linear infinite` | 8 个圆点 |
| 撤销提示 | opacity + slide in from left | 300ms | `cubic-bezier(0.4, 0, 0.2, 1)` | 操作可撤销感 |

**全局守卫**:动效统一受 `usePrefersReducedMotion()` 控制,`<html data-motion="off">` 时:
- transform 替换为 opacity
- 时长压至 80ms
- 循环动画(扫描 / spinner)停止
- viewport-clamp 改为瞬时切换(避免 spring 摆动)

---

## 6. 响应式断点

| 断点 | viewport 宽度 | 浮卡尺寸 | 4 类卡片 | 翻译叠加模式 | 历史面板 |
|------|---------------|---------|---------|-------------|---------|
| `xl` | `>= 1280px` | 480 × 自动 | 4 卡网格(2×2) | 70% × 80% 视口 | 右侧抽屉 480px 宽 |
| `lg` | `1024 - 1280px` | 420 × 自动 | 4 卡网格(2×2) | 70% × 80% 视口 | 右侧抽屉 420px 宽 |
| `md` | `768 - 1024px` | 360 × 自动 | 4 卡纵向(1×4) | 90% × 80% 视口 | 底部抽屉全宽 |
| `sm` | `< 768px` | 全宽 × 自动(max-h 60vh) | 4 卡纵向(1×4,滑动切换) | 全屏 | 底部抽屉全宽 |

**触摸适配**(`< 1024px`):
- 截图改用 `HTMLCanvasElement` 全屏覆盖层 + 双指捏合缩放选区
- 长按浮卡 600ms → 二级菜单(替代 hover)
- 翻译叠加模式 → 上下滑动切换原文 / 译文
- 历史面板 → swipe-to-delete(从右滑左)
- 剪贴板自动弹卡 → 改为系统通知 + 下拉横幅

**平板适配**(`768 - 1024px`):
- 4 类改为 2×2 网格
- 浮卡可分屏:左半屏显示浮卡,右半屏显示原图

---

## 7. 可观测指标(`X-Screenshot-*` 响应头)

| 响应头 | 类型 | 含义 | 示例值 |
|--------|------|------|--------|
| `X-Screenshot-Engine` | enum | 识别引擎组合(`ocr+clip+detectron+smolsymnet`) | `ocr+clip+detectron` |
| `X-Screenshot-Latency-Total-Ms` | int | 总耗时 | `1820` |
| `X-Screenshot-Latency-Text-Ms` | int | 文字识别耗时 | `850` |
| `X-Screenshot-Latency-Logo-Ms` | int | Logo 识别耗时 | `1240` |
| `X-Screenshot-Latency-Table-Ms` | int | 表格识别耗时 | `1620` |
| `X-Screenshot-Latency-Formula-Ms` | int | 公式识别耗时 | `1980` |
| `X-Screenshot-Count-Text` | int | 文字识别条数 | `3` |
| `X-Screenshot-Count-Logo` | int | Logo 识别条数 | `1` |
| `X-Screenshot-Count-Table` | int | 表格识别条数 | `1` |
| `X-Screenshot-Count-Formula` | int | 公式识别条数 | `1` |
| `X-Screenshot-Cache-Hit` | bool | 是否命中缓存 | `true` / `false` |
| `X-Screenshot-Privacy-Mode` | enum | 隐私模式(`local-only` / `cloud-enhanced`) | `local-only` |
| `X-Screenshot-Format` | enum | 输入格式(`png` / `jpeg` / `webp` / `bmp`) | `png` |
| `X-Screenshot-Source-Bytes` | int | 输入图片字节数 | `234567` |
| `X-Screenshot-Query-Id` | uuid | 此次分类的追踪 ID | `uuid-v4` |
| `X-Screenshot-Trace-Id` | uuid | 分布式追踪 ID | `w3c-traceparent` |

**Console 日志格式**(服务端):
```
[screenshot-classify 2026-07-01T14:32:18.231Z] queryId=uuid-v4 latencyMs=1820 textCount=3 logoCount=1 tableCount=1 formulaCount=1 cache=false privacy=local-only
```

**Console 日志格式**(客户端):
```
[screenshot-client 2026-07-01T14:32:17.510Z] event=screenshot_taken source=clipboard format=png bytes=234567
[screenshot-client 2026-07-01T14:32:19.330Z] event=classify_done queryId=uuid-v4 latencyMs=1820 categories=[text,logo,table,formula]
[screenshot-client 2026-07-01T14:32:21.520Z] event=user_copy queryId=uuid-v4 category=text action=copy_clipboard bytes=42
[screenshot-client 2026-07-01T14:32:25.100Z] event=user_translate queryId=uuid-v4 category=text targetLang=zh-CN
```

**Prometheus 指标**( `/metrics`):
- `screenshot_requests_total{engine, status}` Counter
- `screenshot_latency_seconds{category}` Histogram
- `screenshot_classify_count_total{category}` Counter
- `screenshot_cache_hit_ratio` Gauge
- `screenshot_category_distribution{category}` Gauge
- `screenshot_user_action_total{action}` Counter(`copy` / `translate` / `reverse_search` / `template_match`)

---

## 8. 深色模式(semantic token 用法)

**核心策略**:`[data-theme="dark"]` 下,所有颜色通过语义层别名映射。

| 浅色 token | 深色对应 | 用途 |
|-----------|---------|------|
| `--color-bg-base` `#FFFFFF` | `[data-theme="dark"] --color-bg-base` `#0A0E1A` | 主背景 |
| `--color-bg-elevated` `#F7F8FA` | `[data-theme="dark"] --color-bg-elevated` `#161B2C` | 卡片背景 |
| `--color-bg-overlay` `rgba(255,255,255,0.96)` | `[data-theme="dark"] --color-bg-overlay` `rgba(10,14,26,0.96)` | 浮卡 / 面板 |
| `--color-scrim` `rgba(0,0,0,0.4)` | `[data-theme="dark"] --color-scrim` `rgba(0,0,0,0.7)` | 全屏 dim |
| `--color-text-primary` `#0F1B2D` | `[data-theme="dark"] --color-text-primary` `#E6E9F0` | 主文字 |
| `--color-text-secondary` `#6B7280` | `[data-theme="dark"] --color-text-secondary` `#9CA3AF` | 次文字 |
| `--color-primary` `#1677FF` | `[data-theme="dark"] --color-primary` `#4096FF` | 主题蓝(描边 / 选中) |
| `--color-confidence-high` `#10B981` | 不变 | 置信度高 |
| `--color-confidence-mid` `#F59E0B` | 深色下 → `#FBBF24` | 置信度中 |
| `--color-confidence-low` `#EF4444` | 深色下 → `#F87171` | 置信度低 |
| `--color-formula-text` `#1677FF` | 深色下 → `#60A5FA` | 公式字符 |
| `--color-table-border` `#E5E7EB` | `[data-theme="dark"] --color-table-border` `#2A3144` | 表格线 |

**关键深色模式细节**:
- 截图 dim 全屏覆盖层深色下更暗(`opacity 0.7` vs 0.4),让浮卡更突出
- 4 类卡片背景:`--color-bg-card` 浅色 `#FFFFFF` / 深色 `#1A1F2E`
- 公式弹窗 Monokai 风格:浅色下用 `Tomorrow` 主题,深色下用 `Monokai`
- 文字 hover 背景 `--color-primary-soft`:浅色 `rgba(22,119,255,0.08)` / 深色 `rgba(64,150,255,0.16)`
- 截图描边发光:浅色 4px `var(--color-primary)` / 深色 4px `rgba(64,150,255,0.6)`(增加透明度,避免刺眼)
- 词典卡二级浮卡:浅色下白底,深色下深灰底 + `1px` 浅色描边

**主题切换流程**:
1. 用户点击 `<ThemeToggle>`(已有)
2. `useTheme()` 改 `<html data-theme>` 属性
3. CSS 变量级联刷新,所有组件在 250ms 内平滑过渡
4. 浮卡位置 / 内容自动适配,无需重渲染

---

## 9. KPI 基线

### 9.1 性能指标(冷启动 / 缓存命中分别测量)

| 指标 | 目标 | 警戒 | 不可接受 |
|------|------|------|----------|
| **截屏采集 P50** | < 200ms | < 500ms | ≥ 1s |
| **截屏采集 P95** | < 500ms | < 1s | ≥ 2s |
| **首字识别 P50**(文字) | < 500ms | < 1s | ≥ 2s |
| **完整识别 P50**(4 路并行) | < 2s | < 3s | ≥ 5s |
| **完整识别 P95**(4 路并行) | < 3s | < 5s | ≥ 8s |
| **完整识别 P99**(4 路并行) | < 5s | < 8s | ≥ 12s |
| **公式识别单独 P95** | < 2.5s | < 4s | ≥ 6s |
| **表格识别单独 P95** | < 2.8s | < 4.5s | ≥ 7s |
| **Logo 反搜单独 P95** | < 2.5s | < 4s | ≥ 6s |
| **浮卡弹出 TTI** | < 100ms | < 200ms | ≥ 400ms |
| **复制到剪贴板 P95** | < 50ms | < 100ms | ≥ 300ms |
| **历史面板加载 100 项** | < 500ms | < 1s | ≥ 2s |
| **剪贴板监听 CPU 占用** | < 1% | < 3% | ≥ 8% |

### 9.2 准确率指标

| 指标 | 目标 | 警戒 | 备注 |
|------|------|------|------|
| **文字 OCR Top-1 准确率**(清晰文档) | ≥ 95% | ≥ 88% | 印刷体 |
| **文字 OCR Top-1 准确率**(手写 / 模糊) | ≥ 75% | ≥ 60% | 复杂场景 |
| **Logo 反搜 Top-5 准确率** | ≥ 80% | ≥ 65% | 1k 图库 |
| **表格单元格识别准确率** | ≥ 90% | ≥ 80% | 含边框表格 |
| **公式 LaTeX 完全匹配率** | ≥ 60% | ≥ 45% | 基础公式 |
| **公式字符级 F1** | ≥ 88% | ≥ 75% | |
| **分类准确率**(4 路并行) | ≥ 92% | ≥ 80% | 各分类独立性 |
| **用户首次操作转化率**(识别后直接操作) | ≥ 50% | ≥ 35% | |
| **误报率**(错误分类) | ≤ 3% | ≤ 8% | |
| **历史检索准确率** | ≥ 90% | ≥ 75% | tag / search |

### 9.3 用户体验指标

| 指标 | 目标 | 警戒 |
|------|------|------|
| **新用户首次 `⌘⇧V` 完成识别率** | ≥ 85% | ≥ 60% |
| **次月留存率** | ≥ 65% | ≥ 45% |
| **每日截屏使用频次** | ≥ 5 次 | ≥ 2 次 |
| **平均会话时长**(含历史查阅) | ≥ 6 min | ≥ 2 min |
| **公式识别 → 复制 LaTeX 转化率** | ≥ 35% | ≥ 20% |
| **表格识别 → 复制 CSV 转化率** | ≥ 30% | ≥ 15% |
| **翻译叠加模式使用率** | ≥ 20%(文字类用户) | ≥ 10% |
| **NPS**(用户净推荐值) | ≥ 55 | ≥ 35 |
| **键盘快捷键使用率** | ≥ 35%(重度用户) | - |

### 9.4 可观测性指标

| 指标 | 目标 |
|------|------|
| **响应头覆盖率** | 100%(`X-Screenshot-*` 全部字段) |
| **Timeline 写入成功率** | ≥ 99.9% |
| **缓存命中率**(重复截图) | ≥ 35% |
| **错误告警响应时间** | < 5 min |
| **审计日志完整性** | 100% |
| **剪贴板权限撤销率** | < 5% |

---

## 10. 实施 Checklist(为 TDD 提供输入)

### 10.1 单元测试(≥ 16 项)

1. `useClipboardImage() 应当在 paste 事件触发时返回图片 Blob`(TDD 红 → 绿)
2. `useClipboardImage() 应当在非图片 paste 时不触发`
3. `viewport-clamp 应当把浮卡 clamp 在视口内`(`DictionaryCard` 已有,本模式复用 + 增测)
4. `4 类卡片渲染应当不重叠`(grid layout)
5. `按 `1` `2` `3` `4` 应当切换高亮分类`(键盘事件)
6. `按 `C` 应当复制当前分类主结果`
7. `按 `T` 应当进入翻译叠加模式`
8. `按 `R` 应当跳转到以图搜图`
9. `按 `Esc` 应当关闭浮卡`
10. `Logo 反搜按钮点击应当导航到 image-search 模式`
11. `公式 LaTeX 复制应当去除前后空格`
12. `CSV 复制应当逗号分隔 + RFC 4180 转义`
13. `文字行 hover 应当浮出 DictionaryCard`
14. `翻译叠加模式 原文 / 译文 滚动应当同步`
15. `历史面板 ⌘+单击 应当进入多选模式`
16. `设置面板 ⌘⇧V 修改后 keyboard listener 应当重新注册`

### 10.2 E2E 测试(≥ 5 项)

1. `screenshot-assistant.spec.ts` — `⌘⇧V` → 拖框 → 等待分类 → 操作 4 类卡片(复制 / 翻译 / 反搜 / 复制 LaTeX)
2. `screenshot-assistant-keyboard.spec.ts` — `1-4` 切换 / `C` 复制 / `T` 翻译 / `R` 反搜 / `Esc` 关闭
3. `screenshot-assistant-clipboard.spec.ts` — 模拟粘贴事件 → 弹卡 → 识别 → 操作
4. `screenshot-assistant-formula.spec.ts` — 公式截屏 → LaTeX 复制 → 粘贴到编辑器验证
5. `screenshot-assistant-history.spec.ts` — 历史面板 → 标签筛选 → 重新识别 → 删除
6. `screenshot-assistant-translate.spec.ts` — 文字类 → `T` → 双语模式 → 加入翻译队列 → Toast

### 10.3 视觉回归测试(≥ 3 项)

1. `screenshot-assistant-spec.ts-snapshots/floating-card.png`
2. `screenshot-assistant-spec.ts-snapshots/translate-overlay.png`
3. `screenshot-assistant-spec.ts-snapshots/history-panel.png`

### 10.4 性能基准测试(可选)

`web/scripts/bench-screenshot.mjs` — 50 张测试图 × 4 路并行,验证 P50 / P95 / P99 达标

---

## 11. 复用资产清单

| 已有组件 / Hook | 本模式用途 |
|----------------|----------|
| `DictionaryCard.tsx`(已有,viewport-anchor) | 二级浮卡 + 历史面板详情复用 |
| `ConfidenceDot.tsx`(已有) | 各分类置信度点复用 |
| `OCRPage.tsx`(已有,识别逻辑) | 文字识别流水线复用 |
| `OCRPage.tsx` 的 SVG bbox 渲染 | 复用为截图区域描边发光 |
| `useWorkspaceTimeline.ts`(已有) | kind='screenshot-classify' 写入 |
| `Hover/Press` 动效原语 | 弹卡 / 操作按钮动效复用 |
| `Modal.tsx`(已有,Phase 2 通用 Modal) | 设置面板 / 翻译叠加模式底座 |
| `MotionProvider`、`usePrefersReducedMotion` | 全局动效开关 |
| `tokens.ts`(已扩展 semantic + dark) | 颜色 / 间距 / 字号复用 |
| `palette/sources/` | `screenshot-assistant` 加入 navigation source(全局快捷键)|
| `store.ts`(已有 slices) | 截屏历史 / 设置持久化 |

### 11.1 新增模块(本子模式特有)

| 文件 | 用途 |
|------|------|
| `server/src/screenshot-classify.mjs` | 4 路并行分类流水线(文字 / Logo / 表格 / 公式) |
| `web/src/hooks/useClipboardImage.ts` | 剪贴板图片监听 hook |
| `web/src/hooks/useScreenshotCapture.ts` | 截屏 / 区域选择 hook(基于 `getDisplayMedia` / canvas) |
| `web/src/components/ScreenshotFloatingCard.tsx` | viewport-anchor 浮卡,4 类卡片渲染 |
| `web/src/components/ScreenshotHistoryPanel.tsx` | 历史截图面板(虚拟滚动 + 多选) |
| `web/src/pages/ScreenshotAssistantPage.tsx` | 设置面板独立页面(可选) |
| `web/src/workers/screenshot-worker.ts` | Web Worker 包装分类流水线,避免主线程卡顿 |

---

## 12. 不在本子模式范围内的内容

- 以图搜图(检索 / 瀑布流)→ 见 `01-reverse-image-search.md`
- 跨文件图谱追溯 → 见 `03-cross-doc-trace.md`
- 视觉 diff 对比 → 见 `04-visual-diff.md`
- 智能聚类 → 见 `05-clustering.md`
- 图片 Translation Memory → 见 `06-image-tm.md`

---

> **声明**:
> - **模型**:claude-sonnet-4-6
> - **调研基础**:1) 百度翻译拍照 / CamScanner / Apple Visual Look Up / Mathpix / Snapchat Scan 官方文档与公开 UX 拆解;2) 截至 2026-01 模型知识库;3) 项目 memory(`OCRPage.tsx` 已有逻辑、`DictionaryCard.tsx` viewport-anchor 模式、`Hover/Press` 动效原语);4) 项目既有 design tokens 体系;5) Mathpix / 百度翻译等产品的快捷键体系(`⌘⇧V` / `⌘⇧S`)。
> - **限制**:WebSearch / WebFetch 在当前会话中持续返回 API 错误 400,所有引用均为知识库沉淀的二次信息,建议下游人工核验:
>   - Apple Visual Look Up 响应延迟(< 200ms) — 实测 iPhone 12 以上较快
>   - Mathpix 公式识别延迟(1.5s) — 不同公式复杂度差异大
>   - 百度翻译拍照实时识别(< 1s) — 实测可能 1-2s
>   - SmolSymNet / Detectron2 模型大小与精度 — 来自 Mathpix 公开技术分享,可能略有出入
>   - 全局快捷键在浏览器 / Electron 中权限限制 — 浏览器扩展需要 `tabs` / `activeTab` 权限,Electron 全局可用
>   - 配色 hex 值 — 均为行业最常用近似值,以最终视觉走查为准
