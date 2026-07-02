# AI 能力块设计稿 — 4 大块 × 21 子模式行业对标 + 实施规范

> **模型声明**:claude-sonnet-4-6
> **生成日期**:2026-07-01
> **状态**:调研阶段 — 设计稿(本报告) → 用户审批 → TDD 实施
> **覆盖范围**:4 个 AI 能力块 × 21 个子模式 = 完整产品表面
> **方法**:WebSearch / WebFetch 在当前网络环境持续返回 API 错误,故"竞品最新版本细节"以业内公知信息 + 截至 2026-01 模型知识 + 本仓库代码 / memory 沉淀为依据
> **本报告纯只读**,未修改任何代码文件

---

## 0. 速查总览(21 子模式 ROI 矩阵)

| 块 | 子模式 | 当前实现度 | 行业差距 | 用户感知 | ROI | 优先级 | 推荐窗口 |
|---|---|---|---|---|---|---|---|
| **OCR** | Recognize | 90% | 中(批量/引擎切换缺) | ★★★★★ | 14/15 | **P0** | Week 1 |
| **OCR** | Template-Edit | 70% | 中(撤销栈/吸附缺) | ★★★★ | 12/15 | **P1** | Week 2 |
| **OCR** | Template-Manage | 60% | 中(dashboard 缺) | ★★★ | 9/15 | **P2** | Week 3 |
| **Translation** | realtime | 85% | 中(术语库缺) | ★★★★★ | 13/15 | **P0** | Week 1 |
| **Translation** | text | 70% | 中(多译本/AI 改写) | ★★★★★ | 14/15 | **P0** | Week 1 |
| **Translation** | doc | 55% | 大(Glossary/TM 缺) | ★★★★ | 10/15 | **P1** | Week 2 |
| **Translation** | image | 60% | 中(批量/原图对照) | ★★★ | 8/15 | **P2** | Week 3 |
| **Translation** | audio | 50% | 大(说话人/摘要) | ★★ | 6/15 | **P3** | Week 4 |
| **Translation** | video | 50% | 大(字幕烧录) | ★ | 5/15 | **P4** | Month 2 |
| **QualityCheck** | text | 90% | 小(AI 改写/Undo 缺) | ★★★★★ | 10/10 | **P0 已完成** | — |
| **QualityCheck** | text-compliance | 5% | 大 | ★★★★ | 9/10 | **P1** | Week 1 |
| **QualityCheck** | image-compliance | 5% | 大 | ★★★ | 8/10 | **P1** | Week 1 |
| **QualityCheck** | doc | 5% | 极大 | ★★★★ | 6/10 | **P2** | Week 2 |
| **QualityCheck** | doc-compliance | 5% | 大 | ★★ | 7/10 | **P2** | Week 2 |
| **QualityCheck** | audio | 5% | 中(可复用 Voice) | ★★ | 7/10 | **P3** | Week 3 |
| **QualityCheck** | video | 5% | 极大 | ★ | 4/10 | **P4** | Month 2 |
| **Voice** | realtime | 80% | 中(说话人/分角色) | ★★★★ | 9/12 | **P0** | Week 1 |
| **Voice** | tts | 80% | 小(SSML/长文) | ★★★ | 8/12 | **P1** | Week 1 |
| **Voice** | audio | 80% | 中(摘要/导出) | ★★★ | 7/12 | **P1** | Week 1 |
| **Voice** | video | 70% | 大(关键帧/烧录) | ★★ | 5/12 | **P3** | Week 3 |
| **Voice** | clone | 5% | 极大 | ★★ | 4/12 | **P2** | Week 2 |

**核心策略**:按"用户感知 × 行业差距 × 实现成本"三维度滚动交付 — Week 1 集中交付 8-10 个 P0 增量,后续每周 5-7 个 P1 / P2 增量,Month 2 处理 P3 / P4 多媒体旗舰。

---

## 1. 目录结构

本报告按 4 大能力块分章节,每章包含 1 个实施总览 + 各子模式独立小节。每子模式统一 9 个维度:

1. 行业最佳实践
2. 亮点挖掘(≥ 8 条,带产品出处)
3. ASCII 设计稿
4. 关键交互流
5. 动效规范
6. 响应式断点
7. 可观测指标(`X-{Mode}-*` 响应头)
8. 深色模式
9. KPI 基线

子模式完整设计稿见同目录子文件(每个子文件 250-400 行 markdown):

