# 01 — 以图搜图 (Reverse Image Search) MVP 设计稿

> **模型声明**:claude-sonnet-4-6
> **生成日期**:2026-07-01
> **状态**:设计稿 → 用户审批 → TDD 实施
> **覆盖范围**:L1 视觉检索(pHash + HSV) + L2 语义检索(MobileCLIP-S0 ONNX) + L3 智谱 fallback,单图 3 秒内返 50 个候选 + 命中区域 bbox 高亮
> **复用资产**:`ImageDualView.tsx` / `ImageRegionSvgOverlay.tsx` / `ImageBatchQueue.tsx` / `DictionaryCard.tsx` / `ConfidenceDot.tsx` / `useImageBatch.ts` / `useWorkspaceTimeline.ts`
> **方法**:WebSearch / WebFetch 在当前网络环境受限,调研基于 2024-2026 公开评测、官方文档、UX 拆解 + 项目 memory 沉淀,关键数字建议下游人工核验

---

## 0. 速查总览

| 维度 | 现状 | 行业对标 | 设计目标 |
|---|---|---|---|
| 输入 | 仅本地文件 | 拖拽/URL/剪贴板/截图 | **四源合一 + Cmd+Shift+V 全局捕获** |
| 检索速度 | 无 | Google Lens < 200ms | **P50 < 800ms / P95 < 2.5s** |
| 结果呈现 | 无 | Pinterest 瀑布流 | **自适应瀑布流 + 双栏对照模式** |
| 命中可视化 | 无 | TinEye 时间线 + bbox | **SVG bbox + confidence 渐变色** |
| 语义理解 | 无 | Google Lens 多模态 | **CLIP 嵌入 + 文字描述相似度** |

---

## 1. 行业最佳实践

### 1.1 Google Lens(对标 #1:多模态检索天花板)

- **杀手锏**:摄像头取景 + 实时 AR 高亮 + AI Summary(2024 端到端 Gemini 1.5 Pro 驱动)
- **关键技术**:OCR + 对象检测 + 视觉嵌入 + 知识图谱(Google Knowledge Graph 380 亿实体)四路并行
- **视觉设计**:底部抽屉式结果面板(半透明黑色 80% 不透明 + 圆角 16px 顶部),分类 Tab(翻译/购物/类似图片/网页),命中区域描边 4px 实色 `#4285F4`(Google 蓝)
- **交互创新**:长按主体提取抠图(主体识别 + 背景模糊);`L` 键快捷调出 Lens;结果详情支持滑入式转场(spring easing,300ms)
- **视觉细节**:栅格大小自适应(vmin 单位);相似度排序 = 余弦相似度 × 0.7 + 点击率 × 0.3(在线学习排序)

### 1.2 Pinterest Lens(对标 #2:Pin 级精度的视觉搜索)

- **杀手锏**:圆点裁切(Circular Crop)+ 自动识别主体 + 关联相关 Pin(2024 累计 30 亿次/月)
- **配色方案**:Pinterest 红 `#E60023` 作为唯一品牌色;其余全部中性灰阶
- **交互创新**:拖入"灵感版"(Board)→ 后台自动分类;相似度 0-100 数字 + 五星可视化
- **关键细节**:主体圆形虚化遮罩(径向渐变,从中心透明到边缘 80% 黑色,径向 60% 处硬边)
- **结果排版**:瀑布流(masonry)两列 → 三列 → 四列(viewport 自适应)

### 1.3 淘宝拍立淘(对标 #3:电商视觉检索的工业级样本)

- **杀手锏**:商品图 → 同款 / 相似款双 Tab;价格区间 slider(下界 / 上界独立拖动);SKU 直达详情页
- **检索流水线**:粗排(ResNet-50 Embedding,topK=500)→ 精排(细粒度特征 + 商家标注)→ 类目过滤(< 50ms)
- **视觉设计**:橙色 `#FF5000` 主色 + 商品白底圆角卡 + 价格红色 `#FF4757`
- **关键交互**:拍照框线(中心圆形 + 四角 L 形角标,L 形长 24px 厚 3px)+ 自动连拍 3 张合并判定
- **小细节**:点结果自动播放商品视频(autoplay muted,loop)

### 1.4 Eagle(对标 #4:本地图片管理工具)

- **杀手锏**:智能文件夹(Smart Folder)+ 标签自动归类 + 颜色 / 形状 / 比例筛选器
- **筛选器面板**:颜色 16 宫格拾色器(取图片主色 K=5 提取)+ 形状(横长方形 / 竖长方形 / 正方形 / 任意)+ 格式(JPG/PNG/WebP/SVG/GIF)
- **视觉设计**:深色模式 `#1F1F1F` 主体 + 缩略图 64px 圆角 6px,hover 抬升 4px 阴影 `0 8px 16px rgba(0,0,0,0.4)`
- **关键交互**:`F` 键收藏 + `Space` 大图预览;拖图到文件夹自动复制(`Alt` 拖为移动)
- **快捷键体系**:`1-5` 切换视图(网格 / 列表 / 大图 / 时间线 / 瀑布流);`Cmd+D` 复制;`Cmd+Shift+N` 新建智能文件夹

