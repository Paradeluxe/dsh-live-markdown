/**
 * 「@我」判定：
 *   node scripts/comments-mentions-test.mjs
 *
 * 支持全名（@Alice Chen）与首词（@Alice），大小写不敏感，中文名同样支持；
 * 一条批注的根正文或任一回复里出现都算。
 */
import { buildThreads, createComment, createReply, emptyStore, mentionsAuthor, parseStore, serializeStore } from '../src/comments/model.js'

const results = []
const check = (name, ok, detail) => {
  results.push(ok === true)
  console.log((ok === true ? '[OK] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' — ' + detail))
}

const text = '第一段。第二段。\n'
const store = emptyStore()
const root = createComment(store, { author: { name: 'Bob Wu' }, body: '请 @Alice Chen 看一下这条。', start: 0, end: 3, text })
const other = createComment(store, { author: { name: 'Bob Wu' }, body: '这条没有提及。', start: 4, end: 7, text })
const chinese = createComment(store, { author: { name: 'Bob Wu' }, body: '请 @张伟 复核。', start: 0, end: 2, text })
const threads = buildThreads(store.comments)

const byId = (id) => threads.find((thread) => thread.id === id)

check('a full-name mention matches', mentionsAuthor(byId(root.id), 'Alice Chen') === true, '')
check('the first name alone matches the same comment', mentionsAuthor(byId(root.id), 'Alice') === true, '')
check('matching is case insensitive', mentionsAuthor(byId(root.id), 'alice chen') === true, '')
check('a different name does not match', mentionsAuthor(byId(root.id), 'Carol Li') === false, '')
check('a comment without mentions never matches', mentionsAuthor(byId(other.id), 'Alice Chen') === false, '')
check('CJK names work', mentionsAuthor(byId(chinese.id), '张伟') === true, '')
check('an empty signature matches nothing', mentionsAuthor(byId(root.id), '') === false, '')

// 回复里的提及也算
createReply(store, other.id, { author: { name: 'Carol Li' }, body: '@Alice Chen 我也同意。', text })
const withReply = buildThreads(store.comments).find((thread) => thread.id === other.id)
check('a mention inside a reply counts', mentionsAuthor(withReply, 'Alice Chen') === true, '')
check('the mention survives serialisation', (() => {
  const copy = parseStore(serializeStore(store))
  const thread = buildThreads(copy.comments).find((entry) => entry.id === root.id)
  return mentionsAuthor(thread, 'Alice Chen') === true
})(), '')
check('a null thread is handled', mentionsAuthor(null, 'Alice Chen') === false, '')

console.log('MENTIONS: ' + results.filter(Boolean).length + '/' + results.length + ' ok')
process.exit(results.every(Boolean) ? 0 : 1)
