# 技术调研报告：MPA → SPA 迁移方案 & 微前端方案选型

> 撰写人：didi  
> 撰写日期：2026-06-18  
> 关联文档：[tech.md](./tech.md)（Orbit v2.0 异构微前端架构设计）、[work.md](./work.md)（LLab 业务背景）  
> 业务背景：滴滴 LLab —— 行中导游（旅行路线 + 语音 AI 博客）、在哪儿问问（AI 图搜地点），形态包含 H5 / 小程序 / 后台管理；接入的子应用以**异构第三方模型 Demo**（Streamlit / Gradio / 原生 WebGL / React）为主。

---

## 0. 摘要（TL;DR）

1. **MPA → SPA 不是"一次性切换"**，而是"渐进式重构"。主流有三种范式：**路由代理（边缘层）**、**基座+子应用（运行时层）**、**模块联邦（构建时层）**。三者并非互斥，往往组合使用。
2. **微前端 ≠ 选一个框架**。核心是"**隔离强度 / 性能 / 改造成本 / 团队能力**"四个维度的取舍。
3. 在 LLab 这种**异构、不可信、必须物理防爆**的场景下，**纯 iframe 路线（Orbit v2.0）** 比 qiankun/icestark/wujie/micro-app/MF 都要更契合；尤其在面对 Streamlit / Gradio 这类**非前端框架产物**时，iframe 几乎是唯一稳妥解。
4. **2025-2026 年的微前端生态正在分化为两大阵营**：
   - **运行时隔离派**：qiankun / micro-app / wujie / icestark —— 面向"多团队、独立部署、强隔离"；
   - **模块共享派**：Module Federation（MF） / Rspack —— 面向"统一技术栈、极致性能、构建时优化"。
5. **qiankun 维护频率下降**（npm 仍停在 3.0.0-rc.19），新项目不再首推；**wujie 与 micro-app 活跃度更高**，**MF 在新建统一技术栈项目中已逐渐成为首选**。

---

## 第一部分：MPA → SPA 迁移方案调研

### 1.1 为什么需要从 MPA 迁移到 SPA

| 维度 | MPA | SPA |
|------|-----|-----|
| 页面切换体验 | 整页刷新、白屏 | 局部刷新、丝滑 |
| 公共资源 | 每页重复加载 | 一次性加载、按需懒加载 |
| 前后端职责 | 后端出 HTML，前端是"切图仔" | 前端路由 + API 数据，前后端解耦 |
| 用户体验 | 弱 | 强 |
| 工程化 | 简单 | 复杂（路由 / 状态 / 构建） |
| SEO | 友好（首屏即 HTML） | 需要 SSR / SSG 兜底 |

LLab 的"行中导游 / 在哪儿问问"对**切换流畅度、地图/语音/AI 博客的连续交互**有极高要求，MPA 整页刷新的体验会严重拖业务。

### 1.2 三大迁移范式

#### 范式 A：路由代理（边缘层 / 反向代理）

```
        ┌──────────────────────────────────┐
        │   Nginx / Gateway / Reverse Proxy │
        └──────────────┬───────────────────┘
                       │ 根据 path 路由
        ┌──────────────┴──────────────┐
        ▼                              ▼
   旧 MPA 系统                   新 SPA 系统
   /old/*                       /new/*
   /dashboard_old               /dashboard
```

- **机制**：Nginx 根据 `location` 规则把不同路径分发给不同的后端服务（旧的 SSR 服务 / 新的 SPA Node 服务）。
- **优点**：零侵入、新旧系统并存、可灰度、可回滚。
- **缺点**：跨子域共享登录态、跨子域 Cookie 需要特殊处理。
- **典型案例**：Youzan ZanSpa、Next.js Pages → App Router 的 `rewrites` 方案。

> **LLab 适用判断**：如果未来 LLab 要接入"旅行社/景点方的 H5"，**适合用 Nginx 路由代理把"第三方提供的 H5"挂在 `/partner/*` 下**，主站继续 SPA。

#### 范式 B：基座 + 子应用（运行时层 / 微前端）

