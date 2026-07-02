/**
 * server.config —— 启动期 env 校验单测
 *
 * 验证：缺 MINIMAX_API_KEY 时 server.mjs import 立即 throw，exit ≠ 0。
 *
 * 模型：Claude (Sonnet 4.5)
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

test('server: 缺 MINIMAX_API_KEY 启动即崩', (_t, done) => {
  // 显式清空 env，跑子进程 import server.mjs
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `import('./server.mjs').catch(e => { console.error(e.message); process.exit(1) })`,
  ], {
    cwd: process.cwd(),
    env: { ...process.env, MINIMAX_API_KEY: '' },
  })
  let stderr = ''
  child.stderr.on('data', c => { stderr += c })
  child.on('exit', (code) => {
    try {
      assert.notEqual(code, 0, `应非 0 退出，实际 ${code}`)
      assert.match(stderr, /MINIMAX_API_KEY env required/)
      done()
    } catch (e) { done(e) }
  })
})

test('server: 配置 MINIMAX_API_KEY 启动成功（不打 LLM）', (_t, done) => {
  // 给一个假 key，只看启动日志里的 config loaded，不实际打 LLM
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `import('./server.mjs').then(() => setTimeout(()=>process.exit(0), 300))`,
  ], {
    cwd: process.cwd(),
    env: { ...process.env, MINIMAX_API_KEY: 'sk-test-xxx', PORT: '8799' },
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', c => { stdout += c })
  child.stderr.on('data', c => { stderr += c })
  child.on('exit', (code) => {
    try {
      assert.equal(code, 0, `应正常退出，stderr=${stderr}`)
      // 结构化日志：config loaded + 只露后 4 位
      const combined = stdout + stderr
      const line = combined.split('\n').find(l => l.includes('config loaded'))
      assert.ok(line, `应有 config loaded 日志: ${combined}`)
      const parsed = JSON.parse(line)
      assert.equal(parsed.apiKeyMasked, '***-xxx')
      assert.ok(!combined.includes('sk-test-xxx'), '完整 key 不应出现在日志')
      done()
    } catch (e) { done(e) }
  })
})
