// 双栏对比 / 智检 — 组件测试（重构后）
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { InspectCompareModal } from '../src/inspect/InspectCompareModal'
import { useStore } from '../src/store'
import type { Task, InspectDiffResponse } from '../src/types'

function txtTask(over: Partial<Task> = {}): Task {
  return {
    id: 't1', name: '原文.txt', size: 100, ext: 'txt', mime: 'text/plain',
    strategy: 'frontend', originalUrl: '/o', previewUrl: '/p', previewExt: 'txt',
    convertStatus: 'done', status: 'ready',
    createdAt: Date.now(), updatedAt: Date.now(),
    ...over,
  } as Task
}

const MOCK_DIFF: InspectDiffResponse = {
  ops: [
    { op: 'equal', text: '权' },
    { op: 'delete', text: '利' },
    { op: 'insert', text: '力' },
    { op: 'equal', text: ' ' },
    { op: 'delete', text: '既' },
    { op: 'insert', text: '继' },
    { op: 'equal', text: '往开来' },
  ],
  errors: [
    { id: 'e1', original: '利', corrected: '力', op: 'change' },
    { id: 'e2', original: '既', corrected: '继', op: 'change' },
  ],
  hunks: [
    { kind: 'equal', text: '权' },
    { kind: 'change', original: '利', corrected: '力' },
    { kind: 'equal', text: ' ' },
    { kind: 'change', original: '既', corrected: '继' },
    { kind: 'equal', text: '往开来' },
  ],
  tokens: [
    { type: 'equal', text: '权' },
    { type: 'delete', text: '利' },
    { type: 'insert', text: '力' },
    { type: 'equal', text: ' ' },
    { type: 'delete', text: '既' },
    { type: 'insert', text: '继' },
    { type: 'equal', text: '往开来' },
  ],
  // 段落级 diff blocks（granularity='paragraph' 时存在）
  paragraphBlocks: [
    { kind: 'change', leftText: '利', rightText: '力',
      charOps: [{ op: 'delete', text: '利' }, { op: 'insert', text: '力' }] },
    { kind: 'equal', leftText: ' ', rightText: ' ' },
    { kind: 'change', leftText: '既', rightText: '继',
      charOps: [{ op: 'delete', text: '既' }, { op: 'insert', text: '继' }] },
    { kind: 'equal', leftText: '往开来', rightText: '往开来' },
  ],
  ms: 5,
  meta: { granularity: 'char', leftChars: 7, rightChars: 7, errorCount: 2 },
}

function mockFetchDiff(
  response: InspectDiffResponse | null = MOCK_DIFF,
  opts: { delay?: number; fail?: boolean; sourceText?: string } = {},
) {
  return vi.fn().mockImplementation((url: string, _init?: any) => {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (opts.fail) return reject(new Error('network'))
        if (url && url.startsWith('/o')) {
          return resolve({
            ok: true, status: 200,
            headers: { get: () => null },
            text: async () => opts.sourceText || '权利 既往开来',
            arrayBuffer: async () => new TextEncoder().encode(opts.sourceText || '权利 既往开来').buffer,
          } as any)
        }
        resolve({
          ok: true, status: 200,
          headers: { get: (k: string) => k === 'X-Diff-Ms' ? '5' : null },
          json: async () => response,
          text: async () => JSON.stringify(response),
        } as any)
      }, opts.delay ?? 0)
    })
  })
}

describe('InspectCompareModal — 基础渲染', () => {
  beforeEach(() => {
    localStorage.clear()
    global.fetch = mockFetchDiff() as any
    useStore.setState({ inspectMode: 'inspect' })
  })
  afterEach(() => cleanup())

  it('不显示：open=false', () => {
    const { container } = render(
      <InspectCompareModal open={false} source={txtTask()} compare={null} onClose={() => {}} />,
    )
    expect(container.querySelector('.inspect-compare-modal')).toBeNull()
  })

  it('显示：open=true 渲染顶部工具条 + 主内容区 + 错误侧栏', () => {
    render(
      <InspectCompareModal open={true} source={txtTask()} compare={null} onClose={() => {}} />,
    )
    expect(screen.getByRole('dialog') || screen.getByTestId('inspect-modal')).toBeTruthy()
    expect(screen.getByTestId('inspect-toolbar')).toBeTruthy()
    // 智检模式默认：左主内容区 + 右错误侧栏
    expect(screen.getByTestId('inspect-left')).toBeTruthy()
    expect(screen.getByTestId('inspect-diff-sidebar')).toBeTruthy()
  })

  it('顶部工具条有模式切换按钮（智检 / 双栏对比）', () => {
    render(
      <InspectCompareModal open={true} source={txtTask()} compare={null} onClose={() => {}} />,
    )
    expect(screen.getByRole('button', { name: /智检/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /双栏对比/ })).toBeTruthy()
  })
})

