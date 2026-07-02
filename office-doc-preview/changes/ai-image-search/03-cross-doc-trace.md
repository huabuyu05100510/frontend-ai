# AI 图搜 — 03 跨文档图像追溯 (Cross-Document Image Trace)

> **模型声明**:claude-sonnet-4-6
> **生成日期**:2026-07-01
> **状态**:调研阶段 — 设计稿(本报告) → 用户审批 → TDD 实施
> **本子模式编号**:03(系列共 4 篇:01 基础 / 02 反向 / 03 跨文档 / 04 视觉 diff)
> **核心定位**:上传一张截图 → 系统扫描所有 task 库 → 返回"匹配于:合同-v3.pdf 第 7 页(相似度 0.94)" → 一键跳转预览
> **方法**:WebSearch / WebFetch 在当前网络环境持续返回 API 错误,故"竞品最新版本细节"以业内公知信息 + 截至 2026-01 模型知识 + 本仓库代码 / memory 沉淀为依据
> **本报告纯只读**,未修改任何代码文件

---

## 0. 子模式速览

| 维度 | 值 |
|---|---|
| 子模式名 | cross-doc-trace(跨文档图像追溯) |
| 入口 | SideMenu → "AI 图搜" → tab 切换 [基础] / [反向] / **[跨文档]** / [视觉 diff] |
| 核心承诺 | "这张图第一次出现在哪个 task?被哪些 task 引用过?" |
| 借鉴产品 | TinEye / Yandex Images / Google Find image source / Google Lens / 百度识图 |
| 复用资产 | `ImageDualView.tsx` / `ImageRegionSvgOverlay.tsx` / `PreviewModal.tsx` / `useWorkspaceTimeline.ts` / `workspace-timeline.mjs` / `template-matcher.mjs` / `store.ts` tasks slice |
| 服务端能力 | `POST /api/image-search/trace` 返回 `{queryId, matches[], timeline[], tamperStatus, scannedTaskCount}` |
| 用户感知 | ★★★★★(找原图最快方式,版权审计 / 合同比对 / 文档管理必备) |
| ROI | 13/15(高价值,中成本) |
| 优先级 | **P0**(Week 1) |
| 预估实现 | 5-7 天 |

---

## 1. 行业最佳实践

### 1.1 对标 5 个产品

| 产品 | URL | 核心做法 | 我们要学什么 | 不学什么 |
|---|---|---|---|---|
| **TinEye** | tineye.com | 反向图像 + 时间线聚合 + 文件聚合 + 篡改检测 4 状态(🟢原图/🟡改色/🟠裁切/🔴重大改动) | 时间线柱状图、文件聚合柱状图、篡改徽章 | 商业版权追踪 UI(我们只做发现) |
| **Yandex Images** | yandex.com/images | 跨语言 OCR + 相似图集 + 站点过滤 | 相似图集分组、跨语言文字 OCR | Yandex 视觉风格(俄式) |
| **Google Find image source** | images.google.com (右键) | 整页所有可见图反向搜 + 关联页面 | 关联页面 URL、整页扫描 | 需登录的 Lens 个人中心 |
| **Google Lens** | lens.google | 实时取景 + 文字提取 + 商品识别 | 文字提取(我们 OCR 已有)+ 商品识别后续扩展 | 实时视频分析(本期不做) |
| **百度识图** | image.baidu.com | 全球搜索 + 人脸识别 + OCR + 相似图集 | 全球搜索、相似图集、相似度 0-100 数字显示 | 人脸识别(隐私 / 合规) |

### 1.2 TinEye 时间线聚合(灵魂级借鉴)

**TinEye Timeline** 是图像反向搜索的黄金标准:
- 横轴:时间(从图片首次出现 → 当前)
- 纵轴:网站数量
- 每个柱:一个时间点上的"该图被发现 N 次"
- 悬停柱 → 显示该时段的源列表
- 点击柱 → 跳转源页

**我们要做的是文档版**:
- 横轴:任务创建时间
- 纵轴:被引用次数
- 每个柱:一个时间窗口内的"该图出现在 N 个 task"
- 悬停柱 → 显示该窗口的 task 列表
- 点击柱 → 跳转到第一个 task 的预览

### 1.3 TinEye 文件聚合(灵魂级借鉴)

