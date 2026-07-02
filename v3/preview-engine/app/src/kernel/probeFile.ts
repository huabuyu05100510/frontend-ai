import type { ProbeResult } from './types'
import type { SourceHandle } from './SourceHandle'
import { probe } from './FormatProbe'

// ============================================================================
// probeFile — 从真实数据源探测（读前 4KB，覆盖 OOXML 目录标记）
// ============================================================================

const PROBE_BYTES = 4096

export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  if (i < 0 || i === name.length - 1) return ''
  return name.slice(i + 1).toLowerCase()
}

export async function probeFile(source: SourceHandle): Promise<ProbeResult> {
  const head = await source.readHead(PROBE_BYTES)
  return probe(head, extOf(source.name))
}
