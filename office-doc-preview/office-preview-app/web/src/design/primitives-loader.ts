// 模型：claude-sonnet-4-6
import { SCALE_NAMES } from './primitives'

export function logPrimitivesLoaded(): void {
  const ts = new Date().toISOString()
  console.info(`[tokens ${ts}] primitives loaded: ${SCALE_NAMES.length} scales (${SCALE_NAMES.join(', ')})`)
}
