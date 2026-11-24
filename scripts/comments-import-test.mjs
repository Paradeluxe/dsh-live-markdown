/**
 * docx 批注导入的回归测试：
 *   node scripts/comments-import-test.mjs
 *
 * 用真实 docx（test_with_comments.docx）当来源，把它的摊平文本当成 markdown 正文（这样锚点必然能精确映射），
 * 断言：条数、线程、已解决、映射统计、与已有侧车合并后两边都在。
 */
import { readFileSync } from 'node:fs'
import { readDocxComments } from '../src/comments/docx-comments.js'
import { importDocxComments } from '../src/comments/import.js'
import { buildThreads, createComment, emptyStore, parseStore, serializeStore } from '../src/comments/model.js'

const results = []
const check = (name, ok, detail) => {
  results.push(ok === true)
  console.log((ok === true ? '[OK] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' — ' + detail))
}

const SOURCE = 'E:/hermes_playground/docx-testbed/test_with_comments.docx'
const buffer = readFileSync(SOURCE)
const parsed = readDocxComments(buffer)
const markdownText = parsed.text

const first = importDocxComments({ docxBuffer: buffer, markdownText })
const expected = parsed.comments.length + parsed.comments.reduce((total, thread) => total + thread.replies.length, 0)
check('imports every comment from the docx', first.imported === expected, JSON.stringify({ imported: first.imported, expected }))
check('threads come through', buildThreads(first.store.comments).length === parsed.comments.length, String(buildThreads(first.store.comments).length))
check('mapping is exact when the text matches', first.mapStats.lost === 4 && first.mapStats.mapped === expected - 4, JSON.stringify(first.mapStats))
const resolved = first.store.comments.filter((comment) => comment.resolved === true).length
check('nothing is marked resolved in this sample', resolved === 0, String(resolved))

const authored = first.store.comments.filter((comment) => comment.author.name !== '').length
check('authors are preserved', authored === expected, String(authored))
const withQuote = first.store.comments.find((comment) => comment.anchor.quote !== '')
check('an imported anchor points at the real text', withQuote !== undefined && markdownText.slice(withQuote.anchor.start, withQuote.anchor.end) === withQuote.anchor.quote, withQuote === undefined ? 'none' : JSON.stringify(withQuote.anchor.quote.slice(0, 40)))

// 导入到已有侧车：两边的批注都要在
const existing = emptyStore()
const needle = markdownText.indexOf('Centre for Cognitive and Brain Sciences')
createComment(existing, { author: { name: '本地作者' }, body: '本地已有的一条。', start: needle, end: needle + 40, text: markdownText })
const merged = importDocxComments({ docxBuffer: buffer, markdownText, store: parseStore(serializeStore(existing)) })
check('importing into an existing store keeps both sides', merged.store.comments.length === expected + 1, String(merged.store.comments.length))
check('the local comment survives', merged.store.comments.some((comment) => comment.author.name === '本地作者'), '')
const ids = merged.store.comments.map((comment) => comment.id)
check('no duplicate ids after the merge', new Set(ids).size === ids.length, String(ids.length))

// 第二次导入同一份 docx：幂等（按 id 合并，不翻倍）
const twice = importDocxComments({ docxBuffer: buffer, markdownText, store: merged.store })
check('importing twice does not duplicate comments', twice.store.comments.length === merged.store.comments.length, JSON.stringify({ before: merged.store.comments.length, after: twice.store.comments.length }))

console.log('IMPORT: ' + results.filter(Boolean).length + '/' + results.length + ' ok')
process.exit(results.every(Boolean) ? 0 : 1)