```
   ┌────────────────────────────────────────────┐
   │   主基座 (Host / Shell)                     │
   │   - 鉴权、路由、骨架屏、全局状态             │
   │   - 子应用注册表、子应用加载器               │
   └──────────────┬─────────────────────────────┘
                  │ 路由劫持 / 沙箱 / iframe
   ┌──────────────┴─────────────────────────────┐
   ▼              ▼              ▼              ▼
 子应用 A       子应用 B       子应用 C       子应用 D
（React）      （Vue）       （Streamlit）    （Gradio）
```

- **机制**：主基座运行后，按路由**动态加载**子应用，子应用可独立技术栈、独立部署。
- **关键能力**：路由劫持、JS 沙箱、CSS 隔离、通信总线、生命周期管理。
- **代表方案**：qiankun、micro-app、wujie、icestark、single-spa、Orbit（自研 iframe）。
- **优点**：**业务可独立迭代、跨团队协作、技术栈解耦**。
- **缺点**：复杂度高、性能有损耗、调试有难度。

> **LLab 适用判断**：✅ **LLab 接入第三方模型 Demo 的主路径**。Streamlit/Gradio 这类子应用非常适合用"基座 + 子应用"模式集成。

#### 范式 C：模块联邦（构建时层 / MF）

```
   ┌────────────────────────────────────────┐
   │  Monorepo + Webpack 5 / Rspack         │
   │  Host 声明 consumes：                  │
   │    remoteA/Button                      │
   │    remoteB/Chart                       │
   │  Remote 声明 exposes：                 │
   │    ./Button  →  Button.tsx            │
   │    ./Chart   →  Chart.tsx             │
   └────────────────────────────────────────┘
```

- **机制**：构建期约定 `exposes` / `consumes`，运行时通过 `import()` 拉取远程模块。
- **优点**：**性能天花板**（同 bundle 调用，零沙箱开销）、天然支持模块共享、依赖解耦。
- **缺点**：**要求全栈统一 Webpack 5+ / Rspack**、无沙箱需自律、跨仓库版本管理复杂。
- **代表方案**：Module Federation 1.0/1.5/2.0、`@module-federation/enhanced`、`@originjs/vite-plugin-federation`、EMP、Rspack Federation。

> **LLab 适用判断**：❌ **不太适用**。LLab 子应用是异构第三方（Streamlit/Gradio），不是前端项目，无法走构建时联邦。

### 1.3 渐进式迁移路径（业界共识）

> **核心原则**：不要"大爆炸"重写，要 **coexistence（共存）→ routing control（路由分流）→ data consistency（数据一致）→ continuous validation（持续验证）**。

#### Step 1：搭建基座（Shell）

- 选型 React + Vite + React Router（或 Vue3 + Vite + Vue Router）。
- 抽离公共能力：登录态、Layout、Topbar、Sider、面包屑、骨架屏、监控 SDK。
- 子应用注册表：`apps` 数组，每项含 `name / entry / activeRule / container / props`。

#### Step 2：边缘层路由分流

- Nginx 规则：旧系统 `/legacy/*`，新基座 `/`。
- 旧域名 / 旧路径完全不动，新业务从 `/` 起步。

#### Step 3：业务模块逐个接入

- 选**复杂度最低**的业务先迁（如"个人中心"），验证流水线。
- 每迁一个模块就下线一个旧 HTML 页面。
- 子应用优先用 `umd` 入口或 `systemjs` 动态加载。

#### Step 4：状态与权限统一

- 主基座统一签发 Token，子应用通过 props 接收。
- 全局用户信息、菜单权限走基座 `store` / `context`。

#### Step 5：流量切换 & 旧系统下线

- 按灰度比例把 `/old/*` 流量切到 `/new/*`。
- 全部切完后，停止旧服务、删除旧代码。

#### 迁移路径示意

```
Phase 1（1-2 月）         Phase 2（2-3 月）         Phase 3（1-2 月）
───────────────          ───────────────          ───────────────
基座 + 鉴权 + Layout     迁移核心业务 1-2 个       迁移剩余业务
Nginx 双轨               子应用接入 1-2 个          灰度切流
旧系统独立运行            旧系统继续承载             旧系统下线

        ─────────────────────────────────────►
                            时间
```

#### 项目规模决策

| 项目规模 | 推荐策略 |
|---------|---------|
| < 10 页面、页面间耦合低 | 渐进式逐页迁移 |
| > 10 页面、用户体验要求高 | 零停机（基座+子应用并行） |
| 新项目 | 直接 SPA / SSR，**不要从 MPA 起步** |

