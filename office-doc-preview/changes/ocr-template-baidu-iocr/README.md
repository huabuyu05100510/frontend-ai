# ocr-template-baidu-iocr OCR 模板识别（百度 iocr）

> 模型：claude-sonnet-4-6

## 背景
- 用户要求：对标百度 iocr/finance + Textin 医疗票据识别
- 场景：财务票据 + 医疗票据 + 通用表单 + 证照识别（全场景）
- 模板定义：前端可视化框选
- OCR 引擎：百度智能云 iocr API

## 集成范围（已落地）

### 1. 后端模块

| 模块 | 说明 |
|------|------|
| `server/src/baidu-iocr.mjs` (NEW) | 百度云 iocr 客户端：access_token 缓存 + processor API 调用 |
| `server/src/ocr-template.mjs` (NEW) | 模板持久化（JSON 文件存储 + 完整字段校验） |

**baidu-iocr.mjs**：
- `getAccessToken()` — POST `https://aip.baidubce.com/oauth/2.0/token`，缓存到 `expireAt`
- `recognizeByTemplate({templateSign, imageBuffer, imageUrl})` — POST urlencoded 到 processor
- 无 `BAIDU_OCR_API_KEY`/`BAIDU_OCR_SECRET_KEY` 时返回 `isMock=true`（开发/测试友好）
- 错误处理：`error_code` → throw；网络错误 → throw；上层 catch 后 fallback 到本地 mock

**ocr-template.mjs** schema：
```ts
{
  id: string,
  name: string,
  scenario: 'finance' | 'medical' | 'general' | 'id-card',
  sign?: string,                  // 百度 templateSign（可选）
  fields: Array<{
    id: string,
    name: string,
    type: 'string' | 'number' | 'date' | 'text',
    x: number, y: number, w: number, h: number,   // 像素坐标
  }>,
  sampleImageUrl?: string,
  createdAt: number,
  updatedAt: number,
}
```
- 存储：`DERIVED_DIR/ocr-templates/<id>.json`
- 校验：name/scenario/fields 全部必填；每个 field 的 x/y/w/h 必须是有限数
- 4 个场景白名单：`finance` / `medical` / `general` / `id-card`

### 2. 后端 6 新端点

| 端点 | 用途 | 关键头 |
|------|------|--------|
| `POST /api/ocr/template` | 创建模板 | `X-Template-Id` |
| `GET /api/ocr/templates?scenario=xxx` | 列表（可按场景过滤） | `X-Template-Count` |
| `GET /api/ocr/template/:id` | 单个 | - |
| `DELETE /api/ocr/template/:id` | 删除 | - |
| `POST /api/ocr/recognize-template` | 模板识别（taskId + templateId） | `X-OCR-Engine`/`X-OCR-Ms`/`X-OCR-Fields` |

**识别流程**（`handleOcrRecognizeTemplate`）：
1. 取 template.sign（百度 templateSign）
2. 若有 sign + AK/SK → 调真实百度 iocr → 按 `template.fields.name` 对齐 KV
3. 否则 → 本地 mock：返回每个字段的占位值（type=date → "2024-01-01"，number → "0.00"，其他 → "(待识别:字段名)"）
4. 字段对齐：百度返回 `words_result` 是 `{字段名: {words, location}}` 字典，已天然按 `template.fields.name` 对齐

### 3. 前端

**OCRPage 重构**（替换 mock 数据 → 真实后端）：

| 模式 | 改造 |
|------|------|
| 模板管理 | 从 `/api/ocr/templates` 加载真实列表；删除调 DELETE；试一试调 recognize-template |
| 模板编辑 | 鼠标拖拽画框（在样例图上 mousedown/move/up）；坐标按图片原始分辨率保存；4 场景下拉；templateSign 输入框；保存调 POST |

