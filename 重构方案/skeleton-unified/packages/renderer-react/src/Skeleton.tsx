/**
 * @skeleton/renderer-react - React 骨架屏组件
 *
 * 设计目标：
 * 1. 零 CLS（内容布局偏移为 0）：用 aspectRatio 撑开占位空间
 * 2. 全百分比坐标：骨骼用 CSS % 定位，任意宽度完美缩放
 * 3. 固定宽度约束：min-width/max-width % 防止小骨骼被拉伸
 * 4. 深色模式感知：MutationObserver 监听 .dark class
 * 5. 响应式：ResizeObserver 追踪容器宽度，自动切换断点
 * 6. 动画：pulse（CSS keyframes，合成器线程）/ shimmer（渐变平移）
 *
 * 用法：
 * ```tsx
 * // 方式 1：直接传入 bones（构建期生成的 JSON）
 * import bones from './product-card.bones.json'
 * <Skeleton loading={isLoading} bones={bones} name="product-card">
 *   <ProductCard />
 * </Skeleton>
 *
 * // 方式 2：运行时自动捕获（配合 useSkeletonCapture）
 * <Skeleton loading={isLoading} name="product-card">
 *   <ProductCard />
 * </Skeleton>
 * ```
 */

import React, {
  useRef, useState, useEffect, useMemo,
  type ReactNode, type CSSProperties,
} from 'react'

// React 17 兼容：useId 是 React 18 新增，这里用 ref + 计数器模拟
let _uidCounter = 0
function useId(): string {
  const ref = useRef<string>('')
  if (!ref.current) {
    ref.current = `:r${(_uidCounter++).toString(36)}:`
  }
  return ref.current
}
import type {
  SkeletonData, ResponsiveSkeletonData, AnimationStyle, Bone,
} from '@skeleton/core'
import {
  normalizeBone, resolveBreakpoint,
  adjustColor, COLOR_DEFAULTS,
  PULSE_DEFAULTS, SHIMMER_DEFAULTS, CONTAINER_DEFAULTS,
} from '@skeleton/core'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SkeletonProps {
  /** 是否显示骨架（true=显示骨架，false=显示子内容） */
  loading: boolean
  /** 组件名（用于从存储查找骨架数据） */
  name?: string
  /**
   * 直接传入骨架数据（优先于 storage）。
   * 支持单断点 SkeletonData 或多断点 ResponsiveSkeletonData。
   */
  bones?: SkeletonData | ResponsiveSkeletonData
  /** 动画风格，默认 'pulse' */
  animation?: AnimationStyle
  /** 骨架颜色（亮色模式），默认 '#f0f0f0' */
  color?: string
  /** 骨架颜色（暗色模式），默认 '#222222' */
  darkColor?: string
  /**
   * 骨架淡出过渡时长（ms）。
   * loading→false 时骨架平滑淡出。默认 300ms，0 = 无过渡
   */
  fadeOutMs?: number
  /** 自定义容器 className */
  className?: string
  /** 自定义容器 style */
  style?: CSSProperties
  children?: ReactNode
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/** 从响应式或单一骨架数据中解析出当前宽度对应的 SkeletonData */
function resolveData(
  data: SkeletonData | ResponsiveSkeletonData,
  width: number,
): SkeletonData | null {
  if ('breakpoints' in data) {
    return resolveBreakpoint(data.breakpoints, width)
  }
  return data
}

/** 生成单条骨骼的 CSS style（全百分比 + min/max 约束） */
function boneStyle(bone: Bone, color: string, isDark: boolean): CSSProperties {
  const containerAdjust = bone.c
    ? (isDark ? CONTAINER_DEFAULTS.darkAdjustment : CONTAINER_DEFAULTS.lightAdjustment)
    : 0
  const baseColor = containerAdjust !== 0 ? adjustColor(color, containerAdjust) : color

  const style: CSSProperties = {
    position: 'absolute',
    left: `${bone.x}%`,
    top: `${bone.y}%`,
    width: `${bone.w}%`,
    height: `${bone.h}%`,
    borderRadius: bone.r !== undefined
      ? (typeof bone.r === 'number' ? `${bone.r}px` : bone.r)
      : '8px',
    backgroundColor: baseColor,
    boxSizing: 'border-box',
  }

  // min/max 约束（固定宽度骨骼防止响应式变形）
  if (bone.minW !== undefined) style.minWidth = `${bone.minW}%`
  if (bone.maxW !== undefined) style.maxWidth = `${bone.maxW}%`
  if (bone.minH !== undefined) style.minHeight = `${bone.minH}%`
  if (bone.maxH !== undefined) style.maxHeight = `${bone.maxH}%`

  return style
}

// ─── 暗色模式检测 ─────────────────────────────────────────────────────────────

function useDarkMode(containerRef: React.RefObject<HTMLElement | null>): boolean {
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    const check = () => {
      const el = containerRef.current ?? document.documentElement
      setIsDark(el.classList.contains('dark') || document.documentElement.classList.contains('dark'))
    }

    check()

    // 监听 .dark class 变化
    const observer = new MutationObserver(check)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    // 监听系统主题
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', check)

    return () => {
      observer.disconnect()
      mq.removeEventListener('change', check)
    }
  }, [containerRef])

  return isDark
}

