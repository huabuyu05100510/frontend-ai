// 端到端验证：两个 WebSocket 客户端在同一房间，A 的更新应被 B 收到，
// 且 B 后加入应收到 A 已写入的快照。仅用 Node 内置 WebSocket。
const URL = process.env.URL || 'ws://localhost:8787'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const open = (ws) => new Promise((r) => (ws.onopen = () => r(ws)))

const a = await open(new WebSocket(URL))
const aMsgs = []
const bMsgs = []
a.onmessage = (e) => aMsgs.push(JSON.parse(e.data))

a.send(JSON.stringify({ t: 'join', room: 'r1' }))
await sleep(100)
// A 先写一条
a.send(JSON.stringify({ t: 'op', update: { key: 'k1', value: { txt: 'fromA' }, ts: 1, client: 'A', deleted: false } }))
await sleep(100)

// B 后加入：应收到含 k1 的快照
const b = await open(new WebSocket(URL))
b.onmessage = (e) => bMsgs.push(JSON.parse(e.data))
b.send(JSON.stringify({ t: 'join', room: 'r1' }))
await sleep(150)

// A 再写一条：B 应实时收到 op
a.send(JSON.stringify({ t: 'op', update: { key: 'k2', value: { txt: 'live' }, ts: 2, client: 'A', deleted: false } }))
await sleep(200)

const snap = bMsgs.find((m) => m.t === 'snapshot')
const liveOp = bMsgs.find((m) => m.t === 'op' && m.update.key === 'k2')

let ok = true
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}`)
  if (!cond) ok = false
}
check('B 加入收到快照', !!snap)
check('快照含 A 先前写入的 k1', !!snap && snap.snapshot.k1 && snap.snapshot.k1.value.txt === 'fromA')
check('B 实时收到 A 的 k2 op', !!liveOp && liveOp.update.value.txt === 'live')

a.close()
b.close()
console.log(ok ? '\nE2E ALL PASS' : '\nE2E FAILED')
process.exit(ok ? 0 : 1)
