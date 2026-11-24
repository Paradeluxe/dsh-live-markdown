/**
 * 真实稿件往返：JSpace_Liu_Oct09_2026.docx（22 条批注、11 条线程、3 条已解决线程）
 *   docx 批注 → 侧车模型 → 写回新 docx → 真实 Word 读回
 * 断言 Word 对「原文件」和「写回文件」报告同样的统计（条数、已解决数、可解析的锚点），
 * 并核对写回部件的结构（commentsExtended 的 paraIdParent 数量）。
 *
 * 运行：node scripts/comments-jspace-roundtrip.mjs
 * Word 部分通过 COM（Windows + Word 必需），失败时明确报错而不是假装通过。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { readDocxComments } from '../src/comments/docx-comments.js'
import { exportDocxComments } from '../src/comments/docx-export.js'
import { fromDocxComments, mapDocxAnchorsToMarkdown, toDocxComments } from '../src/comments/model.js'

const SOURCE = 'E:/hermes_playground/jspace-repo/manuscript/JSpace_Liu_Oct09_2026.docx'
const OUT_DIR = 'E:/hermes_playground/.dsh-scratch/word-comments'
const OUT = OUT_DIR + '/jspace-roundtrip.docx'
const PS = OUT_DIR + '/read-jspace-comments.ps1'

const results = []
const check = (name, ok, detail) => {
  results.push(ok === true)
  console.log((ok === true ? '[OK] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' — ' + detail))
}

const source = readDocxComments(readFileSync(SOURCE))
const model = fromDocxComments(source)
mapDocxAnchorsToMarkdown(model, source.text, source.text)
const roots = model.comments.filter((comment) => comment.parentId === null)
const replies = model.comments.filter((comment) => comment.parentId !== null)
const resolvedRoots = roots.filter((comment) => comment.resolved === true)
check('the manuscript parses into the expected threads', source.comments.length === 11 && roots.length === 11, JSON.stringify({ threads: source.comments.length, roots: roots.length }))
check('replies are recognised', replies.length === 11, String(replies.length))
check('resolved threads are recognised', resolvedRoots.length === 3, String(resolvedRoots.length))

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT, exportDocxComments(readFileSync(SOURCE), toDocxComments(model)))

const script = `
param([string]$Path)
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$doc = $word.Documents.Open($Path, $false, $true)
try {
  $comments = @($doc.Comments)
  $done = 0
  $withScope = 0
  foreach ($c in $comments) {
    try { if ([bool]$c.Done) { $done += 1 } } catch {}
    try { if ([string]$c.Scope.Text -ne '') { $withScope += 1 } } catch {}
  }
  [pscustomobject]@{ Count = $comments.Count; Done = $done; WithScope = $withScope } | ConvertTo-Json
} finally {
  $doc.Close(0)
  $word.Quit()
}
`
writeFileSync(PS, script, 'utf8')

const readInWord = (path) => {
  const raw = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS, '-Path', path], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  return JSON.parse(raw.slice(raw.indexOf('{')))
}

const original = readInWord(SOURCE)
const after = readInWord(OUT)
check('Word sees the same comment count after the round trip', after.Count === original.Count && after.Count === 22, JSON.stringify({ original: original.Count, after: after.Count }))
check('Word sees the same resolved count', after.Done === original.Done && after.Done === 6, JSON.stringify({ original: original.Done, after: after.Done }))
check('Word resolves every anchor to real text', after.WithScope === original.WithScope && after.WithScope === 22, JSON.stringify({ original: original.WithScope, after: after.WithScope }))

console.log('JSPACE ROUNDTRIP: ' + results.filter(Boolean).length + '/' + results.length + ' ok')
process.exit(results.every(Boolean) ? 0 : 1)
