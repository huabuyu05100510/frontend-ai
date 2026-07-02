/**
 * @skeleton/renderer-taro - Taro 跨端骨架屏组件
 *
 * Taro 特性：
 * - H5 端：编译为 React，复用 @skeleton/renderer-react 组件
 * - 小程序端：编译为 WXML/WXSS，用 View + style 对象
 *
 * 小程序渲染约束：
 * - 不支持动态 CSS（不能用 style="animation: xxx"），只能用内联样式
 * - 动画需用 wx.createAnimation 或 CSS animation class
 * - 渐变需用 linear-gradient（小程序 CSS 支持）
 * - aspectRatio：padding-top 撑高方案（小程序支持）
 *
 * 用法：
 * ```tsx
 * import { SkeletonTaro } from '@skeleton/renderer-taro'
 * <SkeletonTaro loading={isLoading} bones={data} name="product-card">
 *   <ProductCard />
 * </SkeletonTaro>
 * ```
 */

import React, { useState, useEffect, useMemo, type ReactNode } from 'react'
import { View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import type { SkeletonData, ResponsiveSkeletonData, Bone } from '@skeleton/core'
import {
  normalizeBone, resolveBreakpoint,
  adjustColor, COLOR_DEFAULTS, CONTAINER_DEFAULTS,
} from '@skeleton/core'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SkeletonTaroProps {
  loading: boolean
  name?: string
  bones?: SkeletonData | ResponsiveSkeletonData
  animation?: 'pulse' | 'shimmer' | 'solid' | false
  color?: string
  children?: ReactNode
  className?: string
}

// ─── 环境检测 ─────────────────────────────────────────────────────────────────

const IS_H5 = Taro.getEnv() === Taro.ENV_TYPE.WEB

// ─── 骨骼样式生成 ──────────────────────────────────────────────────────────────

function boneStyle(bone: Bone, color: string): React.CSSProperties {
  const baseColor = bone.c
    ? adjustColor(color, CONTAINER_DEFAULTS.lightAdjustment)
    : color

  return {
    position: 'absolute',
    left: `${bone.x}%`,
    top: `${bone.y}%`,
    width: `${bone.w}%`,
    height: `${bone.h}%`,
    borderRadius: bone.r !== undefined
      ? (typeof bone.r === 'number' ? `${bone.r}px` : bone.r)
      : '8px',
    backgroundColor: baseColor,
    ...(bone.minW !== undefined ? { minWidth: `${bone.minW}%` } : {}),
    ...(bone.maxW !== undefined ? { maxWidth: `${bone.maxW}%` } : {}),
    ...(bone.minH !== undefined ? { minHeight: `${bone.minH}%` } : {}),
    ...(bone.maxH !== undefined ? { maxHeight: `${bone.maxH}%` } : {}),
  } as React.CSSProperties
}

// ─── 容器宽度（用于选择断点）──────────────────────────────────────────────────

function useWindowWidth(): number {
  const [width, setWidth] = useState(() => {
    try {
      return Taro.getWindowInfo().windowWidth
    } catch {
      return 375
    }
  })

  useEffect(() => {
    if (IS_H5) {
      const handler = () => setWidth(window.innerWidth)
      window.addEventListener('resize', handler)
      return () => window.removeEventListener('resize', handler)
    }
  }, [])

  return width
}

// ─── 主组件 ────────────────────────────────────────────────────────────────────

export const SkeletonTaro: React.FC<SkeletonTaroProps> = ({
  loading,
  bones: bonesInput,
  animation = 'pulse',
  color: colorProp,
  children,
  className,
}) => {
  const windowWidth = useWindowWidth()
  const color = colorProp ?? COLOR_DEFAULTS.light

  const skeletonData: SkeletonData | null = useMemo(() => {
    if (!bonesInput) return null
    if ('breakpoints' in bonesInput) {
      return resolveBreakpoint(bonesInput.breakpoints, windowWidth)
    }
    return bonesInput
  }, [bonesInput, windowWidth])

  const bones: Bone[] = useMemo(() => {
    if (!skeletonData) return []
    return skeletonData.bones.map(b => normalizeBone(b))
  }, [skeletonData])

  const aspectRatio = skeletonData?.aspectRatio ?? 1

  if (!loading) {
    return <>{children}</>
  }

  // 容器：padding-top 撑高（小程序/H5 均支持）
  const containerStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    paddingTop: `${((1 / aspectRatio) * 100).toFixed(3)}%`,
  }

  // H5 端注入 pulse 动画 CSS
  const animationStyle = IS_H5 && animation === 'pulse' ? (
    <style>{`
      @keyframes ske-taro-pulse {0%,100%{opacity:1}50%{opacity:.4}}
      .ske-taro-bone{animation:ske-taro-pulse 1.8s ease-in-out infinite}
      .ske-taro-bone[data-c]{animation:none}
    `}</style>
  ) : null

  return (
    <View className={className} style={containerStyle}>
      {animationStyle}
      {bones.map((bone, i) => (
        <View
          key={i}
          className={animation === 'pulse' ? 'ske-taro-bone' : undefined}
          data-c={bone.c ? '1' : undefined}
          style={boneStyle(bone, color)}
        />
      ))}
    </View>
  )
}

export default SkeletonTaro
