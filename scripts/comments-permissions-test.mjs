/**
 * 批注权限边界：作者才能改自己的批注正文（Word 的行为），别人可以回复、可以删除。
 *   node scripts/comments-permissions-test.mjs
 */
import { canEditComment, createComment, createReply, emptyStore, parseStore, serializeStore } from '../src/comments/model.js'

const results = []
const check = (name, ok, detail) => {
  results.push(ok === true)
  console.log((ok === true ? '[OK] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' — ' + detail))
}

const text = '这是一段用来测试权限的文字。\n'
const store = emptyStore()
const mine = createComment(store, { author: { name: 'Alice Chen' }, body: '我写的第一条。', start: 0, end: 5, text })
const theirs = createComment(store, { author: { name: 'Bob Wu' }, body: 'Bob 写的。', start: 6, end: 12, text })
createReply(store, mine.id, { author: { name: 'Bob Wu' }, body: 'Bob 的回复。', text })

check('the author can edit their own comment', canEditComment(mine, 'Alice Chen') === true, '')
check('another author cannot edit it', canEditComment(mine, 'Bob Wu') === false, '')
check('Bob can edit the comment he wrote', canEditComment(theirs, 'Bob Wu') === true, '')
check('an empty signature cannot edit anything', canEditComment(mine, '') === false, '')
check('a deleted comment cannot be edited', (() => {
  const copy = parseStore(serializeStore(store))
  copy.comments[0].deleted = true
  return canEditComment(copy.comments[0], 'Alice Chen') === false
})(), '')
check('a reply follows the same rule', (() => {
  const reply = store.comments.find((comment) => comment.parentId === mine.id)
  return reply !== undefined && canEditComment(reply, 'Bob Wu') === true && canEditComment(reply, 'Alice Chen') === false
})(), '')
check('the rule does not depend on position', canEditComment({ ...mine, anchor: { ...mine.anchor, start: null } }, 'Alice Chen') === true, '')

console.log('PERMISSIONS: ' + results.filter(Boolean).length + '/' + results.length + ' ok')
process.exit(results.every(Boolean) ? 0 : 1)
