# A2UI / GenUI 技术文档提取索引

提取时间: 2026-06-16 05:16:31 UTC

## 文档清单

| 序号 | 文件 | 标题 | 页数 | 字符数 | Markdown |
| --- | --- | --- | ---: | ---: | --- |
| 1 | `tech1.pdf` | A2UI 实战（一）- 渲染器基础 | 4 | 3812 | [tech1.md](./markdown/tech1.md) |
| 2 | `tech2.pdf` | A2UI 实战（二）- SSE、AGUI 协议与服务端搭建 | 2 | 2201 | [tech2.md](./markdown/tech2.md) |
| 3 | `tech3.pdf` | A2UI 实战（三）- 图片理解与多轮对话 | 11 | 15453 | [tech3.md](./markdown/tech3.md) |
| 4 | `tech4.pdf` | 四、生成式 UI 与 A2UI | 22 | 22658 | [tech4.md](./markdown/tech4.md) |

## 学习路径（推荐顺序）

1. **tech4** — 生成式 UI 概念与 A2UI 协议全景
2. **tech1** — `@a2ui/core` + `@a2ui/react` 渲染器 MVP
3. **tech2** — SSE / AGUI 传输层 + Koa 服务端
4. **tech3** — 图片理解、多轮对话、元素级交互

## 目录结构

```
extracted/
├── pages/              # 各页 PNG（180 DPI）
├── markdown/           # 按 PDF 拆分的 OCR Markdown
├── manifest.json       # 机器可读元数据
├── INDEX.md            # 本索引
└── EXTRACTION_PLAN.md  # 提取方案说明
```