- [`ocr.md`](./ocr.md) — OCR 3 子模式(Recognize / Template-Edit / Template-Manage)
- [`translation.md`](./translation.md) — Translation 6 子模式(realtime / text / doc / image / audio / video)
- [`quality-check.md`](./quality-check.md) — QualityCheck 7 子模式
- [`voice.md`](./voice.md) — Voice 5 子模式(realtime / tts / audio / video / clone)
- [`kpi-dashboard.md`](./kpi-dashboard.md) — 跨模式 KPI / 可观测 / 共享组件

---

## 2. 跨块共享能力(必读)

所有 AI 块都依赖以下 4 类共享能力,**新建子模式时必须复用,禁止重复造轮子**:

### 2.1 三层设计 Token(已落地 Phase 1.A)
- **primitive**:`web/src/design/primitives.ts` — Radix 12-step × 10 色板(blue/green/red/amber/purple/indigo/slate/...)
- **semantic**:`web/src/design/semantic.ts` — 36 个语义 alias(brand/ai/text/bg/border/status/diff)
- **dark**:`web/src/design/dark.css` — `[data-theme="dark"]` 覆盖

任何新组件的 hex 字面量都会被 `noInlineHex.test.tsx` 静态守卫拦截。

### 2.2 动效原语(已落地 Phase 1.B)
- `motion/primitives/Hover.tsx` — 100ms ease-out 涟漪
- `motion/primitives/Press.tsx` — 120ms scale 0.97
- `motion/primitives/PageTransition.tsx` — 200ms 进出
- 全部读 `<html data-motion="on|off">`,默认 off(无障碍优先)
- 启用:`?motion=on` query string,`MotionProvider` 在 App.tsx 顶层

### 2.3 ⌘K 命令面板(已落地 Phase 1.C / 2.B)
- 5 类 source:`navigation` / `files` / `templates` / `voices` / `actions`
- ⌘K / Ctrl+K 打开,Esc 关闭
- 新增 AI 模式快捷键必须注册到对应 source
- TopBar 搜索栏已 wire,palette.open()

### 2.4 工作区时间轴(已落地 Phase 2.B)
- `server/src/workspace-timeline.mjs` — JSONL 持久化(200 cap, 10k rotation)
- 客户端:`hooks/useWorkspaceTimeline.ts` — in-flight dedup
- 每个 AI 操作的成功/失败事件必须 emit 到时间轴,header 返回 `X-Timeline-Count/Kind/Id`
- 用途:AI 模式侧栏"最近操作"列表

---

## 3. 跨块 KPI & 可观测规范

### 3.1 响应头命名约定

每个 AI 端点必须返回以下 header(命名按模式前缀区分,便于灰度对比):

| Header 名 | 含义 | 示例值 | 来源 |
|---|---|---|---|
| `X-{Mode}-Engine` | 实际使用的引擎 | `baidu-accurate` / `deepseek-v3` / `elevenlabs-turbo` | server |
| `X-{Mode}-Latency-Ms` | 服务端处理时长 | `234` | server |
| `X-{Mode}-Tokens` | LLM token 用量 | `1,204` | server |
| `X-{Mode}-Hits` | 命中/检出条目数 | `12` | server |
| `X-{Mode}-Confidence` | 平均置信度(0-1) | `0.94` | server |
| `X-{Mode}-Cache` | 是否命中缓存 | `HIT` / `MISS` | server |
| `X-Timeline-Id` | 时间轴事件 ID(共享) | `tl_01HX...` | server |

示例(`{Mode}` 占位符):
- OCR:`X-OCR-Engine: baidu-accurate`
- Translation:`X-Translate-Engine: deepseek-v3`
- QualityCheck:`X-QC-Engine: xunfei-pro`
- Voice:`X-Voice-Engine: elevenlabs-multilingual-v2`

### 3.2 前端埋点(必加)
- 每个 AI 操作的 `start` / `success` / `error` 三个事件必须埋点
- 字段:`mode` / `subMode` / `engine` / `inputBytes` / `latencyMs` / `hits` / `cache` / `timestamp`
- 失败时 `error.code` / `error.message` / `error.stack`(prod 仅 code+message)

### 3.3 性能基线

| 操作 | P50 | P95 | P99 | 备注 |
|---|---|---|---|---|
| OCR 单图识别 | < 800ms | < 1.5s | < 3s | mock < 50ms |
| Translation 段落 | < 300ms | < 800ms | < 2s | 流式 < 100ms 首 token |
| QC 段落 | < 250ms | < 600ms | < 1.5s | 1000 字以内 |
| TTS 首字节 | < 200ms | < 500ms | < 1s | 浏览器内置 |
| ASR 实时 | < 300ms | < 800ms | < 1.5s | Web Speech API |
| 声音克隆训练 | 30s | 90s | 180s | 5 秒样本 |

