/**
 * 端到端：markdown 侧模型 → docx 导出 → Word 读回验收。
 *   node scripts/comments-model-word-check.mjs
 *
 * 和 comments-word-check.mjs 的区别：那边的批注数组是手写的，这里走完整的 model API
 * （createComment / createReply / setResolved / serializeStore / parseStore / toDocxComments），
 * 验证「侧车文件里的批注能原样变成 Word 里的批注」。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readDocxComments } from '../src/comments/docx-comments.js'
import { exportDocxComments } from '../src/comments/docx-export.js'
import { createComment, createReply, emptyStore, parseStore, serializeStore, setResolved, toDocxComments } from '../src/comments/model.js'

const here = dirname(fileURLToPath(import.meta.url))
const SOURCE = 'E:/hermes_playground/docx-testbed/test_with_comments.docx'
const INSPECT = join(here, 'word', 'inspect-comments.ps1')
const OUT_DIR = 'E:/hermes_playground/.dsh-scratch/word-comments'
const ANCHOR_ONE = 'Centre for Cognitive and Brain Sciences'
const ANCHOR_TWO = 'Department of Psychology'

const sourceBuffer = readFileSync(SOURCE)
const docxResult = readDocxComments(sourceBuffer)
const text = docxResult.text
const find = (needle) => ({ start: text.indexOf(needle), end: text.indexOf(needle) + needle.length })

const store = emptyStore()
const root = createComment(store, { author: { name: 'Alice Chen', initials: 'AC', email: 'alice@example.edu' }, body: '根批注：请补引用。', ...find(ANCHOR_ONE), text })
createReply(store, root.id, { author: { name: 'Bob Wu', initials: 'BW' }, body: '回复：下一版补上。', text })
setResolved(store, root.id, true)
const second = createComment(store, { author: { name: 'Carol Li', initials: 'CL' }, body: '另一条没解决的。', ...find(ANCHOR_TWO), text })
void second

// 走一遍侧车文件的真实路径：序列化 → 解析 → 导出
const storeFromDisk = parseStore(serializeStore(store))
const out = OUT_DIR + '/model-word-' + Date.now().toString().slice(-6) + '.docx'
writeFileSync(out, exportDocxComments(sourceBuffer, toDocxComments(storeFromDisk)))
console.log('exported', out)

const result = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', INSPECT, '-Path', out], { encoding: 'utf8' })
if (result.status !== 0) {
  console.log('word check failed to run:', String(result.stderr).slice(0, 400))
  process.exit(1)
}
console.log(result.stdout.trim())
const lines = result.stdout.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('#'))

const results = []
const check = (name, ok, detail) => {
  results.push(ok === true)
  console.log((ok === true ? '[OK] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' — ' + detail))
}
check('Word sees both threads', lines.length === 3, String(lines.length))
check('Word shows the reply as a thread member', lines.some((line) => /ancestor=\d+/u.test(line)), JSON.stringify(lines.filter((line) => /ancestor=\d+/u.test(line))))
check('Word shows the resolved thread as done', lines.some((line) => /done=True/u.test(line)), JSON.stringify(lines.filter((line) => /done=True/u.test(line))))
check('Word shows the anchored text of both roots', lines.some((line) => line.includes(ANCHOR_ONE)) && lines.some((line) => line.includes(ANCHOR_TWO)), '')
check('Word keeps both authors', lines.some((line) => line.includes('author=Alice Chen')) && lines.some((line) => line.includes('author=Carol Li')), '')

console.log('MODEL → WORD: ' + results.filter(Boolean).length + '/' + results.length + ' ok')
process.exit(results.every(Boolean) ? 0 : 1)