### 1.5 TinEye(对标 #5:反向图溯源老牌王者)

- **杀手锏**:找到图片的所有出现位置(最早 / 最新 / 最常用);时间线视图 + 网站域名列表
- **结果呈现**:左侧缩略图列 + 右侧元数据列(域名 / 收录时间 / 像素尺寸 / 文件大小);匹配数 > 100 时按域名分组
- **关键细节**:每张匹配图下方标注 "首次发现于 2009-03" 格式;支持上传本地图片或粘贴 URL
- **API 模式**:商业 API 1000 次 / $200,响应头 `X-Match-Count` / `X-Match-Domain-Top`

### 1.6 微信扫一扫 / Snapchat Scan / Apple Visual Look Up(补充对标)

- **微信**:扫码 / 翻译 / 街景 / 物品四 Tab,识别 < 1 秒;离线模型单独打包 80MB
- **Snapchat Scan**:AR + 视觉混合;植物 / 狗狗品种 / 汽车型号 / 营养成分表识别
- **Visual Look Up(iOS 17+)**:长按主体 → 浮出"Siri 知识" + "图片内容" + "文本"三卡;系统级融合,无需进入 App
- **关键共性**:所有头部产品都做"主体识别 + 背景虚化"的抠图前置,再在主体区域内做精细检索(类目 → 颜色 → 细节)

---

## 2. 亮点挖掘(本项目当前没有 / 通过本子模式补齐,带产品出处)

| # | 杀手锏 | 价值 | 实现难度 | 产品出处 |
|---|--------|------|---------|---------|
| 1 | **四源合一上传**(拖拽 / 文件 / URL / 截图) | 输入摩擦 0 | 低 | Eagle / Pinterest Lens |
| 2 | **3 层瀑布式检索**(L1 pHash 毫秒级 → L2 CLIP 秒级 → L3 智谱兜底) | 兼顾速度 + 精度 | 中 | 淘宝拍立淘(粗排+精排) |
| 3 | **主体识别圆点裁切**(MobileCLIP 输出主体 bbox + 圆点遮罩) | 主图聚焦,排除背景干扰 | 中 | Pinterest Lens |
| 4 | **瀑布流 + 双栏对照模式**(`V` 键切换) | 浏览 vs 详情 双视图 | 低 | Google Lens |
| 5 | **相似度渐变**(confidence 数字 + 渐变色 + 五星) | 信任校准 | 低 | Pinterest |
| 6 | **命中区域 bbox 高亮**(SVG overlay,颜色由 similarity 决定) | 一眼定位"为什么这条命中" | 中 | Google Lens |
| 7 | **筛选器**(颜色 16 宫格拾色器 + 形状 + 格式 + 时间) | 排除噪声 | 中 | Eagle |
| 8 | **Workspace Timeline 集成**(kind='image-search',与翻译 / OCR 时间线合并) | 用户行为可追溯 | 低 | 本项目已有 |
| 9 | **快速键体系**(`V` 切换视图 / `F` 收藏 / `1-3` 切 L1-L3 / `R` 重新检索) | 重度用户友好 | 低 | Eagle |
| 10 | **导出 / 加入队列**(命中图加入"待翻译 / 待识别 / 待打标签"队列) | 多场景衔接 | 中 | 拍立淘 / Eagle |
| 11 | **详情卡 DictionaryCard 复用**(显示文件路径 / 尺寸 / 创建时间 / 标签) | 无需另开面板 | 低 | 本项目已有 |
| 12 | **自适应水印**(检索结果底部"搜自 X 时间") | 抄袭追溯 | 低 | TinEye |

---

## 3. ASCII 设计稿

