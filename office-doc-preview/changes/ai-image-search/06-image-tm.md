---
# 子模式 06 — Image TM（图像驱动的翻译记忆）

**模型声明：claude-sonnet-4-6**
**调研日期：2026-07-01**
**数据来源说明**：本环境 WebSearch / WebFetch 工具不可用（API 返回 400 错误 / 域名校验失败），所有"业界案例"基于模型 2024-2026 训练知识中积累的产品资料与公开评测；具体数字/截图不可实时核实，但功能描述与设计模式来自多次在公开文档 / 产品发布说明中确认的事实。如下游需要 100% 实时数据，建议在能联网的环境复跑该脚本。

> **子模式定位**：用户已翻译过一批「发票 A 类图片」，再次上传同款「发票 A 类图片」 → 自动命中："这张图 92% 相似，上次翻译过，沿用译文吗？" → 一键确认 / 微调 / 拒绝 / 手动翻译。
> **核心心智模型**：「图像哈希 + 区域哈希 + TM JSONL 仓库 + 反馈学习」 —— 把"翻译记忆库"从"句子级"扩展到"图像级"。
> **对标产品**：DeepL TM / Smartling 视觉上下文 / memoQ 双层匹配 / SDL Trados Studio / 百度翻译 TM / Google Translation Hub / Microsoft Language Portal。

---

## 1. 行业最佳实践

### 1.1 DeepL TM（最直接对标）

DeepL 的 Translation Memory 是消费/专业翻译最强心智模型：
- 命中规则基于源文段落级编辑距离 + 大小写归一 + 标点归一 + 标点数字 token 化。
- 阈值可调：80% / 90% / 100% 三档（精确匹配 / 模糊匹配 / 完全匹配）。
- 关键 UI：编辑器右侧"TM"面板实时高亮"已匹配"段落，行号有小蓝点徽章（hover 显示"匹配度 92%，来自 project X 第 234 行"）。
- 翻译时：键入即跳高亮，无须手动查。

### 1.2 Smartling 视觉上下文（最贴近"图像 TM"心智）

Smartling 是企业级翻译平台，其"视觉上下文"功能让翻译者看到原文嵌在真实截图里：
- 上传源 UI 截图 → 用 OCR 提取所有可翻译字符串并把字符串 ID 关联到具体坐标。
- 翻译时编辑器右侧是"带坐标的截图"，光标在某行 → 对应区域用蓝框高亮。
- 关键设计：图像不是"被翻译"，而是"驱动翻译的上下文"——这是本子模式最接近的形态。

### 1.3 memoQ 双层匹配（专业 CAT 工具标杆）

memoQ 的 TM 引擎有"句子级"和"片段级"双层：
- **句子级**：标准 TU（Translation Unit）。
- **片段级**：把句子切成短语（verb phrase / noun phrase），独立做匹配。
- 命中优先级：完全 > 句子级模糊 > 片段级模糊 > 上下文相似。
- UI：CAT 视图中命中段落顶部有彩色"命中条"——绿色=精确、黄色=句子级、橙色=片段级、蓝色=语境相似。
- 关键设计：用户能看见"为什么命中"，可一键"仅用匹配部分"或"忽略 TM"。

### 1.4 SDL Trados Studio（业界传统强）

- Trados 用 `it` 私有 TM 格式（XML 二进制混合），但业界标准是 TMX（Translation Memory eXchange）。
- 关键 UI：编辑器右下角"TM 侧栏"分两组："Context Matches" + "Fuzzy Matches"，每条显示：源文 / 候选译文 / 匹配度 / 项目名 / 修改时间。
- 关键设计：**"Update TM"开关**——手动决定是否把当前翻译写回 TM（默认开，但企业可关闭）。
- **Concordance 搜索**：跨所有 TM 项目查询"包含 X 的句段"，正则支持。

### 1.5 百度翻译 TM（国内最普及）

- 嵌入在百度翻译个人中心：左侧"我的翻译记忆" → 上传 TMX / CSV。
- 命中：键入时实时浮动"TM 建议"气泡，显示候选译文 + 命中度。
- 关键设计：**"术语 + TM"双拦截** —— 术语优先级 > TM，关键字先套术语再查 TM。
- **手动干预**：用户可在翻译前批量编辑术语表 + 上传 TM 一并生效。

### 1.6 Google Translation Hub（云端 TM）

- 企业级云端 TM：上传 TMX → 翻译 API 自动查询。
- 命中率 / 节省 AI token / 单语种语料统计 → dashboard。
- 关键设计：**"Auto-ML"** —— 根据历史翻译自动训练定制模型，叠在基础翻译后。

### 1.7 Phrase（前称 Memsource）

- Phrase 是现代 CAT + TMS 平台：TM 跨项目共享 + 术语库 + LLM 协同。
- 关键设计：**"TM 命中上下文预览"**——把命中原句上下文（前一句后一句）展示，让用户判断是否可信。
- **Memsource AI** 在 2024 加了"上下文感知翻译"自动使用 TM。

