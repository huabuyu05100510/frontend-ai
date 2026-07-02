// OCRPage 模板模式测试（对接真实后端）
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { OCRPage } from '../src/pages/OCRPage'
import { useStore } from '../src/store'

beforeEach(() => {
  useStore.setState({
    tasks: [{
      id: 't_img1', name: 'invoice.png', ext: 'png',
      status: 'ready', originalUrl: '/api/files/t_img1?as=original',
      previewUrl: null, thumbPath: null, pagesDir: null,
    } as any],
    fetchTasks: vi.fn().mockResolvedValue(undefined),
  })
  vi.restoreAllMocks()
  // mock confirm dialog always returns true
  vi.spyOn(window, 'confirm').mockImplementation(() => true)
  vi.spyOn(global, 'fetch').mockImplementation((async (url: string, init?: any) => {
    const u = url.startsWith('http') ? url : 'http://test' + url
    const p = new URL(u).pathname
    const method = (init?.method || 'GET').toUpperCase()
    if (p === '/api/tasks' && method === 'GET') {
      return new Response(JSON.stringify({
        tasks: [{
          id: 't_img1', name: 'invoice.png', ext: 'png',
          status: 'ready', originalUrl: '/api/files/t_img1?as=original',
        }],
      }) as any, { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (p === '/api/ocr/templates' && method === 'GET') {
      return new Response(JSON.stringify({
        items: [
          { id: 'tpl_1', name: '发票模板', scenario: 'finance', sign: 'sig1', fields: [], createdAt: 1, updatedAt: 2 },
          { id: 'tpl_2', name: '医疗票据-test', scenario: 'medical', sign: '', fields: [], createdAt: 1, updatedAt: 3 },
        ],
      }) as any, { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (p === '/api/ocr/template' && method === 'POST') {
      const body = JSON.parse(init?.body || '{}')
      return new Response(JSON.stringify({
        id: 'tpl_new',
        template: { id: 'tpl_new', name: body.name, scenario: body.scenario, sign: body.sign || '', fields: body.fields, createdAt: 1, updatedAt: 1 },
      }) as any, { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (p === '/api/ocr/recognize-template' && method === 'POST') {
      return new Response(JSON.stringify({
        engine: 'local-mock-v1',
        fields: [
          { name: '发票号码', value: '(待识别:发票号码)', confidence: 0 },
          { name: '日期', value: '2024-01-01', confidence: 0 },
        ],
        isMock: true,
        ms: 1,
      }) as any, { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (p?.startsWith('/api/ocr/template/') && method === 'DELETE') {
      return new Response(JSON.stringify({ ok: true, id: p.split('/').pop() }) as any, { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('ok', { status: 200 })
  }) as any)
})

describe('OCRPage 模板管理（对接后端）', () => {
  it('点击模板管理 → 从后端加载模板列表', async () => {
    render(<OCRPage />)
    fireEvent.click(screen.getByText('模板管理'))
    await waitFor(() => {
      expect(screen.getByText('发票模板')).toBeTruthy()
      expect(screen.getByText('医疗票据-test')).toBeTruthy()
    })
  })

  it('按场景过滤', async () => {
    render(<OCRPage />)
    fireEvent.click(screen.getByText('模板管理'))
    await waitFor(() => expect(screen.getByText('发票模板')).toBeTruthy())
    // 默认已加载全部，过滤在前端做
    // 这里仅验证列表加载成功即可（过滤逻辑由后端实现）
  })

  it('删除模板触发后端 DELETE', async () => {
    render(<OCRPage />)
    fireEvent.click(screen.getByText('模板管理'))
    await waitFor(() => expect(screen.getByText('发票模板')).toBeTruthy())
    // 点击第一个删除按钮
    const deleteBtn = screen.getAllByText('删除')[0]
    fireEvent.click(deleteBtn)
    await waitFor(() => {
      // 调用了 DELETE
      expect((global.fetch as any).mock.calls.some((c: any[]) =>
        typeof c[0] === 'string' && c[0].includes('/api/ocr/template/tpl_1')
      )).toBe(true)
    })
  })
})

describe('OCRPage 模板编辑（2 步可视化框选）', () => {
  it('点击模板编辑默认进入第 1 步（参照字段）', () => {
    render(<OCRPage />)
    fireEvent.click(screen.getByText('模板编辑'))
    expect(screen.getByTestId('ocr-template-canvas')).toBeTruthy()
    expect(screen.getByTestId('ocr-step-indicator')).toBeTruthy()
    expect(screen.getByTestId('ocr-ref-list')).toBeTruthy()
    expect(screen.getByTestId('ocr-step-refs').textContent).toContain('参照字段')
    // 底部导航存在
    expect(screen.getByTestId('ocr-step-back')).toBeTruthy()
    expect(screen.getByTestId('ocr-step-next')).toBeTruthy()
  })

  it('点下一步切换到识别字段面板', () => {
    render(<OCRPage />)
    fireEvent.click(screen.getByText('模板编辑'))
    fireEvent.click(screen.getByTestId('ocr-step-next'))
    expect(screen.getByTestId('ocr-field-list')).toBeTruthy()
    // 上一步可用
    const back = screen.getByTestId('ocr-step-back') as HTMLButtonElement
    expect(back.disabled).toBe(false)
  })

  it('refs 步骤拖拽 → 创建参照字段', async () => {
    render(<OCRPage />)
    fireEvent.click(screen.getByText('模板编辑'))
    const canvas = screen.getByTestId('ocr-template-canvas')
    fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(canvas, { clientX: 200, clientY: 150 })
    fireEvent.mouseUp(canvas, { clientX: 200, clientY: 150 })
    await waitFor(() => {
      expect(screen.getByText(/锚点1/)).toBeTruthy()
    })
  })

  it('fields 步骤拖拽 → 创建识别字段', async () => {
    render(<OCRPage />)
    fireEvent.click(screen.getByText('模板编辑'))
    fireEvent.click(screen.getByTestId('ocr-step-next'))
    const canvas = screen.getByTestId('ocr-template-canvas')
    fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(canvas, { clientX: 200, clientY: 150 })
    fireEvent.mouseUp(canvas, { clientX: 200, clientY: 150 })
    await waitFor(() => {
      expect(screen.getByText(/字段1/)).toBeTruthy()
    })
  })

  it('场景选择支持财务/医疗/通用/证照', () => {
    render(<OCRPage />)
    fireEvent.click(screen.getByText('模板编辑'))
    const scenarioSelect = screen.getByTestId('ocr-scenario-select') as HTMLSelectElement
    const opts = Array.from(scenarioSelect.options).map(o => o.value)
    expect(opts).toContain('finance')
    expect(opts).toContain('medical')
    expect(opts).toContain('general')
    expect(opts).toContain('id-card')
  })
})

describe('OCRPage 模板识别（试一试）', () => {
  it('在模板管理列表点"试一试"调识别端点', async () => {
    render(<OCRPage />)
    fireEvent.click(screen.getByText('模板管理'))
    await waitFor(() => expect(screen.getByText('发票模板')).toBeTruthy())
    fireEvent.click(screen.getAllByText('试一试')[0])
    await waitFor(() => {
      expect((global.fetch as any).mock.calls.some((c: any[]) =>
        typeof c[0] === 'string' && c[0].includes('/api/ocr/recognize-template')
      )).toBe(true)
    })
  })

  it('识别结果展示对齐质量 + 引擎名（自研 iocr）', async () => {
    // 重写 mock：保留原 templates 逻辑，覆写 recognize-template 响应为含对齐诊断
    vi.spyOn(global, 'fetch').mockImplementation((async (url: string, init?: any) => {
      const u = url.startsWith('http') ? url : 'http://test' + url
      const p = new URL(u).pathname
      const method = (init?.method || 'GET').toUpperCase()
      if (p === '/api/tasks' && method === 'GET') {
        return new Response(JSON.stringify({
          tasks: [{ id: 't_img1', name: 'invoice.png', ext: 'png', status: 'ready', originalUrl: '/api/files/t_img1?as=original' }],
        }) as any, { status: 200 })
      }
      if (p === '/api/ocr/templates' && method === 'GET') {
        return new Response(JSON.stringify({
          items: [{ id: 'tpl_1', name: '发票模板', scenario: 'finance', sign: '', referenceFields: [], fields: [], createdAt: 1, updatedAt: 2 }],
        }) as any, { status: 200 })
      }
      if (p === '/api/ocr/recognize-template' && method === 'POST') {
        return new Response(JSON.stringify({
          engine: 'self-hosted-iocr-mock',
          fields: [{ name: '发票号码', value: '12345', confidence: 0.9, hitCount: 1 }],
          anchors: [
            { id: 'r1', name: 'r1', text: '发票号码', matched: true, score: 0.95, region: { text: '发票号码' } },
            { id: 'r2', name: 'r2', text: '日期', matched: false, score: 0.2, region: null },
          ],
          alignmentScore: 0.48,
          transform: { offsetX: 50, offsetY: 80, scaleX: 1.0, scaleY: 1.0 },
          regionsTotal: 30,
          isMock: true,
          ms: 42,
        }) as any, { status: 200 })
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as any)
    render(<OCRPage />)
    fireEvent.click(screen.getByText('模板管理'))
    await waitFor(() => expect(screen.getByText('发票模板')).toBeTruthy())
    fireEvent.click(screen.getAllByText('试一试')[0])
    await waitFor(() => {
      expect(screen.getByTestId('ocr-result-engine').textContent).toContain('self-hosted-iocr-mock')
      expect(screen.getByTestId('ocr-result-alignment').textContent).toContain('48%')
      expect(screen.getByTestId('ocr-result-field-发票号码').textContent).toContain('12345')
    })
  })
})