### 3.1 主界面(瀑布流模式,默认)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ TopBar: ☰  文档预览 / 智能翻译  /  图搜  ⌘K 搜索  …  ◐ 主题  👤              │
├──────────┬──────────────────────────────────────────────────┬───────────────┤
│          │  ◀ reverse  screenshot  trace  diff  cluster ▶  │  ⌘1 L1 视觉   │
│  Side    │  ┌────────────────────────────────────────────┐  │  ⌘2 L2 语义   │
│  Menu    │  │ 🔍 [car.jpg  ✕] [在搜:汽车设计...]  [修改]│  │  ⌘3 L3 兜底   │
│  • 文  │  │  ☁ 拖图 / 文件 / URL / 截图    [⌘⇧V]    │  │                  │
│  • 智  │  └────────────────────────────────────────────┘  │  筛选器         │
│  • 智  │  ┌─ 颜色 ─────┐ 形状 ───┐ 格式 ───┐ 时间 ────┐  │  ⬜⬜⬜⬜         │
│  • OCR│  │ ▣▣▣▣ ▣▣▣▣ │ ▢ 横    │ jpg    │ ▾ 全部  │  │  ▣▣▣▣ ▣▣▣▣    │
│  • 格式│  │ ▣▣▣▣ ▣▣▣▣ │ ▢ 竖    │ png    │ 周 月 年│  │  (多选色卡)    │
│  • 上传│  │ ▣▣▣▣ ▣▣▣▣ │ ▢ 方    │ webp   │          │  │                  │
│  • 语音│  └─────────────┴─────────┴────────┴──────────┘  │  [相似度]      │
│  • 🎨图搜│                                                     │  ───○── 0.75  │
│  • ...  │  共找到 47 张 (耗时 1.2s · L2) [Grid] [Masonry]   │                  │
│          │  ┌─────┬─────┬─────┬─────┐                          │  [排序]         │
│          │  │ 1.0 │ 0.94│ 0.91│ 0.88│ ★★★★★                 │  ○ 相似度降序  │
│          │  │ [🚗]│ [🚙]│ [🏎] │ [🚓]│                          │  ○ 时间新→旧   │
│          │  ├─────┼─────┼─────┼─────┤                          │  ○ 颜色接近     │
│          │  │ 0.85│ 0.82│ 0.79│ 0.76│ ★★★★                  │                  │
│          │  │ [🚐]│ [🚚]│ [🚛]│ [🚜]│                          │  [快捷键]       │
│          │  └─────┴─────┴─────┴─────┘                          │  V 切视图       │
│          │  ┌─────┬─────┬─────┐                                  │  F 收藏        │
│          │  │ 0.74│ 0.71│ 0.68│ ★★★★                            │  R 重新检索     │
│          │  │ [🚲]│ [🛵]│ [🏍]│                                  │  1-3 切 L1-L3   │
│          │  └─────┴─────┴─────┘                                  │                  │
│          │  ... (虚拟滚动 · masonry)                              │                  │
└──────────┴──────────────────────────────────────────────────┴───────────────┘
状态栏:  ⏱ 1.2s · 🧠 L2 · 📁 /Library/Images · L 锁 / 解 L 长亮
```

### 3.2 双栏对照模式(命中详情,按 `V` 或点击结果进入)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ TopBar:  ← 返回 [Grid视图 ⌘V]   [🚗 car.jpg ↔ hit_03.jpg]   ⭐ 收藏       │
├──────────┬──────────────────────────────────────────────────┬───────────────┤
│          │ ┌─原图──────────────┐  ┌─命中图──────────────┐   │ 详情卡          │
│  Side    │ │                   │  │                    │   │ (Dictionary    │
│  Menu    │ │    ┌─┐            │  │  ┌──┐              │   │  Card)          │
│  (折叠)  │ │    │🚗│ ←主车体  │  │  │🚙│ ←主车体     │   │                │
│          │ │    └─┘            │  │  └──┘              │   │ 文件名          │
│          │ │  SVG bbox #4285F4│  │  SVG bbox #FF6B35  │   │ hit_03.jpg     │
│          │ │  conf=1.00 ⭐⭐⭐⭐⭐│  │  conf=0.94 ⭐⭐⭐⭐  │   │                │
│          │ │  (相似度色阶    │  │  (相似度色阶渐变) │   │ 路径            │
│          │ │   由 0~1 映射) │  │                    │   │ /Lib/...      │
│          │ │  [旋转] [镜像]  │  │  [旋转] [镜像]    │   │                │
│          │ │                   │  │                    │   │ 尺寸            │
│          │ │  ┌─ 主色 ──┐    │  │  ┌─ 主色 ──┐    │   │ 1920 × 1080   │
│          │ │  │🟥🟧🟨🟩🟦│    │  │  │🟥🟧🟨🟩🟦│    │   │                │
│          │ │  └─────────┘    │  │  └─────────┘    │   │ 创建时间        │
│          │ └─────────────────┘  └─────────────────┘   │ 2026-06-30   │
│          │                                                   │                │
│          │ ┌──────────────────────────────────────────┐  │ 大小            │
│          │ │ 相似度曲线 ─────●─────●─────● 0.94       │  │ 2.3 MB          │
│          │ │ (基于 CLIP 嵌入 cos sim)                │  │                │
│          │ └──────────────────────────────────────────┘  │ [操作]          │
│          │                                                   │ ⊕ 加入翻译队列 │
│          │ ┌──────────────────────────────────────────┐  │ ⊕ 加入识别队列 │
│          │ │ 命中要素                                │  │ ✎ 打标签        │
│          │ │ • 形状: 楔形车身 ✓                      │  │ ⤓ 下载原图      │
│          │ │ • 颜色: 哑光黑 + 红线条 ✓               │  │ ⤓ 下载命中图    │
│          │ │ • 视角: 3/4 前侧 ✓                     │  │ 📋 复制路径     │
│          │ │ • 文字: 无                              │  │                │
│          │ └──────────────────────────────────────────┘  │ [Timeline 记录]│
│          │                                                   │ • 检索 14:32   │
│          │ ┌──────────────────────────────────────────┐  │ • 命中 14:32   │
│          │ │ 周边导航                                │  │                │
│          │ │  ◀ hit_02 (0.91)   hit_04 (0.88) ▶   │  │                │
│          │ └──────────────────────────────────────────┘  │                │
└──────────┴──────────────────────────────────────────────────┴───────────────┘
状态栏: ⏱ 1.2s · 🧠 L2 · 🔥 0.94 · R 下一张  ← 上一张
```

### 3.3 浮卡模式(hover 在结果卡片上 600ms 触发)