---

## 4. 各块实施总览(详见子文件)

### 4.1 OCR 块(3 子模式 → `ocr.md`)

**强项**:自研 template-matcher(中位数聚合 + bigram Jaccard + 阅读顺序 + scale clamp)— 行业唯一
**待补**:
- **Recognize**:图片预处理面板(去阴影/透视/对比度) + 批量队列 + 多引擎 A/B + 真实引擎接入(ROI 最高)
- **Template-Edit**:撤销/重做栈(F/V/Del/Cmd+Z/Cmd+Shift+Z) + 智能吸附 + 保存前自检
- **Template-Manage**:顶部 dashboard(健康度评分 0-100 + 4 子项) + 卡片/表格双视图 + 标签过滤

**对外宣传钩子**:
- "可搜索 PDF 导出" — 行业里 Adobe 有,百度 iOCR 没有 → 加大宣传
- "私有化部署 + 中位数聚合锚点算法" — 与百度云 iOCR 控制台 2 步流程对标

### 4.2 Translation 块(6 子模式 → `translation.md`)

**强项**:Myers diff + 词级对齐 + 双栏 hover 桥接(已有)
**待补**:
- **text**:#1 优先级 — 多译本对比 2-4 列 + AI 改写 3 候选 + 修订追踪 diff
- **realtime**:术语库 CSV 导入 + 风格切换(学术/口语/商务/文学 4 档) + TTS 朗读 + 翻译历史栈
- **doc**(B 端刚需):Glossary CSV + Translation Memory JSON 持久化 + 双语 DOCX 输出 + 进度环
- **image**:原图+译文双视图切换 + 批量队列 + 词典卡片
- **audio**(Week 4):说话人识别 + AI 摘要/关键词/待办 + SRT/VTT 导出 + 段同步滚动
- **video**(Month 2):自动字幕 + 翻译 + 字幕烧录(FFmpeg) + 关键帧 + AI 配音

**对外宣传钩子**:DeepL 质感天花板(词级 hover) + 飞书妙记音频翻译 + 剪映视频翻译 三合一

### 4.3 QualityCheck 块(7 子模式 → `quality-check.md`)

**强项**:讯飞智检设计稿 1:1 还原(蓝色 `--xf-primary` + 红浪下划线 + 错误侧栏 + 改正后双栏)
**待补**:
- **text**:可读性评分 + 风格建议 + AI 改写对比视图 + Undo 改进历史 + CJK-Latin 空格
- **text-compliance**(P1 本周):复用 token 框架 + 4 档风险色(H/M/L/ok) + 阈值滑条 + 词库勾选
- **image-compliance**(P1 本周):复用 SVG 框选 + CNN 模型
- **doc**(P2 下周):docx → PDF + PDF.js 文字层定位 + 红盖叠加
- **doc-compliance**(P2 下周):doc + text-compliance 串联
- **audio**(P3 复用 VoicePage)
- **video**(P4 压轴)

**对外宣传钩子**:讯飞智检设计稿 + 网易易盾合规库 + 4 档风险色

### 4.4 Voice 块(5 子模式 → `voice.md`)

**强项**:双语字幕 + 麦克风脉冲 + 波形可视化(已有)
**待补**:
- **realtime**:说话人 diarization(2-4 色卡片) + 多人对话模式 + 语速可视化 + 标点修复
- **tts**:SSML 支持 + 多情感(neutral/happy/sad/angry) + 多人对话朗读 + 长文本切片 + 字幕导出 SRT
- **audio**:说话人识别 + 章节自动分段 + AI 摘要/关键词/待办 + 导出 SRT/VTT + 多语种切换
- **video**:画面文字 OCR + 字幕烧录 + 视频摘要 + 关键帧缩略图 + 说话人共享
- **clone**:#5 优先级 — 3 秒极速克隆 + 跨语种克隆 + 情感迁移 + 隐私保障(本地化 + 数据清理)

**对外宣传钩子**:ElevenLabs 标杆 + 微软 VALL-E + 火山引擎 + 剪映 4 in 1

---

## 5. 滚动交付 Roadmap(4 周)

### Week 1:快速胜利(8-10 个 P0 增量,共 8-10 人天)

