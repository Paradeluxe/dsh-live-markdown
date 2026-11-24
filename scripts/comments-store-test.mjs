/**
 * 批注侧车文件读写的回归测试：
 *   node scripts/comments-store-test.mjs
 *
 * 覆盖：侧车路径推导、缺失文件、正常读写、原子写入（不留临时文件）、
 * 「磁盘上别人改过」时按 id 合并、坏 JSON 不抛异常。
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readStoreFile, sidecarPathFor, writeStoreFile } from '../src/comments/store-io.js'
import { createComment, createReply, emptyStore, parseStore } from '../src/comments/model.js'

const results = []
const check = (name, ok, detail) => {
  results.push(ok === true)
  console.log((ok === true ? '[OK] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' — ' + detail))
}

const dir = mkdtempSync(join(tmpdir(), 'ghmd-comments-'))
const docPath = join(dir, 'draft.md')
writeFileSync(docPath, '# draft\n\nhello world\n', 'utf8')

try {
  check('a .md path maps to <doc>.comments.json', sidecarPathFor('/x/y/draft.md').endsWith('/x/y/draft.comments.json'), sidecarPathFor('/x/y/draft.md'))
  check('a .markdown path maps the same way', sidecarPathFor('/x/y/a.markdown') === '/x/y/a.comments.json', sidecarPathFor('/x/y/a.markdown'))
  check('a path without an extension appends the suffix', sidecarPathFor('/x/y/a') === '/x/y/a.comments.json', sidecarPathFor('/x/y/a'))

  const sidecar = sidecarPathFor(docPath)
  const missing = await readStoreFile(sidecar)
  check('a missing sidecar reads as an empty store', missing.exists === false && missing.store.comments.length === 0 && missing.error === null, JSON.stringify({ exists: missing.exists, error: missing.error }))

  // 1) 正常写 → 读回
  const text = '# draft\n\nhello world\n'
  const store = emptyStore()
  const root = createComment(store, { author: { name: 'Alice Chen' }, body: '第一条。', start: 9, end: 14, text })
  const first = await writeStoreFile(sidecar, store, { baseMtimeMs: null })
  check('writing creates the sidecar atomically', readdirSync(dir).some((name) => name === 'draft.comments.json') && !readdirSync(dir).some((name) => name.includes('.tmp-')), JSON.stringify(readdirSync(dir)))
  const loaded = await readStoreFile(sidecar)
  check('reading back keeps the comment', loaded.exists === true && loaded.store.comments.length === 1 && loaded.store.comments[0].id === root.id, JSON.stringify({ count: loaded.store.comments.length, id: loaded.store.comments[0]?.id }))
  check('the sidecar is pretty-printed JSON', readFileSync(sidecar, 'utf8').includes('\n  "version": 1'), '')

  // 2) 别人在我加载之后又写了一条（模拟多用户）
  const theirs = parseStore(loaded.store)
  createComment(theirs, { author: { name: 'Bob Wu' }, body: '别人加的。', start: 15, end: 20, text })
  await writeStoreFile(sidecar, theirs, { baseMtimeMs: loaded.mtimeMs })
  await new Promise((resolve) => setTimeout(resolve, 15))

  // 我基于旧版本保存：应该合并而不是覆盖
  const mine = parseStore(JSON.stringify(store))
  createReply(mine, root.id, { author: { name: 'Alice Chen' }, body: '我的回复。', text })
  const merged = await writeStoreFile(sidecar, mine, { baseMtimeMs: loaded.mtimeMs })
  check('a stale save merges instead of overwriting', merged.merged === true && merged.store.comments.length === 3, JSON.stringify({ merged: merged.merged, count: merged.store.comments.length }))
  const afterMerge = parseStore(readFileSync(sidecar, 'utf8'))
  check('the merge keeps both authors', new Set(afterMerge.comments.map((comment) => comment.author.name)).size === 2, JSON.stringify(afterMerge.comments.map((comment) => comment.author.name)))
  check('the reply is attached to its root', afterMerge.comments.some((comment) => comment.parentId === root.id), '')

  // 3) base 相同（没人动过）时不合并
  const fresh = await readStoreFile(sidecar)
  const clean = await writeStoreFile(sidecar, fresh.store, { baseMtimeMs: fresh.mtimeMs })
  check('saving without external changes does not merge', clean.merged === false, String(clean.merged))

  // 4) 坏 JSON：不抛，带 error，写回时能自愈
  const broken = join(dir, 'broken.comments.json')
  writeFileSync(broken, '{ this is not json', 'utf8')
  const brokenRead = await readStoreFile(broken)
  check('broken JSON reads without throwing', brokenRead.store.comments.length === 0 && brokenRead.error !== null, JSON.stringify({ error: brokenRead.error }))
  const healed = emptyStore()
  createComment(healed, { author: { name: 'Carol' }, body: '修好之后写的。', start: 0, end: 4, text: 'abcde' })
  await writeStoreFile(broken, healed, { baseMtimeMs: null })
  const healedRead = await readStoreFile(broken)
  check('writing over a broken file repairs it', healedRead.error === null && healedRead.store.comments.length === 1, JSON.stringify({ count: healedRead.store.comments.length }))
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log('STORE IO: ' + results.filter(Boolean).length + '/' + results.length + ' ok')
process.exit(results.every(Boolean) ? 0 : 1)