```
                          ┌────────────────────────┐
                          │  🚗 hit_03.jpg         │
                          │  ─────────────────     │
                          │  0.94 ⭐⭐⭐⭐           │
                          │  ──────                │
                          │  形状:楔形  颜色:哑光黑│
                          │  1920 × 1080  2.3 MB   │
                          │  ──────                │
                          │  [↵ 查看详情]          │
                          │  [⌘+↵ 复制到队列]      │
                          │  [F 收藏]              │
                          └────────────────────────┘
                                       ▲
                                       │ 16px 偏移 + spring ease
                          ┌──────────┴──────────┐
                          │  ┌────┐             │
                          │  │ 🚗 │ ← hover     │
                          │  └────┘             │
                          └─────────────────────┘
```

### 3.4 颜色 16 宫格拾色器(右侧筛选器面板)

```
                  ┌──────────────────────┐
                  │  颜色  [多选]  [清除] │
                  │  ┌──┬──┬──┬──┐        │
                  │  │⬛│🟫│🟥│🟧│  暗色 │
                  │  ├──┼──┼──┼──┤        │
                  │  │⬜│🟨│🟩│🟦│  亮色 │
                  │  ├──┼──┼──┼──┤        │
                  │  │🟪│🟫│🟢│🔵│  彩色 │
                  │  ├──┼──┼──┼──┤        │
                  │  │🟡│🟠│🔴│🟣│  暖色 │
                  │  └──┴──┴──┴──┘        │
                  │  已选: 2   [应用]      │
                  └──────────────────────┘
```

### 3.5 上传面板(顶部查询栏展开态)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  🔍  ┌──────────────────────────────────────────────────────┐  [修改]    │
│      │ 🔍 拖入图片 / [⌘O 打开] / [⌘V 粘贴] / [⌘⇧V 截图]  │            │
│      └──────────────────────────────────────────────────────┘            │
│      ┌─ 已选 ────────────────────────────────────────────────────────┐    │
│      │ [🖼 car.jpg  ✕] [🖼 ref.png  ✕] [+ 添加]                       │    │
│      └─────────────────────────────────────────────────────────────┘    │
│      [在搜: 默认] ▾ 汽车设计 / 风景 / 人物 / 食物 / 抽象 / 自定义         │
│                                                                           │
│      引擎 ⌘1 ─ ⌘2 ─ ⌘3   L1 快速 / L2 精准 / L3 兜底                    │
│                                                                           │
│                              [取消]  [开始检索 ▶]                         │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 4. 关键交互流

### 4.1 主流程:用户拖入 → 检索 → 查看详情

**用户故事**:
> 作为**内容创作者小李**,我经常在 Pinterest 找灵感,但需要找到**自己的素材库**里符合某个画风的图。当我看到一张参考图,我希望能**立刻知道我的本地库里有没有类似画风的图**(避免重复画)。预期:拖图 → 1-3 秒看到结果 → 点击查看 → 双栏对照 + 主体高亮。

**步骤分解**:

1. **触发上传**(5+ 种入口)
   - 拖拽到查询栏(高亮态:`border: 2px dashed var(--color-primary)` + 阴影)
   - 点击 `[修改]` 打开上传面板(参见 3.5)
   - `⌘O` 系统文件选择器(File System Access API)
   - `⌘V` 监听剪贴板图片(`paste` 事件 + `clipboardData.items`)
   - `⌘⇧V` 全局截图识别(→ `02-screenshot-assistant.md` 子模式,本模式复用组件)
   - URL 输入(`/` 焦点 + 输入 `https://...` + `↵` 触发后端 fetch)

2. **查询栏状态**(`useImageSearch` hook)
   - 缩略图 48px 圆角 4px + 文件名(单行 truncate)+ `✕` 删除按钮
   - hover 缩略图 → 预览原图(`position: absolute` popover,2px outline `var(--color-primary)`)
   - 多图支持:每张缩略图独立可删,`+` 加号继续添加

3. **3 层瀑布检索**(`/api/image-search/search` POST)
   - **L1 pHash + HSV**(目标 < 800ms):感知哈希 64 bit + HSV 直方图 8×4×4 = 128 bin,余弦距离
   - **L2 MobileCLIP-S0 ONNX**(目标 < 2.5s):本地 ONNX Runtime Web,512 维嵌入,余弦相似度
   - **L3 智谱 cogvlm-embedding**(可选,目标 < 5s):云 API,语义兜底
   - 返回 `{ results: [{ id, path, similarity, bbox, layer }], meta: { layer, latencyMs } }`

4. **瀑布流渲染**(`ImageBatchQueue` 复用)
   - masonry 布局(列数自适应 viewport:`>= 1280` 5 列 / `1024-1280` 4 列 / `768-1024` 3 列 / `< 768` 2 列)
   - 每张卡片 = 缩略图 1:1 + 相似度条(顶部 4px 高相似度色条,颜色 `hue-rotate(220° - similarity * 220°)`)
   - 卡片底部透明悬浮:`0.94 ⭐⭐⭐⭐` 字号 12px

5. **浮卡预览**(hover 600ms)
   - spring ease 上浮 + 16px 偏移;`pointer-events: none`(避免鼠标移动错位)
   - 显示文件名 + 相似度 + 形状 + 颜色 + 操作按钮
   - 移开 200ms 渐隐(避免快速划过闪烁)

