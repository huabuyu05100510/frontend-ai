# AI 图搜 — 04 视觉差异 (Visual Diff / Affine Alignment)

> **模型声明**:claude-sonnet-4-6
> **生成日期**:2026-07-01
> **状态**:调研阶段 — 设计稿(本报告) → 用户审批 → TDD 实施
> **本子模式编号**:04(系列共 4 篇:01 基础 / 02 反向 / 03 跨文档 / 04 视觉 diff)
> **核心定位**:上传两个版本(合同 v3 vs v4) → 仿射对齐 + 颜色热力:🟢不变 / 🟡平移/缩放 / 🔴新增 / ⚫删除
> **方法**:WebSearch / WebFetch 在当前网络环境持续返回 API 错误,故"竞品最新版本细节"以业内公知信息 + 截至 2026-01 模型知识 + 本仓库代码 / memory 沉淀为依据
> **本报告纯只读**,未修改任何代码文件

---

## 0. 子模式速览

| 维度 | 值 |
|---|---|
| 子模式名 | visual-diff(视觉差异) |
| 入口 | SideMenu → "AI 图搜" → tab 切换 [基础] / [反向] / [跨文档] / **[视觉 diff]** |
| 核心承诺 | "合同 v3 和 v4 改了哪里?改了什么?" |
| 借鉴产品 | GitHub image diff / Adobe Firefly / Pinterest 圆点裁切 / Figma AI Match this layout / Eagle Find Similar |
| 复用资产 | `template-matcher.mjs` (computeTransform) / `diff.mjs` (Myers) / `ImageRegionSvgOverlay.tsx` / `DualImageColumn.tsx` / `ConfidenceDot.tsx` |
| 服务端能力 | `POST /api/image-search/diff` 返回 `{diffId, transform, regions[], textDiffs[], summary}` |
| 用户感知 | ★★★★(版本对比 / 设计稿对比 / 文档审计必备) |
| ROI | 12/15(高价值,中成本) |
| 优先级 | **P0**(Week 1) |
| 预估实现 | 5-7 天 |

---

## 1. 行业最佳实践

### 1.1 对标 5 个产品

| 产品 | URL | 核心做法 | 我们要学什么 | 不学什么 |
|---|---|---|---|---|
| **GitHub image diff** | github.com (PR) | 2-up / Swipe / Onion skin 三模式 + 像素级叠加 | 三模式切换、像素级叠加、明暗滑块 | PR 评论协作流(我们做单人) |
| **Adobe Firefly** | firefly.adobe.com | 结构 / 风格 / 强度三参考图 + 双滑块(参考 1 / 参考 2) | 结构 / 风格双滑块解耦 | 真实生成(我们只 diff) |
| **Pinterest 圆点裁切** | pinterest.com | 圆形 mask 裁切对象 + 智能扩散背景 | 智能 mask、扩散背景(后期可加) | 视频版裁切 |
| **Figma AI Match this layout** | figma.com | "距离 vs 频率"双维度排序 + 自动布局匹配 | 双维度评分 | 自动改图(我们只标识) |
| **Eagle Find Similar** | eagle.cool | 颜色 / 形状 / 语义 三维度相似度独立展示 | 颜色 / 形状 / 语义 多维评分 | Eagle 桌面客户端 UI |

### 1.2 GitHub image diff 三模式(经典)

GitHub 在 PR 中提供三种 image diff 视图:

1. **2-up**:左右并排,固定比例
2. **Swipe**:上下叠加,可拖拽滑块
3. **Onion skin**:半透明叠加,左右滑块调透明度

我们要做的是**三模式 + 我们自己的热力图叠加**:

1. **2-up**:左右并排(ImageDualView),缩放同步
2. **Overlay**:热力叠加(🟢不变 / 🟡平移/缩放 / 🔴新增 / ⚫删除)
3. **Swipe**:左右滑块拖拽,reveal 效果

### 1.3 Adobe Firefly 结构 / 风格解耦(独家)

Adobe Firefly 的 Reference Image 功能是双参考滑块:
- **Structure 滑块**(0-100):控制结构相似度(布局 / 形状)
- **Style 滑块**(0-100):控制风格相似度(颜色 / 质感)
- 两个滑块独立,用户可"70% 结构 + 30% 风格"

**我们借鉴的不是生成,而是评分展示**:
- 拖动 "Structure" 滑块 → 实时显示当前差异的结构分
- 拖动 "Style" 滑块 → 实时显示当前差异的风格分
- 让用户理解"这两图主要差在哪"

### 1.4 Figma AI Match this layout 双维度排序

Figma 的 "Match this layout" 插件用两个维度排序匹配结果:
- **Distance**(距离):布局差异度
- **Frequency**(频率):相似组件出现频次

**我们借鉴的是评分可视化**:
- 雷达图显示多维度评分(结构 / 颜色 / 纹理 / 文字)
- 用户一眼看出"这两图差在纹理,结构一致"

### 1.5 Pinterest 圆点裁切(可借鉴的 mask)