describe('InspectCompareModal — 数据加载', () => {
  beforeEach(() => {
    localStorage.clear()
    useStore.setState({ inspectMode: 'inspect' })
  })
  afterEach(() => cleanup())

  it('open=true 时调用 /api/inspect/diff 至少 1 次', async () => {
    const fetchMock = mockFetchDiff()
    global.fetch = fetchMock as any
    render(
      <InspectCompareModal
        open={true}
        source={txtTask({ id: 't-orig' })}
        compare={txtTask({ id: 't-cmp', name: '改正.txt' })}
        onClose={() => {}}
      />,
    )
    await waitFor(() => {
      const diffCalls = fetchMock.mock.calls.filter(([u]: any) => u === '/api/inspect/diff')
      expect(diffCalls.length).toBeGreaterThanOrEqual(1)
    })
    const diffCall = fetchMock.mock.calls.find(([u]: any) => u === '/api/inspect/diff')
    expect(diffCall).toBeTruthy()
    const [, init] = diffCall!
    const body = JSON.parse(init.body)
    expect(body).toHaveProperty('left')
    expect(body).toHaveProperty('right')
    // 始终拉 paragraph 粒度：dual 模式靠 paragraphBlocks 对齐，
    // inspect 模式仍用 tokens/errors（granularity 不影响这两项）
    expect(body.granularity).toBe('paragraph')
  })

  it('智检模式：主文档区包含 delete token（红色下划线标记）', async () => {
    global.fetch = mockFetchDiff() as any
    const { container } = render(
      <InspectCompareModal open={true} source={txtTask()} compare={txtTask({ name: '改正.txt' })} onClose={() => {}} />,
    )
    await waitFor(() => {
      const main = container.querySelector('[data-testid="inspect-left"]')!
      expect(main.querySelector('.diff-token-delete')?.textContent).toBe('利')
    })
  })

  it('双栏段落网格：渲染所有 block，左右成对 cell，同行 pairId 一致', async () => {
    global.fetch = mockFetchDiff() as any
    useStore.setState({ inspectMode: 'dual' })
    const { container } = render(
      <InspectCompareModal
        open={true}
        source={txtTask()}
        compare={txtTask({ name: '改正.txt' })}
        onClose={() => {}}
        defaultMode="dual"
      />,
    )
    await waitFor(() => {
      // mock 返回 4 个 paragraphBlocks → 渲染 8 个 cell（4 行 × 左右）
      const cells = container.querySelectorAll('.dcv-para[data-pair-id]')
      expect(cells.length).toBeGreaterThanOrEqual(8)
    })

    // 每个 pairId 在左右两侧都存在
    const leftPairs = new Set(
      Array.from(container.querySelectorAll('.dcv-para[data-side="left"][data-pair-id]'))
        .map(el => el.getAttribute('data-pair-id'))
    )
    const rightPairs = new Set(
      Array.from(container.querySelectorAll('.dcv-para[data-side="right"][data-pair-id]'))
        .map(el => el.getAttribute('data-pair-id'))
    )
    expect(leftPairs.size).toBeGreaterThan(0)
    expect(leftPairs).toEqual(rightPairs)
  })

  it('双栏段落：change block 左侧渲染 delete char，右侧渲染 insert char', async () => {
    global.fetch = mockFetchDiff() as any
    useStore.setState({ inspectMode: 'dual' })
    const { container } = render(
      <InspectCompareModal
        open={true}
        source={txtTask()}
        compare={txtTask({ name: '改正.txt' })}
        onClose={() => {}}
        defaultMode="dual"
      />,
    )
    await waitFor(() => {
      // 第一个 change block：左 "利" / 右 "力"
      const leftChange = container.querySelector(
        '.dcv-para[data-side="left"].dcv-para-change'
      ) as HTMLElement
      expect(leftChange).toBeTruthy()
      expect(leftChange.querySelector('.dcv-char-delete')?.textContent).toBe('利')

      const rightChange = container.querySelector(
        '.dcv-para[data-side="right"].dcv-para-change'
      ) as HTMLElement
      expect(rightChange).toBeTruthy()
      expect(rightChange.querySelector('.dcv-char-insert')?.textContent).toBe('力')
    })
  })

  it('双栏段落：hover 一个 change block → 同行左右两 cell 同步进入 dcv-para-pair-hover', async () => {
    global.fetch = mockFetchDiff() as any
    useStore.setState({ inspectMode: 'dual' })
    const { container } = render(
      <InspectCompareModal
        open={true}
        source={txtTask()}
        compare={txtTask({ name: '改正.txt' })}
        onClose={() => {}}
        defaultMode="dual"
      />,
    )
    await waitFor(() => {
      expect(container.querySelector('.dcv-para-change')).toBeTruthy()
    })

    // 初始无 hover
    expect(container.querySelectorAll('.dcv-para-pair-hover').length).toBe(0)

    // hover 第一个 change block 的左侧 cell
    const firstLeftChange = container.querySelector(
      '.dcv-para[data-side="left"].dcv-para-change'
    ) as HTMLElement
    fireEvent.mouseEnter(firstLeftChange)

    // 同 pairId 的左右两 cell 都进入 hover 态
    const hovered = container.querySelectorAll('.dcv-para-pair-hover')
    expect(hovered.length).toBe(2)
    const pid = firstLeftChange.getAttribute('data-pair-id')
    hovered.forEach(el => {
      expect(el.getAttribute('data-pair-id')).toBe(pid)
    })

    // mouseLeave 后清除
    fireEvent.mouseLeave(firstLeftChange)
    expect(container.querySelectorAll('.dcv-para-pair-hover').length).toBe(0)
  })

  it('双栏段落：点击 cell 选中同行两 cell（dcv-para-pair-sel）；再点取消', async () => {
    global.fetch = mockFetchDiff() as any
    useStore.setState({ inspectMode: 'dual' })
    const { container } = render(
      <InspectCompareModal
        open={true}
        source={txtTask()}
        compare={txtTask({ name: '改正.txt' })}
        onClose={() => {}}
        defaultMode="dual"
      />,
    )
    await waitFor(() => {
      expect(container.querySelector('.dcv-para-change')).toBeTruthy()
    })

    // 首次加载会自动选中第一个 change block（默认行为）
    // 测试点击 toggle：先记录当前选中数，点击后应反转
    const selBefore = container.querySelectorAll('.dcv-para-pair-sel').length

    const firstRightChange = container.querySelector(
      '.dcv-para[data-side="right"].dcv-para-change'
    ) as HTMLElement
    fireEvent.click(firstRightChange)

    const sel = container.querySelectorAll('.dcv-para-pair-sel')
    // 点击 toggle：若之前选中了这个 block → 取消；否则 → 选中
    // 自动选中已生效，所以这里至少能看到 sel 数变化（无论方向）
    const selAfter = sel.length
    expect(selAfter).not.toBe(selBefore)
    const pid = firstRightChange.getAttribute('data-pair-id')
    if (selAfter > 0) {
      sel.forEach(el => {
        expect(el.getAttribute('data-pair-id')).toBe(pid)
      })
    }

    // 再点一次 → 反转回原状态
    fireEvent.click(firstRightChange)
    expect(container.querySelectorAll('.dcv-para-pair-sel').length).toBe(selBefore)
  })

  it('change block 内多处差异 → 单段保留全文，charOps 内联高亮（每处差异独立可见）', async () => {
    // 真实场景：一整段是 1 个 change block，内部 2 处差异
    // 重构后原则：每段一行，全文保留，差异以 inline 红蓝高亮（对标设计稿）
    const bigChangeDiff: InspectDiffResponse = {
      ops: [],
      errors: [
        { id: 'e1', original: '既', corrected: '继', op: 'change' },
        { id: 'e2', original: '岳', corrected: '岳阳', op: 'change' },
      ],
      hunks: [],
      tokens: [],
      paragraphBlocks: [
        {
          kind: 'change',
          leftText: '前文 既往开来 后文 岳楼 结尾',
          rightText: '前文 继往开来 后文 岳阳楼 结尾',
          charOps: [
            { op: 'equal', text: '前文 ' },
            { op: 'delete', text: '既' }, { op: 'insert', text: '继' },
            { op: 'equal', text: '往开来 后文 ' },
            { op: 'delete', text: '岳' }, { op: 'insert', text: '岳阳' },
            { op: 'equal', text: '楼 结尾' },
          ],
        },
      ],
      ms: 2,
      meta: { granularity: 'paragraph', leftChars: 30, rightChars: 31, errorCount: 2 },
    }
    global.fetch = mockFetchDiff(bigChangeDiff) as any
    useStore.setState({ inspectMode: 'dual' })
    const { container } = render(
      <InspectCompareModal
        open={true}
        source={txtTask()}
        compare={txtTask({ name: '改正.txt' })}
        onClose={() => {}}
        defaultMode="dual"
      />,
    )
    await waitFor(() => {
      // 1 个 change block → 1 行（左右 2 cell），不切片
      const leftChangeCells = container.querySelectorAll(
        '.dcv-para[data-side="left"].dcv-para-change'
      )
      expect(leftChangeCells.length).toBe(1)
    })

    // 全文保留：左右 cell 文本均包含完整段落（不是省略号碎片）
    const leftCell = container.querySelector(
      '.dcv-para[data-side="left"].dcv-para-change'
    ) as HTMLElement
    const rightCell = container.querySelector(
      '.dcv-para[data-side="right"].dcv-para-change'
    ) as HTMLElement
    expect(leftCell.textContent).toContain('前文')
    expect(leftCell.textContent).toContain('结尾')
    expect(rightCell.textContent).toContain('前文')
    expect(rightCell.textContent).toContain('结尾')

    // 2 处 delete 字符（'既' + '岳'）和 2 处 insert 字符（'继' + '岳阳'）
    const delSpans = leftCell.querySelectorAll('.dcv-char-delete')
    expect(delSpans.length).toBe(2)
    expect(delSpans[0].textContent).toBe('既')
    expect(delSpans[1].textContent).toBe('岳')
    const insSpans = rightCell.querySelectorAll('.dcv-char-insert')
    expect(insSpans.length).toBe(2)
    expect(insSpans[0].textContent).toBe('继')
    expect(insSpans[1].textContent).toBe('岳阳')
  })

  it('加载失败时显示错误态 + 重试按钮', async () => {
    global.fetch = mockFetchDiff(null, { fail: true }) as any
    render(
      <InspectCompareModal open={true} source={txtTask()} compare={txtTask()} onClose={() => {}} />,
    )
    await waitFor(() => {
      const btns = screen.getAllByRole('button', { name: /重试/ })
      expect(btns.length).toBeGreaterThan(0)
    })
  })
})