### 1.4 迁移成本与风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| 鉴权状态丢失 | 用户被踢出 | 主基座统一 Token，子应用从 props 接收 |
| 跨域 Cookie | 第三方接口失败 | 统一同源 / Bridge 代理 |
| 样式串扰 | UI 错位 | 沙箱 + 工程化（CSS Modules / Shadow DOM） |
| 路由冲突 | 子应用 404 | 基座统一路由表，子应用禁止顶层路由 |
| 性能回退 | 白屏/卡顿 | 预加载 + Skeleton + 性能监控 |
| 调试困难 | 排障慢 | 完善 SourceMap、统一日志规范 |

---

## 第二部分：微前端方案调研

### 2.1 主流方案全景对比

| 框架 | 团队 | 原理 | 沙箱强度 | Vite 支持 | IE 兼容 | 维护活跃度 | 适用场景 |
|------|------|------|----------|-----------|---------|-----------|---------|
| **single-spa** | single-spa 社区 | 生命周期调度 | ❌ 无 | ⚠️ 需插件 | ✅ | ⭐⭐⭐⭐ | 自研基座、深度定制 |
| **qiankun** | 蚂蚁金服 | single-spa + HTML Entry + Proxy 沙箱 | ⭐⭐⭐⭐ | ⚠️ 需插件 | ✅ | ⚠️ **维护停滞** | 存量多技术栈后台 |
| **icestark** | 阿里飞猪/淘系 | ES Module / UMD / single-spa | ⭐⭐⭐ | ✅ 原生 | ⚠️ | ⭐⭐⭐ | 新建统一技术栈 |
| **micro-app** | 京东 | Web Components + 资源劫持 | ⭐⭐⭐ | ✅ 原生 | ⚠️ | ⭐⭐⭐⭐ | 渐进迁移、Vue3 |
| **wujie（无界）** | 腾讯 | Web Components + iframe 沙箱 | ⭐⭐⭐⭐⭐ | ✅ 原生 | ✅ | ⭐⭐⭐⭐⭐ | 金融/政务高敏感、老旧系统 |
| **Module Federation** | Webpack 官方 | 构建时模块共享 | ❌ 无 | ⚠️ 社区插件 | ⚠️ | ⭐⭐⭐⭐⭐ | 新建统一技术栈、模块生态 |
| **garfish** | 字节跳动 | HTML Entry + Proxy 沙箱 | ⭐⭐⭐ | ✅ | ✅ | ⭐⭐⭐ | 中后台 |
| **hel-micro** | 腾讯 | 预加载优化 + 模块共享 | ⭐⭐ | ✅ | ⚠️ | ⭐⭐⭐ | 模块共享 |
| **Orbit（自研）** | 滴滴 LLab（参考 tech.md） | 纯 iframe + Bridge + 预热池 | ⭐⭐⭐⭐⭐ | ✅ | ✅ | 自研可控 | **异构/不可信/物理防爆** |

### 2.2 核心能力矩阵

| 能力 | single-spa | qiankun | icestark | micro-app | wujie | MF | Orbit |
|------|-----------|---------|----------|-----------|-------|-----|-------|
| 子应用保活（keep-alive） | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| 多应用同时激活 | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |
| JS 沙箱 | ❌ | ✅ Proxy | ✅ Proxy | ✅ Proxy | ✅ iframe | ❌ | ✅ iframe |
| CSS 隔离 | ❌ | ✅ Strict | ⚠️ Module | ✅ Scoped | ✅ Shadow DOM | ⚠️ 需自律 | ✅ 天然 |
| ESM/Vite 友好 | ❌ | ⚠️ | ✅ | ✅ | ✅ | ⚠️ | ✅ |
| 预加载 | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| 零改造接入 | ❌ | ✅ HTML Entry | ⚠️ | ✅ | ✅ | ❌ | ✅ URL |
| 第三方框架产物 | ❌ | ❌ | ❌ | ❌ | ⚠️ | ❌ | ✅ Streamlit/Gradio |
| 调试便利度 | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 性能 | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |

### 2.3 五大主流方案详解

#### 2.3.1 single-spa（鼻祖）

**原理**：
- 主应用注册子应用（`registerApplication`），声明 `activeWhen`（URL 路由前缀）。
- 监听 `hashchange` / `popstate`，匹配后顺序执行子应用生命周期：`load → bootstrap → mount → unmount → unload`。