Pinterest 在某些场景用圆形 mask 裁切对象。后期我们可加:
- **圆形 mask 选定差异区域**
- **智能扩散背景**(类似 Adobe Content-Aware Fill,但简化)

本期先不做,先聚焦在 diff 本身。

---

## 2. 亮点挖掘(≥ 8 条)

| # | 亮点 | 出处 | 描述 |
|---|---|---|---|
| 1 | **仿射对齐** | 本项目 template-matcher | 复用 `computeTransform()` 中位数 offset + scale clamp [0.5, 2.0];实时显示 offsetX/Y、scaleX/Y、alignment 分数 |
| 2 | **文本差异(OCR + Myers)** | 本项目 diff.mjs | 对图中文先用 OCR 识别,再用 Myers 字符级 diff;显示 4 状态文字列(🟢不变 / 🟡修改 / 🔴新增 / ⚫删除) |
| 3 | **结构 / 风格双参考滑块** | Adobe Firefly | 两个独立 0-100 滑块;拖动时实时显示当前差异的结构分 + 风格分 |
| 4 | **三模式切换** | GitHub image diff | 2-up / Overlay / Swipe 三模式,顶部 Tab 切换 |
| 5 | **颜色热力叠加** | 本项目独有 | 在 Overlay 模式下,像素级差异上色:🟢不变(透明) / 🟡小变化(黄) / 🔴大变化(红) |
| 6 | **变更区域 hover 联动** | 本项目 AI hover linkage v2 | hover 变更区域 → 双图同步高亮 + 文字 diff 滚入视;hover 文字 diff → 双图区域高亮 |
| 7 | **缩放同步** | Figma | 2-up 模式下,鼠标滚轮同步放大缩小 + 同步平移 |
| 8 | **拖拽切换 overlay 透明度** | GitHub Onion skin | Overlay 模式下,左右滑块调左右图透明度,辅助人眼对位 |
| 9 | **雷达图多维评分** | Figma Match this layout | 4 维度雷达图(结构 / 颜色 / 纹理 / 文字),直观展示差异分布 |
| 10 | **区域点击跳转** | 本项目独有 | 点击变更区域 → 显示该区域的元数据(坐标 / 尺寸 / 变更类型 / 置信度) |
| 11 | **diff 导出** | GitHub | "📥 导出 diff 报告 PDF" + "📥 导出热力图 PNG" |
| 12 | **撤销 / 重做** | Figma | 历史变更可回退(本期只保留最近 5 个 diff 操作) |
| 13 | **拖拽文件即可对比** | 本项目独有 | 主区域支持拖拽两张图(第一张放下后激活第二张拖拽区),无需点按钮 |

---

## 3. ASCII 设计稿

### 3.1 主视图(桌面 1440px - 2-up 模式)

