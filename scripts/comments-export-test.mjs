/**
 * 导出器回归测试：
 *   node scripts/comments-export-test.mjs
 *
 * 流程：取一份真实 docx（有批注也行，先被剥掉）→ 按纯文本偏移写入 3 条批注
 * （2 条根批注 + 1 条回复，其中 1 条已解决）→ 用我们自己的读取器读回 → 字段全部对上。
 * 再用 PowerShell + Word COM 打开导出的文件核对 Comments.Count / Author / Done（见输出的 word-check 命令）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { readDocxComments, summarizeDocxComments } from '../src/comments/docx-comments.js'
import { exportDocxComments, readPart, ensureCompatibilityMode, stripComments } from '../src/comments/docx-export.js'

const SOURCE = 'E:/hermes_playground/docx-testbed/test_with_comments.docx'
const OUT = 'E:/hermes_playground/.dsh-scratch/word-comments/exported.docx'

const sourceBuffer = readFileSync(SOURCE)
const stripped = stripComments(sourceBuffer)
const original = readDocxComments(sourceBuffer).text

const results = []
const check = (name, ok, detail) => {
  results.push(ok === true)
  console.log((ok === true ? '[OK] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' — ' + detail))
}

// 找三段文字做锚点（用正文里真实存在的句子，确保锚点可读）
const anchors = {
  a1: 'Authors and Affiliations:',
  a2: 'Centre for Cognitive and Brain Sciences',
  a3: 'Department of Psychology',
}
const offsets = {}
for (const [key, text] of Object.entries(anchors)) {
  const index = original.indexOf(text)
  offsets[key] = { start: index, end: index + text.length }
  check('source text contains the anchor for ' + key, index >= 0, JSON.stringify({ index, text }))
}

const comments = [
  {
    id: 1,
    author: 'Alice Chen',
    initials: 'AC',
    email: 'alice@example.edu',
    createdAt: '2026-11-24T02:00:00Z',
    resolved: false,
    parentId: null,
    body: '这是一条根批注。\n\n第二段：批注正文支持多段。',
    anchor: offsets.a1,
  },
  {
    id: 2,
    author: 'Bob Wu',
    initials: 'BW',
    createdAt: '2026-11-24T02:05:00Z',
    resolved: false,
    parentId: 1,
    body: '这是一条回复。',
    anchor: offsets.a1,
  },
  {
    id: 3,
    author: 'Bob Wu',
    initials: 'BW',
    createdAt: '2026-11-24T02:10:00Z',
    resolved: true,
    parentId: null,
    body: '这条已经解决。',
    anchor: offsets.a2,
  },
]

const exported = exportDocxComments(sourceBuffer, comments)
writeFileSync(OUT, exported)
check('export produced bytes', exported.length > 1000, String(exported.length))

// 1) 结构：五个部件都在，rels/content types/settings 齐全
for (const part of ['word/comments.xml', 'word/commentsExtended.xml', 'word/commentsIds.xml', 'word/commentsExtensible.xml', 'word/people.xml']) {
  check('part exists: ' + part, readPart(exported, part) !== null)
}
const documentXml = readPart(exported, 'word/document.xml')
check('document keeps the original body text', documentXml.includes('Authors and Affiliations:'), 'length=' + documentXml.length)
const rels = readPart(exported, 'word/_rels/document.xml.rels')
check('rels declare all five parts', ['comments.xml', 'commentsExtended.xml', 'commentsIds.xml', 'commentsExtensible.xml', 'people.xml'].every((name) => rels.includes('Target="' + name + '"')), '')
const contentTypes = readPart(exported, '[Content_Types].xml')
check('content types declare comment parts', contentTypes.includes('/word/comments.xml') && contentTypes.includes('/word/people.xml'), '')
const settings = readPart(exported, 'word/settings.xml')
const compat = ensureCompatibilityMode(settings)
check('settings carry compatibilityMode 15', compat !== null && /compatibilityMode" w:uri="[^"]*" w:val="15"/u.test(compat), '')

// 2) 读回：数量、线程、已解决、作者、作者身份、锚点原文
const back = readDocxComments(exported)
const summary = summarizeDocxComments(back)
check('reader sees 3 comments', summary.nodes === 3, JSON.stringify(summary))
check('threads are 2 roots + 1 reply', summary.threads === 2 && summary.replies === 1, JSON.stringify({ threads: summary.threads, replies: summary.replies }))
check('one thread is resolved', summary.resolvedThreads === 1, String(summary.resolvedThreads))
const root = back.comments.find((thread) => thread.id === 1)
const reply = root === undefined ? undefined : root.replies[0]
const resolved = back.comments.find((thread) => thread.id === 3)
check('root author and initials', root !== undefined && root.author === 'Alice Chen' && root.initials === 'AC', JSON.stringify({ author: root?.author, initials: root?.initials }))
check('reply is attached to the root', reply !== undefined && reply.parentId === 1 && reply.author === 'Bob Wu', JSON.stringify(reply === undefined ? null : { parentId: reply.parentId, author: reply.author }))
check('resolved flag survives the round trip', resolved !== undefined && resolved.resolved === true, JSON.stringify({ resolved: resolved?.resolved }))
check('multi-paragraph body survives', root !== undefined && root.body.includes('第二段'), JSON.stringify(root?.body))
check('anchor quote is the original sentence', root !== undefined && root.anchor !== null && root.anchor.quote === anchors.a1, JSON.stringify(root?.anchor?.quote))
check('second anchor quote', resolved !== undefined && resolved.anchor !== null && resolved.anchor.quote === anchors.a2, JSON.stringify(resolved?.anchor?.quote))
check('people.xml keeps the author identity', back.people.get('Alice Chen') !== undefined && String(back.people.get('Alice Chen').userId).includes('alice@example.edu'), JSON.stringify(back.people.get('Alice Chen')))
check('w:date is local time with Z, dateUtc is real UTC', root !== undefined && root.dateUtc === '2026-11-24T02:00:00Z' && root.date !== root.dateUtc, JSON.stringify({ date: root?.date, dateUtc: root?.dateUtc }))
check('durableId is four bytes of hex', root !== undefined && /^[0-9A-F]{8}$/u.test(String(root.durableId)), String(root?.durableId))

// 3) 幂等：把导出结果再导出一次，结构不炸
const twice = exportDocxComments(exported, comments)
const twiceBack = readDocxComments(twice)
check('exporting an exported file stays stable', summarizeDocxComments(twiceBack).nodes === 3 && twiceBack.comments[0].anchor.quote === anchors.a1, JSON.stringify(summarizeDocxComments(twiceBack)))

console.log('DOCX EXPORT: ' + results.filter(Boolean).length + '/' + results.length + ' ok')
console.log('exported file: ' + OUT)
process.exit(results.every(Boolean) ? 0 : 1)
