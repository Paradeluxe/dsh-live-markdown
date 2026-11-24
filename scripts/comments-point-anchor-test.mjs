/**
 * 光标处（0 长度）批注的往返测试：
 *   node scripts/comments-point-anchor-test.mjs
 *
 * Word 允许把批注挂在插入点上（不选文字）。侧车里用 start === end 表示；
 * 导出时写成 commentRangeStart + commentRangeEnd + commentReference（同一偏移），
 * 再读回来仍然是这条批注，并让真实 Word 确认能打开、Scope 长度为 0。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readDocxComments } from '../src/comments/docx-comments.js'
import { exportDocxComments } from '../src/comments/docx-export.js'
import { anchorAt, createComment, emptyStore, parseStore, resolveStore, serializeStore, toDocxComments } from '../src/comments/model.js'
import { readZipDirectory, readZipEntry } from '../src/comments/zip.js'

const results = []
const check = (name, ok, detail) => {
  results.push(ok === true)
  console.log((ok === true ? '[OK] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' — ' + detail))
}

const text = '第一段。\n\n第二段有内容。\n'
const anchor = anchorAt(text, 8, 8)
check('a zero-length anchor has an empty quote', anchor.quote === '' && anchor.start === 8 && anchor.end === 8, JSON.stringify(anchor))
check('it still keeps the prefix for later re-anchoring', anchor.prefix.length > 0, JSON.stringify(anchor.prefix))

const store = emptyStore()
const comment = createComment(store, { author: { name: 'Alice Chen' }, body: '挂在插入点上的批注。', start: 8, end: 8, text })
check('createComment accepts a caret position', comment.anchor.start === 8 && comment.anchor.end === 8 && comment.anchor.quote === '', JSON.stringify(comment.anchor))

const resolved = parseStore(serializeStore(store))
const stats = resolveStore(resolved, text)
check('resolveStore keeps the caret anchor', stats.lost === 0 && resolved.comments[0].anchor.start === 8, JSON.stringify(stats))
const movedText = '插入的文字\n' + text
const moved = parseStore(serializeStore(store))
resolveStore(moved, movedText)
check('the caret anchor survives an edit before it', moved.comments[0].anchor.start !== null && moved.comments[0].anchor.quote === '', JSON.stringify(moved.comments[0].anchor))

// 导出：0 长度锚点写进 docx
const SOURCE = 'E:/hermes_playground/docx-testbed/test_with_comments.docx'
const buffer = readFileSync(SOURCE)
const docxText = readDocxComments(buffer).text
const start = docxText.indexOf('Centre for Cognitive and Brain Sciences') + 20
const exportStore = parseStore(serializeStore(store))
exportStore.comments[0].anchor = anchorAt(docxText, start, start)
const exported = exportDocxComments(buffer, toDocxComments(exportStore))
const reread = readDocxComments(exported)
const found = reread.comments.find((thread) => String(thread.body).includes('插入点上的批注'))
check('the exported docx contains the caret comment', found !== undefined, String(reread.comments.length))

const directory = readZipDirectory(exported)
const zipped = directory instanceof Map ? directory : new Map(directory.map((entry) => [entry.name, entry]))
const xml = readZipEntry(exported, zipped.get('word/document.xml')).toString('utf8')
const rangeStarts = (xml.match(/<w:commentRangeStart /gu) ?? []).length
const rangeEnds = (xml.match(/<w:commentRangeEnd /gu) ?? []).length
check('the markers sit next to each other with no text between', rangeStarts === 1 && rangeEnds === 1 && /<w:commentRangeStart w:id="1"\/><w:commentRangeEnd w:id="1"\/>/u.test(xml), JSON.stringify({ rangeStarts, rangeEnds }))

// 真实 Word 读回：能打开、Scope 长度为 0
const OUT_DIR = 'E:/hermes_playground/.dsh-scratch/word-comments'
const OUT = OUT_DIR + '/point-anchor.docx'
const PS = OUT_DIR + '/read-point-anchor.ps1'
mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT, exported)
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
  if ($comments.Count -gt 0) { $scope = [string]$comments[0].Scope.Text }
  [pscustomobject]@{ Count = $comments.Count; ScopeLength = $scope.Length } | ConvertTo-Json
} finally {
  $doc.Close(0)
  $word.Quit()
}
`, 'utf8')
const raw = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS, '-Path', OUT], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
const word = JSON.parse(raw.slice(raw.indexOf('{')))
check('Word opens the file with the caret comment', word.Count === 1, JSON.stringify(word))
check('Word reports a zero-length scope', word.ScopeLength === 0, JSON.stringify(word))

console.log('POINT ANCHOR: ' + results.filter(Boolean).length + '/' + results.length + ' ok')
process.exit(results.every(Boolean) ? 0 : 1)