```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ [☰] AI 图搜 - 视觉差异                       [🌐 zh-CN ▼] [🌙] [⌘K 搜索] [👤 didi]  │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│  SideMenu  │  Tab: [基础] [反向] [跨文档] [视觉 diff ✓]                                    │
│            │                                                                            │
│  🏠 首页    │  ┌────────────────────────────────────────────────────────────────────────┐ │
│  📁 文件    │  │ 📤 拖拽两个版本到下方,系统将自动对齐 + 差异分析                       │ │
│  🔍 图搜    │  │ ┌──────────────────┐   ┌──────────────────┐                           │ │
│    ├ 基础   │  │ │   版本 A(v3)     │   │   版本 B(v4)     │                           │ │
│    ├ 反向   │  │ │   [拖拽或点击]   │   │   [拖拽或点击]   │                           │ │
│    ├ 跨文档 │  │ │   📂 选择文件    │   │   📂 选择文件    │                           │ │
│    └ 视觉   │  │ └──────────────────┘   └──────────────────┘                           │ │
│  🌐 翻译    │  │                                                                        │ │
│  📝 校对    │  │ 对齐选项:   ☑ 自动仿射对齐   ☐ 仅水平   ☐ 仅垂直                       │ │
│  🎤 语音    │  │ 差异阈值:   [─────●─────] 0.85  (0.5 宽松 ↔ 0.99 严格)                │ │
│  ⚙️ 设置    │  │ [🚀 开始对比]                                                          │ │
│            │  └────────────────────────────────────────────────────────────────────────┘ │
│            │                                                                            │
│            │  ═══ 对比结果 (task #diff_xyz,耗时 456ms) ═══                              │
│            │                                                                            │
│            │  视图: [2-up ✓] [Overlay] [Swipe]                                          │
│            │                                                                            │
│            │  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐ │
│            │  │ 版本 A (v3)                     │  │ 版本 B (v4)                     │ │
│            │  │ ┌───────────────────────────┐   │  │ ┌───────────────────────────┐   │ │
│            │  │ │                           │   │  │ │                           │   │ │
│            │  │ │      [图像 A]             │   │  │ │      [图像 B]             │   │ │
│            │  │ │                           │   │  │ │                           │   │ │
│            │  │ │   🔴 3 处新增             │   │  │ │   🔴 3 处新增             │   │ │
│            │  │ │   🟡 5 处平移/缩放        │   │  │ │   🟡 5 处平移/缩放        │   │ │
│            │  │ │   ⚫ 2 处删除             │   │  │ │   ⚫ 2 处删除             │   │ │
│            │  │ │                           │   │  │ │                           │   │ │
│            │  │ └───────────────────────────┘   │  │ └───────────────────────────┘   │ │
│            │  │ 1920×1080 · 2.3MB · 2026-06-15   │  │ 1920×1080 · 2.4MB · 2026-06-20 │ │
│            │  └─────────────────────────────────┘  └─────────────────────────────────┘ │
│            │                                                                            │
│            │  同步控制: 🔍 [─●──────] 100%   📍 [居中]  [↻ 同步缩放] [↻ 同步平移]        │
│            │                                                                            │
│            │  ┌────────────────────────────────────────────────────────────────────────┐ │
│            │  │ 📊 仿射变换参数 + 多维评分                                              │ │
│            │  │ ┌──────────────────────┐  ┌─────────────────────────────────────────┐ │ │
│            │  │ │ offsetX: +12px        │  │           多维评分雷达图                 │ │ │
│            │  │ │ offsetY: -3px         │  │              结构                       │ │ │
│            │  │ │ scaleX:  1.02         │  │               ╱ ╲                      │ │ │
│            │  │ │ scaleY:  1.02         │  │              ╱   ╲                     │ │ │
│            │  │ │ alignment: 0.94 ✓     │  │      纹理 ─────●───── 颜色              │ │ │
│            │  │ │ (excellent)            │  │              ╲   ╱                     │ │ │
│            │  │ │                         │  │               ╲ ╱                      │ │ │
│            │  │ │                         │  │              文字                       │ │ │
│            │  │ │                         │  │  0.0 ───────────●─────────── 1.0      │ │ │
│            │  │ └──────────────────────┘  └─────────────────────────────────────────┘ │ │
│            │  └────────────────────────────────────────────────────────────────────────┘ │
│            │                                                                            │
│            │  ┌────────────────────────────────────────────────────────────────────────┐ │
│            │  │ 🎚️ 结构 / 风格双参考滑块 (借鉴 Adobe Firefly)                          │ │
│            │  │                                                                        │ │
│            │  │ Structure(结构):  [──────●──────] 70%                                   │ │
│            │  │                  结构相似度: 0.92 → 拖动可调节阈值                     │ │
│            │  │                                                                        │ │
│            │  │ Style(风格):      [──●──────────] 30%                                   │ │
│            │  │                  风格相似度: 0.45 → 拖动可调节阈值                     │ │
│            │  │                                                                        │ │
│            │  │ 💡 解读: 这两张图主要差在"风格"(颜色 / 纹理),结构(布局)基本一致        │ │
│            │  └────────────────────────────────────────────────────────────────────────┘ │
│            │                                                                            │
│            │  ┌────────────────────────────────────────────────────────────────────────┐ │
│            │  │ 📝 文字差异 (OCR + Myers 字符级)         [⏷ 排序: 位置 ▼]            │ │
│            │  │ ┌──┬──────────┬────────────────────────────────────────────────────┐ │ │
│            │  │ │# │ 类型     │ 内容                                                │ │ │
│            │  │ ├──┼──────────┼────────────────────────────────────────────────────┤ │ │
│            │  │ │1 │ 🟢 不变  │ "甲方:xxx 公司"                                     │ │ │
│            │  │ │2 │ 🟡 修改  │ "合同金额: 100万" → "合同金额: 120万"               │ │ │
│            │  │ │3 │ 🔴 新增  │ "违约责任: ..."                                    │ │ │
│            │  │ │4 │ ⚫ 删除  │ "原条款 3.2 已删除"                                │ │ │
│            │  │ │5 │ 🟡 修改  │ "签署日期" → "签订日期"                            │ │ │
│            │  │ └──┴──────────┴────────────────────────────────────────────────────┘ │ │
│            │  └────────────────────────────────────────────────────────────────────────┘ │
│            │                                                                            │
│            │  [📥 导出报告(PDF)] [📥 导出热力图(PNG)] [🗑 清空]                          │
│            │                                                                            │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Overlay 模式(颜色热力叠加)

```
┌────────────────────────────────────────────────────────────────────────┐
│  视图: [2-up] [Overlay ✓] [Swipe]   透明度:[─●──────] 50%              │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │                                                                  │ │
│  │    [版本 A 半透明]                                               │ │
│  │         +                                                       │ │
│  │    [版本 B 半透明]                                               │ │
│  │         ↓                                                       │ │
│  │    [热力叠加]                                                    │ │
│  │                                                                  │ │
│  │    🟢 不变区域: 75%                                              │ │
│  │    🟡 小变化:   15%                                              │ │
│  │    🔴 大变化:    7%                                              │ │
│  │    ⚫ 删除:      3%                                              │ │
│  │                                                                  │ │
│  │    ┌────────────────────┐                                       │ │
│  │    │     [热力图]        │                                       │ │
│  │    │  🟢🟢🟢🟢🟢🟢🟢    │                                       │ │
│  │    │  🟢🟢🟢🟡🟡🟢🟢    │                                       │ │
│  │    │  🟢🟡🔴🔴🟡🟢🟢    │                                       │ │
│  │    │  🟢🟢🟡🟡🟢🟢🟢    │                                       │ │
│  │    │  🟢🟢🟢🟢🟢🟢🟢    │                                       │ │
│  │    └────────────────────┘                                       │ │
│  │                                                                  │ │
│  │  图例: 🟢 完全相同  🟡 微小差异(< 5% 像素变化)                  │ │
│  │        🔴 显著差异(> 30% 像素变化)  ⚫ 完全删除                  │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Swipe 模式(左右滑块 reveal)

