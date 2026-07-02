// 智检 / 双栏对比 — 常量定义
// 模型：claude-sonnet-4-6

/** 左侧分类导航（讯飞智检设计稿） */
export const CATEGORIES = [
  { id: 'text', label: '文字校对' },
  { id: 'doc', label: '文档校对' },
  { id: 'compliance', label: '文本合规' },
  { id: 'docCompliance', label: '文档合规' },
  { id: 'image', label: '图片合规' },
  { id: 'audio', label: '音频合规' },
  { id: 'video', label: '视频合规' },
] as const

/** 底部编辑工具条（设计稿底部 toolbar） */
export const EDIT_TOOLS = ['B', 'H', 'T', 'F', 'I', 'S', '≡', '≡', '⊡', '✏', '↺', '↻'] as const