| # | 块 | 子模式 | 增量 | 人天 | 关联文件 |
|---|---|---|---|---|---|
| 1 | Translation | text | 多译本对比 2-4 列 | 1 | `pages/TranslationPage.tsx` |
| 2 | Translation | text | AI 改写 3 候选(更正式/口语/精炼) | 1 | 同上 |
| 3 | Translation | text | 修订追踪 diff 模式 | 0.5 | 同上 |
| 4 | Translation | realtime | 术语库 CSV 导入 + 强制着色 | 2 | `pages/TranslationPage.tsx` + `server/src/glossary.mjs` |
| 5 | Translation | realtime | 风格切换(学术/口语/商务/文学 4 档) | 1.5 | 同上 |
| 6 | Translation | realtime | TTS 朗读(Web Speech API) | 0.5 | 同上 |
| 7 | Translation | realtime | 翻译历史栈(Alt+Z/Shift+Z) | 0.5 | `store.ts` |
| 8 | OCR | Recognize | 图像预处理面板(4 toggle) | 1.5 | `pages/OCRPage.tsx` |
| 9 | OCR | Recognize | 批量识别队列(50 张) | 2 | `pages/OCRPage.tsx` + `server/src/ocr-batch.mjs` |
| 10 | QC | text | AI 改写对比视图 + Undo | 1 | `pages/QualityCheckPage.tsx` |

### Week 2:B 端突破 + 模板深耕(8-10 个 P1,共 12-15 人天)

| # | 块 | 子模式 | 增量 | 人天 |
|---|---|---|---|---|
| 11 | Translation | doc | Glossary CSV 导入 + 强制替换 | 2 |
| 12 | Translation | doc | Translation Memory(JSON 持久化) | 3 |
| 13 | Translation | doc | 双语 DOCX 输出(docx 库) | 2 |
| 14 | Translation | doc | 进度环 + 中断 + 局部导出 | 1.5 |
| 15 | Translation | image | 原图+译文双视图切换 + 区域选择 | 2 |
| 16 | Translation | image | 批量翻译队列(10+ 图) | 2 |
| 17 | OCR | Template-Edit | 撤销/重做栈 + 快捷键 | 2 |
| 18 | OCR | Template-Edit | 保存前对齐质量自检 | 1.5 |
| 19 | QC | text-compliance | 4 档风险色 + 阈值滑条 | 2 |
| 20 | QC | image-compliance | SVG 框选 + CNN | 3 |
| 21 | Voice | clone | 3 步 wizard + 训练进度 + 试听 | 4 |

### Week 3:多媒体扩展(8-10 个 P2,共 15-20 人天)

| # | 块 | 子模式 | 增量 | 人天 |
|---|---|---|---|---|
| 22 | Translation | image | 词典卡片(点词即查) | 1.5 |
| 23 | Translation | audio | 说话人识别 + 彩色卡片 | 4 |
| 24 | Translation | audio | AI 摘要/关键词/待办 | 2 |
| 25 | Translation | audio | SRT/VTT 导出 | 1 |
| 26 | Translation | audio | 段同步滚动(timeupdate) | 1.5 |
| 27 | OCR | Template-Manage | 顶部 dashboard + 健康度评分 | 2 |
| 28 | OCR | Template-Manage | 批量操作 + 卡片/表格双视图 | 2 |
| 29 | QC | doc | docx→PDF + 文字层 + 红盖 | 5 |
| 30 | QC | doc-compliance | doc + text-compliance 串联 | 3 |
| 31 | Voice | realtime | 说话人 diarization | 4 |

### Week 4 + Month 2:视频旗舰(P3/P4,共 30+ 人天)

| # | 块 | 子模式 | 增量 | 人天 |
|---|---|---|---|---|
| 32 | Translation | video | 自动字幕 + 翻译 + 烧录 | 8 |
| 33 | Translation | video | 关键帧 + AI 配音 | 7 |
| 34 | Voice | tts | SSML + 多情感 + 多人对话 | 4 |
| 35 | Voice | audio | 章节自动分段 + 多语种 | 3 |
| 36 | Voice | video | 画面文字 OCR + 字幕烧录 | 5 |
| 37 | Voice | clone | 跨语种克隆 + 情感迁移 | 5 |
| 38 | QC | audio | 复用 VoicePage 段同步 + 风险色 | 3 |
| 39 | QC | video | ffmpeg 抽帧 + 三路融合 | 8 |

---

## 6. TDD + 端到端 + UI 回归强制项(CLAUDE.md)

每个子模式任务的强制三件套:

