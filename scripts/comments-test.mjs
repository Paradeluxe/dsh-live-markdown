/**
 * docx 批注读取的回归测试：
 *   node scripts/comments-test.mjs
 *
 * 期望值来自两处独立证据：
 *   1) docx 包里的 XML（本仓库解析）；
 *   2) Word 16.0 COM：`doc.Comments.Count` / `Comment.Done`（脚本 word-count-comments.ps1，结果见 docs/WORD-COMMENTS.md）。
 * 两边的「评论条数」必须一致；resolved 的差异是 Word 把 done 继承给线程内每一条，见 summarizeDocxComments 注释。
 */
import { readFileSync } from 'node:fs'
import { readDocxComments, summarizeDocxComments } from '../src/comments/docx-comments.js'

const SAMPLES = [
  {
    path: 'E:/hermes_playground/docx-testbed/test_nested.docx',
    wordCount: 48,
    wordDone: 0,
    expect: { threads: 24, nodes: 48, resolvedThreads: 0, firstId: 1, date: '2026-05-20T15:40:00Z', dateUtc: '2026-05-20T07:40:00Z', durableId: '37B0C978', quote: 'The audio recordings are publicly available at https://osf.io/wjdyr/' },
  },
  {
    path: 'E:/hermes_playground/docx-testbed/test_with_comments.docx',
    wordCount: 46,
    wordDone: 0,
    expect: { threads: 23, nodes: 46, resolvedThreads: 0 },
  },
  {
    path: 'E:/hermes_playground/docx-testbed/test_overlap.docx',
    wordCount: 49,
    wordDone: 0,
    expect: { threads: 26, nodes: 49, resolvedThreads: 0 },
  },
  {
    path: 'E:/hermes_playground/jspace-repo/manuscript/JSpace_Liu_Oct09_2026.docx',
    wordCount: 22,
    wordDone: 6,
    expect: { threads: 11, nodes: 22, resolvedThreads: 3, authors: ['Haoyun Zhang', 'Tony, Liu Zhengyuan'] },
  },
]

const results = []
const check = (name, ok, detail) => {
  results.push(ok === true)
  console.log((ok === true ? '[OK] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' — ' + detail))
}

for (const sample of SAMPLES) {
  const fileName = sample.path.split('/').pop()
  let result
  try {
    result = readDocxComments(readFileSync(sample.path))
  } catch (error) {
    check(fileName + ' parses', false, error instanceof Error ? error.message : String(error))
    continue
  }
  const summary = summarizeDocxComments(result)
  check(fileName + ' parses', true, 'threads=' + summary.threads + ' nodes=' + summary.nodes)
  check(fileName + ' comment count matches Word', summary.nodes === sample.wordCount, JSON.stringify({ word: sample.wordCount, reader: summary.nodes }))
  check(fileName + ' replies form threads', summary.threads + summary.replies === summary.nodes && summary.replies > 0, JSON.stringify({ threads: summary.threads, replies: summary.replies }))
  check(fileName + ' resolved count', summary.resolvedThreads === sample.expect.resolvedThreads, JSON.stringify({ expect: sample.expect.resolvedThreads, got: summary.resolvedThreads, wordDone: sample.wordDone }))
  if (sample.expect.authors !== undefined) {
    check(fileName + ' authors', JSON.stringify(summary.authors) === JSON.stringify(sample.expect.authors), JSON.stringify(summary.authors))
  }
  const first = result.comments[0]
  if (sample.expect.firstId !== undefined) {
    check(fileName + ' first thread id', first.id === sample.expect.firstId, String(first.id))
    check(fileName + ' first thread date', first.date === sample.expect.date, String(first.date))
    check(fileName + ' first thread UTC date', first.dateUtc === sample.expect.dateUtc, String(first.dateUtc))
    check(fileName + ' first thread durableId', first.durableId === sample.expect.durableId, String(first.durableId))
    check(fileName + ' first thread anchor quote', first.anchor !== null && first.anchor.quote === sample.expect.quote, first.anchor === null ? 'null' : JSON.stringify(first.anchor.quote))
    check(fileName + ' first thread has a reply', first.replies.length === 1 && first.replies[0].parentId === first.id, JSON.stringify(first.replies.map((reply) => reply.parentId)))
  }
  // 锚点必须落在正文范围内，且 start <= end
  const nodes = result.comments.flatMap((thread) => [thread, ...thread.replies])
  const inRange = nodes.filter((node) => node.anchor !== null && node.anchor.start !== null)
  check(fileName + ' anchors stay inside the text', inRange.every((node) => node.anchor.start >= 0 && node.anchor.end <= result.text.length && node.anchor.start <= node.anchor.end), JSON.stringify({ textLength: result.text.length, anchors: inRange.length }))
}

console.log('DOCX COMMENTS: ' + results.filter(Boolean).length + '/' + results.length + ' ok')
process.exit(results.every(Boolean) ? 0 : 1)