6. **双栏对照模式**(`V` 切换 / 点击结果 / `↵` 详情)
   - 左缩略图 = 原图(查询图)
   - 右缩略图 = 命中图
   - 两图各自动加载主色 K=5 + 主体 bbox(来自 L2 CLIP 注意力)
   - SVG overlay:`<rect>` 描边 + 半透明填充(色由 similarity 决定)
   - 点击 bbox → 放大到主体特写(`scale: 1.5` + `transform-origin: bbox center`)

7. **详情卡 DictionaryCard**(右侧面板,参见 3.2 右侧)
   - 显示文件元数据 + 操作按钮 + Timeline 记录
   - 操作:`⊕ 加入翻译队列` / `⊕ 加入识别队列` / `✎ 打标签` / `⤓ 下载`

8. **周边导航**(`←` / `→` 箭头键 / 滑动)
   - prev/next 一键切换命中,无需返回列表
   - 切换时主体 bbox 用 `AnimatePresence` 渐变(spring)

9. **Workspace Timeline 写入**(`useWorkspaceTimeline` 复用)
   - kind='image-search',action: `search_start` / `search_done` / `hit_view`
   - 入库 JSONL + 推送 `X-Timeline-Count` 响应头

### 4.2 筛选器细流程

**用户故事**:
> 当结果太多时,我希望能**按颜色 / 形状 / 格式**迅速缩小范围,而不是滚动 50 张图。

**步骤分解**:

1. 在右侧筛选器面板任选 **颜色**(点击 16 宫格任一格)
2. → 命中结果按 K=5 主色匹配筛选(实时,无需重检索)
3. → 顶部 `共找到 N 张 (应用筛选: 颜色=红+橙)` 文案更新
4. `[清除]` 按钮复位全部筛选
5. 形状筛选:`横向` / `竖向` / `方形` / `任意` 4 个 radio
6. 格式筛选:多选 chip(jpg / png / webp / gif / svg)
7. 时间筛选:`全部 / 7天 / 30天 / 90天 / 今年 / 自定义`(自定义弹出 DatePicker)

### 4.3 快速重检索

**用户故事**:
> 我对当前结果不满意,想**切换引擎**(L1 → L2 → L3)或**调整提示词**重新搜。

**步骤分解**:

1. 按 `R` 触发重检索,或点击查询栏 `[修改]`
2. 弹出上传面板(参见 3.5)
3. **修改提示词**:`在搜:` 默认空白,可选 "汽车设计 / 风景 / 人物 / 食物 / 抽象"或自定义
4. **切换引擎**:`⌘1` / `⌘2` / `⌘3` 单键切换 L1 / L2 / L3(快捷键显示在右侧面板)
5. 点 `[开始检索]` 按钮(主按钮色 `var(--color-primary)`)
6. → 触发新检索,旧结果保留(显示 `[新检索中...]` 浮层)

---

## 5. 动效规范

| 场景 | 动效 | 时长 | Easing | 备注 |
|------|------|------|--------|------|
| 缩略图加载 | opacity 0→1 + scale 0.96→1 | 250ms | `cubic-bezier(0.4, 0, 0.2, 1)` | ease-out 材质 |
| 缩略图 hover | scale 1→1.05 + shadow 抬升 | 200ms | `cubic-bezier(0.4, 0, 0.2, 1)` | Hover 动效原语 |
| 卡片点击 | scale 1→0.95→1(Press 反弹) | 100ms | `cubic-bezier(0.4, 0, 0.6, 1)` | Press 动效原语 |
| 浮卡弹出 | opacity 0→1 + translateY 8→0 | 180ms | `spring(stiffness: 360, damping: 28)` | spring 物理 |
| 浮卡关闭 | opacity 1→0 + translateY 0→4 | 120ms | `cubic-bezier(0.4, 0, 1, 1)` | ease-in |
| 视图切换(Grid↔Dual) | `AnimatePresence` 渐变 + slide | 280ms | `cubic-bezier(0.32, 0.72, 0, 1)` | iOS 风格 |
| 主体 bbox 高亮 | stroke 描边 dashoffset 动画 | 600ms | `linear`(循环) | 类似雷达扫描 |
| 相似度条 | width 0→target% | 500ms | `cubic-bezier(0.65, 0, 0.35, 1)` | ease-in-out |
| 颜色拾色器反馈 | 选中色格 scale 1→1.15 | 150ms | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 弹性 bounce |
| 检索进行中 | 顶部进度条 width 0→90% | 直到响应 | `cubic-bezier(0.4, 0, 0.2, 1)` | 90% 后等响应再 100% |
| 完成回调 | 进度条 width 90%→100% | 200ms | `ease-out` | 平滑收尾 |
| 双栏对照翻转 | rotateY 0→180 | 500ms | `cubic-bezier(0.4, 0, 0.2, 1)` | 3D 卡片效果(可选) |
| SVG bbox 描边 | 虚线动画 dasharray + dashoffset | 800ms | `linear infinite` | 类似"扫描"动画 |
| 详情卡 viewport anchor | position 跟随 + opacity transition | - | - | see `DictionaryCard` viewport-anchor |

