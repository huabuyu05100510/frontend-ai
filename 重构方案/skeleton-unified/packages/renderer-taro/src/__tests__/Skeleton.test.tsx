// @vitest-environment happy-dom

/**
 * @skeleton/renderer-taro - SkeletonTaro 组件测试
 *
 * Mock @tarojs/taro 和 @tarojs/components，用 React Testing Library 渲染验证。
 */

import React from 'react'
import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SkeletonData, ResponsiveSkeletonData } from '@skeleton/core'

// ─── Mock @tarojs/taro ────────────────────────────────────────────────────────

vi.mock('@tarojs/taro', () => ({
  default: {
    getEnv: () => 'WEB',
    ENV_TYPE: { WEB: 'WEB', WEAPP: 'WEAPP' },
    getWindowInfo: () => ({ windowWidth: 375 }),
  },
}))

// ─── Mock @tarojs/components ──────────────────────────────────────────────────

vi.mock('@tarojs/components', () => ({
  View: ({ children, style, className, 'data-c': dataC, ...rest }: {
    children?: React.ReactNode
    style?: React.CSSProperties
    className?: string
    'data-c'?: string
    [key: string]: unknown
  }) => (
    <div style={style} className={className} data-c={dataC} {...rest}>
      {children}
    </div>
  ),
}))

// ─── 测试数据 ─────────────────────────────────────────────────────────────────

const simpleBones: SkeletonData = {
  name: 'test',
  aspectRatio: 375 / 200,
  capturedWidth: 375,
  version: 2,
  bones: [
    [2.67, 5, 94.67, 10],        // 标题
    [2.67, 20, 60, 10],          // 副标题
    [2.67, 40, 30, 40, '50%'],   // 头像（圆形）
  ],
  capturedAt: Date.now(),
  platform: 'web',
}

const responsiveBones: ResponsiveSkeletonData = {
  breakpoints: {
    375: simpleBones,
  },
}

// ─── 动态导入（mock 之后再 import 组件）──────────────────────────────────────

let SkeletonTaro: typeof import('../Skeleton.js').SkeletonTaro

beforeEach(async () => {
  const mod = await import('../Skeleton.js')
  SkeletonTaro = mod.SkeletonTaro
})

// ─── 测试 ──────────────────────────────────────────────────────────────────────

describe('SkeletonTaro - loading 状态', () => {
  it('loading=false 时渲染 children', () => {
    const { container } = render(
      <SkeletonTaro loading={false} bones={simpleBones}>
        <span data-testid="content">内容</span>
      </SkeletonTaro>,
    )
    expect(container.querySelector('[data-testid="content"]')).not.toBeNull()
  })

  it('loading=true 时不渲染 children', () => {
    const { container } = render(
      <SkeletonTaro loading={true} bones={simpleBones} animation="solid">
        <span data-testid="content">内容</span>
      </SkeletonTaro>,
    )
    // loading=true 时渲染骨架容器，不渲染 children
    expect(container.querySelector('[data-testid="content"]')).toBeNull()
  })

  it('loading=true 时渲染骨架容器', () => {
    const { container } = render(
      <SkeletonTaro loading={true} bones={simpleBones} animation="solid" />,
    )
    // 容器存在（position:relative）
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper).not.toBeNull()
    expect(wrapper.style.position).toBe('relative')
  })
})

