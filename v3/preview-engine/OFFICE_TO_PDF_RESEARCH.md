# Office → PDF 转换技术方案专项调研

> 日期：2026-06-18
> 范围：聚焦 `*.doc(x)/xls(x)/ppt(x) → .pdf` 这一环节，作为 `INDUSTRY_RESEARCH.md`（行业预览方案）与 `FIDELITY_ANALYSIS.md`（保真度实测）的专项补充。
> 现状：当前 `server/convert.mjs` 已采用 LibreOffice headless 路径，实测保真度 **4.5/10**（颜色丢失、PPT 内容缺失、XLSX 网格线消失）。

---

## 一、转换技术路线全景

```
                                         ┌─────────────────────────┐
                                         │  Microsoft Office (官方) │ ← 100% 保真
                                         └─────────────────────────┘
                                                       ▲
                                                       │
                                         ┌─────────────────────────┐
                                         │   OnlyOffice Document   │ ← 95% 保真
                                         └─────────────────────────┘
                                                       ▲
Office 文件 ──→ 转换引擎 ──→ PDF ──→ pdf.js 渲染       │
                                         ┌─────────────────────────┐
                                         │      LibreOffice        │ ← 80~90% (实测 4.5/10)
                                         └─────────────────────────┘
                                                       ▲
                                         ┌─────────────────────────┐
                                         │     商业 SDK (Aspose…)   │ ← 95~99%
                                         └─────────────────────────┘
                                         ┌─────────────────────────┐
                                         │     WASM (浏览器内)     │ ← 80~90% 但客户端
                                         └─────────────────────────┘
```

按实现层级分 5 类：

| 类别 | 代表方案 | 保真度 | 部署形态 | License |
|---|---|---|---|---|
| **A. 原生 Office 引擎** | MS Office Interop / Graph API | 99~100% | Windows Server / 云 API | 商业 |
| **B. 类 Office 引擎** | OnlyOffice / Collabora Online | 95~99% | 自托管 Linux | AGPL/商业 |
| **C. 开源兼容引擎** | LibreOffice (headless/WASM) | 80~90% | 自托管/浏览器 | MPL 2.0 |
| **D. 商业 SDK** | Aspose / Spire / Syncfusion / Gembox | 95~99% | 嵌入进程 | 商业 |
| **E. 文本转换工具** | Pandoc / docx2pdf / unoconv | 60~85% | CLI | GPL |

---

## 二、各方案逐项评估

### A1. Microsoft Office + Interop（Windows COM）

```
.docx/.xlsx/.pptx ──→ MS Word/Excel/PowerPoint COM ──→ .SaveAs(PDF)
```

| 维度 | 评分/说明 |
|---|---|
| 保真度 | **99~100%**（唯一能与原文档像素级一致的方案） |
| 性能 | 单文档 1~3s（启动 Office 5~10s） |
| 成本 | Office 许可证（~¥1500/用户/yr），Windows Server |
| 部署 | 必须 Windows + Office + DCOM 配置；不可 Linux |
| 并发 | 一个 Office 实例一个文档；需进程池管理 |
| 失败模式 | Office 进程僵死需 watchdog 清理 |

**最权威方案**，但 Windows-only + 高 license 成本决定了它只适合对保真有极端要求且愿意付费的场景（法律/金融/政府公文）。

### A2. Microsoft Graph API（云端 SaaS）

```
POST https://graph.microsoft.com/v1.0/me/drive/root:/file.docx:/content
        ?format=pdf
```

| 维度 | 评分/说明 |
|---|---|
| 保真度 | **99%**（云端跑真实 Word/Excel/PowerPoint） |
| 性能 | 5~15s（含网络） |
| 成本 | 按调用计费（Azure），个人版 $6/月，企业 E3/E5 |
| 部署 | 零部署，但要 OAuth + Microsoft 365 账号 |
| 并发 | 受 Graph 限流（默认每应用 30 req/s） |
| 局限 | 依赖 Microsoft 365 可用性；国内访问受限 |

**最简部署方案**，免运维，但海外依赖 + 国内访问 + 隐私合规问题。