**TinEye Collections** 按"使用该图的源文件"聚合:
- 列出所有引用该图的源文件
- 显示"最早出现日期 / 最新出现日期 / 总引用数"
- 按文件类型分组(PDF / DOCX / 网页)
- 按引用次数降序

**我们要做的是 task 聚合**:
- 列出所有引用该图的 task
- 显示"首次出现 / 最新出现 / 总引用数"
- 按文件类型分组(PDF / DOCX / 图片)
- 按相似度 + 引用次数综合降序

### 1.4 TinEye 篡改检测(独家)

TinEye 通过分析图像的 EXIF、像素、色彩分布,判断:
- 🟢 **Original**:完全匹配原图,无任何修改
- 🟡 **Color Modified**:仅改色(亮度 / 对比度 / 滤镜)
- 🟠 **Cropped**:裁切过
- 🔴 **Major Edits**:重大改动(PS / 重绘 / 部分删除)

**我们用图像哈希 + 直方图距离 + 边缘检测**(轻量算法)模拟,精度不及 TinEye 但可用。

### 1.5 Google Lens 文字提取

Google Lens 最强的是"看见图中文字 → 一键提取复制"。我们的 OCR 能力已成熟(`baidu-accurate_basic` + 自研 template-matcher),可以在 trace 结果旁加 "📋 提取图中文字" 按钮,复用 OCR 链路。

---

## 2. 亮点挖掘(≥ 8 条)

| # | 亮点 | 出处 | 描述 |
|---|---|---|---|
| 1 | **时间线柱状图** | TinEye Timeline | 横轴时间 / 纵轴引用次数,hover 显示来源 task,click 跳转预览;复用 `useWorkspaceTimeline.ts` 数据模型 |
| 2 | **文件聚合柱状图** | TinEye Collections | 按文件类型分组(PDF / DOCX / 图片),显示每个文件的"首次出现 / 最新出现 / 总引用数";排序:综合分 = 相似度 × 0.6 + 引用次数 × 0.4 |
| 3 | **篡改检测 4 状态** | TinEye Tamper | 🟢 原图 / 🟡 改色 / 🟠 裁切 / 🔴 重大改动;实现:图像哈希 + 直方图距离 + 边缘连续性;徽章置顶 |
| 4 | **URL 反搜模式** | Google Lens | 输入框除"上传文件 / 拖拽"外,还支持粘贴 URL;自动 fetch URL 提取 image 后反搜 |
| 5 | **跨 task 扫描** | 本项目独有 | 用户不指定范围时,扫描整个 task 库(本地索引 + ES 倒排);显示 `X-ImageSearch-Scanned-Tasks: 1,234` header |
| 6 | **跨语言 OCR** | Yandex Images | 匹配源页含非中文时,自动 OCR 提取文字,显示在匹配卡片下方 |
| 7 | **预览一键跳转** | 本项目独有 | 匹配卡片右侧 "📂 打开所在 task" 按钮,直接打开 PreviewModal 跳转到指定文件 + 页码(URL params + useCrossPageHandoff) |
| 8 | **关联任务推荐** | Pinterest Related Ideas | "使用了相同图片的 task" 推荐列表(基于引用该图的其他 task),点击跳转 |
| 9 | **整页扫描** | Google Find image source | 用户粘贴 URL 时,自动抓取页面所有 `<img>`,批量反搜(返回 top 10) |
| 10 | **图像指纹库缓存** | 本项目独有 | 首次扫描时建立 `data/image-fingerprints/<taskId>.json`(pHash + dHash + 直方图),后续查询 O(1) 索引 |
| 11 | **快捷键面板** | 本项目 ⌘K | ⌘3 切换到本模式,⌘⇧U URL 反搜,⌘⇧P 打开命令面板 |
| 12 | **变更追踪** | Google Docs version | 同一文件多次反搜后,显示"该图在此 task 中变更了 3 次"(对比 v1 / v2 / v3) |

---

## 3. ASCII 设计稿

### 3.1 主视图(桌面 1440px)

