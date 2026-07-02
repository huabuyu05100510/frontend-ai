// 矢量图标集 — lucide-style，stroke-based，统一 24px 视图框
// 模型：claude-sonnet-4-6
// 用法：<FileIcon size={20} className="icon-blue" />

import React from 'react'

export interface IconProps extends React.SVGAttributes<SVGElement> {
  size?: number | string
  strokeWidth?: number
}

function svgProps(size: number | string = 20, strokeWidth = 2): React.SVGAttributes<SVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }
}

const make = (path: React.ReactNode) => {
  const C = ({ size, strokeWidth, ...rest }: IconProps) => (
    <svg {...svgProps(size, strokeWidth)} {...rest}>{path}</svg>
  )
  C.displayName = 'Icon'
  return C
}

// ============ 文件 / 文档 ============
export const FileIcon = make(<>
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
  <polyline points="14 2 14 8 20 8" />
</>)
export const FileTextIcon = make(<>
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
  <polyline points="14 2 14 8 20 8" />
  <line x1="16" y1="13" x2="8" y2="13" />
  <line x1="16" y1="17" x2="8" y2="17" />
  <line x1="10" y1="9" x2="8" y2="9" />
</>)
export const UploadIcon = make(<>
  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
  <polyline points="17 8 12 3 7 8" />
  <line x1="12" y1="3" x2="12" y2="15" />
</>)
export const DownloadIcon = make(<>
  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
  <polyline points="7 10 12 15 17 10" />
  <line x1="12" y1="15" x2="12" y2="3" />
</>)
export const FolderIcon = make(<>
  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
</>)

// ============ 翻译 / 语言 ============
export const LanguagesIcon = make(<>
  <path d="m5 8 6 6" />
  <path d="m4 14 6-6 2-3" />
  <path d="M2 5h12" />
  <path d="M7 2h1" />
  <path d="m22 22-5-10-5 10" />
  <path d="M14 18h6" />
</>)
export const TranslateIcon = LanguagesIcon
export const GlobeIcon = make(<>
  <circle cx="12" cy="12" r="10" />
  <line x1="2" y1="12" x2="22" y2="12" />
  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
</>)

// ============ 校对 / 检查 ============
export const CheckCircleIcon = make(<>
  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
  <polyline points="22 4 12 14.01 9 11.01" />
</>)
export const AlertCircleIcon = make(<>
  <circle cx="12" cy="12" r="10" />
  <line x1="12" y1="8" x2="12" y2="12" />
  <line x1="12" y1="16" x2="12.01" y2="16" />
</>)
export const AlertTriangleIcon = make(<>
  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
  <line x1="12" y1="9" x2="12" y2="13" />
  <line x1="12" y1="17" x2="12.01" y2="17" />
</>)
export const ShieldCheckIcon = make(<>
  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  <polyline points="9 12 11 14 15 10" />
</>)

// ============ OCR / 视觉 ============
export const ScanIcon = make(<>
  <path d="M3 7V5a2 2 0 0 1 2-2h2" />
  <path d="M17 3h2a2 2 0 0 1 2 2v2" />
  <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
  <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
  <line x1="3" y1="12" x2="21" y2="12" />
</>)
export const EyeIcon = make(<>
  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
  <circle cx="12" cy="12" r="3" />
</>)
export const ImageIcon = make(<>
  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
  <circle cx="8.5" cy="8.5" r="1.5" />
  <polyline points="21 15 16 10 5 21" />
</>)
export const MusicIcon = make(<>
  <path d="M9 18V5l12-2v13" />
  <circle cx="6" cy="18" r="3" />
  <circle cx="18" cy="16" r="3" />
</>)
export const VideoIcon = make(<>
  <polygon points="23 7 16 12 23 17 23 7" />
  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
</>)
export const MicIcon = make(<>
  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
  <line x1="12" y1="19" x2="12" y2="23" />
  <line x1="8" y1="23" x2="16" y2="23" />
</>)
export const MicOffIcon = make(<>
  <line x1="1" y1="1" x2="23" y2="23" />
  <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
  <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
  <line x1="12" y1="19" x2="12" y2="23" />
  <line x1="8" y1="23" x2="16" y2="23" />
</>)
export const VolumeIcon = make(<>
  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
  <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
</>)
export const AudioWaveIcon = make(<>
  <line x1="2" y1="10" x2="2" y2="14" />
  <line x1="6" y1="6" x2="6" y2="18" />
  <line x1="10" y1="3" x2="10" y2="21" />
  <line x1="14" y1="6" x2="14" y2="18" />
  <line x1="18" y1="9" x2="18" y2="15" />
  <line x1="22" y1="7" x2="22" y2="13" />
</>)
export const RadioIcon = make(<>
  <circle cx="12" cy="12" r="2" />
  <path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49" />
  <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14" />
</>)
export const WandVoiceIcon = make(<>
  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
</>)

