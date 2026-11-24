/**
 * 开发用探针：node scripts/comments-probe.mjs <docx> [更多 docx...]
 * 打印每份 docx 的批注摘要，用来和 Word 的 doc.Comments.Count 对照。
 */
import { readFileSync } from 'node:fs'
import { readDocxComments, summarizeDocxComments } from '../src/comments/docx-comments.js'

const paths = process.argv.slice(2)
if (paths.length === 0) {
  console.error('usage: node scripts/comments-probe.mjs <docx> [more.docx ...]')
  process.exit(2)
}
for (const path of paths) {
  try {
    const result = readDocxComments(readFileSync(path))
    console.log('=== ' + path)
    console.log(JSON.stringify(summarizeDocxComments(result), null, 2))
    const nodes = result.comments.flatMap((thread) => [thread, ...thread.replies])
    const missing = nodes.filter((node) => node.anchor === null || node.anchor.quote === '')
    if (missing.length > 0) {
      console.log('empty anchors: ' + missing.map((node) => node.id + '@' + (node.anchor === null ? 'none' : node.anchor.start)).join(', '))
    }
    const bare = nodes.filter((node) => node.anchor !== null && node.anchor.quote !== '')
    if (bare.length > 0) {
      console.log('first 3 anchors: ' + bare.slice(0, 3).map((node) => JSON.stringify({ id: node.id, start: node.anchor.start, end: node.anchor.end, quote: node.anchor.quote.slice(0, 60) })).join('\n                '))
    }
  } catch (error) {
    console.log('=== ' + path + ' :: ERROR ' + (error instanceof Error ? error.message : String(error)))
    process.exitCode = 1
  }
}