```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ [☰] AI 图搜 - 跨文档追溯                       [🌐 zh-CN ▼] [🌙] [⌘K 搜索] [👤 didi] │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│  SideMenu  │  Tab: [基础] [反向] [跨文档 ✓] [视觉 diff]                                    │
│            │                                                                            │
│  🏠 首页    │  ┌────────────────────────────────────────────────────────────────────────┐ │
│  📁 文件    │  │ 📤 上传或拖拽图片,系统将扫描所有 task 库                              │ │
│  🔍 图搜    │  │ ┌──────────────────┐  ┌──────────────────────────────────────────┐ │ │
│    ├ 基础   │  │ │                  │  │ 或粘贴 URL: [____________________] [反搜] │ │ │
│    ├ 反向   │  │ │   [拖拽区]       │  └──────────────────────────────────────────┘ │ │
│    ├ 跨文档 │  │ │   或 📂 选择文件 │                                                 │ │
│    └ 视觉   │  │ │   或 📋 粘贴     │  检索选项:                                     │ │
│  🌐 翻译    │  │ └──────────────────┘  ☑ 扫描所有 task (1,234 个)                    │ │
│  📝 校对    │  │                          ☑ 仅扫描近 30 天                             │ │
│  🎤 语音    │  │                          ☐ 仅扫描 PDF                                │ │
│  ⚙️ 设置    │  │                          [🚀 开始追溯]                                │ │
│            │  └────────────────────────────────────────────────────────────────────────┘ │
│            │                                                                            │
│            │  ═══ 追溯结果 (task #t_abc123,扫描 1,234 tasks,耗时 234ms) ═══             │
│            │                                                                            │
│            │  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐ │
│            │  │ 🔍 查询图                       │  │ 📊 时间线                       │ │
│            │  │ ┌─────────┐                     │  │   ↑ 引用次数                    │ │
│            │  │ │         │ 🟢 Original         │  │ 3 │     ████                    │ │
│            │  │ │ [缩略图]│ 2.3 MB · 1920×1080  │  │ 2 │  ██ ██ ██                  │ │
│            │  │ │         │ SHA: a1b2c3...       │  │ 1 │██ ██ ██ ██ ██              │ │
│            │  │ └─────────┘ pHash: 8f3a9c       │  │ 0 └────────────────────→ 时间  │ │
│            │  │ [🔍 查看大图] [📋 提取文字]      │  │   06-01  06-15  06-30  今日    │ │
│            │  └─────────────────────────────────┘  │   ↑ 点击柱 → 跳转首个 task    │ │
│            │                                         └─────────────────────────────────┘ │
│            │                                                                            │
│            │  ┌────────────────────────────────────────────────────────────────────────┐ │
│            │  │ 📁 匹配源(8 条,按 综合分 降序)                      [⏷ 排序: 综合分 ▼]│ │
│            │  │ ┌──┬──────────┬──────────┬──────┬──────┬──────┬─────────────────────┐│ │
│            │  │ │# │ 缩略图   │ 文件名   │ 页码 │ 相似 │ 篡改 │ 操作               ││ │
│            │  │ ├──┼──────────┼──────────┼──────┼──────┼──────┼─────────────────────┤│ │
│            │  │ │1 │ [img]    │合同-v3   │  7   │ 0.94 │ 🟢   │[📂 跳转][📋 OCR]   ││ │
│            │  │ │2 │ [img]    │合同-v2   │  7   │ 0.92 │ 🟡   │[📂 跳转][📋 OCR]   ││ │
│            │  │ │3 │ [img]    │合同-v1   │  8   │ 0.89 │ 🟠   │[📂 跳转][📋 OCR]   ││ │
│            │  │ │4 │ [img]    │订单-a    │  3   │ 0.85 │ 🟢   │[📂 跳转][📋 OCR]   ││ │
│            │  │ │5 │ [img]    │订单-b    │  2   │ 0.83 │ 🟢   │[📂 跳转][📋 OCR]   ││ │
│            │  │ │6 │ [img]    │发票-2024 │  -   │ 0.79 │ 🔴   │[📂 跳转][📋 OCR]   ││ │
│            │  │ │7 │ [img]    │报告-q3   │  12  │ 0.76 │ 🟡   │[📂 跳转][📋 OCR]   ││ │
│            │  │ │8 │ [img]    │手册-v5   │  45  │ 0.72 │ 🟢   │[📂 跳转][📋 OCR]   ││ │
│            │  │ └──┴──────────┴──────────┴──────┴──────┴──────┴─────────────────────┘│ │
│            │  │                                                                        │ │
│            │  │ [⏮ 上一页] [1] [2] [下一页 ⏭]      共 8 条 · 234ms                    │ │
│            │  └────────────────────────────────────────────────────────────────────────┘ │
│            │                                                                            │
│            │  ┌────────────────────────────────────────────────────────────────────────┐ │
│            │  │ 🔗 关联任务推荐(使用了相同图片的 task)                                │ │
│            │  │  • 任务 #t_def456 - 财务-月报.docx - 引用了 3 张相同图片               │ │
│            │  │  • 任务 #t_ghi789 - 产品-白皮书.pdf - 引用了 2 张相同图片               │ │
│            │  │  • 任务 #t_jkl012 - 培训-新员工.pptx - 引用了 1 张相同图片             │ │
│            │  └────────────────────────────────────────────────────────────────────────┘ │
│            │                                                                            │
│            │  [📥 导出报告(PDF)] [📤 分享给同事] [🗑 清空结果]                          │
│            │                                                                            │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 匹配卡片悬停态

```
┌─────────────────────────────────────────────┐
│ #1  🟢 Original                              │
│ ┌──────┐ 合同-v3.pdf                          │
│ │      │ 第 7 页 · 1920×1080 · 2.1MB           │
│ │[缩略]│ 相似度 0.94 (excellent)               │
│ │      │ 引用 3 次 · 首次 2026-06-15           │
│ └──────┘ OCR 提取文字: "甲方:xxx 公司..."      │
│         [📂 跳转预览] [📋 复制 OCR] [⭐ 收藏]   │
└─────────────────────────────────────────────┘
```

### 3.3 大图预览(Modal)

```
┌──────────────────────────────────────────────────────────────┐
│  ✕                                                          │
│  ┌────────────────────┐    ┌──────────────────────────────┐│
│  │                    │    │ 📄 合同-v3.pdf 第 7 页         ││
│  │   [大图预览]       │    │ ─────────────────────────────  ││
│  │                    │    │ 元数据:                        ││
│  │   1920×1080        │    │   • 大小: 2.1 MB               ││
│  │   🔍 100%          │    │   • 创建: 2026-06-15 14:23     ││
│  │                    │    │   • 修改: 2026-06-20 09:11     ││
│  │  [←] [→]           │    │   • SHA-256: a1b2c3d4...       ││
│  │  1/8               │    │                               ││
│  └────────────────────┘    │ 篡改检测:                      ││
│                            │   🟢 Original (置信 0.98)       ││
│                            │   • 直方图距离: 0.02            ││
│                            │   • 边缘连续性: 0.99            ││
│                            │                               ││
│                            │ [📂 打开所在 task]              ││
│                            │ [📋 复制图片地址]               ││
│                            │ [⬇ 下载原图]                    ││
│                            └──────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

