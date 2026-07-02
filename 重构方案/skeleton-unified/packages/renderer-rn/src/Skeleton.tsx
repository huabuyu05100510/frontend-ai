/**
 * @skeleton/renderer-rn - React Native 骨架屏组件
 *
 * RN 渲染约束（与 Web 的主要差异）：
 * - 无 CSS，所有样式为 JS StyleSheet 对象
 * - 无 background-image，无 linear-gradient（需单独安装 expo-linear-gradient）
 * - 位置用 position:'absolute' + 百分比 * 容器宽/高（RN 支持 % 单位）
 * - 动画用 Animated API（pulse）或 expo-linear-gradient（shimmer）
 * - 圆角：borderRadius（所有角）或 borderTopLeftRadius 等
 * - 容器高度：无 aspect-ratio CSS，用 onLayout 获取容器宽度，乘以 1/aspectRatio
 *
 * 设计：
 * - 骨骼用 View position:'absolute' + left/top/width/height（百分比字符串）
 * - pulse：Animated.Value 0→1→0 循环，1800ms，合成器线程（useNativeDriver: true）
 * - shimmer：Animated.Value translateX（-containerWidth → +containerWidth）
 *
 * 用法：
 * ```tsx
 * import { SkeletonRN } from '@skeleton/renderer-rn'
 * <SkeletonRN loading={isLoading} bones={bonesData} name="product-card">
 *   <ProductCard />
 * </SkeletonRN>
 * ```
 */

import React, {
  useRef, useState, useEffect, useMemo,
  type ReactNode,
} from 'react'
// 注意：不直接 import react-native，通过动态引用保持可选
import type { SkeletonData, ResponsiveSkeletonData, Bone, AnimationStyle } from '@skeleton/core'
import {
  normalizeBone, resolveBreakpoint,
  adjustColor, COLOR_DEFAULTS,
  PULSE_DEFAULTS, CONTAINER_DEFAULTS, NATIVE_SHIMMER,
} from '@skeleton/core'

// ─── RN 模块动态引用（避免在非 RN 环境报错）─────────────────────────────────

let RN: typeof import('react-native') | null = null
function getRN() {
  if (!RN) {
    RN = require('react-native')
  }
  return RN!
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SkeletonRNProps {
  loading: boolean
  name?: string
  bones?: SkeletonData | ResponsiveSkeletonData
  animation?: AnimationStyle
  color?: string
  darkColor?: string
  children?: ReactNode
}

// ─── Pulse 动画 ────────────────────────────────────────────────────────────────

function usePulseAnimation(enabled: boolean) {
  const { Animated } = getRN()
  const opacity = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (!enabled) { opacity.setValue(1); return }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [enabled, opacity])

  return opacity
}

// ─── Shimmer 动画 ──────────────────────────────────────────────────────────────

function useShimmerAnimation(enabled: boolean, containerWidth: number) {
  const { Animated } = getRN()
  const translateX = useRef(new Animated.Value(-containerWidth)).current

  useEffect(() => {
    if (!enabled || containerWidth <= 0) return

    const shimmerWidth = containerWidth * (1 + NATIVE_SHIMMER.widthFraction)
    translateX.setValue(-shimmerWidth)

    const loop = Animated.loop(
      Animated.timing(translateX, {
        toValue: shimmerWidth,
        duration: NATIVE_SHIMMER.speed,
        useNativeDriver: true,
      }),
    )
    loop.start()
    return () => loop.stop()
  }, [enabled, containerWidth, translateX])

  return translateX
}

// ─── 单条骨骼 ──────────────────────────────────────────────────────────────────

interface BoneViewProps {
  bone: Bone
  color: string
  opacity?: import('react-native').Animated.Value
}

function BoneView({ bone, color, opacity }: BoneViewProps) {
  const { Animated, StyleSheet } = getRN()

  const baseColor = bone.c
    ? adjustColor(color, CONTAINER_DEFAULTS.lightAdjustment)
    : color

  // RN 百分比字符串（RN 0.71+ 支持 % 单位）
  const style = {
    position: 'absolute' as const,
    left: `${bone.x}%`,
    top: `${bone.y}%`,
    width: `${bone.w}%`,
    height: `${bone.h}%`,
    borderRadius: typeof bone.r === 'number' ? bone.r : (bone.r === '50%' ? 9999 : 8),
    backgroundColor: baseColor,
    ...(bone.minW !== undefined ? { minWidth: `${bone.minW}%` } : {}),
    ...(bone.maxW !== undefined ? { maxWidth: `${bone.maxW}%` } : {}),
  }

  if (opacity && !bone.c) {
    return <Animated.View style={[style, { opacity }]} />
  }
  return <Animated.View style={style} />
}

// ─── 主组件 ────────────────────────────────────────────────────────────────────

export const SkeletonRN: React.FC<SkeletonRNProps> = ({
  loading,
  bones: bonesInput,
  animation = 'pulse',
  color: colorProp,
  darkColor: _darkColor,
  children,
}) => {
  const { View, Dimensions } = getRN()
  const [containerWidth, setContainerWidth] = useState(
    Dimensions.get('window').width,
  )

  const color = colorProp ?? COLOR_DEFAULTS.light

  // 解析骨架数据
  const skeletonData: SkeletonData | null = useMemo(() => {
    if (!bonesInput) return null
    if ('breakpoints' in bonesInput) {
      return resolveBreakpoint(bonesInput.breakpoints, containerWidth)
    }
    return bonesInput
  }, [bonesInput, containerWidth])

  const bones = useMemo(() => {
    if (!skeletonData) return []
    return skeletonData.bones.map(b => normalizeBone(b))
  }, [skeletonData])

  const aspectRatio = skeletonData?.aspectRatio ?? 1

  // 动画
  const pulseOpacity = usePulseAnimation(loading && animation === 'pulse')
  const shimmerTranslate = useShimmerAnimation(loading && animation === 'shimmer', containerWidth)

  if (!loading) {
    return <>{children}</>
  }

  return (
    <View
      onLayout={e => setContainerWidth(e.nativeEvent.layout.width)}
      style={{ width: '100%', aspectRatio }}
      accessible={false}
      accessibilityElementsHidden={true}
    >
      {bones.map((bone, i) => (
        <BoneView
          key={i}
          bone={bone}
          color={color}
          opacity={animation === 'pulse' && !bone.c ? pulseOpacity : undefined}
        />
      ))}
    </View>
  )
}

export default SkeletonRN
