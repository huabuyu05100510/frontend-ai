# 双栏对比 · 重构为「段落同行 + 段内字符级高亮」

> 对标讯飞翻译对比设计稿 —— `讯飞设计稿/翻译对比.png`
> 模型：claude-sonnet-4-6

## 问题

之前 `splitChangeBlocksByHunks` 把单个长段落切成多个带省略号的「hunk 碎片」，
导致：

1. **文档流被破坏** — 用户看不到完整段落，只能看碎片
2. **段落对齐错位** — 同一段被强行拆成多行，左右栏无法对应
3. **视觉跟设计稿完全不符** — 设计稿是「每段一行 + 段内字符红/蓝高亮」

样例 `智检样例_原文.txt`（416 字 / 1 段）正好命中这个 bug：整段被切成
若干省略号片段，体验崩坏。

## 方案（对标设计稿）

| 维度 | 之前 | 重构后 |
|---|---|---|
| 单元 | 切片 hunk | **1 段 = 1 行**（grid 单行） |
| 段落背景 | 整段琥珀/红/绿铺底 | 仅 change 左红/右蓝极淡铺底 |
| 字符高亮 | 60% 红绿背景 + 白字 + 边框 | **#FECACA 红 / #BFDBFE 蓝** + 深色字（设计稿色值） |
| hover | 整段强琥珀 + 粗边框 | 细靛蓝边框（不抢字符高亮视觉） |
| selected | 大块靛蓝背景 + 脉冲动画 | 左/右 3px 色条 + 细边框（更冷静） |

## 改动文件

| 文件 | 变更 |
|---|---|
| `web/src/inspect/DualColumnView.tsx` | 删 `splitChangeBlocksByHunks`；直接用 `paragraphBlocks`，每段 1 行；CharDiffText 内联渲染 |
| `web/src/styles.css` | `.dcv-para-change` 整体背景移除；`.dcv-para-change.dcv-para-side-left/right` 加极淡红/蓝；`.dcv-char-delete/insert` 改设计稿色值；hover/selected 收敛 |
| `web/test/InspectCompareModal.test.tsx` | "拆成 ≥2 行"断言改为「1 change block → 1 行（全文保留，charOps 内联）」 |

## 设计原则

- **每段同行**：CSS Grid 2 列，每个 block 渲染左右两个 cell（同行），天然对齐，无需 JS 同步滚动
- **单滚动容器**：同行 = 同段，垂直滚动即同步
- **段内字符级 diff**：change block 内嵌 `charOps`，左栏过滤掉 insert、右栏过滤掉 delete → 段落全文保留，仅差异字符着色
- **equal 段落正常显示**，不参与 hover/select

## 测试

```
npx vitest run test/InspectCompareModal.test.tsx
→ 23/23 passed
npx tsc --noEmit
→ 0 errors
```