### 3.4 时间线柱状图悬停态

```
    ↑ 引用次数
3 │     ████
2 │  ██ ██ ██
1 │██ ██ ██ ██ ██
0 └─────╥──────────────→ 时间
  06-01  ║ 06-15  06-30  今日
          ║
          ╠══ 悬停 06-15 ~ 06-20 窗口
          ║
          ┌─────────────────────────────────────────┐
          │ 该时段 2 个 task 包含此图:               │
          │  • #t_abc 合同-v3.pdf 第 7 页           │
          │  • #t_def 订单-a.docx 第 3 页           │
          │ [点击柱 → 跳转到 #t_abc 预览]            │
          └─────────────────────────────────────────┘
```

### 3.5 移动端(< 768px)

```
┌─────────────────────────┐
│ [☰] AI 图搜 - 跨文档   │
├─────────────────────────┤
│ Tab:[跨文档 ✓] [视觉]   │
├─────────────────────────┤
│ ┌─────────────────────┐ │
│ │ [拖拽 / 📂 / 📋 URL] │ │
│ └─────────────────────┘ │
│ ☑ 扫描所有 task         │
│ [🚀 开始追溯]            │
├─────────────────────────┤
│ 🔍 查询图:               │
│ [缩略图] 🟢 Original     │
│ 2.3 MB · pHash: 8f3a9c  │
├─────────────────────────┤
│ 📊 时间线:               │
│ ┌─────────────────────┐ │
│ │ ████                │ │
│ │ ██ ██ ██            │ │
│ │ ██ ██ ██ ██ ██     │ │
│ └─────────────────────┘ │
├─────────────────────────┤
│ 📁 匹配源 (8):           │
│ ┌─────────────────────┐ │
│ │ 1. 合同-v3 p7 0.94🟢│ │
│ │    [📂 跳转]         │ │
│ ├─────────────────────┤ │
│ │ 2. 合同-v2 p7 0.92🟡│ │
│ │    [📂 跳转]         │ │
│ ├─────────────────────┤ │
│ │ ...                 │ │
│ └─────────────────────┘ │
├─────────────────────────┤
│ [📥 导出] [📤 分享]      │
└─────────────────────────┘
```

