# 10年资深专家代表作：技术深挖路线图

## 一、当前项目定位

**现状**：模式2标配水平（与钉钉/飞书同级），服务端转PDF+客户端渲染。

**目标**：模式3/4顶尖水平，对标 Google Docs / Office Online / ONLYOFFICE。

**差距**：
- 无统一文档模型（UDM）
- 无 Web Vitals 监控
- 无保真度回归测试
- 无 CRDT 协同
- 无 AI 内容增强
- 已写代码未接入（scheduler.mjs、PdfPreviewWASM.tsx 等）

---

## 二、核心架构升级

### 最终架构

```
所有文件 → 转PDF → pdfium统一处理：
  ├── Canvas渲染（矢量，可缩放，95-99%还原度）
  └── UDM提取（交互层：搜索、批注、翻译）
```

### 三层渲染架构

```
┌─────────────────────────────────────────────┐
│                  用户看到                    │
├─────────────────────────────────────────────┤
│                                             │
│  Canvas层（pdfium渲染）  ← 高保真视觉        │
│                                             │
│  UDM交互层              ← 搜索/批注/翻译    │
│                                             │
│  高亮层                  ← 搜索结果/批注标记 │
│                                             │
└─────────────────────────────────────────────┘
```

---

## 三、实现计划

### Phase 1：后端 UDM 提取（Week 1）

**目标**：统一 PDF 流程，所有格式转 PDF 后提取 UDM。

**任务清单**：
- [ ] 安装 pdfium WASM 包
- [ ] 实现 pdfium.mjs（渲染+提取）
- [ ] 实现 udm-extractor.mjs
- [ ] 改造 converter.mjs（加入 UDM 提取）
- [ ] 测试 UDM 输出（坐标对齐验证）

**验收标准**：
- Office 文件转 PDF 后 UDM 坐标与渲染 100% 对齐
- UDM 包含段落级文本 + bbox + paraId

---

### Phase 2：前端渲染引擎（Week 2）

**目标**：pdfium Canvas 渲染 + UDM 交互层。

**任务清单**：
- [ ] 实现 pdfium-worker.js
- [ ] 实现 usePdfium hook
- [ ] 实现 PdfPreviewPro.tsx
- [ ] 实现 UDMOverlay.tsx
- [ ] 替换 previewers/index.tsx 路由

**验收标准**：
- PDF 渲染达到 95%+ 还原度
- 缩放 400% 无模糊
- UDM 交互层精确对齐

---

### Phase 3：交互功能（Week 3-4）

**目标**：搜索、文本选中、批注锚点。

**任务清单**：
- [ ] 搜索高亮（基于 UDM 文本匹配）
- [ ] 文本选中（透明文本层）
- [ ] 批注锚点存储（paraId 锚定）
- [ ] 批注 UI 组件

**验收标准**：
- 搜索响应 <100ms
- 批注锚定精确到段落

---

### Phase 4：伪深度焊实（Week 5）

**目标**：把已写未用的代码接入主链路。

**任务清单**：
- [ ] scheduler.mjs 接入 converter.mjs（替换 round-robin）
- [ ] PdfPreviewWASM.tsx 删除（统一用 pdfium）
- [ ] predictive-render.ts 真正控制渲染策略

**验收标准**：
- SJF 调度器生效，长尾任务延迟降低
- 预测渲染命中率 >85%

---

### Phase 5：可观测性体系（Week 6）

**目标**：生产级监控 + 保真度测试。

**任务清单**：
- [ ] 接入 web-vitals（FCP/LCP/CLS/INP）
- [ ] Lighthouse CI 回归门禁
- [ ] 10份黄金样本 SSIM 保真度测试
- [ ] ErrorBoundary + 图片降级

**验收标准**：
- Web Vitals 数据上报
- 保真度 SSIM >95%
- 性能回归自动拦截

---

### Phase 6：差异化亮点（Week 7-8）

**目标**：AI 内容增强（结合讯飞背景）。

**任务清单**：
- [ ] 双语翻译对照（讯飞星火API + paraId锚点）
- [ ] 智能摘要（GPT-4）
- [ ] 语义搜索（OpenAI Embedding）
- [ ] OCR 增强（tesseract.js，扫描件支持）

**验收标准**：
- 翻译对照段落级同步
- 摘要准确率 >80%

---

### Phase 7：协同批注（Week 9-10）

**目标**：实时协作能力。

**任务清单**：
- [ ] Yjs CRDT 文档
- [ ] IndexedDB 本地持久化
- [ ] WebRTC P2P 同步
- [ ] 批注协同 UI

**验收标准**：
- 离线编辑，冲突解决率 100%
- 多人协同延迟 <200ms

---

## 四、技术栈对比

| 维度 | 当前（模式2标配） | 目标（模式3/4顶尖） |
|------|------------------|---------------------|
| PDF引擎 | pdf.js单引擎 | **pdfium（Chrome同款）** |
| Office渲染 | 转PDF丢失交互 | **UDM保留结构** |
| 协同 | 无 | **Yjs CRDT** |
| AI能力 | 无 | **摘要+翻译+搜索** |
| 监控 | 自研指标 | **Web Vitals + SSIM** |
| 离线 | 无 | **Service Worker** |
| 保真度 | 无验证 | **回归门禁>95%** |
| 调度 | round-robin | **SJF+优先级抢占** |

---

## 五、面试话术价值

完成后的简历亮点：

1. **"pdfium WASM 引擎架构师"**
   - 选择 Chrome 同款渲染引擎，保真度 99%
   - 同源提取 UDM，坐标 100% 对齐
   - 大文件内存占用降低 60%

2. **"统一文档模型 UDM 设计"**
   - 所有格式归一化到 PDF+UDM
   - 搜索/批注/翻译跨格式复用
   - paraId 锚点精确定位

3. **"Yjs CRDT 协同批注"**
   - 无中心实时协作
   - 冲突解决率 100%
   - 支持离线编辑

4. **"AI 内容增强"**
   - 双语翻译对照（讯飞 API）
   - 智能摘要（GPT-4）
   - 语义搜索（向量检索）

5. **"生产级可观测性"**
   - Web Vitals 监控
   - SSIM 保真度回归门禁
   - Lighthouse CI 自动拦截

---

## 六、文件结构

```
server/src/
├── pdfium.mjs          # pdfium WASM 封装
├── udm-extractor.mjs   # UDM 提取
├── converter.mjs       # 改造：加入 UDM
└── scheduler.mjs       # 接入主链路

web/src/
├── previewers/
│   └── PdfPreviewPro.tsx   # 新预览器
├── components/
│   ├── UDMOverlay.tsx      # UDM 交互层
│   ├── SearchHighlight.tsx # 搜索高亮
│   └── AnnotationAnchor.tsx # 批注锚点
├── hooks/
│   └── usePdfium.ts        # pdfium hook
│   └── useUDM.ts           # UDM hook
└── workers/
    └── pdfium-worker.js    # WASM worker
```

---

## 七、下一步行动

**本周目标**：Phase 1 完成，后端 UDM 提取跑通。

**第一步**：
```bash
npm install @aspect-pdf/pdfium
```

然后实现 `pdfium.mjs` 和 `udm-extractor.mjs`。