**模板编辑器交互细节**：
- 样例图选择：根据 scenario 自动切换（finance/medical/general/id-card 各自样例）
- 鼠标光标 `crosshair`，拖拽时显示蓝色虚线预览框
- 拖拽 < 8px 视为点击，忽略（防误触）
- 坐标系：DOM 显示坐标 → 原图坐标 = `displayX × (naturalWidth / displayWidth)`
- 字段标签悬浮在框上方（蓝/灰色根据选中态）
- 右侧字段面板：每行可改名、选类型（文本/数字/日期/长文本）、显示像素坐标、删除

**模板管理交互细节**：
- 场景徽章：紫底蓝字（`#f0f5ff` + `#1677ff`）
- templateSign 截断显示前 24 字符 + ⧉ 复制按钮
- 试一试：自动找第一个上传的图片 task → 调识别 → KV 卡片网格（置信度颜色：>80% 绿，否则黄）
- mock 模式标识：黄色提示「配置 BAIDU_OCR_API_KEY 后启用真实识别」
- 删除：window.confirm 二次确认

## 测试
- 后端 `npx vitest run`：**361 pass / 27 files**（含新增 11 tests）
  - `ocr-template.test.mjs` 11 tests：CRUD + 校验 + mock 识别
- 前端 `npx vitest run`：**229 pass / 23 files**（含新增 7 tests）
  - `OCRPage.template.test.tsx` 7 tests：列表加载 + 删除 + 拖拽画框 + 场景下拉 + 试一试
- `npx tsc --noEmit`：通过

## 设计决策

### 为什么 baidu-iocr 模块返回 isMock 标志而非抛错？
百度 iocr 需要付费 AK/SK，开发/测试环境不便。模块设计为：
- 有 AK/SK → 真实调用
- 无 AK/SK → 返回 `isMock=true`，上层决定降级策略

让上层（router）可以选择 fallback 到本地坐标模板（用 `template.fields` 的坐标定义返回占位结构），保证应用无 AK 也能演示完整流程。

### 为什么本地坐标模板（无 sign）也要存字段坐标？
对标百度 iocr 编辑器的"画框 → 训练"体验：
- 用户在前端画框 = 定义模板的字段位置（视觉上等价于百度控制台的画框训练）
- 本地存储坐标 → 后续可对接 Tesseract 本地 OCR + 坐标裁剪（CJK 精度有限但能跑）
- 也可对接其他云 OCR（Textin 等）：返回文本 + 坐标后用模板字段坐标过滤

### 为什么支持 4 场景而不是任意自定义？
- 财务（发票/收据/银行流水）、医疗（医疗发票/处方）、通用表单、证照（身份证/护照）—— 覆盖用户提到的全部场景
- 每个场景预定义样例图，避免用户上传样例图步骤（MVP 简化）
- 后续可扩展：在 `VALID_SCENARIOS` 中追加 key 即可

### 字段对齐策略
百度 iocr 返回的 `words_result` 是 `{字段名: {words, location}}` 字典。我们在 template.fields 中保存的 `name` 字段直接对齐百度的字段名。识别时按 template.fields 顺序遍历，从 words_result 取值，未命中则返回空 + confidence=0。

## 配置百度 iocr
1. 注册百度智能云账号 → 控制台创建「文字识别 → 自定义模板」应用
2. 拿到 `API Key` 和 `Secret Key`
3. 在百度 iocr 编辑器中创建模板、画框训练字段、获得 `templateSign`
4. 在本应用服务端配置环境变量：
   ```bash
   export BAIDU_OCR_API_KEY=your_api_key
   export BAIDU_OCR_SECRET_KEY=your_secret_key
   ```
5. 重启服务端，在「OCR 识别 → 模板编辑」创建本地模板时填入对应的 templateSign
6. 试一试 → 真实识别（响应头 `X-OCR-Engine: baidu-iocr`）

## 文件清单
**后端**：
- `server/src/baidu-iocr.mjs`（NEW）
- `server/src/ocr-template.mjs`（NEW）
- `server/src/router.mjs`（+6 routes / +5 handlers）
- `server/test/ocr-template.test.mjs`（NEW）

**前端**：
- `web/src/pages/OCRPage.tsx`（重构 TemplateEditMode + TemplateManageMode）
- `web/test/OCRPage.template.test.tsx`（NEW）
