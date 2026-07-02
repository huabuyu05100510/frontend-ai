import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCfb } from '../cfb.mjs'

function writeDirEntry(b, off, name, type, start, size) {
  for (let i = 0; i < name.length; i++) b.writeUInt16LE(name.charCodeAt(i), off + i * 2)
  b.writeUInt16LE((name.length + 1) * 2, off + 64)
  b[off + 66] = type
  b.writeUInt32LE(start, off + 116)
  b.writeUInt32LE(size, off + 120)
  b.writeUInt32LE(0, off + 124)
}

// 构造最小 CFB（512B 扇区；miniCutoff=0 强制所有流走主 FAT）
function buildCfb(streamName, data) {
  const b = Buffer.alloc(512 + 4 * 512, 0)
  const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
  sig.forEach((v, i) => (b[i] = v))
  b.writeUInt16LE(0x003e, 24)
  b.writeUInt16LE(0x0003, 26) // major v3
  b.writeUInt16LE(0xfffe, 28)
  b.writeUInt16LE(9, 30) // sector shift → 512
  b.writeUInt16LE(6, 32) // mini sector shift
  b.writeUInt32LE(1, 44) // num FAT sectors
  b.writeUInt32LE(1, 48) // first dir sector
  b.writeUInt32LE(0, 56) // mini cutoff = 0
  b.writeUInt32LE(0xfffffffe, 60) // first mini fat
  b.writeUInt32LE(0, 64)
  b.writeUInt32LE(0xfffffffe, 68) // first difat
  b.writeUInt32LE(0, 72)
  b.writeUInt32LE(0, 76) // DIFAT[0] = FAT 在扇区 0
  for (let i = 1; i < 109; i++) b.writeUInt32LE(0xffffffff, 76 + i * 4)

  const fatOff = 512
  for (let i = 0; i < 128; i++) b.writeUInt32LE(0xffffffff, fatOff + i * 4)
  b.writeUInt32LE(0xfffffffd, fatOff + 0 * 4) // FATSECT
  b.writeUInt32LE(0xfffffffe, fatOff + 1 * 4) // dir 单扇区
  b.writeUInt32LE(3, fatOff + 2 * 4) // data: 2 → 3
  b.writeUInt32LE(0xfffffffe, fatOff + 3 * 4) // data 结束

  const dirOff = 1024
  writeDirEntry(b, dirOff, 'Root Entry', 5, 0xfffffffe, 0)
  writeDirEntry(b, dirOff + 128, streamName, 2, 2, data.length)

  Buffer.from(data).copy(b, 1536) // 扇区 2 起始
  return new Uint8Array(b)
}

test('parseCfb 列出流并按名读取', () => {
  const data = Buffer.alloc(700)
  for (let i = 0; i < data.length; i++) data[i] = i & 0xff
  const cfb = parseCfb(buildCfb('Workbook', data))
  assert.ok(cfb.names.includes('Workbook'))
  const got = cfb.readStream('Workbook')
  assert.equal(got.length, 700)
  assert.deepEqual(Buffer.from(got), data)
})

test('读取不存在的流返回 null', () => {
  const cfb = parseCfb(buildCfb('Book', Buffer.from([1, 2, 3])))
  assert.equal(cfb.readStream('Nope'), null)
})

test('非 CFB 抛错', () => {
  assert.throws(() => parseCfb(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])))
})