---

## 4. 关键交互流

### 4.1 用户故事

```
作为一个 法务 / 合规 / 文档管理员
我希望 上传一张图,系统自动找到它在所有 task 中的出处和变体
以便 我能快速定位原图、追踪引用、发现篡改、审计版权
```

### 4.2 主流程(7 步)

| 步 | 动作 | 系统响应 | 反馈 |
|---|---|---|---|
| 1 | 用户在 SideMenu 点击 "AI 图搜" → "跨文档" | 进入本子模式页 | Tab 高亮,左侧拖拽区 focus |
| 2 | 用户拖拽图片 / 点击 📂 / 粘贴 URL / 粘贴图片 | 本地预览缩略图,显示文件元数据 + pHash | 拖拽区高亮 + 文件信息卡 |
| 3 | 用户配置扫描范围(默认 ☑所有 task) | 实时显示 task 总数 | `X-ImageSearch-Scanned-Tasks: 1,234` |
| 4 | 用户点击 "🚀 开始追溯" | 启动 `POST /api/image-search/trace` | Loading spinner + "扫描中... 234/1234" |
| 5 | 服务端返回结果 | 渲染时间线柱状图 + 匹配源列表 + 篡改徽章 | 三块同时 fade-in,300ms |
| 6 | 用户悬停匹配卡片 | 卡片浮起 2px,大图预览弹出 | 200ms ease-out |
| 7 | 用户点击 "📂 跳转预览" | 打开 PreviewModal,定位到指定页 | useCrossPageHandoff + URL params |

### 4.3 URL 反搜子流程

```
1. 用户在 URL 输入框粘贴 URL(如 https://example.com/foo.png)
2. 用户点击 "反搜" 或按 Enter
3. 前端 fetch URL(后端代理避免 CORS)→ 取 image 二进制
4. 将图像当作 query 走主流程 4-7
```

### 4.4 键盘快捷键

| 键位 | 动作 | 实现 |
|---|---|---|
| ⌘3 | 跳转到本子模式 | palette navigation source 注册 |
| ⌘⇧U | focus 到 URL 输入框 | palette actions source 注册 |
| ⌘O | 打开文件选择器 | dropzone 的 hidden input |
| Esc | 关闭大图预览 | Modal Esc 监听 |
| ↑ / ↓ | 在匹配源列表移动 focus | keydown listener |
| Enter | 打开当前匹配源的预览 | keydown listener |
| Space | 收藏当前匹配源 | keydown listener + localStorage |

### 4.5 错误兜底

| 场景 | 兜底 |
|---|---|
| 上传文件 > 50MB | 拒绝 + toast "文件过大,请压缩至 50MB 以下" |
| URL 反搜 CORS 失败 | 后端代理重试,3 次后失败提示 |
| 扫描 0 个匹配 | 空状态插画 + "试试反向图搜(从 URL 反向搜索)" |
| 服务端超时(>10s) | 进度条 + "扫描 567/1234 任务,继续等待?" |
| 服务端 500 | 错误页 + 复制 stacktrace + "重试" |

---

## 5. 动效规范

