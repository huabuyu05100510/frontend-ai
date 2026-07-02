// ============================================================
// @upload-engine/react — React 适配层出口
//   依赖 react（peerDependency）。core 能力请从主入口导入。
// ============================================================

export { useUpload } from './hooks/useUpload'

// 可复用 UI 组件
export { UploadZone } from './components/UploadZone'
export { FileCard, fileIcon } from './components/FileCard'
export { FileGallery } from './components/FileGallery'
export { FilePreviewCard } from './components/FilePreviewCard'
export { ContentPreview } from './components/ContentPreview'

// 便于 React 用户直接取用核心类型/能力
export type {
  UploadScenario,
  UploadConfig,
  UploadFile,
  CompressMeta,
} from './types'
export { PRESETS, PRESET_META } from './presets'
export { generatePreview } from './preview'
export type { FilePreview } from './preview'
