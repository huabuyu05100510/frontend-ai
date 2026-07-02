# 插件开发指南

本文档详细介绍如何为妙码 AI 工作流平台开发、发布和使用插件。

## 目录

- [概述](#概述)
- [快速开始](#快速开始)
- [插件结构](#插件结构)
- [开发插件](#开发插件)
    - [创建项目](#创建项目)
    - [编写 plugin.json](#编写-pluginjson)
    - [实现节点执行器](#实现节点执行器)
    - [自定义前端组件（可选）](#自定义前端组件可选)
- [构建与打包](#构建与打包)
- [发布插件](#发布插件)
- [在工作流中使用](#在工作流中使用)
- [权限系统](#权限系统)
- [完整示例](#完整示例)
- [最佳实践](#最佳实践)
- [常见问题](#常见问题)

---

## 概述

妙码 AI 工作流平台的插件系统允许开发者：

- 创建自定义节点类型，扩展工作流能力
- 集成第三方服务（邮件、短信、API 等）
- 封装复杂的数据处理逻辑
- 通过插件市场分享给其他用户

### 插件架构

```
┌─────────────────────────────────────────────────────────────┐
│                        插件市场 UI                           │
│    (浏览、搜索、安装、发布)                                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      插件注册中心                             │
│    (管理已安装插件、动态注册节点类型)                           │
└─────────────────────────────────────────────────────────────┘
                              │
           ┌──────────────────┼──────────────────┐
           ▼                  ▼                  ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│   插件加载器      │ │   权限沙箱        │ │   Schema 表单     │
│   (CDN 加载)     │ │   (安全隔离)      │ │   (动态生成 UI)   │
└──────────────────┘ └──────────────────┘ └──────────────────┘
```

---

## 快速开始

### 5 分钟创建第一个插件

```bash
# 1. 创建插件目录
mkdir my-first-plugin && cd my-first-plugin

# 2. 初始化项目
npm init -y
npm install typescript rollup @rollup/plugin-typescript --save-dev

# 3. 创建必要文件
touch plugin.json src/index.ts rollup.config.js
```

最小化的 `plugin.json`：

```json
{
    "id": "my-first-plugin",
    "version": "1.0.0",
    "name": "我的第一个插件",
    "description": "一个简单的示例插件",
    "author": { "name": "Your Name" },
    "permissions": [],
    "nodes": [
        {
            "type": "hello-world",
            "name": "Hello World",
            "icon": "Smile",
            "color": "#10B981",
            "category": "utility",
            "configSchema": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "title": "消息",
                        "default": "Hello, World!"
                    }
                }
            },
            "outputs": [{ "name": "result", "type": "string", "description": "输出消息" }]
        }
    ],
    "main": {
        "executor": "dist/executor.umd.js"
    }
}
```

---

## 插件结构

标准的插件项目结构：

```
my-plugin/
├── plugin.json              # 插件清单（必需）
├── package.json             # npm 包配置
├── tsconfig.json            # TypeScript 配置
├── rollup.config.js         # 打包配置
├── src/
│   ├── index.ts             # 执行器入口（必需）
│   ├── executors/           # 节点执行器
│   │   ├── node-a.ts
│   │   └── node-b.ts
│   └── components/          # 自定义组件（可选）
│       ├── index.tsx
│       └── NodeASettings.tsx
└── dist/                    # 构建输出
    ├── executor.umd.js
    └── components.umd.js    # 可选
```

---

## 开发插件

### 创建项目

```bash
mkdir email-sender-plugin && cd email-sender-plugin

# 初始化 package.json
cat > package.json << 'EOF'
{
  "name": "@miaoma/email-sender",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "rollup -c",
    "watch": "rollup -c -w"
  },
  "devDependencies": {
    "@miaoma-aiflow/plugin-core": "workspace:*",
    "@rollup/plugin-commonjs": "^25.0.0",
    "@rollup/plugin-node-resolve": "^15.0.0",
    "@rollup/plugin-typescript": "^11.0.0",
    "rollup": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
EOF
```

### 编写 plugin.json

完整的插件清单示例：

```json
{
    "id": "@miaoma/email-sender",
    "version": "1.0.0",
    "name": "邮件发送",
    "description": "支持 SMTP 协议的邮件发送插件，可发送纯文本和 HTML 邮件",
    "icon": "Mail",
    "author": {
        "name": "妙码学院",
        "email": "support@miaomaedu.com",
        "url": "https://miaomaedu.com"
    },
    "license": "MIT",
    "keywords": ["邮件", "SMTP", "通知", "自动化"],
    "permissions": ["network", "env:read"],
    "nodes": [
        {
            "type": "send-email",
            "name": "发送邮件",
            "description": "通过 SMTP 发送邮件",
            "icon": "Mail",
            "color": "#6366F1",
            "category": "communication",
            "configSchema": {
                "type": "object",
                "properties": {
                    "smtpHost": {
                        "type": "string",
                        "title": "SMTP 服务器",
                        "description": "例如: smtp.gmail.com",
                        "x-order": 1
                    },
                    "smtpPort": {
                        "type": "number",
                        "title": "端口",
                        "default": 587,
                        "enum": [25, 465, 587],
                        "x-order": 2
                    },
                    "username": {
                        "type": "string",
                        "title": "用户名",
                        "x-variable": true,
                        "x-order": 3
                    },
                    "password": {
                        "type": "string",
                        "title": "密码",
                        "x-component": "password",
                        "x-variable": true,
                        "x-order": 4
                    },
                    "from": {
                        "type": "string",
                        "title": "发件人",
                        "format": "email",
                        "x-variable": true,
                        "x-order": 5
                    },
                    "to": {
                        "type": "array",
                        "title": "收件人",
                        "items": { "type": "string", "format": "email" },
                        "x-variable": true,
                        "x-order": 6
                    },
                    "subject": {
                        "type": "string",
                        "title": "邮件主题",
                        "x-variable": true,
                        "x-order": 7
                    },
                    "body": {
                        "type": "string",
                        "title": "邮件内容",
                        "x-component": "textarea",
                        "x-variable": true,
                        "x-order": 8
                    },
                    "isHtml": {
                        "type": "boolean",
                        "title": "HTML 格式",
                        "default": false,
                        "x-order": 9
                    }
                },
                "required": ["smtpHost", "smtpPort", "username", "password", "from", "to", "subject", "body"]
            },
            "outputs": [
                { "name": "messageId", "type": "string", "description": "邮件 ID" },
                { "name": "accepted", "type": "array", "description": "成功发送的收件人列表" },
                { "name": "rejected", "type": "array", "description": "发送失败的收件人列表" }
            ]
        }
    ],
    "main": {
        "executor": "dist/executor.umd.js",
        "components": "dist/components.umd.js"
    },
    "engines": {
        "miaoma": ">=1.0.0"
    }
}
```

### Schema 扩展属性说明

| 属性                | 类型      | 说明                                            |
| ------------------- | --------- | ----------------------------------------------- |
| `x-variable`        | `boolean` | 启用变量引用（从上游节点获取值）                |
| `x-component`       | `string`  | 指定渲染组件：`textarea`、`password`、`code` 等 |
| `x-component-props` | `object`  | 传递给组件的额外属性                            |
| `x-group`           | `string`  | 字段分组名称                                    |
| `x-order`           | `number`  | 字段显示顺序                                    |

### 实现节点执行器

`src/index.ts`：

```typescript
import type { PluginNodeExecutor, PluginNodeExecutionContext, PluginNodeExecutionResult } from '@miaoma-aiflow/plugin-core'

/**
 * 邮件发送执行器
 */
class SendEmailExecutor implements PluginNodeExecutor {
    readonly type = 'send-email'

    async execute(context: PluginNodeExecutionContext): Promise<PluginNodeExecutionResult> {
        const { config, services, logger } = context

        try {
            logger.info('开始发送邮件...')

            // 获取配置
            const { smtpHost, smtpPort, username, password, from, to, subject, body, isHtml } = config as {
                smtpHost: string
                smtpPort: number
                username: string
                password: string
                from: string
                to: string[]
                subject: string
                body: string
                isHtml: boolean
            }

            // 使用受权限控制的 fetch 发送请求
            // 这里假设有一个邮件发送 API
            const response = await services.fetch('https://api.example.com/send-email', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Basic ${btoa(`${username}:${password}`)}`,
                },
                body: JSON.stringify({
                    host: smtpHost,
                    port: smtpPort,
                    from,
                    to,
                    subject,
                    [isHtml ? 'html' : 'text']: body,
                }),
            })

            if (!response.ok) {
                throw new Error(`邮件发送失败: ${response.statusText}`)
            }

            const result = await response.json()

            logger.info(`邮件发送成功，ID: ${result.messageId}`)

            return {
                success: true,
                outputs: {
                    messageId: result.messageId,
                    accepted: result.accepted || to,
                    rejected: result.rejected || [],
                },
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '未知错误'
            logger.error(`邮件发送失败: ${errorMessage}`)

            return {
                success: false,
                error: errorMessage,
            }
        }
    }

    validate(config: Record<string, unknown>) {
        const errors: string[] = []

        if (!config.smtpHost) {
            errors.push('SMTP 服务器不能为空')
        }

        if (!config.to || (Array.isArray(config.to) && config.to.length === 0)) {
            errors.push('收件人不能为空')
        }

        return {
            valid: errors.length === 0,
            errors,
        }
    }
}

// 导出所有执行器
export const executors: PluginNodeExecutor[] = [new SendEmailExecutor()]

// 默认导出（供 UMD 使用）
export default { executors }
```

### 自定义前端组件（可选）

如果默认的 Schema 表单无法满足需求，可以创建自定义组件：

`src/components/index.tsx`：

```tsx
import React from 'react'

interface EmailPreviewProps {
    value: Record<string, unknown>
    onChange: (value: Record<string, unknown>) => void
    schema: unknown
    availableVariables: unknown[]
    disabled?: boolean
}

/**
 * 邮件预览组件
 */
export function EmailPreview({ value, onChange }: EmailPreviewProps) {
    const { subject, body, isHtml } = value as {
        subject?: string
        body?: string
        isHtml?: boolean
    }

    return (
        <div className="space-y-4">
            {/* 预览区域 */}
            <div className="border rounded-lg p-4 bg-white">
                <div className="border-b pb-2 mb-2">
                    <strong>主题：</strong> {subject || '(未设置)'}
                </div>
                <div className="min-h-[100px]">
                    {isHtml ? (
                        <div dangerouslySetInnerHTML={{ __html: body || '' }} />
                    ) : (
                        <pre className="whitespace-pre-wrap">{body || '(无内容)'}</pre>
                    )}
                </div>
            </div>

            {/* 切换 HTML 模式 */}
            <label className="flex items-center gap-2">
                <input type="checkbox" checked={isHtml || false} onChange={e => onChange({ ...value, isHtml: e.target.checked })} />
                <span>HTML 格式</span>
            </label>
        </div>
    )
}

// 导出组件（供 UMD 使用）
export default { EmailPreview }
```

---

## 构建与打包

### rollup.config.js

```javascript
import commonjs from '@rollup/plugin-commonjs'
import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'

export default [
    // 执行器打包
    {
        input: 'src/index.ts',
        output: {
            file: 'dist/executor.umd.js',
            format: 'umd',
            name: 'EmailSenderPlugin',
            globals: {
                react: 'React',
            },
        },
        plugins: [resolve(), commonjs(), typescript({ tsconfig: './tsconfig.json' })],
        external: ['react'],
    },
    // 组件打包（可选）
    {
        input: 'src/components/index.tsx',
        output: {
            file: 'dist/components.umd.js',
            format: 'umd',
            name: 'EmailSenderComponents',
            globals: {
                react: 'React',
            },
        },
        plugins: [resolve(), commonjs(), typescript({ tsconfig: './tsconfig.json', jsx: 'react' })],
        external: ['react'],
    },
]
```

### 构建命令

```bash
# 构建
npm run build

# 监听模式开发
npm run watch
```

---

## 发布插件

### 1. 上传到 CDN

将构建产物上传到可访问的 CDN：

```
https://cdn.example.com/plugins/@miaoma/email-sender/1.0.0/
├── plugin.json
├── executor.umd.js
└── components.umd.js
```

### 2. 在插件市场发布

1. 访问 `/plugins/publish` 页面
2. 填写插件信息：
    - **插件 ID**: `@miaoma/email-sender`
    - **名称**: 邮件发送
    - **描述**: 支持 SMTP 协议的邮件发送插件
    - **分类**: 通讯
    - **版本**: 1.0.0
3. 填写资源地址：
    - **Manifest URL**: `https://cdn.example.com/plugins/@miaoma/email-sender/1.0.0/plugin.json`
    - **Executor URL**: `https://cdn.example.com/plugins/@miaoma/email-sender/1.0.0/executor.umd.js`
    - **Components URL**: `https://cdn.example.com/plugins/@miaoma/email-sender/1.0.0/components.umd.js`
4. 选择所需权限
5. 提交审核

### 3. 等待审核

提交后，插件将进入审核队列。审核通过后将自动上架到插件市场。

---

## 在工作流中使用

### 1. 安装插件

1. 进入「插件市场」页面
2. 搜索或浏览找到所需插件
3. 点击「安装」按钮
4. 确认权限授权

### 2. 在工作流中添加节点

安装后，插件提供的节点会自动出现在节点面板中：

1. 打开工作流编辑器
2. 在左侧节点面板找到插件节点（按分类查找）
3. 拖拽到画布
4. 配置节点参数
5. 连接到其他节点

### 3. 使用变量引用

支持 `x-variable: true` 的字段可以引用上游节点的输出：

1. 点击字段右侧的变量按钮
2. 选择上游节点和输出字段
3. 变量格式：`{{nodeId.outputName}}`

---

## 权限系统

### 可用权限

| 权限             | 说明               | 风险等级 |
| ---------------- | ------------------ | -------- |
| `network`        | 发起 HTTP 请求     | 中       |
| `storage`        | 访问浏览器本地存储 | 低       |
| `env:read`       | 读取环境变量       | 中       |
| `llm:invoke`     | 调用大语言模型     | 低       |
| `knowledge:read` | 读取知识库内容     | 低       |

### 权限声明

在 `plugin.json` 中声明所需权限：

```json
{
    "permissions": ["network", "env:read"]
}
```

### 权限限制

- 未声明的权限，相关 API 调用将被拒绝
- 用户安装时会看到权限列表，需确认授权
- 高风险权限会有明显提示

---

## 完整示例

### 天气查询插件

`plugin.json`：

```json
{
    "id": "@miaoma/weather",
    "version": "1.0.0",
    "name": "天气查询",
    "description": "查询指定城市的天气信息",
    "icon": "CloudSun",
    "author": { "name": "妙码学院" },
    "permissions": ["network"],
    "nodes": [
        {
            "type": "get-weather",
            "name": "获取天气",
            "icon": "CloudSun",
            "color": "#0EA5E9",
            "category": "integration",
            "configSchema": {
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "title": "城市",
                        "description": "输入城市名称，如：北京、上海",
                        "x-variable": true
                    },
                    "units": {
                        "type": "string",
                        "title": "温度单位",
                        "enum": ["metric", "imperial"],
                        "enumNames": ["摄氏度", "华氏度"],
                        "default": "metric"
                    }
                },
                "required": ["city"]
            },
            "outputs": [
                { "name": "temperature", "type": "number", "description": "当前温度" },
                { "name": "humidity", "type": "number", "description": "湿度 (%)" },
                { "name": "description", "type": "string", "description": "天气描述" },
                { "name": "icon", "type": "string", "description": "天气图标代码" }
            ]
        }
    ],
    "main": {
        "executor": "dist/executor.umd.js"
    }
}
```

`src/index.ts`：

```typescript
import type { PluginNodeExecutor, PluginNodeExecutionContext, PluginNodeExecutionResult } from '@miaoma-aiflow/plugin-core'

const WEATHER_API_BASE = 'https://api.openweathermap.org/data/2.5/weather'

class GetWeatherExecutor implements PluginNodeExecutor {
    readonly type = 'get-weather'

    async execute(context: PluginNodeExecutionContext): Promise<PluginNodeExecutionResult> {
        const { config, services, logger } = context
        const { city, units = 'metric' } = config as { city: string; units: string }

        try {
            logger.info(`查询城市天气: ${city}`)

            // 从环境变量获取 API Key（需要 env:read 权限）
            const apiKey = services.getEnv('OPENWEATHER_API_KEY')
            if (!apiKey) {
                throw new Error('未配置 OPENWEATHER_API_KEY 环境变量')
            }

            // 调用天气 API（需要 network 权限）
            const url = `${WEATHER_API_BASE}?q=${encodeURIComponent(city)}&units=${units}&appid=${apiKey}&lang=zh_cn`
            const response = await services.fetch(url)

            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error(`未找到城市: ${city}`)
                }
                throw new Error(`API 请求失败: ${response.statusText}`)
            }

            const data = await response.json()

            logger.info(`天气查询成功: ${data.weather[0].description}`)

            return {
                success: true,
                outputs: {
                    temperature: data.main.temp,
                    humidity: data.main.humidity,
                    description: data.weather[0].description,
                    icon: data.weather[0].icon,
                },
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '未知错误'
            logger.error(`天气查询失败: ${errorMessage}`)

            return {
                success: false,
                error: errorMessage,
            }
        }
    }

    validate(config: Record<string, unknown>) {
        if (!config.city || typeof config.city !== 'string') {
            return { valid: false, errors: ['城市名称不能为空'] }
        }
        return { valid: true }
    }
}

export const executors: PluginNodeExecutor[] = [new GetWeatherExecutor()]
export default { executors }
```

---

## 最佳实践

### 1. 错误处理

```typescript
try {
    // 业务逻辑
} catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误'
    logger.error(`操作失败: ${errorMessage}`)

    return {
        success: false,
        error: errorMessage,
    }
}
```

### 2. 日志记录

```typescript
logger.debug('调试信息')
logger.info('执行开始')
logger.warn('警告信息')
logger.error('错误信息')
```

### 3. 配置验证

```typescript
validate(config: Record<string, unknown>) {
  const errors: string[] = []

  if (!config.requiredField) {
    errors.push('必填字段不能为空')
  }

  if (typeof config.numberField !== 'number' || config.numberField < 0) {
    errors.push('数值字段必须为非负数')
  }

  return {
    valid: errors.length === 0,
    errors
  }
}
```

### 4. 类型安全

```typescript
interface MyNodeConfig {
    field1: string
    field2: number
    field3?: boolean
}

const config = context.config as MyNodeConfig
```

### 5. 权限最小化

只声明实际需要的权限，避免申请不必要的高风险权限。

---

## 常见问题

### Q: 插件无法加载？

检查：

1. CDN 资源是否可访问
2. UMD 格式是否正确
3. 导出名称是否与 `plugin.json` 中的 `componentName` 匹配

### Q: 节点执行报错 "没有权限"？

确保：

1. `plugin.json` 中声明了所需权限
2. 用户安装时已授权

### Q: 变量引用不生效？

检查：

1. Schema 中是否设置了 `x-variable: true`
2. 变量格式是否正确：`{{nodeId.outputName}}`

### Q: 自定义组件不显示？

确保：

1. `components.umd.js` 正确打包
2. 组件名称与 `customComponent` 字段匹配
3. React 作为外部依赖正确配置

---

## 相关资源

- [插件核心类型定义](/packages/plugin-core/src/types)
- [插件运行时](/packages/plugin-runtime)
- [JSON Schema 规范](https://json-schema.org/)
- [Rollup 打包文档](https://rollupjs.org/)