describe('InspectCompareModal — 错误侧栏交互', () => {
  beforeEach(() => {
    localStorage.clear()
    global.fetch = mockFetchDiff() as any
    useStore.setState({ inspectMode: 'inspect' })
  })
  afterEach(() => cleanup())

  it('侧栏渲染所有错误条目（含编号 + 原文 → 改正）', async () => {
    render(
      <InspectCompareModal open={true} source={txtTask()} compare={txtTask()} onClose={() => {}} />,
    )
    await waitFor(() => {
      const sidebar = screen.getByTestId('inspect-diff-sidebar')
      expect(sidebar.textContent).toContain('利')
      expect(sidebar.textContent).toContain('力')
      expect(sidebar.textContent).toContain('既')
      expect(sidebar.textContent).toContain('继')
    })
  })

  it('每条错误有接受和忽略操作按钮', async () => {
    render(
      <InspectCompareModal open={true} source={txtTask()} compare={txtTask()} onClose={() => {}} />,
    )
    await waitFor(() => {
      const acceptBtns = screen.getAllByRole('button', { name: /接受/ })
      const ignoreBtns = screen.getAllByRole('button', { name: /忽略/ })
      expect(acceptBtns.length).toBe(2) // e1 + e2
      expect(ignoreBtns.length).toBe(2)
    })
  })

  it('点击「接受」后该条目标记为已接受（is-accepted class）', async () => {
    render(
      <InspectCompareModal open={true} source={txtTask()} compare={txtTask()} onClose={() => {}} />,
    )
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /接受/ }).length).toBeGreaterThan(0)
    })
    const firstAccept = screen.getAllByRole('button', { name: /接受/ })[0]
    fireEvent.click(firstAccept)
    const item = firstAccept.closest('[data-error-id]')
    expect(item?.className).toMatch(/is-accepted/)
  })

  it('点击「忽略」后该条目标记为已忽略（is-ignored class）', async () => {
    render(
      <InspectCompareModal open={true} source={txtTask()} compare={txtTask()} onClose={() => {}} />,
    )
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /忽略/ }).length).toBeGreaterThan(0)
    })
    const firstIgnore = screen.getAllByRole('button', { name: /忽略/ })[0]
    fireEvent.click(firstIgnore)
    const item = firstIgnore.closest('[data-error-id]')
    expect(item?.className).toMatch(/is-ignored/)
  })

  it('点击错误侧栏条目展开详情并显示错误类型', async () => {
    render(
      <InspectCompareModal open={true} source={txtTask()} compare={txtTask()} onClose={() => {}} />,
    )
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /接受/ }).length).toBeGreaterThan(0)
    })
    const firstItem = screen.getByTestId('inspect-diff-sidebar').querySelector('[data-error-id]') as HTMLElement
    fireEvent.click(firstItem)
    await waitFor(() => {
      expect(firstItem.className).toMatch(/is-selected/)
    })
  })
})