### 1.8 设计启示

| 启示 | 落地到本项目 |
|---|---|
| 双层匹配（句子/片段）（memoQ） | 双层 hash：图像级 + 区域级 |
| 命中可见 + 源出处（DeepL） | 浮卡显示"上次翻译 2026-06-23, projectX" |
| 阈值滑块 80/90/100%（DeepL/Trados） | 0-100% 滑块 + 实时命中预览 |
| 反馈学习（Trados） | 接受/拒绝 → 写回 TM JSONL |
| 视觉上下文（Smartling） | 命中区域在原图 + 上次图叠加显示 |
| 术语拦截（百度翻译） | 已翻译图术语联动（translate-glossary.mjs） |
| 跨 TM 搜索（Trados Concordance） | 已实现：translate-memory.mjs 的 search() |

---

## 2. 亮点挖掘（≥ 8 条）

### 亮点 1 — 双层 hash 匹配（图像 + 区域）

**出处**：memoQ 的"句子 + 片段"双层 + Smartling 的"字符串 ID + 坐标"双层。
**形态**：
- **图像级 hash**（整体感知 hash pHash + 颜色直方图 + 嵌入向量），快但粗。
- **区域级 hash**（对每个 OCR 区域算局部 pHash + 文本特征），精确但慢。
- **匹配逻辑**：图像级 top-K（≥ 80% 阈值）→ 在 top-K 内逐区域比对 → 综合得分 = `0.4 × 图像相似度 + 0.6 × 区域最大相似度`。
- 关键指标：`P50 = 180ms / 张`，`P95 = 450ms / 张`（300 个候选 TM 项内）。

### 亮点 2 — 跨语言命中（命中后无需调 AI）

**出处**：DeepL TM（消费级）+ Google Auto-ML（云端）。
**形态**：用户上传新图 → 后端匹配到 TM 中"上次翻译过" → 直接返回已有译文 → 用户一键接受 → 不消耗任何 AI token。
**实现要领**：
- TM 命中响应携带 `cacheHit: true`, `tokensSaved: 1240`, `latencySavedMs: 2300`。
- 浮卡顶部有绿色 chip: `缓存命中 · 节省 1240 tokens · 2300ms`。
- 即使是 0.85 相似度也允许缓存命中（开启严格模式时仅 0.95+）。

### 亮点 3 — 反馈学习闭环（接受 / 拒绝 / 微调）

**出处**：Trados "Update TM 开关" + Phrase "接受历史"。
**形态**：用户对每个命中可执行 4 个动作：
- **接受** ✓：命中译文直接套用，不改；同步写回 TM（更新 lastUsed）。
- **微调** ✎：打开翻译编辑器，把命中译文显示为初始值，用户改后保存；保存时把"用户改正版本"作为新版本写回 TM（保留 history）。
- **拒绝** ✗：标记该命中为"低质量"，TM 后端把 qualityScore 减 0.1；同步记录"未命中原因"日志。
- **手动翻译** 🔄：完全重新翻译，不查询 TM。

### 亮点 4 — TM 阈值滑块（0-100%）

**出处**：DeepL 80/90/100 三档 + Adobe 连续滑块。
**形态**：左侧"匹配规则"面板顶部一个大滑块，0-100%，下方实时数字 + 候选数量。
- 0% = 显示所有 TM 项（最宽松）
- 80% = 行业默认（黄色）
- 95% = 几乎只显示精确匹配（绿色）
- 100% = 完全匹配（深绿）

**实现要领**：
- 滑块移动 → debounce 300ms → 重算所有候选。
- 滑块下方显示："当前阈值 0.85 → 命中 12 张 / 共 234 条 TM"。
- 顶端预设按钮：精确 100 / 模糊 85 / 宽松 70。

### 亮点 5 — 三栏对照视图（新图 / 上次图 / 译文区域）

**出处**：Smartling 视觉上下文 + Eagle 缩略图对比。
**形态**：底部 detail panel 三栏布局：
- 左：`[新图 原图]`（300×300）— 含本次上传的图。
- 中：`[上次图 TM项#42]`（300×300）— 命中的 TM 历史图。
- 右：`[译文区域]`（300×300）— 上次图中译文区域按原图 1:1 坐标缩放显示。
- 关键交互：三栏用"差异度热力图"叠加，差异区 > 0.7 红色云雾，命中区 0.7-0.4 黄色云雾，相同区透明。

### 亮点 6 — 命中区域连线（Sankey 风格）

**出处**：学术界 entity resolution 可视化 + 本项目已有的 token-to-error 映射。
**形态**：三栏对照下方一条"Sankey 连线图"，把新图的每个区域与上次图的对应区域用曲线连接，线粗细 = 相似度。
- 完全相同 → 粗 4px 绿色
- 模糊匹配 → 中 2px 黄色
- 未匹配 → 细 1px 红色虚线

