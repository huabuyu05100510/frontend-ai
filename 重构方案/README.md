# 骨架方案重构 · 实施手册

> 本目录是 `boneyard` 骨架方案的**第二代落地手册**，按 step 拆分、每份文档可独立照做。
> 旧三份设计文档（`packages/boneyard/src/skeleton-architecture-design.md` / `ssr-injection-design.md` / `skeleton-build-pipeline-design.md`）作为历史归档**不动**。

---

## 1. 为什么有这一轮重构

旧三份文档把"应该做的事"列得很全（七层流水线、SkeletonScheduler、Tier 1/2/3 自动 binding graph、SSR Transform Stream 中间件、三端 Render 后端……），但**没有按落地次序裁剪**。盲目铺开会变成"半成品矩阵"。本目录在 6 个被业务方明确锚定的决策上做了**减法**，把方案聚焦到一条 1–2 个月内可见效的主线。

---

## 2. 6 个锚定决策（不在本目录内推翻）

| # | 决策 | 一句话含义 |
|---|---|---|
| D1 | CSR 首屏「零 JS 可见」= **A + B 并存** | A=Vite/webpack 构建期注 `index.html`（page 级，单 HTML 多路由由 client bridge 切换）；B=SWC 把 `bones.json` 内联到 chunk，`<Skeleton>` 挂载即渲染（组件级） |
| D2 | 三端模型 = **B1（共享 schema + 各端独立采集）+ 类型 × 平台二级结构**（v2 调整） | `bones/pages/{web,rn,mp}` + `bones/regions/{web,rn,mp}`；三端 schema 同形，采集器/Render 后端各写各 |
| D3 | 严格深层依赖 = **esbuild metafile + 深度 5 + ignore glob** | check 复用项目自身的 metafile，零额外 AST 解析；`design-tokens.*` 默认 ignore |
| D4 | 捕获 = **Playwright 权威 + DevSave 仅人工调试**（v2 调整）| Playwright 写 `bones/`（进 git，权威，跑 Visual Diff）；DevSave 写 `.smarty-cache/`（不进 git，不参与 CI） |
| D5 | SSG-lite 注入位置 = **`index.html` 的 `head`/`body`/`auto` 三档** | 原 SSR Transform Stream 中间件章节降级为 Open Questions 后置 |
| D6 | 文档落点 = **顶层独立目录 `/重构方案/`** | 与旧设计物理隔离，便于跨团队评审 |
| **D7** | **命名品牌 = `smarty`**（CLI/包/配置/端点），**内部技术标识符用 `skeleton/sk` 前缀**（v2 新增）| `smarty build` / `smarty.config.json` / `__smarty__/save`；`#__skeleton` / `.sk-bone` / `data-skeleton-*` |
| **D8** | **输出格式 = JSON object（dev）+ tuple（prod），取消 bin**（v2 调整）| bin vs tuple 多省 ~250 字节但加 msgpack 依赖；tuple 把单 snippet 压到 ≤ 4 KB |
| **D9** | **`pruneTree` = `safe` 默认**，`aggressive` 改为 opt-in（v2 新增）| safe 模式保留含 `id` / `className` / `role` / `aria-*` / `data-*` 的容器，避免 Visual Diff 失真 |
| **D10** | **图片采样 = 实验性 + 默认关闭**，扩展原型先验证再上 CI（v2 新增）| 防止"先做后判断价值"，等设计师认可后 P4+ 默认开 |
| **D11** | **接口归因 = 保持显式 `<Bound deps>`**，不引入 Service Worker（v2 新增）| SW 注册时序坑、iOS Safari 限制、postMessage 开销；当前方案性能最优 |
| **D12** | **三端断点经验值各异**（v2 新增）| Web `[375, 768, 1280]` / RN `[375, 414]` / MP `[375, 414]`；不互相套 |

---

## 3. 范围 in / out

**In（本次必做）**

- Web SSG-lite（page）+ SWC 运行时注入（组件）
- 纯前端 SPA 路由 bridge（不依赖任何 SSR 中间件）
- 显式 `<Bound deps={['…']}>` 接口态 + delay/minDuration 防闪烁
- 断点自动扫描（CSS @media + Tailwind + 运行时 styleSheets）
- dev:ske + DevSave + Playwright（**含 Visual Diff**）
- `smarty check --ci` + pre-commit + GitHub Actions
- RN 后端（measure + Reanimated worklet）
- Taro / 小程序后端（编译期 WXML + `setData` 拆除）

