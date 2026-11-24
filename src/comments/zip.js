/**
 * 只读的最小 ZIP 解析：docx 就是个 zip，但要读它不能依赖第三方包。
 * 只做两件事：列目录、取某个 entry 的完整字节（支持 stored / deflate）。
 */
import { inflateRawSync } from 'node:zlib'

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURES = new Set([0x02014b50])
const LOCAL_SIGNATURE = 0x04034b50

function findEndOfCentralDirectory(buffer) {
  // EOCD 在文件尾部，后面最多跟 65535 字节的注释；从后往前扫。
  const min = Math.max(0, buffer.length - 22 - 0xffff)
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset
  }
  return -1
}

/**
 * @param {Buffer} buffer
 * @returns {Map<string, { method: number, compressedSize: number, size: number, localOffset: number }>}
 */
export function readZipDirectory(buffer) {
  const eocd = findEndOfCentralDirectory(buffer)
  if (eocd < 0) throw new Error('not-a-zip: end of central directory not found')
  const count = buffer.readUInt16LE(eocd + 10)
  const centralOffset = buffer.readUInt32LE(eocd + 16)
  const entries = new Map()
  let cursor = centralOffset
  for (let index = 0; index < count; index += 1) {
    const signature = buffer.readUInt32LE(cursor)
    if (!CENTRAL_SIGNATURES.has(signature)) throw new Error('not-a-zip: bad central directory entry at ' + cursor)
    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const size = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength)
    entries.set(name, { method, compressedSize, size, localOffset })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/**
 * @param {Buffer} buffer
 * @param {{ method: number, compressedSize: number, localOffset: number }} entry
 * @returns {Buffer}
 */
export function readZipEntry(buffer, entry) {
  if (buffer.readUInt32LE(entry.localOffset) !== LOCAL_SIGNATURE) throw new Error('not-a-zip: bad local header')
  const nameLength = buffer.readUInt16LE(entry.localOffset + 26)
  const extraLength = buffer.readUInt16LE(entry.localOffset + 28)
  const start = entry.localOffset + 30 + nameLength + extraLength
  const raw = buffer.subarray(start, start + entry.compressedSize)
  if (entry.method === 0) return Buffer.from(raw)
  if (entry.method === 8) return inflateRawSync(raw)
  throw new Error('unsupported-zip-method: ' + entry.method)
}

/** 打开一个 zip，返回按名字取文本/字节的读取器。 */
export function openZip(buffer) {
  const directory = readZipDirectory(buffer)
  return {
    names: () => Array.from(directory.keys()),
    has: (name) => directory.has(name),
    bytes: (name) => {
      const entry = directory.get(name)
      return entry === undefined ? null : readZipEntry(buffer, entry)
    },
    text: (name) => {
      const entry = directory.get(name)
      return entry === undefined ? null : readZipEntry(buffer, entry).toString('utf8')
    },
  }
}
