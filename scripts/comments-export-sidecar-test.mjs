/**
 * 侧车 → docx 导出的回归测试：
 *   node scripts/comments-export-sidecar-test.mjs
 *
 * 1) 真实稿件：从 docx 读到侧车，再导出成新 docx，重新解析应完全一致（22 条 / 11 线程 / 3 已解决）；
 * 2) markdown 带标记（标题、加粗、链接、表格）时，映射仍能找回大部分锚点并如实报告 lost。
 */
import { readFileSync } from 'node:fs'
import { readDocxComments } from '../src/comments/docx-comments.js'
import { exportDocxFromSidecar, mapMarkdownAnchorsToDocx, stripMarkdown } from '../src/comments/export.js'
import { fromDocxComments, mapDocxAnchorsToMarkdown, parseStore, serializeStore } from '../src/comments/model.js'

const results = []
const check = (name, ok, detail) => {
  results.push(ok === true)
  console.log((ok === true ? '[OK] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' — ' + detail))
}

const SOURCE = 'E:/hermes_playground/jspace-repo/manuscript/JSpace_Liu_Oct09_2026.docx'
const buffer = readFileSync(SOURCE)
const parsed = readDocxComments(buffer)
const store = fromDocxComments(parsed)
mapDocxAnchorsToMarkdown(store, parsed.text, parsed.text)
const before = { comments: store.comments.length, threads: parsed.comments.length, resolved: store.comments.filter((comment) => comment.resolved === true).length }

const exported = exportDocxFromSidecar({ docxBuffer: buffer, store: parseStore(serializeStore(store)), markdownText: parsed.text })
check('every anchor maps back on an identical text', exported.stats.mapped === before.comments && exported.stats.lost === 0, JSON.stringify(exported.stats))

const reread = readDocxComments(exported.buffer)
check('the exported docx parses again', reread.text.length > 0 && reread.comments.length === before.threads, JSON.stringify({ threads: reread.comments.length, expected: before.threads }))
const rereadModel = fromDocxComments(reread)
const after = { comments: rereadModel.comments.length, resolved: rereadModel.comments.filter((comment) => comment.resolved === true).length }
check('comment count survives the export', after.comments === before.comments, JSON.stringify({ before: before.comments, after: after.comments }))
check('resolved state survives the export', after.resolved === before.resolved, JSON.stringify({ before: before.resolved, after: after.resolved }))
const authorsBefore = new Set(store.comments.map((comment) => comment.author.name))
const authorsAfter = new Set(rereadModel.comments.map((comment) => comment.author.name))
check('authors survive the export', [...authorsBefore].every((name) => authorsAfter.has(name)), JSON.stringify([...authorsAfter]))

// markdown 带标记时的近似映射
const marked = parsed.text
  .split('\n')
  .map((line, index) => (index === 0 ? '# ' + line : index % 7 === 0 && line.trim() !== '' ? '**' + line + '**' : line))
  .join('\n')
check('stripMarkdown removes the markup', stripMarkdown('# Title\n\n**bold** and [link](https://x.test)') === 'Title\n\nbold and link', JSON.stringify(stripMarkdown('# Title\n\n**bold** and [link](https://x.test)')))
const markedStore = fromDocxComments(parsed)
mapDocxAnchorsToMarkdown(markedStore, parsed.text, marked)
const markedExport = mapMarkdownAnchorsToDocx(markedStore, marked, parsed.text)
check('markup still maps most anchors', markedExport.mapped + markedExport.approx >= Math.floor(markedStore.comments.length * 0.8), JSON.stringify({ ...markedExport, total: markedStore.comments.length }))
check('lost anchors are reported, not hidden', markedExport.lost === markedExport.lost && markedExport.mapped + markedExport.approx + markedExport.lost === markedStore.comments.length, JSON.stringify(markedExport))

console.log('EXPORT SIDECAR: ' + results.filter(Boolean).length + '/' + results.length + ' ok')
process.exit(results.every(Boolean) ? 0 : 1)
