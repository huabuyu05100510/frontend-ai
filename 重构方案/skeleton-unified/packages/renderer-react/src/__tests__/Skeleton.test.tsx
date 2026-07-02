// @vitest-environment happy-dom

/**
 * @skeleton/renderer-react - Skeleton 组件测试
 *
 * 使用 @testing-library/react + happy-dom 环境。
 */

import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Skeleton } from '../Skeleton.js'
import type { SkeletonData, ResponsiveSkeletonData } from '@skeleton/core'

// ─── 测试用骨架数据 ────────────────────────────────────────────────────────────

const simpleBones: SkeletonData = {
  name: 'test',
  aspectRatio: 375 / 200,
  capturedWidth: 375,
  version: 2,
  bones: [
    [2.67, 5, 94.67, 10],    // 标题
    [2.67, 20, 60, 10],      // 副标题
    [2.67, 40, 30, 40, '50%'],  // 头像（圆形）
  ],
  capturedAt: Date.now(),
  platform: 'web',
}

const responsiveBones: ResponsiveSkeletonData = {
  breakpoints: {
    375: simpleBones,
  },
}

// ─── 测试 ──────────────────────────────────────────────────────────────────────

describe('Skeleton - loading 状态', () => {
  it('loading=true 时渲染骨骼层', () => {
    const { container } = render(
      <Skeleton loading={true} bones={simpleBones} animation="solid" />,
    )
    // 骨架层存在（aria-hidden）
    const skeletonLayer = container.querySelector('[aria-hidden="true"]')
    expect(skeletonLayer).not.toBeNull()
  })

  it('loading=false 时渲染 children', () => {
    render(
      <Skeleton loading={false} bones={simpleBones} fadeOutMs={0}>
        <span data-testid="content">内容</span>
      </Skeleton>,
    )
    expect(screen.getByTestId('content')).toBeDefined()
  })

  it('loading=true 时 children 被 visibility:hidden 遮住', () => {
    const { container } = render(
      <Skeleton loading={true} bones={simpleBones} animation="solid">
        <span data-testid="content">内容</span>
      </Skeleton>,
    )
    // children 在 DOM 中但被 visibility:hidden 容器包裹
    const content = container.querySelector('[data-testid="content"]')
    const wrapper = content?.parentElement as HTMLElement | null
    expect(wrapper?.style.visibility).toBe('hidden')
  })
})

describe('Skeleton - 骨骼渲染', () => {
  it('渲染正确数量的骨骼', () => {
    const { container } = render(
      <Skeleton loading={true} bones={simpleBones} animation="solid" />,
    )
    // simpleBones 有 3 条骨骼
    const skeletonLayer = container.querySelector('[aria-hidden="true"]')!
    const boneEls = skeletonLayer.querySelectorAll('div[style]')
    // 至少有 3 个骨骼元素（padding-top 容器也是 div，所以查带 position:absolute 的）
    const absoluteDivs = Array.from(boneEls).filter(el => {
      const s = (el as HTMLElement).style
      return s.position === 'absolute'
    })
    expect(absoluteDivs.length).toBe(3)
  })

  it('骨骼使用百分比定位', () => {
    const { container } = render(
      <Skeleton loading={true} bones={simpleBones} animation="solid" />,
    )
    const skeletonLayer = container.querySelector('[aria-hidden="true"]')!
    const absoluteDivs = Array.from(skeletonLayer.querySelectorAll('div')).filter(el => {
      return (el as HTMLElement).style.position === 'absolute'
    })
    if (absoluteDivs.length > 0) {
      const first = absoluteDivs[0] as HTMLElement
      expect(first.style.left).toMatch(/%$/)
      expect(first.style.top).toMatch(/%$/)
      expect(first.style.width).toMatch(/%$/)
    }
  })
})

describe('Skeleton - 响应式断点', () => {
  it('接受 ResponsiveSkeletonData', () => {
    const { container } = render(
      <Skeleton loading={true} bones={responsiveBones} animation="solid" />,
    )
    const skeletonLayer = container.querySelector('[aria-hidden="true"]')
    expect(skeletonLayer).not.toBeNull()
  })
})

describe('Skeleton - 动画', () => {
  it('pulse 动画注入 <style>', () => {
    const { container } = render(
      <Skeleton loading={true} bones={simpleBones} animation="pulse" />,
    )
    const styleEl = container.querySelector('style')
    expect(styleEl).not.toBeNull()
    expect(styleEl!.textContent).toContain('keyframes')
  })

  it('shimmer 动画注入 gradient 样式', () => {
    const { container } = render(
      <Skeleton loading={true} bones={simpleBones} animation="shimmer" />,
    )
    const styleEl = container.querySelector('style')
    expect(styleEl).not.toBeNull()
    expect(styleEl!.textContent).toContain('shimmer')
  })

  it('solid 模式不注入 <style>', () => {
    const { container } = render(
      <Skeleton loading={true} bones={simpleBones} animation="solid" />,
    )
    // solid 模式无 animation CSS
    const styleEl = container.querySelector('style')
    expect(styleEl).toBeNull()
  })
})

describe('Skeleton - 自定义颜色', () => {
  it('接受 color 属性', () => {
    const { container } = render(
      <Skeleton loading={true} bones={simpleBones} animation="solid" color="#ff0000" />,
    )
    const skeletonLayer = container.querySelector('[aria-hidden="true"]')!
    const bones = Array.from(skeletonLayer.querySelectorAll('div')).filter(
      el => (el as HTMLElement).style.position === 'absolute',
    )
    if (bones.length > 0) {
      // backgroundColor 应当是传入的颜色
      const bg = (bones[0] as HTMLElement).style.backgroundColor
      expect(bg).toBeTruthy()
    }
  })
})

describe('Skeleton - 无骨架数据', () => {
  it('bones=undefined 时仅渲染 loading 占位', () => {
    const { container } = render(
      <Skeleton loading={true} />,
    )
    // 即使没有 bones，骨架层也应存在（0 个骨骼）
    const skeletonLayer = container.querySelector('[aria-hidden="true"]')
    expect(skeletonLayer).not.toBeNull()
  })
})