**全局守卫**:动效统一受 `usePrefersReducedMotion()` 控制,当 `<html data-motion="off">` 时:
- transform 替换为 opacity
- 时长压至 80ms
- 循环动画(stroke / 进度条)停止

---

## 6. 响应式断点

| 断点 | viewport 宽度 | 列数 | 缩略图尺寸 | 顶部查询栏 | 双栏对照 |
|------|---------------|------|------------|-----------|----------|
| `xl` | `>= 1280px` | 5 列 masonry | 240 × 240 | 完整(pHash / HSV / CLIP / 智谱 都展示) | 左右双栏 50:50 |
| `lg` | `1024 - 1280px` | 4 列 masonry | 200 × 200 | 完整 | 左右双栏 50:50 |
| `md` | `768 - 1024px` | 3 列 masonry | 160 × 160 | 紧凑(筛选器折叠为按钮) | 左右双栏 50:50 |
| `sm` | `< 768px` | 2 列 masonry | 120 × 120 | 极简(只保留查询栏 + 引擎切换) | 上下双栏 各 50vh |

**触摸适配**(`< 1024px`):
- 浮卡模式 → 长按触发(`touchstart` + 600ms timer)
- 双栏切换 → 滑动切换(`onTouchStart` + `onTouchEnd` x 偏移 > 50px)
- 滚动手势 → 瀑布流 100vh 一次加载 2 屏,无限滚动
- hover 状态 → 取消,改用 `active` 状态

**平板适配**(`768 - 1024px`):
- 双栏对照可切为三栏(原图 / 命中图 / 详情卡 同屏)

---

## 7. 可观测指标(`X-ImageSearch-*` 响应头)

| 响应头 | 类型 | 含义 | 示例值 |
|--------|------|------|--------|
| `X-ImageSearch-Layer` | enum | 命中层(L1 / L2 / L3) | `L2` |
| `X-ImageSearch-Top-K` | int | 返回候选数 | `50` |
| `X-ImageSearch-Top-Similarity` | float(0-1) | 最高相似度 | `0.94` |
| `X-ImageSearch-Mean-Similarity` | float(0-1) | 平均相似度 | `0.71` |
| `X-ImageSearch-Latency-L1-Ms` | int | L1 检索耗时 | `780` |
| `X-ImageSearch-Latency-L2-Ms` | int | L2 检索耗时 | `2400` |
| `X-ImageSearch-Latency-L3-Ms` | int | L3 检索耗时 | `3800`(如未触发则缺失) |
| `X-ImageSearch-Engine` | enum | 实际生效引擎(`pHash` / `mobileclip-s0` / `cogvlm-embedding`) | `mobileclip-s0` |
| `X-ImageSearch-Hash-Type` | enum | pHash 算法(`ahash` / `phash` / `dhash` / `whash`) | `phash` |
| `X-ImageSearch-Result-Count` | int | 命中数 | `47` |
| `X-ImageSearch-Filtered-Count` | int | 应用筛选后命中数 | `12` |
| `X-ImageSearch-Cache-Hit` | bool | 是否命中缓存 | `true` / `false` |
| `X-ImageSearch-Audit-Hash` | string | 审计哈希(防滥用) | `sha256:a8f3e9...` |
| `X-ImageSearch-Query-Id` | uuid | 此次检索的追踪 ID | `uuid-v4` |
| `X-ImageSearch-Mode` | enum | 工作模式(`web` / `batch` / `cli`) | `web` |
| `X-ImageSearch-Trace-Id` | uuid | 分布式追踪 ID(可跨服务) | `w3c-traceparent` |

**Console 日志格式**(服务端):
```
[image-search 2026-07-01T14:32:18.231Z] layer=L2 engine=mobileclip-s0 queryId=uuid-v4 latencyMs=1840 topK=50 resultCount=47 topSim=0.94 audit=sha256:a8f3e9
```

**Console 日志格式**(客户端):
```
[image-search-client 2026-07-01T14:32:18.231Z] event=search_start queryId=uuid-v4 inputSize=1920x1080 inputBytes=2345678
[image-search-client 2026-07-01T14:32:19.012Z] event=search_done queryId=uuid-v4 layer=L2 latencyMs=781 resultCount=47 userClick=hit_03
[image-search-client 2026-07-01T14:32:21.520Z] event=hit_view queryId=uuid-v4 hit=hit_03 similarity=0.94 dwellMs=2508
```

**Prometheus 指标**( `/metrics`):
- `image_search_requests_total{layer, engine, status}` Counter
- `image_search_latency_seconds{layer, engine}` Histogram
- `image_search_result_count{layer}` Histogram
- `image_search_top_similarity{layer}` Histogram
- `image_search_cache_hit_ratio` Gauge

---

## 8. 深色模式(semantic token 用法)

**核心策略**:`[data-theme="dark"]` 下,所有颜色通过语义层别名映射,无需改组件代码。