**优点**：
- 最灵活，可自定义所有细节。
- 是 qiankun / icestark / garfish 的基石。

**缺点**：
- **不提供沙箱**、不提供 HTML Entry、不提供通信机制。
- 子应用必须暴露 `bootstrap/mount/unmount`，**改造成本高**。
- 无 CSS 隔离。

> **LLab 判断**：**不直接使用**，但理解了 single-spa 等于理解了所有运行时微前端的根基。

#### 2.3.2 qiankun（蚂蚁金服）

**原理**：
- 基于 single-spa 二次封装，提供 **HTML Entry**（子应用无需改造）。
- 沙箱：SnapshotSandbox（老浏览器）→ LegacySandbox → **ProxySandbox**（多实例）。
- CSS 隔离：Strict / Experimental。

**优点**：
- **国内生态最成熟、文档最全、案例最多**。
- 零改造接入任意技术栈子应用。
- Proxy 沙箱支持多实例。

**缺点**：
- **维护频率下降**（npm 3.0.0-rc.19 长期不更新，文档以 Vue 2 示例为主）。
- Vite 需装 `vite-plugin-qiankun`，**踩坑多**。
- Proxy 拦截在主子应用都多时性能损耗明显。
- CSS 隔离不彻底，老项目全局样式仍可能串扰。

> **LLab 判断**：**适合传统后台业务**。LLab 子应用是 Streamlit/Gradio，**HTML Entry 模式与 Streamlit 的实际产物有兼容问题**，不太合适。

#### 2.3.3 icestark（阿里飞猪）

**原理**：
- ES Module / UMD / single-spa 多入口支持。
- 沙箱：Proxy + VM。
- 通信：store / props / Event Emitter。

**优点**：
- **对 React/Angular 新项目体验最丝滑**。
- Vite 原生支持好。
- API 简洁，配置少。

**缺点**：
- **对老旧 / 异构项目支持弱**（需子应用有 ESM 入口或构建插件）。
- 沙箱与样式隔离能力弱于 wujie。
- 多应用同时激活支持差（路由切换即替换）。

> **LLab 判断**：**不适用**。LLab 子应用是黑盒（Streamlit/Gradio），icestark 假设子应用是"现代前端项目"。

#### 2.3.4 micro-app（京东）

**原理**：
- 基于 **Web Components**（customElement + Shadow DOM）作为容器。
- 子应用以 `<micro-app name="..." url="...">` 标签引入。
- JS 沙箱复用 qiankun 的 Proxy 机制。

**优点**：
- **API 极简，像使用组件一样使用微前端**。
- 对 Vite 原生支持。
- 静态资源预加载、子应用保活。
- 改造成本极低。

**缺点**：
- **JS 沙箱基于 Proxy，隔离强度弱于 iframe**。
- 依赖 Web Components，**老浏览器不支持**。
- 自定义能力有限。

> **LLab 判断**：**部分适用**。如果未来 LLab 接入的子应用都是"现代前端产物（React/Vue + Vite）"，micro-app 是性价比最高的方案。

#### 2.3.5 wujie 无界（腾讯）

**原理**：
- Web Components 作为容器（customElement）。
- **子应用运行在 iframe 中**（物理隔离），通过 `postMessage` + 事件代理实现"看起来像组件"的效果。
- 解决了 iframe 的 URL 同步、路由控制、iframe 销毁/保活等所有痛点。

**优点**：
- **物理级 JS / CSS 隔离**（iframe 天然）。
- **零改造接入**任意子应用。
- Vite 原生支持。
- 子应用保活、多应用同时激活、preload 完整支持。
- 国内银行/金融/政务有大量落地。

**缺点**：
- 通信基于 `postMessage`，有序列化/反序列化成本。
- iframe 上下文对 DevTools 调试略复杂。
- React 16 等老版本偶有兼容问题。

> **LLab 判断**：**强烈推荐**。wujie 实际上是"**iframe 物理隔离 + 现代微前端 API 体验**"的组合，与 LLab 的核心诉求（异构、不可信、物理防爆）高度匹配，**且不需要自研**。

#### 2.3.6 Module Federation（Webpack 5）