// ============ 通用 UI ============
export const CloseIcon = make(<>
  <line x1="18" y1="6" x2="6" y2="18" />
  <line x1="6" y1="6" x2="18" y2="18" />
</>)
export const ChevronRightIcon = make(<>
  <polyline points="9 18 15 12 9 6" />
</>)
export const ChevronDownIcon = make(<>
  <polyline points="6 9 12 15 18 9" />
</>)
export const ChevronLeftIcon = make(<>
  <polyline points="15 18 9 12 15 6" />
</>)
export const ArrowRightIcon = make(<>
  <line x1="5" y1="12" x2="19" y2="12" />
  <polyline points="12 5 19 12 12 19" />
</>)
export const ArrowLeftIcon = make(<>
  <line x1="19" y1="12" x2="5" y2="12" />
  <polyline points="12 19 5 12 12 5" />
</>)
export const SearchIcon = make(<>
  <circle cx="11" cy="11" r="8" />
  <line x1="21" y1="21" x2="16.65" y2="16.65" />
</>)
export const MenuIcon = make(<>
  <line x1="3" y1="6" x2="21" y2="6" />
  <line x1="3" y1="12" x2="21" y2="12" />
  <line x1="3" y1="18" x2="21" y2="18" />
</>)
export const SettingsIcon = make(<>
  <circle cx="12" cy="12" r="3" />
  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
</>)
export const PlayIcon = make(<>
  <polygon points="5 3 19 12 5 21 5 3" />
</>)
export const PauseIcon = make(<>
  <rect x="6" y="4" width="4" height="16" />
  <rect x="14" y="4" width="4" height="16" />
</>)
export const StopIcon = make(<>
  <rect x="5" y="5" width="14" height="14" rx="1" />
</>)
export const CopyIcon = make(<>
  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
</>)
export const TrashIcon = make(<>
  <polyline points="3 6 5 6 21 6" />
  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
</>)
export const RefreshIcon = make(<>
  <polyline points="23 4 23 10 17 10" />
  <polyline points="1 20 1 14 7 14" />
  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
</>)
export const MoreVerticalIcon = make(<>
  <circle cx="12" cy="12" r="1" />
  <circle cx="12" cy="5" r="1" />
  <circle cx="12" cy="19" r="1" />
</>)

// ============ 状态指示 ============
export const CheckIcon = make(<>
  <polyline points="20 6 9 17 4 12" />
</>)
export const XIcon = make(<>
  <line x1="18" y1="6" x2="6" y2="18" />
  <line x1="6" y1="6" x2="18" y2="18" />
</>)
export const InfoIcon = make(<>
  <circle cx="12" cy="12" r="10" />
  <line x1="12" y1="16" x2="12" y2="12" />
  <line x1="12" y1="8" x2="12.01" y2="8" />
</>)

// ============ AI / 智能 ============
export const SparkleIcon = make(<>
  <path d="M12 2 14.5 9.5 22 12 14.5 14.5 12 22 9.5 14.5 2 12 9.5 9.5z" />
</>)
export const BoltIcon = make(<>
  <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
</>)
export const BrainIcon = make(<>
  <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2z" />
  <path d="M14.5 2a2.5 2.5 0 0 0-2.5 2.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2z" />
</>)

// ============ Logo / Brand ============
export const OfficeIcon = make(<>
  <rect x="3" y="3" width="18" height="18" rx="2" />
  <path d="M3 9h18" />
  <path d="M9 3v18" />
</>)
export const LayersIcon = make(<>
  <polygon points="12 2 2 7 12 12 22 7 12 2" />
  <polyline points="2 17 12 22 22 17" />
  <polyline points="2 12 12 17 22 12" />
</>)

// ============ Task / 工作台 ============
export const TaskIcon = make(<>
  <rect x="3" y="3" width="18" height="18" rx="2" />
  <path d="m9 12 2 2 4-4" />
</>)
export const HistoryIcon = make(<>
  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
  <polyline points="3 3 3 8 8 8" />
  <polyline points="12 7 12 12 15 14" />
</>)
export const ClockIcon = make(<>
  <circle cx="12" cy="12" r="10" />
  <polyline points="12 6 12 12 16 14" />
</>)
export const StarIcon = make(<>
  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
</>)
export const BookmarkIcon = make(<>
  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
</>)

// ============ 箭头 ============
export const ExternalIcon = make(<>
  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  <polyline points="15 3 21 3 21 9" />
  <line x1="10" y1="14" x2="21" y2="3" />
</>)

/** 全部图标导出（用于通用 icon picker） */
export const ALL_ICONS = {
  file: FileIcon,
  'file-text': FileTextIcon,
  upload: UploadIcon,
  download: DownloadIcon,
  folder: FolderIcon,
  languages: LanguagesIcon,
  translate: TranslateIcon,
  globe: GlobeIcon,
  'check-circle': CheckCircleIcon,
  'alert-circle': AlertCircleIcon,
  'alert-triangle': AlertTriangleIcon,
  'shield-check': ShieldCheckIcon,
  scan: ScanIcon,
  eye: EyeIcon,
  image: ImageIcon,
  close: CloseIcon,
  'chevron-right': ChevronRightIcon,
  'chevron-down': ChevronDownIcon,
  'chevron-left': ChevronLeftIcon,
  'arrow-right': ArrowRightIcon,
  'arrow-left': ArrowLeftIcon,
  search: SearchIcon,
  menu: MenuIcon,
  settings: SettingsIcon,
  play: PlayIcon,
  pause: PauseIcon,
  stop: StopIcon,
  copy: CopyIcon,
  trash: TrashIcon,
  refresh: RefreshIcon,
  'more-vertical': MoreVerticalIcon,
  check: CheckIcon,
  x: XIcon,
  info: InfoIcon,
  sparkle: SparkleIcon,
  brain: BrainIcon,
  office: OfficeIcon,
  layers: LayersIcon,
  task: TaskIcon,
  history: HistoryIcon,
  clock: ClockIcon,
  star: StarIcon,
  bookmark: BookmarkIcon,
  external: ExternalIcon,
} as const

export type IconName = keyof typeof ALL_ICONS