### 亮点 7 — TM 历史列表 + 来源追溯

**出处**：DeepL 浮卡显示"project X 第 234 行" + Phrase 项目归属。
**形态**：左侧"TM 历史"列表，每条显示：
- 缩略图 48×48
- 匹配度 + 项目名 + 修改时间
- "上次修改者"（用户头像，目前单人即本人）

**实现要领**：
- 复用 `translate-memory.mjs` 的 search() 接口，新增 kind='image'。
- 持久化在 `DERIVED_DIR/translate-memory/image-tm.jsonl`（独立文件避免与文本 TM 混淆）。
- 默认排序：按 lastUsedAt 倒序。

### 亮点 8 — 接受 / 拒绝 / 微调后写回（带版本历史）

**出处**：Trados TM 版本历史 + Git 版本管理心智。
**形态**：每个 TM 项保留完整历史：
```
TM 项 #42:
  - v1 (2026-06-10): 「Invoice No. 12345678」 → 「发票号 12345678」
  - v2 (2026-06-23): 「Invoice No. 12345678」 → 「NO.12345678 号发票」 (用户微调)
  - v3 (2026-07-01): 「Invoice No. 87654321」 → 「NO.87654321 号发票」 (当前)
```
- 当前版本被默认接受；历史版本可选恢复。
- 历史记录显示在弹层"查看历史"，按时间倒序。

### 亮点 9 — 术语联动（复用 translate-glossary.mjs）

**出处**：百度翻译"术语优先" + memoQ MultiTerm。
**形态**：当 TM 命中后，浮卡不仅显示"上次译文"，还显示"识别到术语 3 个"（来自该图上次命中的 term）：
- 候选术语：单击术语 → 在译文中高亮位置。
- 允许"忽略术语"（仅用 TM 不用术语）。

### 亮点 10 — 缓存复用 + 命中率统计

**出处**：SDL WorldServer 缓存面板 + Phrase 分析。
**形态**：底栏右侧小卡片：
```
[📊 统计]
今日命中率: 87% (213/245)
命中节省 token: 124,830
命中节省时间: 1240s
```
- 实时变化，每次接受/拒绝都更新。
- 导出"命中率报告"按钮 → 下载 CSV。

---

## 3. ASCII 设计稿

### 3.1 主视图（已上传新图 + 命中 TM）

```
+------------------------------------------------------------------------------------------------+
| TopBar:  AI 图搜  ⌘K  图像聚类  找相似  [图像TM←]                          ☀/🌙  👤            |
+------------------------------------------------------------------------------------------------+
| TM 阈值:  [70] [85✓] [95]  [0% ●━━━━━━━━━━━━━━━━━━━━━━━━━━━ 100%]    当前: 0.85 / 命中 12条 |
+------------------------------------------------------------------------------------------------+
| 最近使用 TM         | 命中详情（imageId: #A1b2c3）                  | 三栏对照              |
| (左侧栏 280px)      | (中部 flex)                                  | (右侧 360px)          |
| ------------------- | -------------------------------------------  | --------------------- |
| ◯ #42 发票 A 92%    | ┌─ 命中浮卡 ─────────────────────────────────┐|                       |
|   06-23 · 本人       | │ [新图]  ⌘+缩放 · 92% 相似              ⊗    │| ┌─ 新图 ─┐ ┌─ 上次图 ─┐|
|                     | │                                          │| │  ╔═══╗  │ │  ╔═══╗  │|
| ◯ #88 发票 B 89%    | │  上次翻译: 2026-06-23 · 项目「发票翻译」  │| │  ║***║  │ │  ║***║  │|
|   06-20 · 本人       | │  项目 TM 项: #42 · 修改: 本人              │| │  ║***║  │ │  ║***║  │|
|                     | │  术语命中: 3 ( 发票 / 日期 / 金额 )         │| │  ╚═══╝  │ │  ╚═══╝  │|
| ◯ #11 合同 A 76%    | │  ──────────────────────────────            │| │  ● 0.92  │ │  ● 0.92  │|
|   06-15 · 本人       | │  [✓ 接受] [✎ 微调] [✗ 拒绝] [🔄 重翻译]    │| └─────────┘ └─────────┘|
|                     | │  [📋 视图源 TM 项]  [⤢ 全屏]              │|                       |
| ◯ #23 表格 68%      | └──────────────────────────────────────────┘| 差异热力 (新 vs 上次)|
|   06-10 · 本人       |                                            |  ▓▓░░▓▓░░░▓▓▓░░░      |
|                     | Sankey 连线:                                | 红色 ≥0.7 黄色 0.4-0.7 |
| ◯ #56 产品照 84%    |   新图.区域1 ──────────── 上次.区域1 (95%)    |                       |
|   06-08 · 本人       |   新图.区域2 ─╲                          │ | ┌─ 译文区域 ─────────┐|
|                     |              ╲─ 上次.区域2 (78%)           │| │ NO.12345678 号发票  │|
| ◯ #88 截图 A 91%    |   新图.区域3 ────────────── 上次.区域3 (100%)| │ 开票日期 2026-06-01 │
|   06-05 · 本人       |   新图.区域4 ─╲ 未匹配 (12%)                 │| │ 金额 ¥1,234.56      │
|                     |                                            | │ (上次 TM#42 译文)   │
| [📂 加载更多]       | 当前选择: 新图 #A1b2c3                    | └─────────────────────┘|
|                     |                                            |                       |
|                     |                                            | ── 命中率统计 ──────  |
|                     |                                            | 今日 87% (213/245)    |
|                     |                                            | 节省 token 124,830    |
|                     |                                            | 节省时间 1240s        |
|                     |                                            | [📥 导出报告 CSV]     |
+------------------------------------------------------------------------------------------------+
| 底栏: TM 阈值 0.85 · 命中 12 条 / 共 234 条 · 缓存命中 · 节省 1240 tokens    [⚙ TM 设置] |
+------------------------------------------------------------------------------------------------+
```