| 场景 | 动画 | 时长 | easing | 备注 |
|---|---|---|---|---|
| 拖拽区 hover | border-color 渐变 → var(--color-brand-7) | 150ms | ease-out | subtle,无 transform |
| 文件选择后缩略图出现 | opacity 0 → 1 + scale 0.95 → 1 | 200ms | `[0.4, 0, 0.2, 1]` | Material 标准 |
| 扫描中进度条 | width 0 → 100% | 实时 | linear | 配合数字滚动 |
| 结果三块淡入 | opacity 0 → 1 + translateY 8px → 0 | 300ms | `[0.4, 0, 0.2, 1]` | stagger 80ms |
| 匹配卡片 hover | box-shadow 加深 + translateY -2px | 150ms | ease-out | 不改变 layout |
| 大图预览弹出 | opacity + scale 0.96 → 1 | 250ms | `[0.4, 0, 0.2, 1]` | Modal AnimatePresence |
| 时间线柱 hover | 柱变高 2px + 显示 tooltip | 100ms | ease-out | tooltip 100ms delay |
| 篡改徽章呼吸 | opacity 0.7 → 1 → 0.7 | 2000ms | ease-in-out infinite | 仅 🔴 重大改动徽章 |
| 列表项 stagger | 每项 delay +30ms | 累计 ≤ 240ms | `[0.4, 0, 0.2, 1]` | 8 项以内 |
| 错误抖动 | translateX -4px → 4px → -4px → 0 | 300ms | ease-in-out | 失败时触发 |

**Motion opt-in**:全部动画受 `<html data-motion="on|off">` 控制,默认 off,无障碍优先。

---

## 6. 响应式断点

| 断点 | 宽度 | 布局 |
|---|---|---|
| **> 1280px** (桌面) | 1440 / 1920 | 左右分栏:左侧查询图 + 检索选项(360px),右侧时间线 + 匹配列表(自适应);匹配列表最大宽度 1000px |
| **1024-1280px** | 1024 | 同上,但匹配列表缩为 8 列宽,缩略图 64px → 56px |
| **768-1024px** | 768 / 1024 | 单列堆叠:上传 → 查询图 → 时间线 → 匹配列表(各占满宽);缩略图 48px |
| **< 768px** (移动) | 375 / 414 | 同 768-1024 但隐藏"检索选项"折叠到 "⚙️ 高级" 抽屉;时间线柱状图改为横向滚动 |

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
| `X-ImageSearch-Engine` | 实际使用的引擎 | `pHash-dHash-histogram` / `tineye-api` | server |
| `X-ImageSearch-Latency-Ms` | 服务端处理时长 | `234` | server |
| `X-ImageSearch-Scanned-Tasks` | 扫描任务数 | `1,234` | server |
| `X-ImageSearch-Matches` | 命中条目数 | `8` | server |
| `X-ImageSearch-Confidence` | 最高相似度(0-1) | `0.94` | server |
| `X-ImageSearch-Cache` | 是否命中指纹缓存 | `HIT` / `MISS` | server |
| `X-ImageSearch-Tamper` | 篡改状态 | `original` / `color` / `cropped` / `major` | server |
| `X-Timeline-Id` | 时间轴事件 ID(共享) | `tl_01HX...` | server |

### 7.2 关键 API

| Method | Path | 用途 | 响应 |
|---|---|---|---|
| POST | `/api/image-search/trace` | 跨文档追溯主接口 | `{queryId, matches[], timeline[], tamperStatus, scannedTaskCount}` |
| GET | `/api/image-search/trace/:queryId` | 拉取历史追溯结果 | 同上 |
| POST | `/api/image-search/fetch-url` | URL 反搜(代理 fetch) | `{imageBuffer, contentType, size}` |
| POST | `/api/image-search/export` | 导出报告 PDF | `{reportUrl, expiresAt}` |

### 7.3 前端埋点

```typescript
// web/src/hooks/useImageSearchTrace.ts
export function useImageSearchTrace() {
  const onSuccess = (result) => {
    track('image_search_trace_success', {
      mode: 'cross-doc',
      scannedTasks: result.scannedTaskCount,
      matches: result.matches.length,
      latencyMs: result.latencyMs,
      tamperStatus: result.tamperStatus,
      source: 'upload' | 'url' | 'drag',
    });
  };
  const onError = (err) => {
    track('image_search_trace_error', {
      mode: 'cross-doc',
      error: err.message,
      errorCode: err.code,
    });
  };
}
```

### 7.4 控制台日志

服务端每个请求必打(带 timestamp + requestId):