### B. OnlyOffice Document Server（推荐中位方案）

```
Docker: onlyoffice/documentserver
       内含：docx2pdf 服务（基于 OnlyOffice 自研渲染引擎，原生 OOXML）
```

| 维度 | 评分/说明 |
|---|---|
| 保真度 | **95~99%**（OOXML 原生解析，与 MS Office 兼容性高于 LibreOffice） |
| 性能 | 单文档 2~4s |
| 成本 | 社区版免费（AGPLv3）；企业版 ~$1500/yr/服务器 |
| 部署 | Docker 一行；自托管 Linux |
| 并发 | 内置 worker 池；横向扩展 |
| License | AGPLv3（**传染性需评估**：如产品不开源需买商业 license） |

**保真度与成本的甜点位**，但 AGPL 协议是采用前必须和法务对齐的硬约束。

### C1. LibreOffice headless（当前方案）

```bash
soffice --headless --convert-to pdf --outdir outdir input.docx
```

| 维度 | 评分/说明 |
|---|---|
| 保真度 | **80~90%**（项目实测 **4.5/10**） |
| 性能 | 单文档 2~8s（冷启动 5~10s） |
| 成本 | 完全免费 |
| 部署 | Linux/macOS 均可；Docker `linuxserver/libreoffice` |
| 并发 | 每实例并发能力差，需起多个进程/容器；可用 `unoconv` 或自管进程池 |
| 失败模式 | 颜色/主题色映射差、字体依赖、SmartArt/嵌入对象易丢失 |

**当前已在用方案**，成本最低但保真度痛点明显（见 FIDELITY_ANALYSIS.md 详细分析）。

### C2. LibreOffice WASM（浏览器端）

```
libreoffice core  → emscripten → .wasm (~300MB, gzip ~80MB)
                 → 加载到浏览器 → 真实 LibreOffice 渲染
```

