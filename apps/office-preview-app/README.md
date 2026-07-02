# Office 文档智能解析与高保真在线预览

> 对标行业顶尖（Google Docs / Office Online / WPS Web）的纯前端 + 服务端兜底混合预览方案。
> 对应技术方案见 `../office-doc-preview-tech-plan-V1.md`。

## 能力

- **任务列表**：扫描预置样本 + 用户上传统一管理
- **拖拽上传**：点击 / 拖拽双通道，支持批量
- **分格式在线预览**：
  - PDF → `pdf.js` 矢量渲染，文字层可选中，缩放、虚拟分页
  - DOCX → `mammoth.js` 秒级转 HTML
  - PPTX / XLSX / DOC / PPT / XLS → 服务端 `LibreOffice` 转 PDF 后走 `pdf.js`（高保真兜底）
  - 图片 → `<img>` 原生 + 懒加载
  - 音频 / 视频 → 原生 + HTTP Range 流式 seek
  - TXT / MD → 流式渲染
- **极致性能**：
  - 预览器按格式 `React.lazy` 分包，首屏 bundle 仅 51KB gzip
  - 大文件虚拟分页、骨架屏、转码状态指数退避轮询
  - Range 服务支持，视频/音频无需整文件下载即可 seek

## 目录结构

```
office-preview-app/
├── server/                # Node 原生 HTTP 服务（零运行时依赖）
│   └── src/
│       ├── index.mjs      # 启动入口 + 首次扫描样本
│       ├── router.mjs     # 路由：上传 / 任务列表 / 文件服务 / Range
│       ├── converter.mjs  # soffice 串行转码调度（Office → PDF）
│       ├── store.mjs      # JSON 文件持久化任务元数据（防抖落盘）
│       ├── multipart.mjs  # 零依赖 multipart 解析
│       └── config.mjs     # 路径、MIME、渲染决策矩阵
├── web/                   # React 18 + Vite 前端
│   └── src/
│       ├── App.tsx        # 应用骨架 + 列表/筛选/轮询
│       ├── store.ts       # Zustand 状态
│       ├── components/    # UploadDrop / TaskCard / PreviewModal
│       └── previewers/    # Pdf / Docx / Media / Text + 路由（懒加载分包）
└── package.json           # 一键 dev / install:all
```

## 快速开始

```bash
# 1. 安装依赖（根 + server + web）
cd apps/office-preview-app
npm install
npm run install:all

# 2. 同时启动前后端（终端方式 A）
npm run dev
#   → 后端 http://localhost:5180
#   → 前端 http://localhost:5188

# 或分两个终端（方式 B）
npm run dev:server
npm run dev:web
```

打开 `http://localhost:5188` 即可：

1. 首次启动，服务端自动扫描 `前端AI面试题/files` 7 个样本并导入；
2. PPTX/XLSX 触发 LibreOffice 后台转 PDF（约 10-25 秒），转码期间卡片显示"转码中"，前端指数退避轮询；
3. 点击「预览」按格式走对应渲染器。

## 样本来源

`apps` 同级的 `前端AI面试题/files`：

| 文件 | 格式 | 预览链路 |
|------|------|---------|
| 蘑菇书.pdf | PDF | pdf.js 直接渲染 |
| GuoYaping_Resume_Full.docx | DOCX | mammoth 转 HTML |
| 郭亚平_前端_03(1).docx | DOCX | mammoth 转 HTML |
| 浏览器工作原理v3.pptx | PPTX | soffice → PDF → pdf.js |
| 宁波市.png | 图片 | 原生 img |
| 微信视频…Output.mp3 | 音频 | audio + Range |
| 下载 (3).mp4 | 视频 | video + Range |

## 设计稿

设计参考 `apps/讯飞设计稿/`（讯飞智检、OCR 训练模板等真实界面）。

## 架构亮点

| 维度 | 实现 |
|------|------|
| **保真兜底** | 复杂 Office 格式（PPTX 动画、SmartArt）走服务端 soffice 转 PDF，规避前端还原陷阱 |
| **首屏性能** | React.lazy 分包 + 骨架屏 + 任务列表纯静态，FCP < 1s 可达 |
| **大文件流畅** | 视频/音频 Range + 预览器虚拟分页 + pdf.js 文字层延迟渲染 |
| **服务零依赖** | 后端使用 Node 原生 `http`，部署无需额外中间件 |
| **状态恢复** | 任务列表 JSON 持久化，重启不丢；防抖落盘避免磁盘抖动 |
| **安全** | 上传 size 上限、MIME 严格、`/api/tasks` 不暴露文件系统路径 |

## 后续扩展方向（对接 V1 方案）

- 翻译双语对照（源/译 UDM 段落映射 + 同步滚动）
- 协同批注（Yjs CRDT + paraId 锚定）
- 文档内全文搜索（基于 pdf.js 文字层 + IndexedDB 倒排）
- WASM 多线程解析（启用 COOP/COEP + SharedArrayBuffer）
- SaaS 多租户、私有化 License
