# 文档在线预览：业界做法调研

> 对标参考，用于把本项目从「模式 2 标配」升级到「模式 4 前沿」。
> 调研日期：2026-06-19

---

## 一、四种主流架构模式

| 模式 | 代表产品 | 适用 | 备注 |
|---|---|---|---|
| 1. 纯客户端渲染（JS/WASM） | pdf.js、GitHub 预览 | PDF/图片/文本 | Office 格式基本做不了 |
| 2. 服务端转 PDF + 客户端渲染 | Box、Dropbox、钉钉、飞书预览、百度文库 | 全格式 | **业界 80% 公司标配**，本项目当前层级 |
| 3. 服务端渲染 + 显示指令流 | Google Docs、Office Online、腾讯文档 | 全格式 + 可编辑 | 工程门槛最高 |
| 4. 客户端 WASM 全格式引擎 | PSPDFKit/Apryse、福昕、ONLYOFFICE | 全格式 | 当前最前沿 |

**本项目定位**：模式 2 → 目标往模式 4 靠拢（不一定做到 ONLYOFFICE 完整度，至少具备 1-2 个模式 4 特征）。

---

## 二、具体产品技术栈（公开资料）

| 产品 | Office 渲染 | PDF 渲染 | 协同 | 关键特征 |
|---|---|---|---|---|
| Google Docs（导入文件） | 服务端转 Pike | 自研 Canvas | OT（已发论文） | 服务端引擎 + 字体子集化 CDN |
| Microsoft Office Online | 服务端跑真实 Office 引擎 | 同左 | OT | WOPI 协议 + 显示指令流 |
| ONLYOFFICE | **纯浏览器端**自研引擎 | 同左 | OT | Canvas + WASM，**最值得读的开源代码** |
| WPS WebOffice | 服务端 + SDK | 自研 | 自研 | 商业 SDK |
| 福昕 Foxit WebPDF | 服务端转 | **自研 WASM PDF 引擎**（非 pdf.js） | - | 与 Chrome pdfium 同源 |
| PSPDFKit / Apryse | 服务端转 | **自研 WASM** 客户端 | - | WASM SIMD，商业标杆 |
| Box / Dropbox | LibreOffice 转 PDF | pdf.js | - | 模式 2 |
| 钉钉 / 飞书预览 | LibreOffice 转 PDF | pdf.js | - | 模式 2（与本项目同） |
| 腾讯文档预览 | 服务端转 XDOC 私有格式 | 自研 | - | 半模式 3 |

---

## 三、专家级可借鉴的深度点（业界已验证）

| 深度点 | 业界对标 | 实现难度 | 简历杀伤力 |
|---|---|---|---|
| WASM 客户端渲染 PDF | 福昕 / PSPDFKit | 高 | ⭐⭐⭐⭐⭐ |
| Worker 池 + SharedArrayBuffer 并行 | Apryse | 中 | ⭐⭐⭐⭐ |
| 显示指令流（scene graph 回放） | Office Online WOPI | 高 | ⭐⭐⭐⭐⭐ |
| OT/CRDT 协同批注 | Google Docs / Yjs | 中 | ⭐⭐⭐⭐ |
| 服务端字体子集化 | Google Docs | 低 | ⭐⭐⭐ |
| OffscreenCanvas Worker 渲染 | PSPDFKit | 中 | ⭐⭐⭐⭐ |
| UDM 统一文档模型 + paraId 锚点 | Google Docs / Notion | 中 | ⭐⭐⭐⭐⭐（架构基石） |

---

## 四、开源参考代码 / 文档

- **ONLYOFFICE / web-apps**：浏览器端 Office 渲染引擎开源，业界天花板。
  `https://github.com/ONLYOFFICE/web-apps`
- **pdf.js**：Mozilla，客户端 PDF 渲染事实标准。
  `https://github.com/mozilla/pdf.js`
- **Yjs**：CRDT 协同开源标杆，Notion / Figma 等参考。
  `https://github.com/yjs/yjs`
- **pdf-rs / lopdf**：纯 Rust PDF 解析库，可编译 WASM。
- **pdfium**：Chrome 同款 PDF 引擎，有 WASM 编译版本（体积 ~2.4MB gzip）。
- **WOPI 协议**：Office Online 开放协议规范（MS-WOPI）。
- **Google Wave OT 论文**：*Operational Transformation in Google Wave*。

---

## 五、商业 SDK 工程博客（深度技术资料）

- PSPDFKit / Apryse Blog：WASM 渲染、Worker 调度、字体处理
- ONLYOFFICE 工程博客：浏览器端 Office 引擎实现细节
- pdf.js 维护者 blog（如 Snuffleupagus 个人博客）

---

## 六、本项目升级路径优先级

按「杀伤力 × 成本」排序，建议按顺序推进：

1. **UDM 统一文档模型 + paraId 锚点**（架构基石，1-2 周，⭐⭐⭐⭐⭐）
   - 没有它，翻译/搜索/批注都是孤岛
   - 做完后续所有功能都接得上

2. **Yjs CRDT 协同批注**（1 周，⭐⭐⭐⭐）
   - 最快见效，业界验证充分

3. **服务端字体子集化**（3-5 天，⭐⭐⭐）
   - 讯飞经历直接对口，性价比高

4. **WASM PDF 解析（基于 pdf-rs）**（2-4 周，⭐⭐⭐⭐⭐）
   - 最高杀伤力但最贵，建议放最后

---

## 七、当前代码的"伪深点"风险（面试官追问会破）

| 现在写了 | 追问会破的点 |
|---|---|
| 视口虚拟化 ±2 页 | 为什么是 2？有压测依据？LRU 还是 LFU？ |
| token 防竞态 | 缩放时在途 `getTextContent` 未 cancel，会泄漏 |
| DPR 封顶 ×2 | 4K 屏 ×1.5、手机 ×3 怎么处理？ |
| soffice 多实例池 | round-robin 无负载感知，某 slot 卡死仍分配给它 |
| ETA 滑动窗口 8 样本 | 样本数依据？小文件 ETA 抖动？冷启动无样本怎么显示？ |
| 零依赖手写 multipart | 没有 boundary 边界 case 测试，生产事故风险 |
