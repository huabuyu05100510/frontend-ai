/**
 * @a2ui-stream/core —— LLM 流式 UI 协议与 SDK（框架无关）。
 *
 * 公共 API 入口 barrel。子路径导入用于 tree-shake：
 *   import { Part } from '@a2ui-stream/core/protocol';
 *   import { defineCard } from '@a2ui-stream/core/registry';
 *   import { createMockProvider } from '@a2ui-stream/core/provider';
 *   import { consumeStream } from '@a2ui-stream/core/runtime';
 */

export * from './protocol';
export * from './CardRegistry';
export * from './ProviderAdapter';
export * from './StreamConsumer';
export * from './runtime';