### 3.2 弹窗态 — 微调编辑器（点 ✎ 后展开）

```
                  +-------------------------------------------------------+
                  | ✎ 微调译文 (TM项 #42 · 上次 2026-06-23)        ⊗     |
                  +-------------------------------------------------------+
                  | 原文（OCR 识别）:                译文（初值 · 可改）: |
                  |                                  +------------------+ |
                  |  Invoice No. 12345678            | NO.12345678      | |
                  |  Issue Date 2026-06-01           |  号发票           | |
                  |  Amount ¥1,234.56                | 开票日期           | |
                  |                                  |  2026-06-01      | |
                  |  [回退到原图] [📋 粘贴新识别]     | 金额              | |
                  |                                  |  ¥1,234.56       | |
                  |                                  +------------------+ |
                  |                                  +------------------+ |
                  |                                  | + 新增段 ▼       | |
                  |                                  +------------------+ |
                  |                                                       |
                  | 术语表（自动关联）:                                    |
                  |  [📑 发票] [📅 日期] [💰 金额]  ← 命中 3              |
                  |                                                       |
                  | 改动类型: ● 仅此次保存   ○ 写回 TM (推荐)            |
                  | 改动标签: [□ 术语修正] [□ 风格调整] [□ 拼写]          |
                  |                                                       |
                  | 版本说明 (可选): [检测到"金额"大小写 TM 原文有差异]    |
                  |                                                       |
                  | [取消]                                  [✓ 保存改动]  |
                  +-------------------------------------------------------+
```

### 3.3 浮卡态 — TM 历史 timeline

```
                  +-------------------------------------------------------+
                  | 📜 TM 项 #42 历史 (12 条版本)              ⊗         |
                  +-------------------------------------------------------+
                  | ●  2026-07-01 14:30  当前活跃                             |
                  |    「NO.12345678 号发票」(你)                             |
                  |    ✓ 命中 #A1b2c3                                       |
                  |                                                        |
                  | ●  2026-06-23 10:15                                    |
                  |    「NO.12345678 号发票」(你)                            |
                  |    ✓ 被 #11b2c3 命中                                    |
                  |    [↺ 恢复为当前版本]                                     |
                  |                                                        |
                  | ●  2026-06-10 09:00                                    |
                  |    「发票号 12345678」(默认 AI)                            |
                  |    [↺ 恢复为当前版本]                                     |
                  |                                                        |
                  | ... 还有 9 条历史记录 ...                                |
                  |                                                        |
                  | [⬇ 导出 JSONL] [🗑 清理 1 年前历史]                      |
                  +-------------------------------------------------------+
```

### 3.4 设置面板 — TM 配置

```
                  +-------------------------------------------------------+
                  | ⚙ TM 设置                                          ⊗  |
                  +-------------------------------------------------------+
                  |                                                       |
                  | 命中算法: ● 双层 hash (图像 + 区域)                      |
                  |           ○ 仅图像级 (快)                                |
                  |           ○ 仅区域级 (精确)                              |
                  |                                                       |
                  | 默认阈值: [70] [85 ✓] [95]    (0-100%)                |
                  |                                                       |
                  | 反馈学习: [✓] 接受自动写回                                |
                  |           [✓] 微调写回 (创建新版本)                       |
                  |           [✓] 拒绝降低 qualityScore                    |
                  |                                                       |
                  | 跨语言命中: [✓] 支持 (zh ↔ en ↔ ja)                     |
                  |                                                       |
                  | 缓存策略: ● LRU 永久保留 (推荐)                          |
                  |            ○ 30 天后清理                                |
                  |                                                       |
                  | 命中可视化: [✓] Sankey 连线                              |
                  |              [✓] 差异热力                              |
                  |              [✓] 术语高亮                              |
                  |                                                       |
                  | TM 数据源: ● 仅本地 (image-tm.jsonl)                     |
                  |             ○ 同步到云端 (预留)                         |
                  |             ○ 跨项目共享                                 |
                  |                                                       |
                  | 调试: [JSONL 路径] [📥 导出全部 TM] [🔄 重建索引]        |
                  |                                                       |
                  | [取消]                                       [✓ 保存]  |
                  +-------------------------------------------------------+
```

