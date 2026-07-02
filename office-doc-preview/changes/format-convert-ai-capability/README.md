# format-convert-ai-capability 文档格式转换 AI 能力

> 模型：claude-sonnet-4-6

## 背景
- 用户要求"文档格式转换 也作为AI能力之一 同时支持转换后的预览 对比预览"
- 后续明确："可以转PDF 和图片 而且 预览文字可以标注和复制"

## 集成范围（已落地）

### 后端
| 文件 | 说明 |
|------|------|
| `server/src/annotate.mjs` | 标注存储模块（JSON 文件持久化 + 内存缓存） |
| `server/src/router.mjs` | 新增 4 端点：`POST /api/convert` + 标注 CRUD 3 端点 |
| `server/test/convert.test.mjs` | 6 tests 覆盖转换端点契约（含 done/processing/failed 三态） |
| `server/test/annotate.test.mjs` | 9 tests 覆盖标注 CRUD + 校验 |

**端点契约**

#### `POST /api/convert` — 转换产物 ensure（幂等）
```
入参: { taskId: string, target?: 'pdf' | 'images' }
响应头: X-Convert-Status / X-Convert-Target / X-Convert-Strategy / X-Convert-Pages / X-Convert-Pdf-Bytes
出参:
  status='done'       → { taskId, status, target, pdfUrl, pages[], originalUrl, meta }
  status='processing' → { taskId, status, target, progress: { pagesTotal, pagesDone, pct } }
  status='failed'     → { taskId, status, target, error }
错误: 400 (非法参数) / 404 (taskId 不存在)
```
设计要点：上传时已自动转 PDF + 栅格化图片 + 文字层。此端点为**幂等 ensure**，避免重复转码。

#### `POST /api/annotate` — 创建标注
```
入参: { taskId, page: number ≥1, text: string ≤4096, note?, color? }
出参: { id, taskId, page, text, note, color, createdAt, updatedAt }
校验: taskId 正则 /^[\w-]{1,128}$/（防路径穿越）+ page ≥ 1 + text 非空
```

#### `GET /api/annotate/:taskId` — 列出标注
出参: `{ taskId, annotations: [...] }` ；响应头 `X-Annotate-Count`

#### `DELETE /api/annotate/:id?taskId=xxx` — 删除标注
成功 `{ ok, id, taskId }` / 未命中 404

**持久化**：`DERIVED_DIR/annotations/<taskId>.json`，原子写（tmp + rename），内存 Map 缓存防重复 IO。

### 前端
| 文件 | 说明 |
|------|------|
| `web/src/pages/FormatConvertPage.tsx` | 主页面（xf-workspace 布局，3 子模式） |
| `web/src/components/SideMenu.tsx` | 新增"格式转换"菜单项（AI 标记，LayersIcon） |
| `web/src/App.tsx` | 接入 FormatConvertPage（全宽模式） |
| `web/src/styles.css` | 新增 `.fc-thumb-card` 悬浮效果 + `.oa-alert-warning` + `.oa-tab` |
| `web/test/FormatConvertPage.test.tsx` | 7 tests 覆盖三模式切换 + 转换流程 + 标注加载 |

**3 个子模式**

1. **格式转换** — 源文件下拉 + 目标格式 toggle（PDF / 高清图片）+ "开始转换"按钮
   - 完成态：4 统计卡（PDF大小 / 图片页数 / 转换耗时 / 策略）+ 产物卡（PDF预览/下载、原文件下载、复制全部文字）+ 图片缩略图网格（hover 上浮 + 阴影）
   - 进行中：圆形 loading + 进度条（pagesDone/pagesTotal）
   - 失败：黄色 alert 提示

2. **对比预览** — 双栏（grid 1fr 1fr）
   - 左栏：原文件（图片直显 / PDF iframe / txt-md 文本预览 / Office 提示下载）
   - 右栏：转换产物（图片+尺寸标注，纵向滚动，max 70vh）
   - 各自独立滚动，方便对比还原度

3. **文字标注** — 图片+文字层 + 标注面板（grid 1fr 320px）
   - 中央：图片底图 + `.pdf-text-layer` 透明覆盖层（文字可选中）
   - 监听 `document.selectionchange`，划选文字 → 显示"已选文字"卡片
   - 卡片内：批注 textarea + 5 色圆点选色 + 标注 / 复制 / 取消按钮
   - 已有标注在页面左上角浮动 chip（颜色 = 标注色，hover 显示完整内容）
   - 右侧：本页标注列表（颜色背景卡 + 删除按钮 + 创建时间）
   - 复制：单选区复制 / 整页文字复制（fetch textUrl → textContent）

## 测试
- 后端 `npx vitest run`：**327 pass / 23 files**（含新增 15 tests）
- 前端 `npx vitest run`：**210 pass / 20 files**（含新增 7 tests）
- `npx tsc --noEmit`：通过

## 设计决策
- **幂等 ensure 而非重新转换**：上传时已经自动转 PDF + 栅格化，再调一次只需返回现有产物，避免重复 soffice 调用
- **三态响应统一**：done/processing/failed 走同一个端点，前端按 `status` 字段分支渲染，避免多端点
- **JSON 文件持久化标注**：单任务单文件（`<taskId>.json`），原子写避免崩溃半写；内存 Map 缓存首次加载后零 IO
- **taskId 正则校验**：`/^[\w-]{1,128}$/` 防路径穿越攻击
- **文字层复用现有 PDFium spans**：直接 fetch `?as=text&n=N` 提取 inner HTML 注入 `.pdf-text-layer`，零额外渲染成本
- **划选即标注**：监听 `selectionchange`，校验选区在文字层内（`contains(commonAncestorContainer)`）才激活标注面板

## 顶级交互细节
- 缩略图悬浮：`transform: translateY(-2px) + box-shadow` 200ms 过渡
- 进度条：`width ${pct}%` + 300ms ease 过渡，蓝/绿双色区分上传/转码
- 颜色选择器：5 色圆点（黄/粉/绿/蓝/紫），选中加 2px 蓝色描边
- 双栏对比：各自 `max-height: 70vh + overflow: auto`，独立滚动
- 标注 chip：颜色 = 标注色背景 + 1px 半透明黑边，pointer cursor + title 提示完整内容
