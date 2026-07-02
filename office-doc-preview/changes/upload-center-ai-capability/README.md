# upload-center-ai-capability 上传中心 AI 能力集成

> 模型：claude-sonnet-4-6

## 背景
- 用户要求"将上传文件也放在 AI 能力下 并且有上传历史"
- "之前对 AI 能力的各种封装 ./v3下的上传功能参考并集成"
- 参考：`/Users/didi/Downloads/前端AI/v3/upload-engine`（七层管道上传内核）

## 集成范围（已落地）

### 1. v3 upload-engine 移植 → `web/src/upload-engine/`
保留核心模块（剥离实验性/基准代码），共 28 文件：

| 类别 | 文件 | 说明 |
|------|------|------|
| 核心 | `smart-uploader.ts` | 七层管道调度器 |
| 策略 | `strategies/direct-upload.ts`、`strategies/chunked-upload.ts` | 直传 + 分片 |
| 校验 | `validator.ts`、`magic.ts` | 四级校验（魔数→扩展→大小→尺寸） |
| 指纹 | `fingerprint.ts` + `workers/hash.worker.ts` | Worker 内 SHA-256 流式哈希 |
| 压缩 | `image-compressor.ts`、`image-processor.ts` + `workers/image-compressor.worker.ts` | OffscreenCanvas + EXIF 矫正 + AVIF/WebP 自适应 |
| 完整性 | `merkle.ts` | 流式 Merkle Tree 分片校验 |
| 自适应 | `adaptive-chunk.ts`、`connection-manager.ts`、`circuit-breaker.ts`、`concurrency.ts` | 网络探测 + EWMA + 断路器 + Semaphore |
| 续传 | `resume-store.ts` | localStorage 已上传分片持久化 |
| 预设 | `presets.ts` | 6 个场景：universal/document/image/audio/video/ai-image |
| 预览 | `preview.ts`、`webcodecs-preview.ts` | 图片/视频/音频/文档预览 |
| 适配器 | `adapters/oss.ts` | 阿里云 OSS PostObject 直传 |
| React | `hooks/useUpload.ts` + 5 个组件（UploadZone/FileCard/FileGallery/FilePreviewCard/ContentPreview） | rAF 批处理 + 拖拽 |
| 可观测 | `telemetry.ts` | 上传统指标采集 |

**剥离的实验性模块**（保留未引用）：`cdc.ts`、`delta-sync.ts`、`encryption.ts`、`sab-pipeline.ts`、`webtransport-upload.ts`、`predictive-upload.ts`、`http-strategies.ts`、`benchmarks.ts`、`bench-sim.ts`、`mock-api.ts`

### 2. 后端 4 新端点
| 端点 | 用途 | 关键头 |
|------|------|--------|
| `POST /api/upload/check` | 秒传检查（hash → taskId 索引） | `X-Upload-Instant` |
| `POST /api/upload/chunk` | 分片接收（multipart：chunk + hash + index + total） | `X-Chunk-Index`/`X-Chunk-Received`/`X-Chunk-Total` |
| `POST /api/upload/merge` | 合并分片 → 触发 soffice 转换 → 返回 taskId + url | `X-Merge-Hash`/`X-Merge-Bytes`/`X-Merge-Merkle` |
| `GET /api/upload/history` | 上传历史（倒序 50 条） | `X-History-Count` |

**修改 `/api/upload`**：响应新增 `url` 字段（`task.previewUrl || task.originalUrl`），让 directUpload 策略拿到产物地址；同时如客户端带 `hash` 字段则建立 hash 索引。

**模块级状态**：`hashIndex: Map<hash, taskId>`（内存），分片暂存于 `DERIVED_DIR/chunks/<hash>/`，按 zero-pad 序号命名，合并后 `rmSync` 清理。

**测试**：`server/test/upload-chunked.test.mjs` — 6 tests 覆盖完整链路：分片接收 → 合并 → 秒传命中 → 缺片检测 → 历史倒序。

### 3. 前端 UploadCenterPage
| 文件 | 说明 |
|------|------|
| `web/src/pages/UploadCenterPage.tsx` | 主页面（xf-workspace + 6 预设 tab + UploadZone + FileCard 列表 + 历史网格） |
| `web/src/components/SideMenu.tsx` | "AI 能力"组新增"上传中心"项（UploadIcon，AI 标记） |
| `web/src/App.tsx` | 接入 UploadCenterPage（全宽模式） |
| `web/src/styles.css` | `.uc-history-card` 悬浮动效 |
| `web/test/UploadCenterPage.test.tsx` | 6 tests 覆盖结构 + 场景切换 + 历史 accept 过滤 |

**布局**
- **左侧 submenu**：6 个预设场景（带 emoji + 中文 label）
- **顶部说明卡**：紫色渐变背景，显示当前 preset 的能力（最大尺寸/数量/分片/压缩/并发）
- **UploadZone**：拖拽/点击/⌘V 粘贴；上传中显示进度条 + 取消全部
- **本次上传卡片**：FileCard 列表，含状态徽章 + 分片进度 + 压缩元数据 + 预览图
- **上传历史**：网格布局，按当前 preset 的 accept 过滤；状态角标（转码中/就绪/失败）；图片缩略图 + 其他格式 emoji

**联动**
- 上传完成（done/instant）自动刷新历史 + 全局 tasks 列表
- 切换 preset 时历史按 accept 过滤（universal 不过滤）

## 测试
- 后端 `npx vitest run`：**333 pass / 24 files**（含新增 6 tests）
- 前端 `npx vitest run`：**216 pass / 21 files**（含新增 6 tests）
- `npx tsc --noEmit`：通过

## 设计决策
- **保留 v3 内核完整性**：七层管道、自适应分片、Merkle 校验、断路器、断点续传全部保留，不简化
- **URL 对齐零配置**：v3 presets 已用 `/api/upload`、`/api/upload/chunk`、`/api/upload/merge`、`/api/upload/check`，与后端端点完全一致，无需重写
- **hash 索引内存存储**：避免每次秒传检查扫盘；首次直传/merge 后建立，进程重启丢失（生产可换 SQLite/Redis）
- **分片 padding 序号**：`String(i).padStart(len(total), '0')` 保证 `readdirSync` 顺序 = 物理顺序
- **/api/upload 双兼容**：保留 `task` 字段不动（旧前端依赖），新增 `url` 字段（v3 directUpload 依赖）
- **历史场景过滤**：客户端过滤（preset.accept），避免后端多端点；universal 通配不过滤
- **zero-extra-dep**：upload-engine 全部为浏览器原生 API（SubtleCrypto / OffscreenCanvas / WebCodecs / Worker），无 npm 依赖

## 顶级交互细节
- 场景 tab：emoji + label 双行设计，hover/active 状态色
- 说明卡：紫色渐变（`linear-gradient(135deg, #f9f0ff, #e6f4ff)`），与 AI 主题一致
- UploadZone：拖拽时 `scale(1.01)` + 紫色阴影 ring + `cubic-bezier(0.4, 0, 0.2, 1)` 过渡
- FileCard：12 种状态徽章配色（idle/校验中/处理中/指纹/秒传检测/上传中/合并中/完成/秒传/暂停/失败/取消）
- 历史卡：状态角标右上角悬浮（转码中黄/就绪绿/失败红），hover 上浮 + 紫色边框
- 图片缩略图自适应 contain，非图片用 emoji 大字号居中