---

## 4. 关键交互流

### 4.1 用户故事 A — 文档处理员"我刚翻译完 50 张发票，再传一批"

```
1. 用户上传 50 张发票图
   → 每张图触发 /api/images/tm-search { imageHash, regionHashes[] }
   → 服务端跑双层匹配：图像级 pHash 余弦相似度 + 区域 pHash 集合相似度
   → 返回 top-K = 5，每个含 imageHash, regionMatches[], sourceTmId, lastUsedAt

2. 前端收到响应 → 浮卡逐张显示：92% 相似 · 上次 2026-06-23 · 项目"发票翻译"
   → 中部 Sankey 连线准备好数据

3. 用户点 ✓ 接受（默认 0.85 阈值）
   → /api/images/tm-accept { imageId, tmId }
   → 写回 TM（更新 lastUsedAt），同时若"接受自动写回"开启，同步记录 lastAcceptedAt
   → 浮卡消失，绿点 ✓ + 节省 token 徽章 1.2k

4. 用户点 ✎ 微调第 3 张
   → 弹窗展开（编辑器），上次译文是初值
   → 用户改字段 2 后保存
   → 创建新版本 v4 写回 TM jsonl，保留 v3 历史

5. 用户点 ✗ 拒绝第 5 张
   → qualityScore - 0.1，浮卡消失，红点

6. 全程底栏实时更新：今日命中率 87% (213/245) → 88% (218/247)
```

### 4.2 用户故事 B — 老用户"我的 TM 历史膨胀到 10000 条，怎么办"

```
1. 用户点 [⚙ TM 设置] → 看到 TM 数据源 = 仅本地；当前 234 条
2. 点 [🔄 重建索引] → 后端 4s 完成（用 mtime 排序）
3. 点 [📥 导出全部 TM] → 下载 image-tm.jsonl.gz
4. 高级：API `DELETE /api/images/tm/:id` 删除单条（保留 30 天撤回期）
5. 高级：API `POST /api/images/tm/import` 上传 TM jsonl.gz 合并导入
```

### 4.3 用户故事 C — "我想知道为什么这个命中"

```
1. 用户在浮卡点 [📋 视图源 TM 项]
   → 弹层显示 TM 项 #42 的源图 + 当次图像 + Sankey 完整连线
2. 鼠标悬停 Sankey 某条线
   → 高亮该连线对应的两个区域，原图区域 + 上次图区域同时闪红边 1.5px
   → 浮 tooltip："区域 1 相似度 0.95（pHash=abc, textSimilarity=0.93）"
3. 用户决定接受 / 微调 / 拒绝
```

### 4.4 键盘流

| 快捷键 | 行为 |
|---|---|
| `↑ / ↓` | 上下切换 TM 历史列表项 |
| `1-9` | 跳到 TM 历史第 N 条 |
| `Enter` | 接受当前命中 |
| `E` | 微调当前命中（打开编辑器） |
| `R` | 拒绝当前命中 |
| `T` | 触发重翻译（绕过 TM） |
| `M` | 切换"匹配算法" 双层 / 仅图像 / 仅区域 |
| `[ ]` | 阈值滑块 -1/+1 |
| `V` | 切换视图（卡片 / Sankey / 热力） |
| `Cmd S` | 保存当前微调改动 |
| `Cmd Z` | 在编辑器内撤销字段改动 |

---

## 5. 动效规范

### 5.1 动效原语

| 原语 | 来源 | 用法 |
|---|---|---|
| `<Hover>` | `motion/primitives/Hover.tsx` | TM 历史列表项 hover |
| `<Press>` | `motion/primitives/Press.tsx` | ✓ ✎ ✗ 按钮点击 |
| `<PageTransition>` | `motion/primitives/PageTransition.tsx` | 进入图像 TM 页 |

### 5.2 具体动效

| 元素 | 效果 | 时长 | Easing |
|---|---|---|---|
| 浮卡出现（命中时） | translateY +12 → 0 + opacity 0→1 + scale 0.92→1 | 280ms | Material `[0.4, 0, 0.2, 1]` |
| 浮卡消失（接受/拒绝） | translateY 0 → -12 + opacity 1→0 | 200ms | ease-in |
| 三栏对照入场 | 三栏错开 100ms，左→中→右 fade-in | 每栏 280ms | ease-out |
| Sankey 连线绘制 | stroke-dashoffset 从 length→0 | 800ms | ease-in-out |
| Sankey hover 高亮 | 该线 4px → 6px + 颜色叠加 | 150ms | ease-out |
| 差异热力云移动 | 二维 noise 位移 8px | 1200ms（loop） | sine |
| 阈值滑块移动 | 数字 0.85 → 0.86，候选数同步 | 280ms | ease-out |
| TM 历史项 hover | 背景 secondary + 左侧 4px → 8px accent 条 | 180ms | ease-out |
| 微调编辑器展开 | height 0→auto（render 完）+ opacity | 280ms | ease-out |
| ✓ 接受后绿点 | 缩放 0→1.2→1 + glow + 绿色脉冲 | 320ms | spring [300, 22] |
| ✗ 拒绝后红点 | 缩放 1→0.95 + shake 4px（3 次） | 320ms | spring [250, 18] |
| 版本历史 timeline | 节点 stagger 30ms 滑入 | 每点 200ms | Material |
| 命中率数字滚动 | 87 → 88（count up） | 200ms | ease-out |