**原理**：
- 构建期：`exposes`（远端暴露的模块） + `remotes`（远端消费的模块）。
- 运行期：动态 `import()` 远程模块，运行时共享依赖。

**优点**：
- **性能天花板**：同 bundle 直接调用，零沙箱开销。
- 模块共享、版本管理、Monorepo 友好。
- 跨团队代码复用能力强。

**缺点**：
- **要求全栈 Webpack 5+ / Rspack**。
- **无沙箱**，需工程化自律（CSS 命名空间、依赖版本）。
- Vite 需 `@originjs/vite-plugin-federation`。
- 不适合"独立部署的异构子应用"。

> **LLab 判断**：**不适用**。LLab 主体是异构第三方 Demo，MF 假设"所有子应用都是前端项目"。

### 2.4 选型决策树

```
开始
  │
  ├─ Q1: 子应用是异构 / 不可信 / 黑盒产物（Streamlit/Gradio/WebGL）？
  │    │
  │    ├─ 是 → iframe 路线 ✅
  │    │       ├─ 自研（Orbit v2.0，物理隔离 + 预热池 + Bridge）✅ LLab 现行方案
  │    │       └─ wujie（开源现成，腾讯背书）✅ 推荐评估
  │    │
  │    └─ 否 ↓
  │
  ├─ Q2: 团队技术栈是否高度统一（全部 React / 全部 Vue）？
  │    │
  │    ├─ 是 → MF + Monorepo（性能天花板）
  │    │
  │    └─ 否 ↓
  │
  ├─ Q3: 是否需要"零改造"接入存量多技术栈系统？
  │    │
  │    ├─ 是 → qiankun / wujie（HTML Entry + iframe）
  │    │
  │    └─ 否 ↓
  │
  ├─ Q4: 是否 Vite + Vue3 / React 18+ 新项目？
  │    │
  │    ├─ 是 → micro-app（最丝滑的现代体验）
  │    │
  │    └─ 否 → single-spa 自研 / qiankun
```

### 2.5 2025-2026 趋势总结

1. **两大阵营分化**：
   - **运行时隔离派**（qiankun / wujie / micro-app / icestark）：持续深耕企业级复杂场景。
   - **模块共享派**（MF / Rspack Federation）：成为新建统一技术栈项目的首选。
2. **iframe 路线回潮**：金融/政务/AI 大模型等高敏感场景，wujie（基于 iframe）持续被采纳。
3. **qiankun 维护停滞**：npm 仍停 3.0.0-rc.19，**新项目不再首推**。
4. **浏览器原生微前端雏形**：`Import Maps` + `Web Components` 规范成熟，未来 2-3 年可能出现浏览器原生微前端 API。
5. **Rspack Federation**：MF 2.0 在 Rust 构建工具上的演进，**性能进一步提升**。

---

## 第三部分：结合 LLab 业务的方案选型

### 3.1 LLab 业务画像

| 维度 | 现状 |
|------|------|
| 业务 | 行中导游（路线+语音+AI 博客）、在哪儿问问（AI 图搜地点） |
| 形态 | H5、小程序、后台管理 |
| 子应用来源 | **异构第三方模型 Demo**（Streamlit / Gradio / 原生 WebGL / React） |
| 核心诉求 | **物理防爆隔离**、**极速冷启动**、**单页级体验** |
| 已有方案 | Orbit v2.0（纯 iframe + Bridge + 预热池），详见 [tech.md](./tech.md) |

### 3.2 子应用分类与适配

| 子应用类型 | 典型 | 物理隔离需求 | 推荐接入方式 |
|------------|------|--------------|--------------|
| **Streamlit / Gradio** | 算法团队 Demo | ⭐⭐⭐⭐⭐ 强 | **iframe（Orbit）** / wujie |
| **原生 WebGL / Three.js** | 3D 可视化 | ⭐⭐⭐⭐ 强（独立 GPU 上下文） | **iframe（Orbit）** |
| **第三方 React Demo** | 外部团队 | ⭐⭐⭐⭐ | wujie / micro-app |
| **内部 React/Vue 模块** | 自研 | ⭐⭐ | wujie / micro-app / MF |

### 3.3 方案对比（针对 LLab）