describe('SkeletonTaro - 骨骼渲染', () => {
  it('渲染正确数量的骨骼', () => {
    const { container } = render(
      <SkeletonTaro loading={true} bones={simpleBones} animation="solid" />,
    )
    // simpleBones 有 3 条骨骼，各为 position:absolute 的 div
    const absoluteDivs = Array.from(container.querySelectorAll('div')).filter(el => {
      return (el as HTMLElement).style.position === 'absolute'
    })
    expect(absoluteDivs.length).toBe(3)
  })

  it('骨骼使用百分比定位', () => {
    const { container } = render(
      <SkeletonTaro loading={true} bones={simpleBones} animation="solid" />,
    )
    const absoluteDivs = Array.from(container.querySelectorAll('div')).filter(el => {
      return (el as HTMLElement).style.position === 'absolute'
    })
    const first = absoluteDivs[0] as HTMLElement
    expect(first.style.left).toMatch(/%$/)
    expect(first.style.top).toMatch(/%$/)
    expect(first.style.width).toMatch(/%$/)
    expect(first.style.height).toMatch(/%$/)
  })

  it('容器使用 padding-top 撑高（aspectRatio）', () => {
    const { container } = render(
      <SkeletonTaro loading={true} bones={simpleBones} animation="solid" />,
    )
    const wrapper = container.firstElementChild as HTMLElement
    // padding-top = (1 / aspectRatio) * 100%
    expect(wrapper.style.paddingTop).toMatch(/%$/)
    // aspectRatio = 375/200 ≈ 1.875, padding-top ≈ 53.333%
    const val = parseFloat(wrapper.style.paddingTop)
    expect(val).toBeCloseTo((1 / (375 / 200)) * 100, 1)
  })
})

describe('SkeletonTaro - 响应式断点', () => {
  it('接受 ResponsiveSkeletonData', () => {
    const { container } = render(
      <SkeletonTaro loading={true} bones={responsiveBones} animation="solid" />,
    )
    const absoluteDivs = Array.from(container.querySelectorAll('div')).filter(el => {
      return (el as HTMLElement).style.position === 'absolute'
    })
    expect(absoluteDivs.length).toBe(3)
  })
})

describe('SkeletonTaro - 动画', () => {
  it('H5 环境下 pulse 注入 <style>', () => {
    const { container } = render(
      <SkeletonTaro loading={true} bones={simpleBones} animation="pulse" />,
    )
    const styleEl = container.querySelector('style')
    expect(styleEl).not.toBeNull()
    expect(styleEl!.textContent).toContain('keyframes')
  })

  it('solid 模式不注入 <style>', () => {
    const { container } = render(
      <SkeletonTaro loading={true} bones={simpleBones} animation="solid" />,
    )
    const styleEl = container.querySelector('style')
    expect(styleEl).toBeNull()
  })

  it('pulse 骨骼有 className', () => {
    const { container } = render(
      <SkeletonTaro loading={true} bones={simpleBones} animation="pulse" />,
    )
    const boneDivs = Array.from(container.querySelectorAll('div')).filter(el => {
      return (el as HTMLElement).style.position === 'absolute'
    })
    // pulse 模式下每个骨骼有 ske-taro-bone class
    expect(boneDivs[0].className).toContain('ske-taro-bone')
  })
})

describe('SkeletonTaro - 自定义颜色', () => {
  it('自定义 color 应用到骨骼背景色', () => {
    const { container } = render(
      <SkeletonTaro loading={true} bones={simpleBones} animation="solid" color="#e00000" />,
    )
    const absoluteDivs = Array.from(container.querySelectorAll('div')).filter(el => {
      return (el as HTMLElement).style.position === 'absolute'
    })
    expect(absoluteDivs.length).toBeGreaterThan(0)
    // 骨骼有 backgroundColor 样式
    const bg = (absoluteDivs[0] as HTMLElement).style.backgroundColor
    expect(bg).toBeTruthy()
  })
})

describe('SkeletonTaro - 无骨架数据', () => {
  it('bones=undefined 时渲染空骨架容器', () => {
    const { container } = render(
      <SkeletonTaro loading={true} />,
    )
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper).not.toBeNull()
    // 无骨骼元素
    const absoluteDivs = Array.from(container.querySelectorAll('div')).filter(el => {
      return (el as HTMLElement).style.position === 'absolute'
    })
    expect(absoluteDivs.length).toBe(0)
  })
})