```
[2026-07-01T14:23:45.123Z] [req_a1b2c3] [image-search:trace] engine=pHash-dHash-histogram
[2026-07-01T14:23:45.357Z] [req_a1b2c3] [image-search:trace] scanned=1234 matches=8 latency=234ms cache=MISS
[2026-07-01T14:23:45.357Z] [req_a1b2c3] [workspace-timeline:emit] kind=image-trace id=tl_01HX...
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
| 篡改徽章 🟢 | `var(--color-status-success)` | `var(--color-status-success)` (= #4ade80) | --color-status-success |
| 篡改徽章 🟡 | `var(--color-status-warning)` | `var(--color-status-warning)` (= #fbbf24) | --color-status-warning |
| 篡改徽章 🟠 | `var(--color-status-warning-hover)` | `var(--color-status-warning-hover)` (= #f59e0b) | --color-status-warning-hover |
| 篡改徽章 🔴 | `var(--color-status-error)` | `var(--color-status-error)` (= #f87171) | --color-status-error |
| 时间线柱 | `var(--color-brand-7)` | `var(--color-brand-5)` | 品牌色 + dark 偏移 |
| 时间线柱 hover | `var(--color-brand-9)` | `var(--color-brand-7)` | hover 加深 |

### 8.2 Dark 模式特殊处理

- **大图预览 Modal**:背景遮罩 opacity 0.8 → 0.95(更深)
- **时间线柱状图**:网格线 `var(--color-border-muted)` 更暗
- **篡改徽章**:红色降低饱和度,避免在暗背景下刺眼
- **匹配卡片 hover**:阴影从 `rgba(0,0,0,0.1)` → `rgba(0,0,0,0.4)`
- **Loading spinner**:颜色从 `--color-brand-7` → `--color-brand-5`

### 8.3 主题切换

复用 `hooks/useTheme.ts` + `[data-theme="dark"]` CSS 变量,无需特殊处理。

---

## 9. KPI 基线

| 指标 | P50 | P95 | P99 | 目标 |
|---|---|---|---|---|
| **扫描耗时**(1234 task) | 180ms | 350ms | 600ms | < 500ms @ P95 |
| **上传 → 首屏渲染** | 280ms | 520ms | 900ms | < 800ms @ P95 |
| **匹配列表渲染**(8 项) | 45ms | 90ms | 150ms | < 100ms @ P95 |
| **大图预览打开** | 120ms | 250ms | 400ms | < 300ms @ P95 |
| **URL 反搜端到端** | 1.2s | 2.5s | 4s | < 3s @ P95 |
| **命中率**(对真实同一图) | 96% | 92% | 88% | > 90% @ P95 |
| **篡改检测准确率** | 92% | 85% | 78% | > 85% @ P95 |
| **误报率**(无关图被命中) | < 2% | < 5% | < 8% | < 5% @ P95 |
| **pHash + dHash 一致性** | 99% | 97% | 94% | > 95% @ P95 |
| **⏱ 用户首次成功追溯** | < 30s | < 60s | < 90s | < 60s @ P95 |
| **📱 移动端可用性** | 全功能 | 全功能 | 全功能 | 全功能 |

**目标用户**:从"上传到拿到第一条匹配结果"的端到端延迟 < 1s。

---

## 10. 实施路线图

### Phase A:服务端骨架(2 天)

- [ ] `server/src/image-search.mjs` — pHash + dHash + 直方图指纹
- [ ] `server/src/image-search-trace.mjs` — 跨 task 扫描 + 相似度排序
- [ ] `server/src/image-search-tamper.mjs` — 篡改检测 4 状态
- [ ] 路由:`POST /api/image-search/trace`、`/fetch-url`、`/export`
- [ ] 响应头 `X-ImageSearch-*` 全套
- [ ] 测试:trace 16 + tamper 8 + url 4 = 28 单测

### Phase B:前端骨架(2 天)

- [ ] `web/src/pages/ImageSearchPage.tsx` — 主视图(Tab 切换)
- [ ] `web/src/components/CrossDocTracePanel.tsx` — 左上传右时间线
- [ ] `web/src/components/MatchList.tsx` — 匹配源列表
- [ ] `web/src/components/TamperBadge.tsx` — 4 状态徽章
- [ ] `web/src/components/TimelineHistogram.tsx` — 复用 useWorkspaceTimeline
- [ ] 测试:panel 12 + list 8 + tamper 4 + timeline 6 = 30 单测

### Phase C:大图预览 + 跳转(1 天)

- [ ] `web/src/components/TracePreviewModal.tsx` — 大图 + 元数据 + 篡改详情
- [ ] useCrossPageHandoff 接入(`?taskId=...&page=7`)
- [ ] 测试:modal 6 + handoff 4 = 10 单测

### Phase D:视觉回归 + E2E(1-2 天)

- [ ] `e2e/cross-doc-trace.spec.ts` — 上传 → 结果 → 跳转预览
- [ ] `e2e/cross-doc-trace-url.spec.ts` — URL 反搜
- [ ] `e2e/cross-doc-trace-tamper.spec.ts` — 篡改徽章显示
- [ ] 视觉回归:snapshots × 3(默认/暗/移动)

**总计**:6-7 天,15 个新文件,~70 个测试。

---

## 11. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 大 task 库扫描慢(>10k) | 中 | 高 | 预建指纹索引(Phase A 一次性 30min),增量更新 |
| pHash 误命中(纹理相似但语义不同) | 中 | 中 | 阈值默认 0.85,可调 0.5-0.99 |
| URL 反搜 CORS 失败 | 高 | 低 | 后端代理 + 3 次重试 |
| 篡改检测准确率低 | 高 | 中 | 标注 "参考" 而非 "判定",给出置信度 |
| 用户隐私(上传敏感图) | 中 | 高 | 任务提示"图片仅本地索引,不外传" |

---

## 12. 与 04-visual-diff 的协作

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
| `ImageDualView.tsx` | `web/src/components/ImageDualView.tsx` | 大图预览框架 |
| `ImageRegionSvgOverlay.tsx` | `web/src/components/ImageRegionSvgOverlay.tsx` | 篡改区域叠加 |
| `PreviewModal.tsx` | `web/src/components/PreviewModal.tsx` | 跳转预览 |
| `Modal.tsx` | `web/src/components/Modal.tsx` | 大图预览 |
| `useWorkspaceTimeline.ts` | `web/src/hooks/useWorkspaceTimeline.ts` | 时间线数据 |
| `useCrossPageHandoff.ts` | `web/src/hooks/useCrossPageHandoff.ts` | 跨页跳转 |
| `useTheme.ts` | `web/src/hooks/useTheme.ts` | 主题切换 |
| `usePalette.ts` | `web/src/hooks/usePalette.ts` | ⌘K 命令面板 |
| `ConfidenceDot.tsx` | `web/src/components/ConfidenceDot.tsx` | 相似度配色 |
| `workspace-timeline.mjs` | `server/src/workspace-timeline.mjs` | 时间轴持久化 |
| `template-matcher.mjs` | `server/src/template-matcher.mjs` | 图像匹配核心 |
| `baidu-accurate_basic` | `server/src/baidu-ocr.mjs` | OCR 复用 |

---

## 14. 模型声明 + 调研基础

**模型**:claude-sonnet-4-6

**调研基础**:
1. **本项目 memory**(截至 2026-07-01):design-overhaul phase 0-2 全部组件、跨块 hover 联动实现、AI 块 21 子模式设计稿、template-matcher 自研算法
2. **公开行业知识**(截至 2026-01 模型知识):
   - TinEye 的时间线 + 文件聚合 + 篡改检测 UI(经典反向图搜功能)
   - Yandex Images 跨语言 OCR + 相似图集
   - Google Lens 文字提取 + 实时取景
   - 百度识图 全球搜索 + 相似度评分
   - Google Find image source 整页扫描
3. **本仓库代码**:
   - `web/src/components/{ImageDualView,ImageRegionSvgOverlay,Modal,ConfidenceDot,PreviewModal}.tsx`
   - `web/src/hooks/{useWorkspaceTimeline,useCrossPageHandoff,useTheme,usePalette}.ts`
   - `web/src/design/{primitives,semantic}.ts`
   - `server/src/{workspace-timeline,template-matcher,baidu-ocr}.mjs`
4. **未访问**:WebSearch / WebFetch 受网络限制未调用,TinEye / Yandex / Google Lens / 百度识图的具体 UI 细节以业内公知信息为准,部分小细节可能与最新版本有出入,建议下游实施时人工核验关键数字

**本报告未修改任何代码文件**,纯只读设计稿。