# 备份：迁移至 OnlyOffice 转码引擎之前

- **生成时间**：2026-06-20
- **触发任务**：用户要求“之前的先备份”，随后将转码引擎切换为 OnlyOffice Document Server
- **生成模型**：Claude MiniMax-M3（MiniMax, Anthropic 兼容 SDK 接口）

## 备份文件清单（与 `MANIFEST.md5` 对照）

| 文件 | 角色 |
| --- | --- |
| `converter.mjs` | 任务入队 / 转码主流程（当前混用 OnlyOffice HTTP + docker cp 回退） |
| `scheduler.mjs` | 自研 SJF 调度器原型（.mjs 内含 TS 语法，未接入主流程） |
| `config.mjs` | 端口、路径、MIME、LibreOffice (`soffice`) 路径与渲染策略 |
| `pdf-optimize.mjs` | qpdf 线性化（fast web view） |
| `router.mjs` | HTTP 路由 / 上传 / Range 文件服务 |
| `index.mjs` | 服务入口（含 `warmupAll`） |
| `store.mjs` | 任务元数据 JSON 持久化 |
| `package.json` | 服务端依赖（仅含 `jsonwebtoken`） |

## 当时已知问题（供恢复/对比参考）

1. `converter.mjs` 在 OnlyOffice HTTP 拉取失败时会回退到 `docker cp` 与 `wget`，强依赖宿主机已装 `docker` / `wget`，且硬编码 `localhost:8080`，跨主机部署不可移植。
2. `config.mjs` 仍保留 `SOFFICE`（LibreOffice 路径），但当前主链路已不再调用，存在概念混淆。
3. `scheduler.mjs` 是 .mjs 文件但使用了 `interface / enum / class 字段声明简写` 等 TS 语法，Node 直接执行会报错；目前未被 `converter.mjs` 引用。
4. `index.mjs` 中仍打印“后台预热 soffice 池”，但当前 `warmupAll` 是 no-op。

## 验证备份完整性

```
md5sum -c MANIFEST.md5
```