| 方案 | 物理隔离 | 黑盒友好 | 改造成本 | 性能 | 维护成本 | LLab 适配度 |
|------|----------|----------|----------|------|----------|-------------|
| **Orbit v2.0（自研 iframe）** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐（零） | ⭐⭐⭐ | 中 | ⭐⭐⭐⭐⭐ **当前主路径** |
| **wujie** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | 低（开源） | ⭐⭐⭐⭐⭐ **次选/可逐步替代 Orbit 部分能力** |
| **qiankun** | ⭐⭐⭐ | ⭐ | ⭐⭐⭐ | ⭐⭐ | 高（停滞） | ⭐⭐ |
| **micro-app** | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | 中 | ⭐⭐⭐ |
| **icestark** | ⭐⭐⭐ | ⭐ | ⭐⭐ | ⭐⭐⭐ | 中 | ⭐⭐ |
| **Module Federation** | ❌ | ❌ | ⭐ | ⭐⭐⭐⭐⭐ | 中 | ❌（异构不适用） |
| **single-spa 自研** | 自定 | 自定 | ⭐ | ⭐⭐⭐ | 高 | ⭐⭐ |

### 3.4 推荐的演进路径

#### 短期（0-3 月）：继续夯实 Orbit v2.0

- ✅ 已有方案（详见 [tech.md](./tech.md)），重点：
  - 完善 `SnifferConfig` 热更新机制；
  - 优化 LRU 预热池的命中率（目标 > 60%）；
  - 沉淀 Bridge SDK 的标准化协议。

#### 中期（3-6 月）：引入 wujie 评估

- 对**可控的 React/Vue 子应用**试点 wujie（享受开箱即用的微前端体验）。
- 与 Orbit 并存：Orbit 负责**异构/不可信**子应用，wujie 负责**统一技术栈**子应用。
- 双轨运行一段时间后再决定是否收敛。

#### 长期（6-12 月）：构建 LLab 微前端生态

- 抽象出 **"Orbit Bridge 协议"** 作为子应用接入标准（无论子应用是 iframe 还是 wujie）。
- 建设**子应用脚手架**（LLab SubApp Template），让算法团队可一键产出可被 Orbit 接入的 Demo。
- 形成 **"基座 + 异构子应用 + 同构子应用"** 的混合微前端架构。

### 3.5 关键技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 基座技术栈 | React 18 + Vite + TypeScript | 与 LLab 现状一致，HMR 快、构建快 |
| 主路由 | React Router v6 | 嵌套路由清晰、与 wujie/orbit 集成方便 |
| 状态管理 | Zustand / Jotai | 轻量、对子应用友好 |
| 通信协议 | 自研 `IframeBridge`（JSON-RPC 2.0）+ wujie 通信 | 异构与同构双轨 |
| 异构子应用接入 | Orbit v2.0（iframe + 预热池） | Streamlit/Gradio 唯一稳妥解 |
| 同构子应用接入 | wujie | 现代体验 + 物理隔离 + 零改造 |
| 监控 | Sentry + 自研 orbit-metrics | 错误追踪 + 性能指标 |
| 部署 | Vercel / 滴滴内部平台 | 边缘加速 + 灰度发布 |

---

## 第四部分：附录

### 4.1 参考资料

