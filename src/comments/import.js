/**
 * 从 Word 的 .docx 里把批注导入侧车。
 *
 * 这是「跟 Word 完全一致」的另一半：读取（docx-comments.js）+ 映射（model.js 的
 * mapDocxAnchorsToMarkdown）+ 合并（mergeStores，按 id，两边的批注都保留）。
 */
import { readDocxComments } from './docx-comments.js'
import { fromDocxComments, mapDocxAnchorsToMarkdown, mergeStores, parseStore } from './model.js'

/**
 * @param {{ docxBuffer: Buffer, markdownText: string, store?: object|null }} input
 * @returns {{ store: object, imported: number, threads: number, mapStats: { mapped: number, approx: number, lost: number } }}
 */
export function importDocxComments(input) {
  const parsed = readDocxComments(input.docxBuffer)
  const imported = fromDocxComments(parsed)
  const mapStats = mapDocxAnchorsToMarkdown(imported, parsed.text, input.markdownText)
  const store = input.store === null || input.store === undefined ? imported : mergeStores(parseStore(input.store), imported)
  return {
    store,
    imported: imported.comments.length,
    threads: parsed.comments.length,
    mapStats,
  }
}