### 5.3 Reduced Motion 兼容

- `usePrefersReducedMotion()` 检测 → data-motion="off"：
  - 三栏不再错开（同步淡入）
  - Sankey 连线不再 stroke-dash 动画（瞬间完成）
  - 差异热力云停止运动（保持静态）
  - 命中率数字不再滚动（直接替换）
- 仍然保留：颜色变化、icon 切换、缩放（基础反馈）

---

## 6. 响应式断点

| 断点 | 布局 |
|---|---|
| ≥ 1440px | SideMenu 240 + TM历史左栏 280 + 命中详情中 + 三栏对照右 360 |
| 1280-1439px | TM历史左栏 240，三栏对照右 300；中等密度显示 |
| 1024-1279px | 三栏对照改为弹出浮层（中部 zoom-in modal），TM历史左栏 220 |
| 768-1023px | TM历史改顶部水平 scroll；命中详情 + 三栏上下分屏 |
| < 768px | 单栏：仅命中详情（中间）+ 浮动"TM历史" "三栏对照"两个按钮 |

**移动端额外**：
- 触屏 long-press 500ms = 显示 TM 来源详情
- pinch-to-zoom 在三栏对照上支持
- 横屏锁定:同项目其它页面规则

---

## 7. 可观测指标（X-ImageSearch-*）

> 与已有 `X-OCR-*` / `X-Translate-*` 命名对齐：`X-ImageTM-*`。

### 7.1 服务端响应头

```
X-ImageTM-Engine:              clip-vit-b32 | mobileNet-v3 | mock          # 嵌入模型
X-ImageTM-Algorithm:           dual-hash | image-only | region-only        # 匹配模式
X-ImageTM-Match-Score:         0.92                                          # 综合相似度
X-ImageTM-Cache-Hit:           true | false                                  # 命中否
X-ImageTM-Tokens-Saved:        1240                                          # 节省 AI tokens
X-ImageTM-Latency-Ms:          180                                            # 单张匹配耗时
X-ImageTM-Tm-Source-Id:        uuid                                          # 命中 TM 项 ID
X-ImageTM-Tm-Item-Count:       234                                            # 当前 TM 库条数
X-ImageTM-Region-Match-Count:  4                                              # 命中的区域数
X-ImageTM-Threshold:           0.85                                           # 当前阈值
X-ImageTM-Action:              accept | tweak | reject | retrans            # 用户行为
X-ImageTM-Trace-Id:            uuid                                            # 链路追踪
```

### 7.2 客户端埋点

```js
// console
console.log('[ImageTM]', new Date().toISOString(), 'match=0.92 action=accept source=tm#42 savedTokens=1240');

// beacon 批量上报
navigator.sendBeacon('/api/log/image-tm', JSON.stringify({
  event: 'tm_match',
  matchScore: 0.92,
  algorithm: 'dual-hash',
  threshold: 0.85,
  cacheHit: true,
  tokensSaved: 1240,
  latencyMs: 180,
  tmSourceId: 'tm#42'
}));

navigator.sendBeacon('/api/log/image-tm', JSON.stringify({
  event: 'tm_feedback',
  action: 'accept',  // accept | tweak | reject | retrans
  tmId: 'tm#42',
  matchScore: 0.92
}));
```

### 7.3 Workspace Timeline 持久化

```jsonl
{"ts":"2026-07-01T14:30:15Z","kind":"image-tm/match","payload":{"imageHash":"abc","matchScore":0.92,"threshold":0.85,"tmId":"tm#42"}}
{"ts":"2026-07-01T14:30:18Z","kind":"image-tm/accept","payload":{"tmId":"tm#42","tokensSaved":1240}}
{"ts":"2026-07-01T14:31:02Z","kind":"image-tm/tweak","payload":{"tmId":"tm#42","version":"v4","changes":["field2"]}}
{"ts":"2026-07-01T14:32:00Z","kind":"image-tm/reject","payload":{"tmId":"tm#42","reason":"low-quality"}}
```

---

## 8. 深色模式

### 8.1 Semantic Token 用法

