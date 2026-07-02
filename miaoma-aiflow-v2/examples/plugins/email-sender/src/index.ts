/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import type { PluginNodeExecutor } from '@miaoma-aiflow/plugin-core'

import { SendEmailExecutor } from './executors/send-email'

/**
 * 导出所有节点执行器
 */
export const executors: PluginNodeExecutor[] = [new SendEmailExecutor()]

/**
 * 默认导出（供 UMD 模式使用）
 */
export default {
    executors,
}