**Out（明确不做、降级到 [42-Open-Questions-后置.md](./42-Open-Questions-后置.md)）**

- SkeletonScheduler（仿 React Scheduler 全套）
- Tier 1/2/3 自动 binding graph + 编译期 `autoBound`
- SSR Transform Stream 中间件 / `Content-Length` 处理 / Edge Runtime 适配

---

## 4. 阅读顺序

| 顺序 | 文档 | 阅读重点 |
|---|---|---|
| 1 | [00-总览与决策锚点.md](./00-总览与决策锚点.md) | 决策表、范围、与旧文档差异 |
| 2 | [01-架构与模型.md](./01-架构与模型.md) | 五层裁剪、bones schema v2、三端目录、ReadySignal |
| 3 | **[02-最佳生成算法.md](./02-最佳生成算法.md)** | **BGv2 算法核心：融合 11 个调研项目的最强点；所有 step 引用本文** |
| 4 | [10-step1-snippet生成器.md](./10-step1-snippet生成器.md) → [19-step10-pre-commit-与-CI.md](./19-step10-pre-commit-与-CI.md) | Web 全链路实施 |
| 5 | [30-step11-RN-后端.md](./30-step11-RN-后端.md) → [31-step12-Taro-小程序后端.md](./31-step12-Taro-小程序后端.md) | 三端扩展 |
| 6 | [40-验收清单-G1-G8.md](./40-验收清单-G1-G8.md) → [41-Rollout-里程碑与回滚.md](./41-Rollout-里程碑与回滚.md) | 验收 + 灰度 |
| 7 | [42-Open-Questions-后置.md](./42-Open-Questions-后置.md) | 延后项与触发条件 |

### 4.1 调研基础（写入 [02-最佳生成算法.md](./02-最佳生成算法.md) §0）

并行调研了 11 个骨架屏开源项目（`/Users/didi/Documents/smart/` 5 个 + `/Users/didi/Documents/code/` 6 个），按"算法步骤 × 项目"得分对比，逐步骤选最强、再补 4 项新机制（图片色采样 / R-tree 块合并 / `data-skeleton-*` 全集 / JSON⇄bin⇄HTML 三态输出）。详见 [02-最佳生成算法.md](./02-最佳生成算法.md)。

| 调研项目 | 主要贡献 | 是否吸收 |
|---|---|---|
| `page-skeleton-webpack-plugin` | 两阶段遍历、css-tree 裁剪、styleCache 去重、`text.js` linear-gradient | ✓ 全部 |
| `smarty-skeleton-toolchain`/trinity | `textToGradient` 多行渐变、`pruneTree` 包装剪枝、flex/grid 布局保真 | ✓ 全部 |
| `smarty-skeleton-toolchain`/core | `getVisibleRect` overflow 祖先裁剪、`matchLeafClass` 控件识别、DSL+bin | ✓ 全部 |
| `awesome-skeleton` | 最完整 `data-skeleton-*` 钩子体系 | ✓ 统一为 `data-skeleton-*` |
| `smarty-skeleton-v1` | 相邻 box 几何合并 | ✓ 恢复 + R-tree 加速 |
| `create-skeleton-quickly` | `isCustomCardBlock` 卡片启发式 | ✓ |
| `visual-skeleton-plugin` | `Range.getClientRects()` 逐行真实矩形 | ✓ 作为 precise 模式 |
| `dps` | `includeElement(node, draw)` + `init()` 钩子 | ✓ 配置式钩子 |
| `skeleton-chrome-extension` | LI + TR 列表识别 | ✓ |
| `smarty-skeleton-v2` | Service Worker 预加载 | ✗ 与 SSG-lite 重复 |
| `smarty-skeleton`（standalone） | TS 重写，但**算法回退** | ✗ 反面教材 |

---

## 5. 每份 step 文档的统一节段

每份 `step` md 都按以下 7 节组织，便于 1:1 对应工程任务：