describe('InspectCompareModal — 模式切换', () => {
  beforeEach(() => {
    localStorage.clear()
    global.fetch = mockFetchDiff() as any
    useStore.setState({ inspectMode: 'inspect' })
  })
  afterEach(() => cleanup())

  it('点击「双栏对比」按钮 → 模式切换，按钮变活跃', async () => {
    render(
      <InspectCompareModal open={true} source={txtTask()} compare={null} onClose={() => {}} />,
    )
    const dualBtn = screen.getByRole('button', { name: /双栏对比/ })
    fireEvent.click(dualBtn)
    await waitFor(() => {
      expect(dualBtn.className).toMatch(/is-active/)
    })
  })

  it('切换到双栏模式但 compare=null → 渲染文件选择器（不能拿自身跟自身比）', async () => {
    const { container } = render(
      <InspectCompareModal open={true} source={txtTask()} compare={null} onClose={() => {}} />,
    )
    const dualBtn = screen.getByRole('button', { name: /双栏对比/ })
    fireEvent.click(dualBtn)
    await waitFor(() => {
      expect(container.querySelector('[data-testid="inspect-compare-picker"]')).toBeTruthy()
    })
    // 选择器里没有 DualColumnView（否则会拿自身跟自身比，diff 全 0）
    expect(container.querySelector('[data-testid="dual-column-view"]')).toBeNull()
  })

  it('compare=task 时切换到双栏模式 → 渲染 DualColumnView（含 inspect-left/right 列头）', async () => {
    const { container } = render(
      <InspectCompareModal
        open={true}
        source={txtTask()}
        compare={txtTask({ id: 't-cmp', name: '改正.txt' })}
        onClose={() => {}}
      />,
    )
    const dualBtn = screen.getByRole('button', { name: /双栏对比/ })
    fireEvent.click(dualBtn)
    await waitFor(() => {
      expect(container.querySelector('[data-testid="inspect-left"]')).toBeTruthy()
      expect(container.querySelector('[data-testid="inspect-right"]')).toBeTruthy()
    })
  })

  it('compare=null 时默认智检模式', () => {
    render(
      <InspectCompareModal open={true} source={txtTask()} compare={null} onClose={() => {}} />,
    )
    const inspectBtn = screen.getByRole('button', { name: /智检/ })
    expect(inspectBtn.className).toMatch(/is-active/)
  })

  it('compare=null 时双栏 picker 列出其他任务并排除源文件；点击触发 setInspectCompare', async () => {
    // 注入两个候选任务到 store
    const srcTask = txtTask({ id: 'src' })
    const otherTask = txtTask({ id: 'other', name: '改正.txt' })
    useStore.setState({ tasks: [srcTask, otherTask] })

    const { container } = render(
      <InspectCompareModal open={true} source={srcTask} compare={null} onClose={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /双栏对比/ }))

    // picker 出现，其他任务可见，源文件被排除
    await waitFor(() => {
      expect(container.querySelector('[data-testid="inspect-compare-picker"]')).toBeTruthy()
    })
    expect(container.querySelector('[data-testid="inspect-compare-pick-other"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="inspect-compare-pick-src"]')).toBeNull()

    // 点击选择 → store 的 inspectCompare 被更新
    fireEvent.click(container.querySelector('[data-testid="inspect-compare-pick-other"]')!)
    expect(useStore.getState().inspectCompare?.id).toBe('other')
  })
})