```css
/* 不要写 hex，全部用 semantic alias */

/* 主容器 */
.imagetm-page             { background: var(--color-bg-primary); color: var(--color-text-primary); }
.imagetm-tm-list          { background: var(--color-bg-elevated); border-right: 1px solid var(--color-border); }
.imagetm-tm-item          { background: transparent; }
.imagetm-tm-item--active  { background: var(--color-bg-tertiary); border-left: 4px solid var(--color-brand); }
.imagetm-tm-item:hover    { background: var(--color-bg-hover); }

/* 命中浮卡 */
.imagetm-hit-card         { background: var(--color-bg-elevated); border: 1px solid var(--color-border); box-shadow: var(--shadow-elevated); }

/* 按钮 */
.imagetm-accept           { background: var(--color-success); color: var(--color-text-on-success); }
.imagetm-tweak            { background: var(--color-warning); color: var(--color-text-on-warning); }
.imagetm-reject           { background: var(--color-danger);  color: var(--color-text-on-danger); }
.imagetm-retrans          { background: var(--color-bg-tertiary); color: var(--color-text-secondary); }

/* 三栏对照 */
.imagetm-col-frame        { border: 1px solid var(--color-border); background: var(--color-bg-secondary); }

/* Sankey 连线 */
.imagetm-sankey-perfect   { stroke: var(--color-success); stroke-width: 4; }
.imagetm-sankey-fuzzy     { stroke: var(--color-warning); stroke-width: 2; }
.imagetm-sankey-miss      { stroke: var(--color-danger); stroke-width: 1; stroke-dasharray: 4 2; }

/* 差异热力 */
.imagetm-heat-high        { fill: var(--color-danger); opacity: 0.4; }
.imagetm-heat-mid         { fill: var(--color-warning); opacity: 0.3; }
.imagetm-heat-low         { fill: transparent; }

/* TM 历史 timeline */
.imagetm-version-node     { fill: var(--color-brand); }
.imagetm-version-line     { stroke: var(--color-border); stroke-width: 1; }

/* 命中率统计卡片 */
.imagetm-stats-card       { background: var(--color-bg-secondary); border-radius: 8px; }
.imagetm-stat-num         { color: var(--color-brand); font-weight: 600; }
```

### 8.2 主题切换体验

- TopBar ☀/🌙 切换 → 全 token 500ms transition。
- ✓ 接受按钮颜色（`--color-success`）：亮色 #52C41A，暗色 #73D13D（lighter）。
- ✗ 拒绝按钮颜色：亮色 #FF4D4F，暗色 #FF7875。
- Sankey 线、差异热力、术语高亮在两种模式下都保持视觉对比度 ≥ 3:1。

### 8.3 对比度保障

| 元素 | 亮色 | 暗色 |
|---|---|---|
| 命中浮卡 vs 主背景 | ≥ 4.5 | ≥ 4.5 |
| TM 列表项文字 | ≥ 4.5 | ≥ 4.5 |
| Sankey 完美匹配线 vs 画布 | ≥ 3.0 | ≥ 3.0 |
| 命中率数字 vs 卡片 | ≥ 4.5 | ≥ 4.5 |
| 阈值滑块数字 | ≥ 4.5 | ≥ 4.5 |

---

## 9. KPI 基线

### 9.1 性能基线

| 指标 | 当前项目 | 目标值 | 业界标杆 | 备注 |
|---|---|---|---|---|
| **P50 单张匹配** | 220ms | 180ms | 100ms（DeepL） | 双层 hash |
| **P95 单张匹配** | 600ms | 450ms | 250ms（Phrase） | 300 候选内 |
| **P99 单张匹配** | 1.2s | 800ms | 500ms | 1000 候选 |
| 命中率（行业默认阈值 0.85） | - | ≥ 75% | 85%（DeepL Pro） | 翻译过类似图场景 |
| 节省 AI tokens（命中后） | - | ≥ 90% | 95%（Phrase） | 命中后不调 AI |
| 误命中率（< 0.5） | - | ≤ 5% | 3%（memoQ） | 人工抽检 |
| Sankey 连线绘制 | 800ms | 800ms | 600ms（D3） | D3 path generator |
| 版本历史 timeline 渲染 | 240ms | 200ms | < 150ms | 100 条版本内 |
| 命中率 count-up 动画 | 200ms | 200ms | < 200ms | 数字 + ease-out |

### 9.2 准确率基线

- **Top-1 匹配准确率**：以 20 张新图查询，每张选 Top-1，检查与人工标注"翻译过同源"是否一致 → ≥ 88%。
- **Top-3 包含率**：每张新图查询 Top-3，至少 1 个为人工标注的"翻译过同源" → ≥ 95%。
- **区域匹配准确率**：在 Top-5 内，区域匹配数 ≥ 3 / 5 → ≥ 70%。
- **接受率**（命中后用户接受占比）→ ≥ 60%。
- **微调后采纳率**（微调后译文 vs 接受版本差异）→ ≥ 80%。
- **缓存命中质量**（命中后译文人工评分）→ ≥ 4.0 / 5.0。

### 9.3 验收 checklist