// ─── 容器宽度追踪 ──────────────────────────────────────────────────────────────

function useContainerWidth(containerRef: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(375)

  useEffect(() => {
    if (!containerRef.current) return
    setWidth(containerRef.current.offsetWidth || 375)

    const observer = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width
      if (w && w > 0) setWidth(Math.round(w))
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [containerRef])

  return width
}

// ─── CSS 动画注入 ──────────────────────────────────────────────────────────────

function useAnimationStyles(uid: string, color: string, isDark: boolean, animation: AnimationStyle): string {
  return useMemo(() => {
    if (!animation || animation === 'solid') return ''

    if (animation === 'pulse') {
      return `
        @keyframes ske-pulse-${uid} {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .ske-bone-${uid} { animation: ske-pulse-${uid} ${PULSE_DEFAULTS.speed} ease-in-out infinite; }
        .ske-bone-${uid}[data-c] { animation: none; }
      `
    }

    if (animation === 'shimmer') {
      const highlight = isDark ? SHIMMER_DEFAULTS.darkHighlight : SHIMMER_DEFAULTS.lightHighlight
      return `
        @keyframes ske-shimmer-${uid} {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .ske-bone-${uid} {
          background: linear-gradient(
            ${SHIMMER_DEFAULTS.angle}deg,
            ${color} ${SHIMMER_DEFAULTS.start}%,
            ${highlight} 50%,
            ${color} ${SHIMMER_DEFAULTS.end}%
          );
          background-size: 200% 100%;
          animation: ske-shimmer-${uid} ${SHIMMER_DEFAULTS.speed} linear infinite;
        }
        .ske-bone-${uid}[data-c] { animation: none; background: none; }
      `
    }

    return ''
  }, [uid, color, isDark, animation])
}

// ─── 主组件 ────────────────────────────────────────────────────────────────────

export const Skeleton: React.FC<SkeletonProps> = ({
  loading,
  name: _name,
  bones: bonesInput,
  animation = 'pulse',
  color: colorProp,
  darkColor: darkColorProp,
  fadeOutMs = 300,
  className,
  style,
  children,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const uid = useId().replace(/:/g, '')

  const isDark = useDarkMode(containerRef)
  const containerWidth = useContainerWidth(containerRef)

  const color = colorProp ?? (isDark ? COLOR_DEFAULTS.dark : COLOR_DEFAULTS.light)
  const darkColor = darkColorProp ?? COLOR_DEFAULTS.dark
  const activeColor = isDark ? darkColor : color

  // 解析当前断点的骨架数据
  const skeletonData: SkeletonData | null = useMemo(() => {
    if (!bonesInput) return null
    return resolveData(bonesInput, containerWidth)
  }, [bonesInput, containerWidth])

  // 骨骼列表
  const bones: Bone[] = useMemo(() => {
    if (!skeletonData) return []
    return skeletonData.bones.map(b => normalizeBone(b))
  }, [skeletonData])

  // 淡出状态
  const [visible, setVisible] = useState(loading)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    if (loading) {
      setVisible(true)
      setFading(false)
    } else if (visible) {
      if (fadeOutMs > 0) {
        setFading(true)
        const timer = setTimeout(() => {
          setVisible(false)
          setFading(false)
        }, fadeOutMs)
        return () => clearTimeout(timer)
      } else {
        setVisible(false)
      }
    }
  }, [loading, fadeOutMs, visible])

  const animationCSS = useAnimationStyles(uid, activeColor, isDark, animation)

  // 容器高度：用 aspectRatio 撑高（骨架内部用绝对定位）
  const aspectRatio = skeletonData?.aspectRatio ?? 1
  const containerStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    ...(visible ? { paddingTop: `${(1 / aspectRatio) * 100}%` } : {}),
    ...style,
  }

  if (!visible) {
    return <div ref={containerRef} className={className} style={style}>{children}</div>
  }

  return (
    <div ref={containerRef} className={className} style={{ position: 'relative' }}>
      {/* 骨架层 */}
      <div
        style={{
          ...containerStyle,
          opacity: fading ? 0 : 1,
          transition: fading ? `opacity ${fadeOutMs}ms ease` : undefined,
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      >
        {animationCSS && <style>{animationCSS}</style>}
        {bones.map((bone, i) => (
          <div
            key={i}
            className={`ske-bone-${uid}`}
            data-c={bone.c ? '' : undefined}
            style={boneStyle(bone, activeColor, isDark)}
          />
        ))}
      </div>
      {/* 子内容（骨架显示时隐藏） */}
      <div style={{ visibility: 'hidden', position: 'absolute', top: 0, left: 0, width: '100%' }}>
        {children}
      </div>
    </div>
  )
}

export default Skeleton
