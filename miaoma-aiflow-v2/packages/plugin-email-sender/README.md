# 邮件发送插件

通过平台内置 SMTP 邮件服务从工作流发送邮件。

## 节点

- `send-email`

## 说明

- 复用工作流项目现有邮件发送逻辑
- 发件人、SMTP 主机和开发环境重定向规则由平台统一控制
- 节点侧只需要配置收件人、主题和正文内容

## 构建

```bash
pnpm --filter @miaoma-aiflow/plugin-email-sender build
```