1. **目标** —— 解决什么问题，用一句话说清
2. **前置依赖** —— 哪几个 step 必须先完成
3. **关键设计** —— 含必要的 mermaid 与决策依据
4. **代码骨架** —— 伪代码 / 接口签名 / 文件相对路径
5. **文件改动清单** —— 新增/修改/删除的精确路径
6. **验收标准** —— 自动化测试或 CI 可断言的条件
7. **已知坑 & 测试用例** —— 防止后人踩同样的坑

---

## 6. 与旧三份文档的对应关系

| 旧文档章节 | 新文档落点 | 备注 |
|---|---|---|
| `skeleton-architecture-design.md` §3 SkeletonScheduler | [42-Open-Questions-后置.md](./42-Open-Questions-后置.md) | 延后；触发条件=实测 INP 退化 |
| `skeleton-architecture-design.md` §4.1/§5.1 SSR | [11-step2](./11-step2-vite-plugin-SSG-lite.md) | 重写为 SSG-lite |
| `skeleton-architecture-design.md` §4.3 接口态 | [14-step5](./14-step5-Bound显式接口态.md) | 简化为显式 `<Bound>` |
| `skeleton-architecture-design.md` §5.2 RN | [30-step11-RN-后端.md](./30-step11-RN-后端.md) | 保留主体 |
| `skeleton-architecture-design.md` §5.3 小程序 | [31-step12-Taro-小程序后端.md](./31-step12-Taro-小程序后端.md) | 保留主体 |
| `skeleton-architecture-design.md` §7 Teardown | [01-架构与模型.md](./01-架构与模型.md) §5 | 提到架构层共用 |
| `skeleton-architecture-design.md` §6.1 文本 gradient | [02-最佳生成算法.md §7](./02-最佳生成算法.md) | 上升为算法核心 |
| `ssr-injection-design.md` 全文 | [10-step1](./10-step1-snippet生成器.md) + [11-step2](./11-step2-vite-plugin-SSG-lite.md) + [12-step3](./12-step3-SPA-router-bridge.md) | 拆 3 份 |
| `ssr-injection-design.md` §五 Transform Stream 中间件 | [42-Open-Questions-后置.md](./42-Open-Questions-后置.md) | 延后 |
| `skeleton-build-pipeline-design.md` §3 dev:ske | [16-step7](./16-step7-DevSave-与dev-ske.md) | 保留 |
| `skeleton-build-pipeline-design.md` §4 断点扫描 | [15-step6](./15-step6-断点自动扫描.md) | 保留 |
| `skeleton-build-pipeline-design.md` §5 binding graph | [14-step5](./14-step5-Bound显式接口态.md) + [42](./42-Open-Questions-后置.md) | 保留显式 / 延后自动 |
| `skeleton-build-pipeline-design.md` §7 异步扫描 | [42-Open-Questions-后置.md](./42-Open-Questions-后置.md) | 延后 |
| `skeleton-build-pipeline-design.md` §8 check | [18-step9](./18-step9-check-CLI-深层依赖.md) | 重写为 esbuild metafile |
| —（无对应章节） | [02-最佳生成算法.md](./02-最佳生成算法.md) | **全新**，本次重构的算法核心 |

---

## 7. 实施节奏建议

- **Week 1–2**：跑通 [step1](./10-step1-snippet生成器.md) → [step3](./12-step3-SPA-router-bridge.md)，在一个 Vite Demo 上验证 page 级 SSG-lite + 路由切换
- **Week 3–4**：[step4](./13-step4-SWC-runtime-inject.md) → [step5](./14-step5-Bound显式接口态.md)，组件级骨架 + 显式 `<Bound>`
- **Week 5**：[step6](./15-step6-断点自动扫描.md) + [step7](./16-step7-DevSave-与dev-ske.md)，开发流闭环
- **Week 6**：[step8](./17-step8-Playwright批量与Visual-Diff.md) + [step9](./18-step9-check-CLI-深层依赖.md) + [step10](./19-step10-pre-commit-与-CI.md)，CI 闭环
- **Week 7+**：[step11](./30-step11-RN-后端.md) → [step12](./31-step12-Taro-小程序后端.md) 三端扩展
- **任何时点**：[40-验收清单](./40-验收清单-G1-G8.md) 滚动验收，[41-Rollout](./41-Rollout-里程碑与回滚.md) 灰度
