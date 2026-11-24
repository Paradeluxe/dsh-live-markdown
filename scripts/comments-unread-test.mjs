/**
 * 「新批注」标记（Word 的 new comments）：按署名记录读到哪儿，之后别人写的就算「新」。
 *   node scripts/comments-unread-test.mjs
 */
import { createComment, emptyStore, markRead, parseStore, serializeStore, unreadThreads } from '../src/comments/model.js'

const results = []
const check = (name, ok, detail) => {
  results.push(ok === true)
  console.log((ok === true ? '[OK] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' — ' + detail))
}

const text = '第一段。第二段。第三段。\n'
const store = emptyStore()
check('a new store has no readers', JSON.stringify(store.readers) === '{}', JSON.stringify(store.readers))
check('nothing is unread before anyone reads', unreadThreads(store, 'Alice Chen').size === 0, '')

const base = Date.parse('2026-11-24T10:00:00Z')
const alices = createComment(store, { author: { name: 'Alice Chen' }, body: 'Alice 的批注。', start: 0, end: 3, text })
const bobs = createComment(store, { author: { name: 'Bob Wu' }, body: 'Bob 的批注。', start: 4, end: 7, text })
// 手动把时间调成可控
alices.createdAt = new Date(base).toISOString(); alices.modifiedAt = alices.createdAt
bobs.createdAt = new Date(base + 60_000).toISOString(); bobs.modifiedAt = bobs.createdAt

markRead(store, 'Alice Chen', new Date(base + 30_000).toISOString())
check('a comment after my read pointer is new', unreadThreads(store, 'Alice Chen').has(bobs.id), JSON.stringify([...unreadThreads(store, 'Alice Chen')]))
check('my own comment is never new', unreadThreads(store, 'Alice Chen').has(alices.id) === false, '')
check('Bob sees the same comment as not new for himself', unreadThreads(store, 'Bob Wu').size === 0, JSON.stringify([...unreadThreads(store, 'Bob Wu')]))

markRead(store, 'Alice Chen', new Date(base + 120_000).toISOString())
check('after marking read nothing is new', unreadThreads(store, 'Alice Chen').size === 0, JSON.stringify([...unreadThreads(store, 'Alice Chen')]))

const later = createComment(store, { author: { name: 'Bob Wu' }, body: 'Bob 又写了一条。', start: 8, end: 11, text })
later.createdAt = new Date(base + 180_000).toISOString(); later.modifiedAt = later.createdAt
check('a newer comment becomes new again', unreadThreads(store, 'Alice Chen').size === 1, JSON.stringify([...unreadThreads(store, 'Alice Chen')]))

const reply = { ...later, id: 'c_REPLY001', parentId: bobs.id, body: 'Bob 的回复。', createdAt: new Date(base + 240_000).toISOString(), modifiedAt: new Date(base + 240_000).toISOString() }
store.comments.push(reply)
check('a new reply marks its thread new', unreadThreads(store, 'Alice Chen').has(bobs.id), JSON.stringify([...unreadThreads(store, 'Alice Chen')]))

check('an empty signature cannot mark anything read', markRead(store, '') === null, '')
check('readers survive a serialize/parse round trip', (() => {
  const copy = parseStore(serializeStore(store))
  return copy.readers['Alice Chen'] === store.readers['Alice Chen']
})(), JSON.stringify(parseStore(serializeStore(store)).readers))
check('a store without readers still parses', parseStore({ version: 1, comments: [] }).readers !== undefined, JSON.stringify(parseStore({ version: 1, comments: [] }).readers))
check('an invalid reader timestamp is ignored', (() => {
  const copy = parseStore(serializeStore(store))
  copy.readers['Alice Chen'] = 'not-a-date'
  return unreadThreads(copy, 'Alice Chen').size === 0
})(), '')
check('a deleted comment is never new', (() => {
  const copy = parseStore(serializeStore(store))
  for (const target of copy.comments) target.deleted = true
  return unreadThreads(copy, 'Alice Chen').size === 0
})(), '')
check('deleting the new reply drops the thread from unread', (() => {
  const copy = parseStore(serializeStore(store))
  const target = copy.comments.find((comment) => comment.id === 'c_REPLY001')
  target.deleted = true
  return unreadThreads(copy, 'Alice Chen').has(bobs.id) === false
})(), '')

console.log('UNREAD: ' + results.filter(Boolean).length + '/' + results.length + ' ok')
process.exit(results.every(Boolean) ? 0 : 1)
