import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseXls } from '../xlsLegacy.mjs'

function writeDirEntry(b, off, name, type, start, size) {
  for (let i = 0; i < name.length; i++) b.writeUInt16LE(name.charCodeAt(i), off + i * 2)
  b.writeUInt16LE((name.length + 1) * 2, off + 64)
  b[off + 66] = type
  b.writeUInt32LE(start, off + 116)
  b.writeUInt32LE(size, off + 120)
  b.writeUInt32LE(0, off + 124)
}
function buildCfb(streamName, data) {
  const b = Buffer.alloc(512 + 4 * 512, 0)
  ;[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].forEach((v, i) => (b[i] = v))
  b.writeUInt16LE(0x0003, 26)
  b.writeUInt16LE(9, 30)
  b.writeUInt16LE(6, 32)
  b.writeUInt32LE(1, 44)
  b.writeUInt32LE(1, 48)
  b.writeUInt32LE(0, 56) // mini cutoff 0
  b.writeUInt32LE(0xfffffffe, 60)
  b.writeUInt32LE(0xfffffffe, 68)
  b.writeUInt32LE(0, 76)
  for (let i = 1; i < 109; i++) b.writeUInt32LE(0xffffffff, 76 + i * 4)
  const fatOff = 512
  for (let i = 0; i < 128; i++) b.writeUInt32LE(0xffffffff, fatOff + i * 4)
  b.writeUInt32LE(0xfffffffd, fatOff)
  b.writeUInt32LE(0xfffffffe, fatOff + 4)
  b.writeUInt32LE(3, fatOff + 8)
  b.writeUInt32LE(0xfffffffe, fatOff + 12)
  writeDirEntry(b, 1024, 'Root Entry', 5, 0xfffffffe, 0)
  writeDirEntry(b, 1024 + 128, streamName, 2, 2, data.length)
  Buffer.from(data).copy(b, 1536)
  return new Uint8Array(b)
}

const rec = (type, data) => [type & 255, (type >> 8) & 255, data.length & 255, (data.length >> 8) & 255, ...data]
const dbl = (n) => {
  const buf = Buffer.alloc(8)
  buf.writeDoubleLE(n, 0)
  return [...buf]
}
const rkInt = (n) => {
  const rk = ((n << 2) | 2) >>> 0
  return [rk & 255, (rk >> 8) & 255, (rk >> 16) & 255, (rk >> 24) & 255]
}

test('parseXls 解析共享串/数字/RK/MULRK/标签', () => {
  const biff = [
    ...rec(0x0809, [0, 0, 0, 0, 0, 0, 0, 0]), // BOF
    ...rec(0x0085, [0, 0, 0, 0, 0, 0, 6, 0, 83, 104, 101, 101, 116, 49]), // BOUNDSHEET "Sheet1"
    ...rec(
      0x00fc, // SST: 2 strings: "Hi"(压缩) / "ABC"(宽)
      [2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 72, 105, 3, 0, 1, 65, 0, 66, 0, 67, 0],
    ),
    ...rec(0x00fd, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), // LABELSST (0,0) isst0
    ...rec(0x00fd, [0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), // LABELSST (0,1) isst1
    ...rec(0x027e, [1, 0, 0, 0, 0, 0, ...rkInt(100)]), // RK (1,0)=100
    ...rec(0x0203, [1, 0, 1, 0, 0, 0, ...dbl(3.5)]), // NUMBER (1,1)=3.5
    ...rec(0x00bd, [2, 0, 0, 0, 0, 0, ...rkInt(10), 0, 0, ...rkInt(20), 1, 0]), // MULRK row2 col0..1
    ...rec(0x000a, []), // EOF
  ]
  const m = parseXls(buildCfb('Workbook', biff))
  assert.equal(m.name, 'Sheet1')
  assert.equal(m.rows, 3)
  assert.equal(m.cols, 2)
  const at = (r, c) => m.cells.find((x) => x.r === r && x.c === c)?.text
  assert.equal(at(0, 0), 'Hi')
  assert.equal(at(0, 1), 'ABC')
  assert.equal(at(1, 0), '100')
  assert.equal(at(1, 1), '3.5')
  assert.equal(at(2, 0), '10')
  assert.equal(at(2, 1), '20')
})