#### MPA→SPA 迁移
- [适用于既有大型MPA项目的"微前端"方案（Youzan ZanSpa）](https://tech.youzan.com/gua-yong-yu-ji-you-da-xing-mpaxiang-mu-de-wei-qian-duan-fang-an/)
- [Incremental Migration: Evolving Without Breaking Production](https://medium.com/@navidbarsalari/incremental-migration-evolving-without-breaking-production-edf679769918)
- [Next.js Pages Router → App Router 迁移实战指南](https://eastondev.com/blog/zh/posts/dev/20251218-nextjs-pages-to-app-router-migration/)
- [基于 Vue 技术栈的微前端方案实践](https://www.w3cschool.cn/article/6dd12f8d678636.html)

#### 微前端框架对比
- [2025年-微前端方案（Williamson's Blog）](https://dhc.ink/archives/2025nian-wei-qian-duan-fang-an)
- [qiankun、micro-app、wujie，2025年我们该选谁？](https://opc.csdn.net/696dfbb5437a6b4033692c2f.html)
- [腾讯无界 wujie：完善解决微前端核心诉求](https://cloud.tencent.com/developer/article/2164474)
- [微前端架构技术选型，到底怎么选（2024版）](https://blog.itmirror.top/article/EghMdVMXQo5BysxQPVmcE9PDnwh)
- [2025微前端框架全景对比（Grewer）](https://www.cnblogs.com/Grewer/p/19423335)
- [主流微前端框架与方案总览](https://www.cnblogs.com/yangykaifa/p/19605238)
- [一文打通微前端：qiankun/microapp/icestark/wujie 全解析](https://juejin.cn/post/7397024981571731495)
- [qiankun、microapp、wujie 前端微服务框架比较](https://www.cnblogs.com/zhouyun-yx/p/18326645)
- [React微前端实战：Module Federation 架构设计与落地避坑](https://blog.csdn.net/weixin_30509393/article/details/97365361)

### 4.2 关键术语

| 术语 | 含义 |
|------|------|
| **MPA** | Multi-Page Application，多页面应用，每次跳转都是整页刷新 |
| **SPA** | Single-Page Application，单页面应用，路由切换不刷新页面 |
| **Micro Frontend** | 微前端，将微服务思想延伸到前端，让多个子应用协同工作 |
| **沙箱（Sandbox）** | 子应用与主应用之间的 JS/CSS 隔离机制 |
| **HTML Entry** | 以子应用的 `index.html` 作为入口加载（qiankun 特色） |
| **Module Federation** | Webpack 5 提出的"构建时模块共享"协议 |
| **Host / Remote** | MF 中的"消费方 / 提供方" |
| **Keep-alive** | 子应用切换时不销毁，仅隐藏，再次进入时恢复状态 |
| **Preload** | 提前加载子应用资源，提升切换速度 |
| **Import Maps** | 浏览器原生 ESM 映射规范，未来微前端的潜在基础 |

### 4.3 关键能力评估量表（选型打分卡）

> 打分范围 1-5（5 最好），用于多方案并行评估。

| 评估维度 | 权重 | Orbit v2.0 | wujie | qiankun | micro-app | icestark | MF |
|----------|------|-----------|-------|---------|-----------|----------|-----|
| 物理隔离 | 25% | 5 | 5 | 3 | 3 | 3 | 1 |
| 黑盒友好 | 20% | 5 | 5 | 2 | 2 | 2 | 1 |
| 改造成本 | 15% | 5 | 5 | 4 | 4 | 3 | 2 |
| 性能 | 15% | 3 | 3 | 3 | 3 | 3 | 5 |
| 维护活跃度 | 10% | 5 | 5 | 2 | 4 | 3 | 5 |
| 文档/社区 | 10% | 3 | 4 | 5 | 4 | 3 | 5 |
| 团队学习成本 | 5% | 4 | 4 | 4 | 4 | 4 | 3 |
| **加权得分** | - | **4.45** | **4.50** | **3.25** | **3.30** | **2.90** | **2.65** |

> 结论：针对 LLab 业务，**wujie 与 Orbit v2.0 几乎并列第一**。Orbit 自研可控但维护成本高，wujie 开箱即用、活跃度高，建议**长期用 wujie 替代 Orbit 的部分能力**。

---

## 第五部分：行动清单（Action Items）

| 优先级 | 事项 | 负责人 | 预期时间 |
|--------|------|--------|----------|
| P0 | 完善 Orbit v2.0 文档 & 单元测试覆盖率 | @didi | 1 周 |
| P0 | 抽象 `Bridge` 协议为独立 npm 包 | @didi | 2 周 |
| P1 | 引入 wujie 并在 LLab 子项目试点一个 React Demo | @didi | 1 月 |
| P1 | 制定 LLab 子应用脚手架（SubApp Template） | @didi | 1.5 月 |
| P2 | 调研 Module Federation 2.0 / Rspack Federation | @didi | 2 月 |
| P2 | 制定 LLab 微前端规范文档 | @didi | 2 月 |
| P3 | 评估 `Import Maps` 浏览器原生方案 | @didi | 3 月 |

---

> **结语**：MPA→SPA 不是"切换"，是"演化"；微前端不是"选框架"，是"选取舍"。  
> 在 LLab 这种"异构、不可信、AI 大模型"语境下，**iframe 物理隔离是当下最稳的底色**（Orbit 或 wujie），**MF/Rspack 是未来模块化生态的演进方向**。两条腿走路，**短期用 iframe 兜底安全，长期用模块联邦提升效率**。
