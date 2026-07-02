import { describe, it, expect } from 'vitest'
import { route } from '../CapabilityRouter'
import type { ProbeResult, DeviceProfile } from '../types'

function p(partial: Partial<ProbeResult>): ProbeResult {
  return {
    ext: 'bin',
    realType: 'bin',
    container: null,
    category: 'unknown',
    trusted: true,
    ...partial,
  }
}

const HIGH: DeviceProfile = {
  tier: 'high',
  wasmEnabled: true,
  hardwareConcurrency: 8,
  canPlayType: () => true,
}
const LOW: DeviceProfile = {
  tier: 'low',
  wasmEnabled: false,
  hardwareConcurrency: 2,
  canPlayType: () => false,
}

describe('CapabilityRouter', () => {
  it('原生可播的 mp4 → native', () => {
    const d = route(p({ realType: 'mp4', category: 'media', codecHints: ['isom'] }), HIGH)
    expect(d.path).toBe('native')
  })

  it('mkv 在高端机有 WASM → wasm（转封装）', () => {
    const d = route(p({ realType: 'mkv', category: 'media' }), HIGH)
    expect(d.path).toBe('wasm')
  })

  it('mkv 在弱机无 WASM → server（兜底转码）', () => {
    const d = route(p({ realType: 'mkv', category: 'media' }), LOW)
    expect(d.path).toBe('server')
  })

  it('老编码 amr 即使有 WASM 也可走 wasm 解码', () => {
    const d = route(p({ realType: 'amr', category: 'media' }), HIGH)
    expect(['wasm', 'server']).toContain(d.path)
  })

  it('amr 弱机无 WASM → server', () => {
    const d = route(p({ realType: 'amr', category: 'media' }), LOW)
    expect(d.path).toBe('server')
  })

  it('PDF 高端机 → wasm（PDF.js 客户端解析）', () => {
    const d = route(p({ realType: 'pdf', category: 'paged' }), HIGH)
    expect(d.path).toBe('wasm')
  })

  it('DOCX 高端机 → wasm（客户端 OOXML 解析）', () => {
    const d = route(p({ realType: 'docx', category: 'flow' }), HIGH)
    expect(d.path).toBe('wasm')
  })

  it('老 Office doc 永远 → server（无客户端解析器）', () => {
    const d = route(p({ realType: 'doc', category: 'flow' }), HIGH)
    expect(d.path).toBe('server')
  })

  it('ppt/xls 老格式 → server', () => {
    expect(route(p({ realType: 'ppt', category: 'paged' }), HIGH).path).toBe('server')
    expect(route(p({ realType: 'xls', category: 'sheet' }), HIGH).path).toBe('server')
  })

  it('图片 png → native', () => {
    const d = route(p({ realType: 'png', category: 'raster' }), HIGH)
    expect(d.path).toBe('native')
  })

  it('bmp 弱机原生不支持 → wasm 或 server 兜底', () => {
    const d = route(p({ realType: 'bmp', category: 'raster' }), { ...LOW, canPlayType: () => false })
    expect(['wasm', 'server']).toContain(d.path)
  })

  it('TXT → native（流式文本，无需解码器）', () => {
    const d = route(p({ realType: 'txt', category: 'flow' }), LOW)
    expect(d.path).toBe('native')
  })

  it('未知类型 → server 兜底', () => {
    const d = route(p({ realType: 'unknown', category: 'unknown' }), HIGH)
    expect(d.path).toBe('server')
  })

  it('PDF 弱机无 WASM → server 兜底转图', () => {
    const d = route(p({ realType: 'pdf', category: 'paged' }), LOW)
    expect(d.path).toBe('server')
  })

  it('决策附带可读 reason', () => {
    const d = route(p({ realType: 'mp4', category: 'media' }), HIGH)
    expect(typeof d.reason).toBe('string')
    expect(d.reason.length).toBeGreaterThan(0)
  })
})