1. **单元测试**(Vitest, 5+ 条)
   - 数据 schema 校验、纯函数、reducer 状态机
   - 目标覆盖率:核心模块 ≥ 90%
2. **端到端测试**(Playwright, 2+ 条)
   - 用户完整操作路径(上传 → 等待 → 结果展示)
   - 关键交互(hover/click/scroll/keyboard)
3. **UI 视觉回归**(Playwright snapshot, 1+ 张)
   - dark/light × 1440 / 1920 / 375 三断点
   - 保存到 `e2e/<page>.spec.ts-snapshots/`

新增 AI 子模式的命名约定:
- 测试文件:`test/{block}/{subMode}.test.tsx`
- E2E 文件:`e2e/{block}-{subMode}.spec.ts`
- 截图:`e2e/{block}-{subMode}.spec.ts-snapshots/{case}-{viewport}-${theme}.png`

---

## 7. 可观测埋点示例(以 OCR 真实引擎接入为例)

```typescript
// 前端
const t0 = performance.now()
const res = await fetch('/api/ocr/recognize', { method: 'POST', body: fd })
const dt = performance.now() - t0

// 必读响应头
const engine = res.headers.get('X-OCR-Engine')         // 'baidu-accurate'
const ms = res.headers.get('X-OCR-Latency-Ms')          // '1234'
const hits = res.headers.get('X-OCR-Hits')              // '5'
const conf = res.headers.get('X-OCR-Confidence')        // '0.94'
const cache = res.headers.get('X-OCR-Cache')            // 'MISS'
const timelineId = res.headers.get('X-Timeline-Id')     // 'tl_01HX...'

// 埋点
track('ocr.recognize', {
  mode: 'ocr',
  subMode: 'recognize',
  engine,
  inputBytes: fd.get('file')!.size,
  latencyMs: parseFloat(ms!),
  hits: parseInt(hits!),
  cache,
  roundTripMs: Math.round(dt),
  timestamp: new Date().toISOString(),
})
```

---

## 8. 风险与缓解

| 风险 | 影响范围 | 缓解策略 |
|---|---|---|
| 真实引擎接入耗时超预期 | OCR/QC/Voice | 早期 P0 接入,留 fallback mock |
| 私有部署数据合规 | 全部 | 默认本地化 + 显式云端勾选 + 数据清理 |
| 长视频抽帧 OOM | Translation/QC/Voice video | 后台异步 + 进度推送(SSE) + 分段处理 |
| ffmpeg 跨平台兼容 | video 模式 | 容器内预装 + 检测缺失时清晰报错 |
| AI 配音版权 | Voice clone | 强制水印 + 免责声明 + 不存储样本 |
| 7 子模式 UI 分散 | QualityCheck | 共享 xf-toolbar + xf-submenu + 统一 hero 文案 |
| 误判投诉 | QualityCheck compliance | 申诉通道 + 人工复审 + 7 天回执 |
| 21 子模式并发实施失控 | 全局 | Week 1 后基于真实反馈动态调整 |

---

## 9. 一句话总结

> **Week 1 集中打磨 8-10 个 P0 增量(Translation text/realtime + OCR Recognize + QC text)**,2 周内补齐 doc/模板/合规 6-8 个 P1,3-4 周扩展 image/audio/voice,Month 2 旗舰 video 烧字幕 + AI 配音。**全栈贯穿:语义 token + 动效 + ⌘K + 时间轴 + 响应头 5 件套**。

---

**报告元信息**:
- 模型:claude-sonnet-4-6
- 总字数(主报告):约 5000 字
- 完整设计稿(子文件汇总):约 35000 字
- 覆盖子模式:21/21
- 业界对标产品:80+(DeepL / Google / Grammarly / 讯飞智检 / 网易易盾 / Otter.ai / 飞书妙记 / ElevenLabs / HeyGen / 剪映 / 火山引擎 / 百度 iOCR / 秘塔写作猫 / 腾讯 Effidit / Notta / Fireflies.ai / 通义听悟 / 微软 VALL-E / 魔音工坊 / Descript / Adobe Acrobat / ABBYY 等)
- 设计稿 ASCII wireframe 数量:21
- 亮点挖掘条目数:≥ 168(每子模式 ≥ 8)
- 可观测 Header 命名规范:21 套 `X-{Mode}-*` 头
- TDD 三件套强制:每子模式 5+ 单测 / 2+ e2e / 1+ 截图
- 工具受限说明:WebSearch / WebFetch 在当前环境不可用,所有竞品细节以业内公知 + 模型知识为准