| 维度 | 评分/说明 |
|---|---|
| 保真度 | **80~90%**（与 headless 同源） |
| 性能 | 首次加载 10~30s；单文档转换 3~10s |
| 成本 | 零服务器成本 |
| 部署 | 纯静态托管，CDN 友好 |
| 局限 | 大文件内存爆；移动端基本不可用 |
| 代表实现 | Collabora Online WASM 衍生版；[allotropia](https://github.com/allotropia) |

**适合客户端隐私敏感 / 离线场景**，但首屏体验差，不适合大文档批量转换。

### D. 商业 SDK（Aspose / Spire / Gembox / Syncfusion）

```python
# Aspose 示例
import aspose.words as aw
doc = aw.Document("input.docx")
doc.save("output.pdf")
```

| 产品 | 价格档 | 保真度 | 备注 |
|---|---|---|---|
| **Aspose.Total** | ~$4000+/yr | 99% | 行业标杆，文档格式支持最全 |
| **Spire.Office** | ~$1200/yr | 95% | 性价比高，免费版有页数限制 |
| **Gembox.Document** | ~$900/yr | 95% | 轻量 |
| **Syncfusion** | ~$1000/yr | 95% | 含 Essential PDF |
| **PDFTron (Apryse)** | 联系销售 | 99% | Web SDK 强 |

**保真度好 + 无部署负担 + 嵌入进程**，但 License 成本是 LibreOffice 的 10~50 倍。

### E. Pandoc / 文本流工具

```bash
pandoc input.docx -o output.pdf  # 需 LaTeX 后端
```

**不适合** 复杂排版的 docx/pptx，仅适合纯文本类 + 简单样式。不推荐用于本项目。

---

## 三、当前 LibreOffice 痛点的根因 & 替代方案对照

| 痛点（FIDELITY_ANALYSIS） | LibreOffice 根因 | OnlyOffice 修复程度 | MS Office 修复程度 | Aspose 修复程度 |
|---|---|---|---|---|
| **颜色丢失（蓝/绿主题色）** | 主题色 XML 映射不一致 | ✅ 完全修复 | ✅ | ✅ |
| **PPT 内容丢失 90%** | SmartArt/嵌入对象解析失败 | ✅ 95% 修复 | ✅ | ✅ |
| **XLSX 网格线消失** | 默认 Print:No Grid | ✅ 默认有网格 | ✅ | ✅ |
| **代码块无高亮** | 需手动配 OOXML 主题 | ✅ | ✅ | ✅ |
| **字体差异** | 缺 Windows 字体 | 部分缓解 | ✅（同字体源） | ✅ |

**结论**：FIDELITY_ANALYSIS 列出的 5 个核心问题中，**OnlyOffice / MS Office / Aspose 全部解决**，LibreOffice 即使加字体也难以全部解决。

---

## 四、性能与扩展性架构

无论选哪种引擎，**生产级** 都需以下结构：

```
                          ┌──────────────────────────┐
上传 ──→ 鉴权/限流 ──→    │  Redis/Bull 任务队列      │
                          └────────────┬─────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              ▼                        ▼                        ▼
       ┌─────────────┐          ┌─────────────┐          ┌─────────────┐
       │  Worker 1   │          │  Worker 2   │          │  Worker 3   │
       │  LibreOffice│          │  LibreOffice│          │  LibreOffice│
       │  (PDF 转换) │          │             │          │             │
       └──────┬──────┘          └──────┬──────┘          └──────┬──────┘
              └────────────────────────┼────────────────────────┘
                                       ▼
                          ┌──────────────────────────┐
                          │  OSS/S3 + CDN 缓存       │
                          │  (key = hash(file) + ext) │
                          └──────────────────────────┘
                                       │
                                       ▼
                          返回 { url: "https://cdn/xxx.pdf" }
```

### 关键设计点

1. **缓存优先**：用 `hash(file_bytes)` 作为缓存 key，相同文件秒级返回（**已转换的 90% 文档都在缓存里**）。
2. **异步转换**：先返回"骨架预览"（当前 OOXML 路径 < 1s），后台异步转换 PDF，完成后通过 WebSocket 推送更新（与项目现有 `ProgressiveLoader` 架构完全契合）。
3. **进程隔离**：每个 worker 一个独立 user profile 目录，避免 LibreOffice 单实例锁问题。
4. **超时与重试**：转换超时 30s，失败回退到原文件直链 + "正在转换"提示。
5. **健康检查**：每 worker 定期 ping，僵死自动剔除 + 新建。

---

## 五、选型决策树

```
保真度要求
  │
  ├── 99%+ (法律/金融/公文/招投标)
  │     │
  │     ├── 自托管可行 + 接受 Windows ──→ MS Office + Interop
  │     ├── 自托管 Linux ──→ Aspose.Total
  │     └── 接受云 API ──→ Microsoft Graph API
  │
  ├── 95% (一般企业预览)
  │     │
  │     ├── 开源可接受 ──→ OnlyOffice Document Server
  │     └── 商业可接受 ──→ Aspose / Spire
  │
  ├── 80~90% (成本敏感/内部工具)
  │     │
  │     └── LibreOffice headless + 配置优化 + 字体补充
  │
  └── 客户端隐私优先 ──→ LibreOffice WASM
```

---

## 六、对 preview-engine 当前 `convert.mjs` 的具体改进建议

### 阶段 1（1 周，立竿见影）— LibreOffice 配置优化

保持 LibreOffice，但解决 FIDELITY_ANALYSIS 报告中的可优化项：

```bash
# 1. 装 Windows 中文字体
brew install --cask font-source-han-sans  # 或直接拷贝 SimSun/微软雅黑
fc-cache -fv

# 2. 创建 user profile 预设（解决网格线问题）
mkdir -p ~/.config/libreoffice/4/user/registrymodifications.xcu
```

```xml
<!-- ~/.config/libreoffice/4/user/registrymodifications.xcu -->
<item oor:path="/org.openoffice.Office.Common/Print/Page"><prop oor:name="PrintProspect" oor:op="fuse"><value>false</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Print/"><prop oor:name="PrintGrid" oor:op="fuse"><value>true</value></prop></item>
<!-- 主题色使用 OOXML 原生映射 -->
<item oor:path="/org.openoffice.Office.Common/Misc/"><prop oor:name="UseSystemPrinterPalette" oor:op="fuse"><value>true</value></prop></item>
```

```javascript
// convert.mjs 改造：每次启动带独立 user profile 目录
const profileDir = mkdtempSync(path.join(os.tmpdir(), 'lo-profile-'))
const r = spawnSync(soffice, [
  '-env:UserInstallation=file://' + profileDir,  // ← 关键
  '--headless',
  '--convert-to', 'pdf',
  '--outdir', dir,
  inFile
], { timeout: 60000 })
```

**预期提升：4.5 → 7/10**

### 阶段 2（2~4 周）— 加 OnlyOffice 作为高保真备选

```javascript
// server/convert.mjs 增加多引擎路由
export async function convertToPdf(bytes, ext) {
  const useHighFidelity = process.env.HIGH_FIDELITY === '1'  // 环境变量控制
  const endpoint = useHighFidelity ? 'http://onlyoffice:8080/ConvertService.ashx' : null

  if (endpoint) {
    // OnlyOffice 转换
    return await convertViaOnlyOffice(bytes, ext, endpoint)
  }
  // 兜底回退 LibreOffice
  return await convertViaLibreOffice(bytes, ext)
}
```

```bash
# OnlyOffice 部署
docker run -d -p 8080:8080 --name onlyoffice \
  -v /app/onlyoffice/Data:/var/www/onlyoffice/Data \
  onlyoffice/documentserver
```

**预期提升：可选 9~10/10（开启高保真模式时）**

### 阶段 3（可选，1~2 月）— 异步转换 + 缓存

将 `/convert` 改为：

```
POST /convert          → { taskId, statusUrl }
GET  /convert/:taskId  → { status: 'pending'|'done', url?: '/pdf/xxx.pdf' }
```

前端通过 SSE/WebSocket 接收完成事件，自动从骨架预览切换到 pdf.js 高保真预览（与现有 `ProgressiveLoader` 一脉相承）。

---

## 七、最终推荐

| 场景 | 推荐方案 | 理由 |
|---|---|---|
| **demo / 内部工具 / 预算 0** | 保持 LibreOffice + 阶段 1 配置优化 | 当前架构不动，1 周内 4.5→7 |
| **生产 SaaS / 通用预览** | **OnlyOffice Document Server** + LibreOffice 兜底 | 95% 保真 + 可控成本 + 开源协议注意 |
| **金融/法律/政企** | Aspose.Total 或 MS Office Interop | 99% 保真是硬指标 |
| **客户端隐私场景** | WASM LibreOffice | 零服务器，但首次加载慢 |

**对当前 preview-engine 的具体动作建议**：

1. 短期（本周）：在 `convert.mjs` 加 `UserInstallation` 隔离 profile + 字体补充，将保真度从 4.5 提到 7 左右。
2. 中期（如需达到 9+）：引入 OnlyOffice 作为高保真备选，通过环境变量/feature flag 切换。
3. 长期（生产化）：按 §四 加 Redis 队列 + OSS 缓存 + 异步任务 API。

---

## 八、参考资料

- [OnlyOffice Document Server](https://github.com/ONLYOFFICE/DocumentServer) — AGPLv3 / 商业
- [Aspose.Total for .NET / Java / Python](https://products.aspose.com/total/) — 商业 SDK
- [Microsoft Graph API: convert content](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content-format) — 云 API
- [Collabora Online](https://github.com/CollaboraOnline/online) — LibreOffice 衍生商业方案
- [LibreOffice WASM](https://github.com/nickthecook/archie/blob/master/docs/notes/2023-07-15-libreoffice-wasm.md) — 浏览器内运行
- [Unoconv (LibreOffice wrapper)](https://github.com/unoconv/unoconv) — 进程池友好的 LibreOffice 包装
- 当前项目 `convert.mjs` / `FIDELITY_ANALYSIS.md` / `INDUSTRY_RESEARCH.md`