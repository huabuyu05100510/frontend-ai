/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import type { PluginNodeExecutor } from '@miaoma-aiflow/plugin-core'

import { GetCurrentTimeExecutor } from './executors/get-current-time'

/**
 * 导出执行器类，兼容运行时按类名反射加载。
 */
export { GetCurrentTimeExecutor }

/**
 * 默认导出（供 UMD 示例和调试使用）。
 */
export const executors: PluginNodeExecutor[] = [new GetCurrentTimeExecutor()]

export default {
    executors,
    GetCurrentTimeExecutor,
}
