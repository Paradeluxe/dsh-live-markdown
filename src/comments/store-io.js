/**
 * 批注侧车文件的读写：`<doc>.md` ↔ `<doc>.comments.json`。
 *
 * 这一层只碰文件系统，不碰 HTTP：Host 路由、单元测试、将来的 CLI 都复用它。
 * 写入是原子的（临时文件 + rename），并且支持「别人在我加载之后改过文件」时的合并：
 * 传入 load 时拿到的 mtimeMs，发现磁盘上的文件更新了就先 mergeStores 再写回去。
 */
import { readFile, rename, stat, writeFile } from 'node:fs/promises'
import { mergeStores, parseStore, serializeStore, emptyStore } from './model.js'

/** 由 markdown 路径推出侧车路径：a.md → a.comments.json（保持同目录同名）。 */
export function sidecarPathFor(markdownPath) {
  const value = String(markdownPath ?? '')
  if (value === '') return ''
  const match = /\.(md|markdown|mdown|txt)$/iu.exec(value)
  if (match === null) return value + '.comments.json'
  return value.slice(0, match.index) + '.comments.json'
}

/**
 * 读侧车文件（不存在或坏掉都不抛）。
 * @returns {Promise<{ store: object, exists: boolean, mtimeMs: number|null, error: string|null }>}
 */
export async function readStoreFile(file) {
  try {
    const info = await stat(file)
    const raw = await readFile(file, 'utf8')
    const store = parseStore(raw)
    return { store, exists: true, mtimeMs: info.mtimeMs, error: null }
  } catch (error) {
    const code = error !== null && error !== undefined && typeof error.code === 'string' ? error.code : ''
    if (code === 'ENOENT') return { store: emptyStore(), exists: false, mtimeMs: null, error: null }
    // 文件存在但内容坏了：返回空 store 并带上错误，调用方决定要不要覆盖
    return { store: emptyStore(), exists: true, mtimeMs: null, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 写侧车文件（原子）。
 * @param {string} file
 * @param {object} incoming 客户端提交的 store
 * @param {{ baseMtimeMs?: number|null, now?: () => number }} options
 *   baseMtimeMs = 客户端加载时看到的 mtime；磁盘比它新就先合并再写。
 * @returns {Promise<{ store: object, mtimeMs: number, merged: boolean }>}
 */
export async function writeStoreFile(file, incoming, options = {}) {
  const baseMtimeMs = options.baseMtimeMs ?? null
  const next = parseStore(incoming)
  const current = await readStoreFile(file)
  let merged = false
  let store = next
  if (current.exists && baseMtimeMs !== null && current.mtimeMs !== null && current.mtimeMs > baseMtimeMs + 1) {
    // 磁盘上的版本比我加载的新：谁的修改都不丢，按 id 合并
    store = mergeStores(current.store, next)
    merged = true
  }
  const temporary = file + '.tmp-' + Math.random().toString(16).slice(2, 10)
  await writeFile(temporary, serializeStore(store), 'utf8')
  await rename(temporary, file)
  const info = await stat(file)
  return { store, mtimeMs: info.mtimeMs, merged }
}