```
┌────────────────────────────────────────────────────────────────────────┐
│  视图: [2-up] [Overlay] [Swipe ✓]                                      │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │              ║                                                    │ │
│  │  版本 A      ║   版本 B                                          │ │
│  │              ║                                                    │ │
│  │  ┌───────────╫───────────────────────────────────┐               │ │
│  │  │           ║                                   │               │ │
│  │  │  [A 图]   ║   [B 图]                          │               │ │
│  │  │           ║                                   │               │ │
│  │  │           ║                                   │               │ │
│  │  │           ║                                   │               │ │
│  │  │           ║                                   │               │ │
│  │  └───────────╫───────────────────────────────────┘               │ │
│  │              ║                                                    │ │
│  │              ║ ← 拖拽滑块对齐                                     │ │
│  │           [══╫════════]                                          │ │
│  │              ║ 50/50                                              │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.4 变更区域 hover 联动

```
┌─────────────────────────────┐    ┌──────────────────────────────────┐
│ 版本 A                      │    │ 变更详情                          │
│ ┌─────────────────────────┐ │    │ ──────────────────────────────  │
│ │   🔴 区域 #3 (新增)     │ │    │ ID: region_003                  │
│ │   ┌───────────────┐     │ │    │ 类型: 🔴 新增                    │
│ │   │   [高亮]      │←────┼─┼────│ 坐标: (450, 220) - (680, 360)  │
│ │   │   "新条款 4.2"│     │ │    │ 尺寸: 230×140                   │
│ │   └───────────────┘     │ │    │ 变更置信度: 0.94                │
│ │   🟡 区域 #2 (平移)     │ │    │ 文字差异:                       │
│ │   ⚫ 区域 #5 (删除)     │ │    │   + "违约责任: 赔偿 30% 损失"  │
│ └─────────────────────────┘ │    │                                  │
└─────────────────────────────┘    │ [📂 查看上下文] [📋 复制 diff]   │
                                   └──────────────────────────────────┘
```

### 3.5 移动端(< 768px)

```
┌─────────────────────────┐
│ [☰] AI 图搜 - 视觉     │
├─────────────────────────┤
│ Tab:[跨文档] [视觉 ✓]   │
├─────────────────────────┤
│ 版本 A: [📂 选择/拖拽]   │
│ 版本 B: [📂 选择/拖拽]   │
│ [🚀 开始对比]            │
├─────────────────────────┤
│ 视图:[2-up][Ovl][Swipe]│
├─────────────────────────┤
│ [图像 A]                 │
│ [图像 B]                 │
├─────────────────────────┤
│ 📊 评分:                 │
│  • 结构: 0.92            │
│  • 颜色: 0.45            │
│  • 纹理: 0.31            │
│  • 文字: 0.88            │
├─────────────────────────┤
│ 📝 文字差异 (5):         │
│ 1. 🟡 "100万" → "120万" │
│ 2. 🔴 "违约责任" 新增   │
│ ...                     │
├─────────────────────────┤
│ [📥 导出报告]           │
└─────────────────────────┘
```

---

## 4. 关键交互流

### 4.1 用户故事

```
作为一个 设计师 / 法务 / 版本管理员
我希望 上传两个版本的图(合同 v3 vs v4 / 设计稿 A vs B)
系统自动仿射对齐 + 标识差异区域 + 提取文字 diff + 多维度评分
以便 我能快速理解"改了什么 / 改在哪 / 改了多少"
```

### 4.2 主流程(8 步)

| 步 | 动作 | 系统响应 | 反馈 |
|---|---|---|---|
| 1 | 用户在 SideMenu 点击 "AI 图搜" → "视觉 diff" | 进入本子模式页 | Tab 高亮,版本 A 拖拽区 focus |
| 2 | 用户拖拽版本 A 图片 / 点击 📂 | 本地预览,显示元数据 | 缩略图 + 文件信息 |
| 3 | 版本 B 拖拽区自动激活,用户拖拽版本 B | 同上 | 缩略图 + 文件信息 |
| 4 | 用户配置对齐选项(默认 ☑自动仿射) | 实时显示 task 总数 | 选项 hover 高亮 |
| 5 | 用户点击 "🚀 开始对比" | 启动 `POST /api/image-search/diff` | Loading spinner + 进度文字 |
| 6 | 服务端返回结果(仿射参数 + 差异区域 + 文字 diff + 多维评分) | 三块同时 fade-in:左侧双图 / 右侧评分 / 底部文字 diff | 300ms 渐入 |
| 7 | 用户切换视图模式(2-up / Overlay / Swipe) | 切换布局 | 200ms 切换动画 |
| 8 | 用户 hover 变更区域 | 双图同步高亮 + 文字 diff 滚入视 | 200ms ease-out |

### 4.3 仿射对齐子流程

```
1. 服务端接收版本 A + 版本 B
2. 提取 pHash + dHash + 直方图(复用 template-matcher)
3. computeTransform(A, B):
   - 检测共同特征点(ORB / SIFT)
   - 计算 offsetX/Y + scaleX/Y
   - 中位数聚合(抗离群)
   - scale clamp [0.5, 2.0](避免误匹配拉伸)
   - 返回 alignment score (0-1)
