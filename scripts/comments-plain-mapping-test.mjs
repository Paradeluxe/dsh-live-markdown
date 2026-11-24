/**
 * 纯文本索引（markdown-plain.js）与导入时的「去标记兜底」：
 *   node scripts/comments-plain-mapping-test.mjs
 *
 * 场景：docx 的摊平文本不含 markdown 标记，直接按 quote 精确匹配会大量失败；
 * 用「去标记后的纯文本」找，再把偏移换算回 markdown，能救回大部分锚点。
 */
import { readFileSync } from 'node:fs'
import { readDocxComments } from '../src/comments/docx-comments.js'
import { importDocxComments } from '../src/comments/import.js'
import { buildPlainIndex, findInPlain } from '../src/comments/markdown-plain.js'

const results = []
const check = (name, ok, detail) => {
  results.push(ok === true)
  console.log((ok === true ? '[OK] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' — ' + detail))
}

// 1) 索引本身
const md = '# 标题\n\n这是 **加粗** 和 [链接](https://x.test) 以及 `代码`。\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n'
const { plain, map } = buildPlainIndex(md)
check('headings lose their hash marks', plain.startsWith('标题'), JSON.stringify(plain.slice(0, 10)))
check('bold and link markers are removed', plain.includes('这是 加粗 和 链接 以及 代码'), JSON.stringify(plain))
check('table pipes become spaces', plain.includes('A   B'), JSON.stringify(plain.split('\n').find((line) => line.includes('A'))))
check('the index maps back to the markdown offsets', (() => {
  const hit = findInPlain({ plain, map }, '这是 加粗 和 链接')
  return hit !== null && md.slice(hit.start, hit.end).startsWith('这是')
})(), '')
check('an unmatched quote returns null', findInPlain({ plain, map }, '这段话不存在') === null, '')
check('whitespace differences are tolerated', findInPlain({ plain, map }, '这是   加粗') !== null, '')

// 2) 把真实 docx 的文本做成「带标记的 markdown」，再导入
const SOURCE = 'E:/hermes_playground/docx-testbed/test_with_comments.docx'
const buffer = readFileSync(SOURCE)
const parsed = readDocxComments(buffer)
const lines = parsed.text.split('\n')
const markdown = lines.map((line, index) => {
  if (index < 2) return '# ' + line
  if (line.trim() !== '' && index % 11 === 0) return '**' + line + '**'
  if (line.trim() !== '' && index % 17 === 0) return '- ' + line
  return line
}).join('\n\n')

const imported = importDocxComments({ docxBuffer: buffer, markdownText: markdown })
const total = imported.store.comments.length
const anchored = imported.store.comments.filter((comment) => comment.anchor.start !== null)
const verified = anchored.filter((comment) => markdown.slice(comment.anchor.start, comment.anchor.end).includes(comment.anchor.quote.slice(0, 10)))
check('most anchors survive when only markdown markers were added', anchored.length >= Math.floor(total * 0.75), JSON.stringify({ total, anchored: anchored.length, stats: imported.mapStats }))
check('status matches reality: exact slices are mapped, marked-up ones are approx', (() => {
  let mismatched = 0
  for (const comment of anchored) {
    const slice = markdown.slice(comment.anchor.start, comment.anchor.end)
    const exact = slice === comment.anchor.quote
    if (exact === (comment.anchorStatus !== 'mapped')) mismatched += 1
  }
  return mismatched === 0
})(), JSON.stringify(imported.mapStats))
check('anchored ranges really contain their quote', verified.length === anchored.length, JSON.stringify({ verified: verified.length, anchored: anchored.length }))

// 3) 短 quote 不会被随机命中
const shortQuote = importDocxComments({ docxBuffer: buffer, markdownText: '大'.repeat(3) + '\n' })
const shortAnchored = shortQuote.store.comments.filter((comment) => comment.anchor.start !== null && comment.anchor.quote.length <= 2)
check('tiny quotes are not anchored by accident', shortAnchored.length === 0, JSON.stringify(shortQuote.mapStats))

console.log('PLAIN MAPPING: ' + results.filter(Boolean).length + '/' + results.length + ' ok')
process.exit(results.every(Boolean) ? 0 : 1)