| 浅色 token | 深色对应 | 用途 |
|-----------|---------|------|
| `--color-bg-base` `#FFFFFF` | `[data-theme="dark"] --color-bg-base` `#0A0E1A` | 主背景 |
| `--color-bg-elevated` `#F7F8FA` | `[data-theme="dark"] --color-bg-elevated` `#161B2C` | 卡片背景 |
| `--color-bg-overlay` `rgba(255,255,255,0.92)` | `[data-theme="dark"] --color-bg-overlay` `rgba(10,14,26,0.92)` | 浮卡 / 面板 |
| `--color-border-subtle` `#E5E7EB` | `[data-theme="dark"] --color-border-subtle` `#1F2538` | 卡片边框 |
| `--color-text-primary` `#0F1B2D` | `[data-theme="dark"] --color-text-primary` `#E6E9F0` | 主文字 |
| `--color-text-secondary` `#6B7280` | `[data-theme="dark"] --color-text-secondary` `#9CA3AF` | 次文字 |
| `--color-primary` `#1677FF` | `[data-theme="dark"] --color-primary` `#4096FF`(更亮,深色下提升对比度) | 主题蓝 |
| `--color-confidence-high` `#10B981` | 不变 | 相似度高(绿) |
| `--color-confidence-mid` `#F59E0B` | 深色下 → `#FBBF24` | 相似度中(黄) |
| `--color-confidence-low` `#EF4444` | 深色下 → `#F87171` | 相似度低(红) |
| `--color-bbox-stroke` `#4285F4`(命中区域描边) | 深色下 → `#60A5FA` | Google 蓝提升亮度 |

**关键深色模式细节**:
- 缩略图加 `1px` 浅色描边(`border: 1px solid var(--color-border-subtle)`)避免深色背景"吃"图
- 浮卡背景从 `rgba(255,255,255,0.96)` 自动切到 `rgba(10,14,26,0.96)`
- bbox 高亮描边宽度深色下提升到 `3px`(浅色 2px)
- 相似度条颜色:`hue-rotate()` 计算在深色模式下 +20°,避免偏暗
- 暗色 → 浅色过渡:`view-transition`(CSS native)250ms 渐变

**主题切换流程**:
1. 用户点击 `<ThemeToggle>`(`web/src/components/ThemeToggle.tsx` 已存在)
2. `useTheme()` hook 改 `<html data-theme>` 属性
3. CSS 变量级联刷新,所有组件在 50ms 内(`<html style="transition: background 250ms">`)平滑过渡

---

## 9. KPI 基线

### 9.1 性能指标(冷启动 / 缓存命中分别测量)

| 指标 | 目标 | 警戒 | 不可接受 |
|------|------|------|----------|
| **L1 pHash 检索 P50** | < 800ms | < 1.2s | ≥ 2s |
| **L1 pHash 检索 P95** | < 1.5s | < 2.0s | ≥ 3.5s |
| **L1 pHash 检索 P99** | < 2.5s | < 4.0s | ≥ 6s |
| **L2 MobileCLIP 检索 P50** | < 2.0s | < 3.0s | ≥ 5s |
| **L2 MobileCLIP 检索 P95** | < 3.5s | < 4.5s | ≥ 7s |
| **L2 MobileCLIP 检索 P99** | < 5.0s | < 7.0s | ≥ 10s |
| **L3 智谱 fallback P50** | < 4.0s | < 6.0s | ≥ 9s |
| **双栏对照加载 P95** | < 800ms | < 1.5s | ≥ 3s |
| **瀑布流滚动 FPS**(60 张/屏) | ≥ 55 FPS | ≥ 45 FPS | < 30 FPS |
| **输入到结果首屏 TTI** | < 3.5s | < 5s | ≥ 8s |
| **Memory 占用**(加载 200 张缩略图) | < 250 MB | < 400 MB | ≥ 600 MB |

### 9.2 准确率指标

| 指标 | 目标 | 警戒 | 备注 |
|------|------|------|------|
| **L1 pHash Top-5 视觉一致率** | ≥ 65% | ≥ 50% | 同图 / 旋转 / 镜像 |
| **L2 CLIP Top-5 语义一致率** | ≥ 80% | ≥ 65% | 主体一致 |
| **L3 智谱 Top-5 语义一致率** | ≥ 90% | ≥ 75% | 多模态理解 |
| **整体链路 Top-5 一致率** | ≥ 85% | ≥ 70% | 真实用户测试 |
| **用户首次点击率**(CTR@1) | ≥ 40% | ≥ 25% | 是否点 Top-1 |
| **用户翻页率**(找到满意图后) | ≤ 3 次 | ≤ 5 次 | 检索效率 |
| **误报率**(用户标记"无关") | ≤ 5% | ≤ 12% | 质量底线 |
| **主体识别准确率**(CLIP 输出) | ≥ 75% | ≥ 60% | bbox IoU > 0.5 |

### 9.3 用户体验指标

| 指标 | 目标 | 警戒 |
|------|------|------|
| **新用户引导完成率** | ≥ 80% | ≥ 60% |
| **次月留存率** | ≥ 60% | ≥ 40% |
| **检索使用频次**(周) | ≥ 8 次 | ≥ 3 次 |
| **平均会话时长** | ≥ 4 min | ≥ 1.5 min |
| **详情卡点击率** | ≥ 35% | ≥ 20% |
| **加入队列转化率** | ≥ 12% | ≥ 5% |
| **NPS**(用户净推荐值) | ≥ 50 | ≥ 30 |
| **键盘快捷键使用率** | ≥ 25%(重度用户) | - |

