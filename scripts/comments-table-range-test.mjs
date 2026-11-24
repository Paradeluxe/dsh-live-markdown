/**
 * 表格单元格里的批注：Word 允许对表格文字批注，导出后 Word 应能读到同一个单元格里的文字。
 *   node scripts/comments-table-range-test.mjs（需要 Windows + Word）
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readDocxComments } from '../src/comments/docx-comments.js'
import { exportDocxComments } from '../src/comments/docx-export.js'
import { createComment, emptyStore, parseStore, serializeStore, toDocxComments } from '../src/comments/model.js'

const results = []
const check = (name, ok, detail) => {
  results.push(ok === true)
  console.log((ok === true ? '[OK] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' — ' + detail))
}

const SOURCE = 'E:/hermes_playground/jspace-repo/manuscript/JSpace_Liu_Oct09_2026.docx'
const OUT_DIR = 'E:/hermes_playground/.dsh-scratch/word-comments'
const OUT = OUT_DIR + '/table-range.docx'
const PS = OUT_DIR + '/read-table-range.ps1'

const buffer = readFileSync(SOURCE)
const parsed = readDocxComments(buffer)
const text = parsed.text
const quote = 'WikiText-103 train split'
const at = text.indexOf(quote)
check('the quote exists inside the document text', at >= 0, String(at))

const store = emptyStore()
createComment(store, { author: { name: 'Alice Chen' }, body: '表格里的批注。', start: at, end: at + quote.length, text })
const exported = exportDocxComments(buffer, toDocxComments(parseStore(serializeStore(store))))
mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT, exported)
const reread = readDocxComments(exported)
check('the exported file parses with one comment', reread.comments.length === 1, String(reread.comments.length))

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
  $inTable = $false
  $cells = 0
  if ($comments.Count -gt 0) {
    $scope = [string]$comments[0].Scope.Text
    try { $inTable = [bool]$comments[0].Scope.Information(12) } catch {}
    try { $cells = @($comments[0].Scope.Cells).Count } catch {}
  }
  [pscustomobject]@{ Count = $comments.Count; Scope = $scope.Trim(); InTable = $inTable; Cells = $cells } | ConvertTo-Json
} finally {
  $doc.Close(0)
  $word.Quit()
}
`, 'utf8')

const raw = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS, '-Path', OUT], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
const word = JSON.parse(raw.slice(raw.indexOf('{')))
check('Word sees one comment', word.Count === 1, JSON.stringify(word))
check('Word anchors it on the quoted cell text', String(word.Scope).includes(quote), JSON.stringify(String(word.Scope).slice(0, 60)))
check('Word reports the scope inside a table', word.InTable === true, JSON.stringify({ InTable: word.InTable, Cells: word.Cells }))

console.log('TABLE RANGE: ' + results.filter(Boolean).length + '/' + results.length + ' ok')
process.exit(results.every(Boolean) ? 0 : 1)
