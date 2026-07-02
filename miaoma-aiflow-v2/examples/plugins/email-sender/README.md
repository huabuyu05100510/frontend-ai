# 邮件发送插件

这是一个完整的妙码 AI 工作流插件示例，展示了如何开发、打包和发布插件。

## 功能

- 通过 SMTP 协议发送邮件
- 支持纯文本和 HTML 格式
- 支持多收件人、抄送、密送
- 内置常用邮箱 SMTP 预设
- 自定义设置组件（带预览功能）

## 快速开始

```bash
# 安装依赖
pnpm install

# 构建
pnpm build

# 开发模式（监听文件变化）
pnpm watch
```

## 项目结构

```
email-sender/
├── plugin.json          # 插件清单
├── package.json         # npm 配置
├── tsconfig.json        # TypeScript 配置
├── rollup.config.js     # 打包配置
├── src/
│   ├── index.ts         # 执行器入口
│   ├── executors/
│   │   └── send-email.ts    # 邮件发送执行器
│   └── components/
│       └── index.tsx        # 自定义设置组件
└── dist/                # 构建输出
    ├── executor.umd.js      # 执行器 UMD 包
    └── components.umd.js    # 组件 UMD 包
```

## 配置说明

### SMTP 配置

| 邮箱服务 | SMTP 地址          | 端口 | 说明                           |
| -------- | ------------------ | ---- | ------------------------------ |
| Gmail    | smtp.gmail.com     | 587  | 需要开启应用专用密码           |
| QQ 邮箱  | smtp.qq.com        | 587  | 需要开启 SMTP 服务并获取授权码 |
| 163 邮箱 | smtp.163.com       | 465  | 需要开启 SMTP 服务并设置授权码 |
| Outlook  | smtp.office365.com | 587  | 使用微软账户密码               |

### 权限要求

本插件需要以下权限：

- `network` - 发起 HTTP 请求调用邮件服务
- `env:read` - 读取环境变量中的 SMTP 配置（可选）

## 节点输出

| 输出名称  | 类型   | 说明                 |
| --------- | ------ | -------------------- |
| messageId | string | 邮件唯一标识符       |
| accepted  | array  | 成功发送的收件人列表 |
| rejected  | array  | 发送失败的收件人列表 |
| response  | string | SMTP 服务器响应      |

## 开发说明

### 自定义组件

本插件使用自定义组件 `EmailSettings` 替代默认的 Schema 表单，提供了：

1. **SMTP 预设** - 快速选择常用邮箱服务配置
2. **分步骤向导** - 将配置分为三个清晰的步骤
3. **邮件预览** - 实时预览邮件效果

### 执行器实现

执行器实现了 `PluginNodeExecutor` 接口：

```typescript
interface PluginNodeExecutor {
    readonly type: string
    execute(context: PluginNodeExecutionContext): Promise<PluginNodeExecutionResult>
    validate?(config: Record<string, unknown>): { valid: boolean; errors?: string[] }
}
```

### 使用受限 API

在执行器中，通过 `context.services` 访问受权限控制的 API：

```typescript
// 发起 HTTP 请求（需要 network 权限）
await services.fetch(url, options)

// 读取环境变量（需要 env:read 权限）
const value = services.getEnv('MY_ENV_VAR')

// 调用 LLM（需要 llm:invoke 权限）
await services.invokeLLM({ userMessage: 'Hello' })

// 搜索知识库（需要 knowledge:read 权限）
await services.searchKnowledge({ query: 'search term' })
```

## 发布

1. 构建项目：`pnpm build`
2. 将 `dist/` 目录上传到 CDN
3. 在插件市场提交发布申请

## 许可证

MIT
