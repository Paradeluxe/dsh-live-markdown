/**
 * 跨段落批注（Word 允许批注跨多个段落）：
 *   在 docx 里选一段跨越两个段落的文字 → 写进 docx → 真实 Word 读回，确认 Scope 覆盖两段。
 *
 * 运行：node scripts/comments-crossrange-test.mjs（需要 Windows + Word）
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readDocxComments } from '../src/comments/docx-comments.js'
import { exportDocxComments } from '../src/comments/docx-export.js'
import { anchorAt, createComment, emptyStore, parseStore, serializeStore, toDocxComments } from '../src/comments/model.js'

const results = []
const check = (name, ok, detail) => {
  results.push(ok === true)
  console.log((ok === true ? '[OK] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' — ' + detail))
}

const SOURCE = 'E:/hermes_playground/jspace-repo/manuscript/JSpace_Liu_Oct09_2026.docx'
const OUT_DIR = 'E:/hermes_playground/.dsh-scratch/word-comments'
const OUT = OUT_DIR + '/crossrange.docx'
const PS = OUT_DIR + '/read-crossrange.ps1'

const buffer = readFileSync(SOURCE)
const parsed = readDocxComments(buffer)
const text = parsed.text
const paragraphs = text.split('\n')
check('the manuscript has several paragraphs', paragraphs.length > 10, String(paragraphs.length))

// 找一段非空段落，批注从这一段中间开始、跨到下一段中间
let firstIndex = paragraphs.findIndex((line, index) => index > 2 && line.trim().length > 40)
if (firstIndex < 0) firstIndex = 3
const firstStart = paragraphs.slice(0, firstIndex).reduce((total, line) => total + line.length + 1, 0)
const start = firstStart + 10
const secondLine = paragraphs[firstIndex + 1] ?? ''
const secondStart = firstStart + paragraphs[firstIndex].length + 1
const end = secondStart + Math.min(20, secondLine.length)
check('the chosen range crosses a paragraph break', text.slice(start, end).includes('\n') && end > start + 20, JSON.stringify({ start, end, preview: text.slice(start, end).replace(/\n/g, '⏎').slice(0, 60) }))

const store = emptyStore()
createComment(store, { author: { name: 'Alice Chen' }, body: '跨两段的批注。', start, end, text })
const exported = exportDocxComments(buffer, toDocxComments(parseStore(serializeStore(store))))
mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT, exported)

const reread = readDocxComments(exported)
check('the exported file still has one comment', reread.comments.length === 1, String(reread.comments.length))

writeFileSync(PS, `
param([string]$Path)
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$doc = $word.Documents.Open($Path, $false, $true)
try {
  $comments = @($doc.Comments)
  $scope = ''
  $paragraphs = 0
  if ($comments.Count -gt 0) {
    $scope = [string]$comments[0].Scope.Text
    $paragraphs = @($comments[0].Scope.Paragraphs).Count
  }
  [pscustomobject]@{ Count = $comments.Count; ScopeLength = $scope.Length; Paragraphs = $paragraphs; HasBreak = $scope.Contains([char]13) } | ConvertTo-Json
} finally {
  $doc.Close(0)
  $word.Quit()
}
`, 'utf8')

const raw = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS, '-Path', OUT], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
const word = JSON.parse(raw.slice(raw.indexOf('{')))
check('Word sees exactly one comment', word.Count === 1, JSON.stringify(word))
check('Word reports a scope longer than a single paragraph', word.ScopeLength >= 20, JSON.stringify(word))
check('the scope spans two paragraphs', word.Paragraphs === 2, JSON.stringify(word))

console.log('CROSSRANGE: ' + results.filter(Boolean).length + '/' + results.length + ' ok')
process.exit(results.every(Boolean) ? 0 : 1)