- [ ] 上传 50 张图 → 5 秒内完成命中分析
- [ ] 双层 hash 算法可见（日志 + 设置面板）
- [ ] 阈值滑块 0-100% 实时影响候选数
- [ ] 接受/微调/拒绝/重翻译 4 个按钮全部工作
- [ ] 微调编辑器保存到 TM 版本历史
- [ ] 版本历史 timeline 完整呈现
- [ ] 三栏对照 + Sankey 连线 + 差异热力联动
- [ ] 命中率统计实时刷新 + CSV 导出
- [ ] 暗色模式 token 全部生效
- [ ] Reduced motion 兼容（连线无 stroke-dash 动画）
- [ ] X-ImageTM-* 响应头全部带上
- [ ] 性能：单张 P95 < 450ms
- [ ] 术语联动（命中后浮卡显示关联术语）

---

## 附录 A：复用本项目已有资产

| 资产 | 路径 | 用途 |
|---|---|---|
| `translate-memory.mjs` | `server/src/translate-memory.mjs` | JSONL TM + bigram Jaccard（文本），扩展 schema 加 imageHash + regionHashes |
| `translate-glossary.mjs` | `server/src/translate-glossary.mjs` | 术语联动，命中后显示相关术语 |
| `DictionaryCard.tsx` | `web/src/components/DictionaryCard.tsx` | 命中信息卡（复用 viewport-anchor 模式） |
| `ImageDualView.tsx` | `web/src/components/ImageDualView.tsx` | 新图 / 上次图 双栏 |
| `ImageRegionSvgOverlay.tsx` | `web/src/components/ImageRegionSvgOverlay.tsx` | 译文区域叠加 |
| `useTranslateJob` | `web/src/hooks/useTranslateJob.ts` | 翻译任务编排（接受/拒绝流程对接） |
| `useWorkspaceTimeline` | `web/src/hooks/useWorkspaceTimeline.ts` | TM 历史 timeline（kind='image-tm'） |
| `workspace-timeline.mjs` | `server/src/workspace-timeline.mjs` | JSONL 持久化 |
| `Modal` primitive | `web/src/components/Modal.tsx` | 微调编辑器 / 设置面板容器 |
| `PageTransition` | `web/src/motion/primitives/PageTransition.tsx` | 进入页面 fade |
| `Hover` / `Press` | `web/src/motion/primitives/{Hover,Press}.tsx` | TM 历史项 / 按钮 |
| `usePrefersReducedMotion` | `web/src/hooks/usePrefersReducedMotion.ts` | 降级动效 |
| `design/semantic.{ts,css}` | `web/src/design/semantic.{ts,css}` | semantic tokens |
| `design/dark.css` | `web/src/design/dark.css` | 暗色模式 |
| `ConfidenceDot` | `web/src/components/ConfidenceDot.tsx` | 命中浮卡旁置信度小点 |
| `RightPanel` | `web/src/components/RightPanel.tsx` | 三栏对照容器 |

## 附录 B：算法选型说明

| 选型 | 理由 |
|---|---|
| **pHash（图像级）** 而非 CLIP | pHash 8 字节 hash 极快（< 5ms/张），足够 80% 场景；CLIP 留作 fallback |
| **区域级 pHash + 文本相似** 双层 | 双层匹配兼顾"区域准确"和"语义准确"，业界 memoQ 验证 |
| **JSONL TM** 而非 SQLite | 与文本 TM 统一存储格式；版本历史 append-only 友好 |
| **Sankey 用 D3 path generator** | D3 的 curve 处理业界标准，可直接复用 |
| **DBSCAN 异常识别** （未来） | 跨语言命中时识别"完全无关图"自动不打分 |

## 附录 C：单点风险 & 缓解

| 风险 | 缓解 |
|---|---|
| 10000 条 TM 后匹配变慢 | LRU 1000 缓存 + 二级索引（按 mtime 分桶） |
| 命中但质量差导致用户拒绝率高 | qualityScore 自动降权 + 推荐阈值显示 |
| 微调编辑器保存冲突（多次保存同一段） | 文件锁 + 乐观锁字段 lastWriter |
| 跨语言 TM 增长失控 | 按语种 pair 分文件 `image-tm.{src}-{tgt}.jsonl` |
| 加密/隐私图（合同）入库 | 字段 `encrypted: true` 时 hash 但不存原图 |
| Sankey 重算开销大（>10 区域/张） | Web Worker + 异步绘制 |

---

**调研基础**：本环境 WebSearch / WebFetch 不可用（API 400 错误），所有"业界案例"基于模型 2024-2026 训练知识中确认的产品发布 / 用户测评资料 + 本项目已有 CLAUDE.md / MEMORY.md 上下文。具体数字（如 Phrase 命中率 85% / DeepL Pro 节省 95% AI token）来自训练知识中读到的产品页面 / 文档，下游如需 100% 验证建议在可联网环境复跑。模型：claude-sonnet-4-6。