### 9.4 可观测性指标

| 指标 | 目标 |
|------|------|
| **响应头覆盖率** | 100%(`X-ImageSearch-*` 全部字段) |
| **Timeline 写入成功率** | ≥ 99.9% |
| **缓存命中率**(重复检索) | ≥ 40% |
| **错误告警响应时间** | < 5 min(PagerDuty) |
| **审计日志完整性** | 100%(每请求带 hash) |

---

## 10. 实施 Checklist(为 TDD 提供输入)

### 10.1 单元测试(≥ 12 项)

1. `useImageSearch.query 应当发送 POST /api/image-search/search`(TDD 红 → 绿)
2. `useImageSearch 不应当重发 in-flight 请求`(in-flight dedup)
3. `masonry layout 在 5 列下应当不重叠`
4. `ImageRegionSvgOverlay.bbox 应当按 similarity 着色`
5. `ImageRegionSvgOverlay testid === 'image-search-bbox-N'`(命名空间隔离)
6. `DictionaryCard viewport-anchor 应当 clamp 在视口内`
7. `ConfidenceDot similarity=0.94 应当为绿色`
8. `ConfidenceDot similarity=0.50 应当为黄色`
9. `颜色 16 宫格拾色器选择后应当触发回调`
10. `形状筛选 horizontal-only 应当过滤命中`
11. `键盘 `R` 应当触发 useImageSearch.refetch`
12. `键盘 `V` 应当切换视图模式`

### 10.2 E2E 测试(≥ 4 项)

1. `reverse-image-search.spec.ts` — 拖图 → 等待结果 → 点击命中 → 双栏对照(bbox 高亮)
2. `reverse-image-search-filters.spec.ts` — 应用颜色筛选 → 结果数减少 → 清除筛选 → 还原
3. `reverse-image-search-batch.spec.ts` — 多图同时检索 → 跨图对比(主体一致)
4. `reverse-image-search-keyboard.spec.ts` — `R` 重新检索 / `V` 切换视图 / `F` 收藏 / `←→` 导航

### 10.3 视觉回归测试(≥ 2 项)

1. `reverse-image-search-spec.ts-snapshots/grid-mode.png`
2. `reverse-image-search-spec.ts-snapshots/dual-mode.png`

### 10.4 性能基准测试(可选)

`web/scripts/bench-image-search.mjs` — 50 张测试图 × 3 层 / 10 次重复,验证 P50 / P95 / P99 达标

---

## 11. 复用资产清单

| 已有组件 / Hook | 本模式用途 |
|----------------|----------|
| `ImageDualView.tsx`(已有,支持三视图) | 双栏对照模式直接复用 |
| `ImageRegionSvgOverlay.tsx`(已有,testIdPrefix 兼容) | 命中区域 bbox 高亮;`testIdPrefix="image-search"` 隔离命名空间 |
| `ImageBatchQueue.tsx`(已有) | 结果网格 / 队列复用 |
| `DictionaryCard.tsx`(已有,viewport-anchor) | 详情卡复用 |
| `ConfidenceDot.tsx`(已有) | 相似度点复用 |
| `useImageBatch.ts`(已有) | 批处理 hook 复用 |
| `useWorkspaceTimeline.ts`(已有) | kind='image-search' 写入 |
| `Hover/Press/PageTransition`(已有动效原语) | 交互动效复用 |
| `MotionProvider`、`usePrefersReducedMotion`(已有) | 全局动效开关 |
| `tokens.ts`(已扩展 semantic + dark) | 颜色 / 间距 / 字号复用 |
| `palette/sources/`(已注册 5 种) | `image-search` 加入 navigation source |

---

## 12. 不在本子模式范围内的内容

- 全局截图识别 → 见 `02-screenshot-assistant.md`
- 跨文件图谱追溯 → 见 `03-cross-doc-trace.md`
- 视觉 diff 对比 → 见 `04-visual-diff.md`
- 智能聚类 → 见 `05-clustering.md`
- 图片 Translation Memory → 见 `06-image-tm.md`

---

> **声明**:
> - **模型**:claude-sonnet-4-6
> - **调研基础**:1) Google Lens / Pinterest / 淘宝拍立淘 / Eagle / TinEye 官方文档与公开 UX 拆解;2) 截至 2026-01 模型知识库;3) 项目 memory(`web/src/components/Image*.tsx`、`useImageBatch.ts` 等已有组件 / hook 行为模式);4) 项目既有 design tokens 体系(`design/primitives.ts`、`design/semantic.ts`、`dark.css`)。
> - **限制**:WebSearch / WebFetch 在当前会话中持续返回 API 错误 400,所有引用均为知识库沉淀的二次信息,建议下游人工核验:
>   - Google Lens 端到端延迟(< 200ms) — 实测可能 300-500ms
>   - Pinterest 30 亿次/月 — 数字为公开宣传值
>   - 淘宝 pHash + ResNet-50 双塔结构 — 内部技术,可能略有出入
>   - MobileCLIP-S0 嵌入维度(512) — 官方为多版本(S0/S1/S2),S0 默认 512
>   - 配色 hex 值 — 均为行业最常用近似值,以最终视觉走查为准
