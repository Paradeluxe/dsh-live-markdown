/**
 * 用 Word 本身验收导出结果（需要本机装了 Word）：
 *   node scripts/comments-word-check.mjs [源 docx]
 *
 * 做法：按纯文本偏移导出 3 条批注（2 根 + 1 回复，其中 1 条已解决）到一个临时 docx，
 * 再调 Word COM（scripts/word/inspect-comments.ps1）读回 Comments.Count / Author / Done /
 * Ancestor / Scope.Text 逐条断言。验证的是「Word 真的认我们写的批注」，不是我们自己的解析器自说自话。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readDocxComments } from '../src/comments/docx-comments.js'
import { exportDocxComments } from '../src/comments/docx-export.js'

const here = dirname(fileURLToPath(import.meta.url))
const SOURCE = process.argv[2] ?? 'E:/hermes_playground/docx-testbed/test_with_comments.docx'
const INSPECT = join(here, 'word', 'inspect-comments.ps1')
const OUT_DIR = 'E:/hermes_playground/.dsh-scratch/word-comments'
const ANCHOR_ONE = 'Centre for Cognitive and Brain Sciences'
const ANCHOR_TWO = 'Department of Psychology'

const text = readDocxComments(readFileSync(SOURCE)).text
const find = (needle) => {
  const index = text.indexOf(needle)
  if (index < 0) throw new Error('anchor text not found: ' + needle)
  return { start: index, end: index + needle.length }
}
const comments = [
  { id: 1, author: 'Alice Chen', initials: 'AC', createdAt: '2026-11-24T02:00:00Z', resolved: false, parentId: null, body: '根批注：请补引用。', anchor: find(ANCHOR_ONE) },
  { id: 2, author: 'Bob Wu', initials: 'BW', createdAt: '2026-11-24T02:05:00Z', resolved: false, parentId: 1, body: '回复：下一版补上。', anchor: find(ANCHOR_ONE) },
  { id: 3, author: 'Bob Wu', initials: 'BW', createdAt: '2026-11-24T02:10:00Z', resolved: true, parentId: null, body: '已解决的一条。', anchor: find(ANCHOR_TWO) },
]

const out = OUT_DIR + '/word-check-' + Date.now().toString().slice(-6) + '.docx'
writeFileSync(out, exportDocxComments(readFileSync(SOURCE), comments))
console.log('exported', out)

const result = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', INSPECT, '-Path', out], { encoding: 'utf8' })
if (result.status !== 0) {
  console.log('word check failed to run:', String(result.stderr).slice(0, 400))
  process.exit(1)
}
console.log(result.stdout.trim())

const lines = result.stdout.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('#'))
const parsed = lines.map((line) => {
  const field = (name) => {
    const match = new RegExp('\\s' + name + '=(.*?)(?=\\s(?:author|done|ancestor|start|end|len|text)=|$)', 'u').exec(line)
    return match === null ? '' : match[1].trim()
  }
  const scope = /text=\[(.*)\]$/u.exec(line)
  return {
    author: field('author'),
    done: field('done'),
    ancestor: field('ancestor'),
    text: scope === null ? '' : scope[1],
  }
})

const results = []
const check = (name, ok, detail) => {
  results.push(ok === true)
  console.log((ok === true ? '[OK] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' — ' + detail))
}
check('Word sees three comments', parsed.length === 3, String(parsed.length))
const [first, second, third] = parsed
check('Word reads the root author', first !== undefined && first.author === 'Alice Chen', JSON.stringify(first === undefined ? null : { author: first.author }))
check('Word reads the anchored text of the root', first !== undefined && first.text === ANCHOR_ONE, JSON.stringify(first === undefined ? null : first.text))
check('Word links the reply to the root', second !== undefined && second.ancestor === '1' && second.author === 'Bob Wu', JSON.stringify(second === undefined ? null : { ancestor: second.ancestor, author: second.author }))
check('Word reads the resolved flag', third !== undefined && third.done === 'True', JSON.stringify(third === undefined ? null : { done: third.done }))
check('Word reads the second anchor text', third !== undefined && third.text === ANCHOR_TWO, JSON.stringify(third === undefined ? null : third.text))

console.log('WORD CHECK: ' + results.filter(Boolean).length + '/' + results.length + ' ok')
process.exit(results.every(Boolean) ? 0 : 1)
