/**
 * @skeleton/renderer-react - 纯 HTML 渲染器（SSR 路径）
 *
 * 在服务端或无 React 环境下，将骨架数据渲染为 HTML 字符串。
 * 可用于：
 * - Next.js getServerSideProps 中生成骨架 HTML 作为 fallback
 * - Edge runtime 返回带骨架的初始 HTML
 * - 调试工具（对比骨架和真实内容）
 */

import type { SkeletonData } from '@skeleton/core'
import {
  normalizeBone, adjustColor,
  COLOR_DEFAULTS, PULSE_DEFAULTS, CONTAINER_DEFAULTS,
} from '@skeleton/core'

export interface RenderOptions {
  color?: string
  animation?: 'pulse' | 'shimmer' | 'solid' | false
  uid?: string
}

/**
 * 将 SkeletonData 渲染为 HTML 字符串。
 *
 * @example
 * const html = renderSkeletonToHTML(data, { animation: 'pulse' })
 * // 注入到 <div id="skeleton-placeholder">${html}</div>
 */
export function renderSkeletonToHTML(
  data: SkeletonData,
  opts: RenderOptions = {},
): string {
  const color = opts.color ?? COLOR_DEFAULTS.light
  const animation = opts.animation ?? 'pulse'
  const uid = opts.uid ?? `ske-${Date.now().toString(36)}`

  const bones = data.bones.map(b => normalizeBone(b))
  const { aspectRatio } = data

  // 动画 CSS
  let animationCSS = ''
  if (animation === 'pulse') {
    animationCSS = `
      @keyframes ske-pulse-${uid} { 0%,100%{opacity:1} 50%{opacity:.4} }
      .ske-bone-${uid}:not([data-c]){animation:ske-pulse-${uid} ${PULSE_DEFAULTS.speed} ease-in-out infinite}
    `
  }

  const containerStyle = [
    'position:relative',
    'width:100%',
    `padding-top:${((1 / aspectRatio) * 100).toFixed(3)}%`,
  ].join(';')

  const boneHTMLs = bones.map(bone => {
    const baseColor = bone.c
      ? adjustColor(color, CONTAINER_DEFAULTS.lightAdjustment)
      : color

    const styles: string[] = [
      'position:absolute',
      `left:${bone.x}%`,
      `top:${bone.y}%`,
      `width:${bone.w}%`,
      `height:${bone.h}%`,
      `border-radius:${bone.r !== undefined ? (typeof bone.r === 'number' ? `${bone.r}px` : bone.r) : '8px'}`,
      `background-color:${baseColor}`,
    ]
    if (bone.minW !== undefined) styles.push(`min-width:${bone.minW}%`)
    if (bone.maxW !== undefined) styles.push(`max-width:${bone.maxW}%`)
    if (bone.minH !== undefined) styles.push(`min-height:${bone.minH}%`)
    if (bone.maxH !== undefined) styles.push(`max-height:${bone.maxH}%`)

    return `<div class="ske-bone-${uid}"${bone.c ? ' data-c=""' : ''} style="${styles.join(';')}"></div>`
  }).join('')

  return `
<style>${animationCSS}</style>
<div style="${containerStyle}" aria-hidden="true">${boneHTMLs}</div>
`.trim()
}