describe('InspectCompareModal — 关闭', () => {
  beforeEach(() => {
    localStorage.clear()
    global.fetch = mockFetchDiff() as any
    useStore.setState({ inspectMode: 'inspect' })
  })
  afterEach(() => cleanup())

  it('ESC 触发 onClose', () => {
    const onClose = vi.fn()
    render(
      <InspectCompareModal open={true} source={txtTask()} compare={null} onClose={onClose} />,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('点击关闭按钮（aria-label="关闭"）触发 onClose', () => {
    const onClose = vi.fn()
    render(
      <InspectCompareModal open={true} source={txtTask()} compare={null} onClose={onClose} />,
    )
    const closeBtn = screen.getByRole('button', { name: /关闭/ })
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('InspectCompareModal — 翻译双栏对照 tab', () => {
  beforeEach(() => {
    localStorage.clear()
    global.fetch = mockFetchDiff() as any
    useStore.setState({ inspectMode: 'inspect', translateStatus: 'idle', translateResult: null, translateSource: null })
  })
  afterEach(() => cleanup())

  it('顶部工具条有「翻译对照」tab', () => {
    render(
      <InspectCompareModal open={true} source={txtTask()} compare={null} onClose={() => {}} />,
    )
    expect(screen.getByTestId('tab-translate')).toBeTruthy()
  })

  it('点击「翻译对照」→ mode 切换 + openTranslate 触发（store 状态写入）', () => {
    const src = txtTask({ id: 'tr-src' })
    render(
      <InspectCompareModal open={true} source={src} compare={null} onClose={() => {}} />,
    )
    const tab = screen.getByTestId('tab-translate')
    fireEvent.click(tab)

    // store 状态：mode=translate + translateSource=src
    const s = useStore.getState()
    expect(s.inspectMode).toBe('translate')
    expect(s.translateSource?.id).toBe('tr-src')
  })

  it('点击「翻译对照」→ 渲染 TranslationLayout（含 AI 翻译按钮 + 源/目标语言选择器）', () => {
    const src = txtTask({ id: 'tr-src' })
    render(
      <InspectCompareModal open={true} source={src} compare={null} onClose={() => {}} />,
    )
    fireEvent.click(screen.getByTestId('tab-translate'))
    // TranslationLayout 内部元素（v4.2：mount 自动触发，按钮可能处于 loading；改用 testid）
    expect(screen.getByTestId('translate-ai-btn')).toBeTruthy()
    expect(screen.getByTestId('translate-source-lang')).toBeTruthy()
    expect(screen.getByTestId('translate-target-lang')).toBeTruthy()
  })

  it('关闭弹层 → 翻译状态被清理（translateSource=null）', () => {
    const src = txtTask({ id: 'tr-src' })
    const { rerender } = render(
      <InspectCompareModal open={true} source={src} compare={null} onClose={() => {}} />,
    )
    fireEvent.click(screen.getByTestId('tab-translate'))
    expect(useStore.getState().translateSource?.id).toBe('tr-src')

    rerender(
      <InspectCompareModal open={false} source={src} compare={null} onClose={() => {}} />,
    )
    expect(useStore.getState().translateSource).toBeNull()
  })
})