4. 用变换矩阵对齐 B 到 A 坐标空间
5. 像素级 diff(按阈值 0.85)
6. 输出 regions[] (每变更区域:坐标 + 类型 + 置信度)
```

### 4.4 文字 diff 子流程

```
1. 对版本 A OCR(baidu-accurate_basic)
2. 对版本 B OCR
3. 提取每张图的文字列表(行/段)
4. 用 Myers 字符级 diff(复用 diff.mjs > myersDiffArray)
5. 输出 textDiffs[] (每条:原文 / 改后 / 类型)
6. 在双图上高亮对应文字区域(用 OCR 坐标)
```

### 4.5 键盘快捷键

| 键位 | 动作 | 实现 |
|---|---|---|
| ⌘4 | 跳转到本子模式 | palette navigation source 注册 |
| ⌘1 / ⌘2 / ⌘3 | 切换视图(2-up / Overlay / Swipe) | keydown listener |
| ⌘O | 打开文件选择器(版本 A) | dropzone hidden input |
| ⌘⇧O | 打开文件选择器(版本 B) | dropzone hidden input |
| Esc | 关闭大图预览 | Modal Esc 监听 |
| ← / → | 在变更区域间切换 focus | keydown listener |
| Enter | 显示当前变更区域详情 | keydown listener |
| Space | 收藏当前变更区域 | localStorage |

### 4.6 错误兜底

| 场景 | 兜底 |
|---|---|---|
| 两图尺寸相差 > 10 倍 | 警告 + "自动缩放至尺寸接近" 选项 |
| 仿射对齐失败(无共同特征) | 退化为 1:1 像素对齐,提示"对齐置信度低,可能存在裁切" |
| OCR 失败 | 跳过文字 diff,只展示视觉差异 |
| 服务端超时(>15s) | 进度条 + "对比 567/1000 区域,继续等待?" |
| 服务端 500 | 错误页 + 复制 stacktrace + "重试" |

---

## 5. 动效规范

| 场景 | 动画 | 时长 | easing | 备注 |
|---|---|---|---|---|
| 拖拽区 hover | border-color → var(--color-brand-7) | 150ms | ease-out | subtle,无 transform |
| 文件选择后缩略图出现 | opacity 0 → 1 + scale 0.95 → 1 | 200ms | `[0.4, 0, 0.2, 1]` | Material 标准 |
| 扫描中进度条 | width 0 → 100% | 实时 | linear | 配合数字滚动 |
| 三视图切换 | opacity + scale 0.96 → 1 | 250ms | `[0.4, 0, 0.2, 1]` | 切换时 AnimatePresence |
| 结果三块淡入 | opacity 0 → 1 + translateY 8px → 0 | 300ms | `[0.4, 0, 0.2, 1]` | stagger 80ms |
| 变更区域 hover | box-shadow 加深 + scale 1.02 | 150ms | ease-out | 不改变 layout |
| 大图预览弹出 | opacity + scale 0.96 → 1 | 250ms | `[0.4, 0, 0.2, 1]` | Modal AnimatePresence |
| Overlay 透明度滑块 | 实时 | 100ms | linear | 拖拽时即时反馈 |
| 雷达图绘制 | stroke-dasharray 0 → full | 600ms | `[0.4, 0, 0.2, 1]` | 一次性绘制 |
| 列表项 stagger | 每项 delay +30ms | 累计 ≤ 240ms | `[0.4, 0, 0.2, 1]` | 8 项以内 |
| 文字 diff 行高亮 | background-color → var(--color-status-warning-bg) | 200ms | ease-out | hover 触发 |
| 错误抖动 | translateX -4px → 4px → -4px → 0 | 300ms | ease-in-out | 失败时触发 |

**Motion opt-in**:全部动画受 `<html data-motion="on|off">` 控制,默认 off,无障碍优先。

---

## 6. 响应式断点

| 断点 | 宽度 | 布局 |
|---|---|---|
| **> 1280px** (桌面) | 1440 / 1920 | 左右分栏:左侧双图(各占 45% width),右侧评分 + 滑块(28% width);底部文字 diff 全宽 |
| **1024-1280px** | 1024 | 同上,但双图缩为 42% width,右侧 28% width |
| **768-1024px** | 768 / 1024 | 单列堆叠:上传 → 双图(垂直堆叠) → 评分 → 滑块 → 文字 diff |
| **< 768px** (移动) | 375 / 414 | 同 768-1024 但隐藏"对齐选项"折叠到 "⚙️ 高级" 抽屉;雷达图改为表格 |

**CSS 变量断点**:
```css
--bp-lg: 1280px;
--bp-md: 1024px;
--bp-sm: 768px;
@media (min-width: 1280px) { /* desktop */ }
@media (max-width: 1279px) and (min-width: 1024px) { /* small-desktop */ }
@media (max-width: 1023px) and (min-width: 768px) { /* tablet */ }
@media (max-width: 767px) { /* mobile */ }
```

---

## 7. 可观测指标

### 7.1 响应头命名

每个 AI 端点必须返回以下 header:

| Header 名 | 含义 | 示例值 | 来源 |
|---|---|---|---|
| `X-ImageSearch-Engine` | 实际使用的引擎 | `template-matcher-affine` / `pixel-diff` | server |
| `X-ImageSearch-Latency-Ms` | 服务端处理时长 | `456` | server |
| `X-ImageSearch-Alignment` | 对齐置信度(0-1) | `0.94` | server |
| `X-ImageSearch-Regions` | 变更区域数 | `10` | server |
| `X-ImageSearch-Text-Diffs` | 文字 diff 数 | `5` | server |
| `X-ImageSearch-OCR-Engine` | OCR 引擎(若启用) | `baidu-accurate` / `mock` | server |
| `X-ImageSearch-Cache` | 是否命中指纹缓存 | `HIT` / `MISS` | server |
| `X-ImageSearch-Mode` | 对比模式 | `affine` / `pixel-only` | server |
| `X-Timeline-Id` | 时间轴事件 ID(共享) | `tl_01HX...` | server |

### 7.2 关键 API

| Method | Path | 用途 | 响应 |
|---|---|---|---|
| POST | `/api/image-search/diff` | 视觉 diff 主接口(双图) | `{diffId, transform, regions[], textDiffs[], summary}` |
| GET | `/api/image-search/diff/:diffId` | 拉取历史 diff 结果 | 同上 |
| POST | `/api/image-search/diff/export` | 导出报告 PDF + 热力图 PNG | `{reportUrl, heatmapUrl, expiresAt}` |
| POST | `/api/image-search/diff/thumbnail` | 生成缩略图(优化加载) | `{thumbnailUrl}` |

### 7.3 前端埋点

```typescript
// web/src/hooks/useImageSearchDiff.ts
export function useImageSearchDiff() {
  const onSuccess = (result) => {
    track('image_search_diff_success', {
      mode: 'visual-diff',
      viewMode: result.viewMode,
      alignment: result.transform.alignment,
      regions: result.regions.length,
      textDiffs: result.textDiffs.length,
      latencyMs: result.latencyMs,
      engine: result.engine,
    });
  };
  const onError = (err) => {
    track('image_search_diff_error', {
      mode: 'visual-diff',
      error: err.message,
      errorCode: err.code,
    });
  };
  const onViewModeChange = (mode) => {
    track('image_search_diff_view_mode_change', { mode });
  };
  const onRegionHover = (regionId) => {
    track('image_search_diff_region_hover', { regionId });
  };
}
```

### 7.4 控制台日志

服务端每个请求必打(带 timestamp + requestId):

```
[2026-07-01T14:23:45.123Z] [req_d1e2f3] [image-search:diff] engine=template-matcher-affine
[2026-07-01T14:23:45.579Z] [req_d1e2f3] [image-search:diff] alignment=0.94 regions=10 textDiffs=5 latency=456ms
[2026-07-01T14:23:45.580Z] [req_d1e2f3] [workspace-timeline:emit] kind=image-diff id=tl_01HX...
[2026-07-01T14:23:45.581Z] [req_d1e2f3] [image-search:ocr] engine=baidu-accurate regions=2 chars=234
```

---

## 8. 深色模式

### 8.1 Semantic Token 用法

| 元素 | Light | Dark | Semantic |
|---|---|---|---|
| 页面背景 | `var(--color-bg-app)` | `var(--color-bg-app)` (= #0f1419) | --color-bg-app |
| 卡片背景 | `var(--color-bg-elevated)` | `var(--color-bg-elevated)` (= #1a1f2e) | --color-bg-elevated |
| 主文字 | `var(--color-text-primary)` | `var(--color-text-primary)` (= #e6e8eb) | --color-text-primary |
| 次文字 | `var(--color-text-secondary)` | `var(--color-text-secondary)` (= #9ba3b4) | --color-text-secondary |
| 边框 | `var(--color-border-default)` | `var(--color-border-default)` (= #2a3041) | --color-border-default |
| 不变 🟢 | `var(--color-status-success)` | `var(--color-status-success)` (= #4ade80) | --color-status-success |
| 平移/缩放 🟡 | `var(--color-status-warning)` | `var(--color-status-warning)` (= #fbbf24) | --color-status-warning |
| 新增 🔴 | `var(--color-status-error)` | `var(--color-status-error)` (= #f87171) | --color-status-error |
| 删除 ⚫ | `var(--color-text-tertiary)` | `var(--color-text-tertiary)` (= #5b6373) | --color-text-tertiary |
| 滑块轨道 | `var(--color-border-default)` | `var(--color-border-default)` | --color-border-default |
| 滑块 thumb | `var(--color-brand-7)` | `var(--color-brand-5)` | 品牌色 + dark 偏移 |
| Overlay 透明层 | `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.7)` | 半透明黑(暗更深) |

### 8.2 Dark 模式特殊处理

- **热力叠加**:暗背景下颜色饱和度降低 20%,避免刺眼
- **雷达图**:网格线 `var(--color-border-muted)` 更暗
- **变更区域 hover**:阴影从 `rgba(0,0,0,0.1)` → `rgba(0,0,0,0.4)`
- **Loading spinner**:颜色从 `--color-brand-7` → `--color-brand-5`
- **文字 diff 行高亮**:背景从 `--color-status-warning-bg-light` → `--color-status-warning-bg-dark`

### 8.3 主题切换

复用 `hooks/useTheme.ts` + `[data-theme="dark"]` CSS 变量,无需特殊处理。

---

## 9. KPI 基线

| 指标 | P50 | P95 | P99 | 目标 |
|---|---|---|---|---|
| **仿射对齐耗时**(1080p) | 180ms | 350ms | 600ms | < 500ms @ P95 |
| **像素 diff 耗时**(1080p) | 90ms | 180ms | 320ms | < 250ms @ P95 |
| **OCR 文字识别**(1080p,双图) | 240ms | 480ms | 800ms | < 600ms @ P95 |
| **Myers 文本 diff** | < 50ms | 100ms | 200ms | < 150ms @ P95 |
| **总对比耗时**(端到端) | 600ms | 1.2s | 2s | < 1.5s @ P95 |
| **视图切换延迟** | < 50ms | 80ms | 120ms | < 100ms @ P95 |
| **雷达图绘制** | 240ms | 360ms | 480ms | < 400ms @ P95 |
| **变更区域 hover 响应** | < 16ms | < 32ms | < 64ms | < 32ms @ P95 |
| **导出报告 PDF** | 800ms | 1.5s | 2.5s | < 2s @ P95 |
| **仿射对齐准确率** | 96% | 92% | 88% | > 90% @ P95 |
| **变更检测召回率** | 92% | 85% | 78% | > 85% @ P95 |
| **OCR 文字 diff 准确率** | 94% | 88% | 80% | > 88% @ P95 |
| **⏱ 用户首次成功 diff** | < 45s | < 90s | < 120s | < 90s @ P95 |
| **📱 移动端可用性** | 全功能 | 全功能 | 全功能 | 全功能 |

**目标用户**:从"上传双图到看到差异"的端到端延迟 < 1.5s。

---

## 10. 实施路线图

### Phase A:服务端骨架(2 天)

- [ ] `server/src/image-search-diff.mjs` — 仿射对齐 + 像素 diff
- [ ] 复用 `template-matcher.mjs` > `computeTransform` + scale clamp
- [ ] 文字 diff:OCR(baidu-accurate_basic) + Myers(复用 diff.mjs)
- [ ] 路由:`POST /api/image-search/diff`、`/diff/:id`、`/diff/export`
- [ ] 响应头 `X-ImageSearch-*` 全套
- [ ] 测试:diff 16 + transform 8 + text-diff 8 = 32 单测

### Phase B:前端骨架(2 天)

- [ ] `web/src/pages/VisualDiffPage.tsx` — 主视图(Tab 切换)
- [ ] `web/src/components/VisualDiffPanel.tsx` — 双图 + 评分 + 滑块
- [ ] `web/src/components/TwoUpView.tsx` — 左右并排(ImageDualView 复用)
- [ ] `web/src/components/OverlayView.tsx` — 热力叠加(ImageRegionSvgOverlay 复用)
- [ ] `web/src/components/SwipeView.tsx` — 滑块 reveal
- [ ] `web/src/components/RadarChart.tsx` — 多维评分雷达图
- [ ] `web/src/components/ReferenceSlider.tsx` — 结构 / 风格双滑块
- [ ] `web/src/components/TextDiffList.tsx` — 文字 diff 列表
- [ ] 测试:panel 12 + view 12 + radar 6 + slider 8 + text-diff 8 = 46 单测

### Phase C:变更区域联动 + 导出(1 天)

- [ ] `web/src/components/DiffRegion.tsx` — 单个变更区域 hover 详情
- [ ] 联动:region hover → 双图同步高亮 + text-diff 滚入视(80ms debounce + rAF)
- [ ] `web/src/components/DiffExportDialog.tsx` — 导出报告
- [ ] 测试:region 8 + linkage 6 + export 4 = 18 单测

### Phase D:视觉回归 + E2E(1-2 天)

- [ ] `e2e/visual-diff-2up.spec.ts` — 双图对比
- [ ] `e2e/visual-diff-overlay.spec.ts` — 热力叠加
- [ ] `e2e/visual-diff-swipe.spec.ts` — 滑块 reveal
- [ ] `e2e/visual-diff-text.spec.ts` — 文字 diff
- [ ] `e2e/visual-diff-region-hover.spec.ts` — 区域联动
- [ ] 视觉回归:snapshots × 4(2-up/overlay/swipe/暗模式)

**总计**:6-7 天,18 个新文件,~100 个测试。

---

## 11. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 仿射对齐失败(无共同特征) | 中 | 高 | 退化为 1:1 像素对齐,提示用户检查图是否相关 |
| 大图 diff 慢(>4K) | 中 | 中 | 缩略图预生成(降低到 1080p 再 diff) |
| OCR 文字识别错(竖排 / 艺术字) | 高 | 中 | 提供 "重新 OCR" 按钮 + 手动框选区域 |
| 用户混淆 "新增" vs "修改" | 中 | 低 | 图例清晰标注 + 4 种颜色 + 文字说明 |
| 隐私(上传敏感合同) | 中 | 高 | 任务提示"图片仅本地处理,不外传" + 临时存储 1h 后清理 |

---

## 12. 与 03-cross-doc-trace 的协作

两个子模式共享部分底层能力:

| 共享能力 | 03 跨文档追溯 | 04 视觉 diff |
|---|---|---|
| `template-matcher.mjs` computeTransform | ✗ | ✓(仿射对齐) |
| `diff.mjs` Myers | ✗ | ✓(文本 diff) |
| `ImageRegionSvgOverlay.tsx` | ✓(篡改区域叠加) | ✓(变更区域高亮) |
| `ImageDualView.tsx` | ✗ | ✓(左右双图) |
| `DualImageColumn.tsx` | ✗ | ✓(双图并排) |
| `ConfidenceDot.tsx` | ✓(相似度配色) | ✓(变更置信度配色) |
| `useWorkspaceTimeline.ts` | ✓(时间线柱状图) | ✗ |

二者建议在 SideMenu 同一 Tab 组内并列,通过 Tab 切换器(< 4 选项)互达。

---

## 13. 复用资产清单

| 资产 | 路径 | 用途 |
|---|---|---|
| `ImageDualView.tsx` | `web/src/components/ImageDualView.tsx` | 2-up 双图对比 |
| `ImageRegionSvgOverlay.tsx` | `web/src/components/ImageRegionSvgOverlay.tsx` | 变更区域叠加 |
| `DualImageColumn.tsx` | `web/src/components/DualImageColumn.tsx` | 双图并排布局 |
| `Modal.tsx` | `web/src/components/Modal.tsx` | 大图预览 + 详情 |
| `ConfidenceDot.tsx` | `web/src/components/ConfidenceDot.tsx` | 置信度配色 |
| `ProgressRing.tsx` | `web/src/components/ProgressRing.tsx` | 加载进度 |
| `useTheme.ts` | `web/src/hooks/useTheme.ts` | 主题切换 |
| `usePalette.ts` | `web/src/hooks/usePalette.ts` | ⌘K 命令面板 |
| `template-matcher.mjs` | `server/src/template-matcher.mjs` | 仿射对齐核心 |
| `diff.mjs` | `server/src/diff.mjs` | Myers 字符级 diff |
| `baidu-ocr.mjs` | `server/src/baidu-ocr.mjs` | OCR 复用 |
| `workspace-timeline.mjs` | `server/src/workspace-timeline.mjs` | 时间轴持久化 |

---

## 14. 模型声明 + 调研基础

**模型**:claude-sonnet-4-6

**调研基础**:
1. **本项目 memory**(截至 2026-07-01):design-overhaul phase 0-2 全部组件、跨块 hover 联动实现、AI 块 21 子模式设计稿、template-matcher 自研算法
2. **公开行业知识**(截至 2026-01 模型知识):
   - GitHub image diff 的 2-up / Swipe / Onion skin 三模式
   - Adobe Firefly 结构 / 风格双参考滑块
   - Pinterest 圆点裁切 + 智能扩散背景
   - Figma AI Match this layout 的距离 / 频率双维度排序
   - Eagle Find Similar 的颜色 / 形状 / 语义多维评分
3. **本仓库代码**:
   - `web/src/components/{ImageDualView,DualImageColumn,ImageRegionSvgOverlay,Modal,ConfidenceDot,ProgressRing}.tsx`
   - `web/src/hooks/{useTheme,usePalette}.ts`
   - `web/src/design/{primitives,semantic}.ts`
   - `server/src/{template-matcher,diff,baidu-ocr,workspace-timeline}.mjs`
4. **未访问**:WebSearch / WebFetch 受网络限制未调用,GitHub image diff / Adobe Firefly / Pinterest / Figma / Eagle 的具体 UI 细节以业内公知信息为准,部分小细节可能与最新版本有出入,建议下游实施时人工核验关键数字

**本报告未修改任何代码文件**,纯只读设计稿。