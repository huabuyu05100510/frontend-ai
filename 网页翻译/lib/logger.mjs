/**
 * logger —— 结构化 JSON line 日志
 *
 * 输出：每行一个 JSON 对象 `{ts, level, component, msg, ...fields}`
 * 用 stdout，便于被 loki/elk/pino 收集器消费。
 *
 * 用法：
 *   import { createLogger, genReqId } from './logger.mjs'
 *   const log = createLogger('server')
 *   log.info('translate.done', { reqId: genReqId(), costMs: 120 })
 *
 * 模型：Claude (Sonnet 4.5)
 */

let _reqCounter = 0

/** 单调递增请求 id（进程内） */
export function genReqId() {
  _reqCounter += 1
  return `r${process.pid.toString(36)}_${_reqCounter.toString(36)}`
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }

let _minLevel = LEVELS[process.env.LOG_LEVEL ? process.env.LOG_LEVEL.toLowerCase() : 'info'] ?? LEVELS.info

export function setMinLevel(level) {
  if (LEVELS[level] != null) _minLevel = LEVELS[level]
}

export function createLogger(component) {
  function emit(level, msg, fields) {
    if (LEVELS[level] < _minLevel) return
    const line = JSON.stringify({
      ts: Date.now(),
      level,
      component,
      msg,
      ...fields,
    })
    if (level === 'error' || level === 'warn') {
      process.stderr.write(line + '\n')
    } else {
      process.stdout.write(line + '\n')
    }
  }
  return {
    debug: (msg, fields = {}) => emit('debug', msg, fields),
    info: (msg, fields = {}) => emit('info', msg, fields),
    warn: (msg, fields = {}) => emit('warn', msg, fields),
    error: (msg, fields = {}) => emit('error', msg, fields),
  }
}
