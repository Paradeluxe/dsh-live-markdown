/**
 * 丢失锚点的批注重新挂载：
 *   node scripts/comments-reattach-test.mjs
 *
 * 场景：批注的原文被整段删掉 → 锚点丢失（start/end 为 null，批注仍保留）→
 * 用户在正文里选一段文字 → 重新挂载 → 锚点回到新位置，回复线程不受影响。
 */
import { canEditComment, createComment, createReply, emptyStore, parseStore, reattachComment, resolveStore, serializeStore } from '../src/comments/model.js'

const results = []
const check = (name, ok, detail) => {
  results.push(ok === true)
  console.log((ok === true ? '[OK] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' — ' + detail))
}

const text = '第一段会被删掉。\n\n第二段保留下来，用来重新挂载。\n'
const store = emptyStore()
const comment = createComment(store, { author: { name: 'Alice Chen' }, body: '原文被删掉的批注。', start: 0, end: 8, text })
createReply(store, comment.id, { author: { name: 'Bob Wu' }, body: '回复也要保留。', text })

// 删掉第一段
const afterDelete = text.replace('第一段会被删掉。\n\n', '')
const lostStore = parseStore(serializeStore(store))
const stats = resolveStore(lostStore, afterDelete)
check('deleting the text loses the anchor', stats.lost === 2 && lostStore.comments[0].anchor.start === null, JSON.stringify(stats))
check('the comment itself survives', lostStore.comments.length === 2, String(lostStore.comments.length))

// 选第二段重新挂载
const from = afterDelete.indexOf('第二段保留下来')
const to = from + '第二段保留下来'.length
const reattached = reattachComment(lostStore, comment.id, afterDelete, from, to)
check('reattaching sets a fresh anchor', reattached !== null && reattached.anchor.start === from && reattached.anchor.quote === '第二段保留下来', JSON.stringify(reattached === null ? null : reattached.anchor))
check('the lost flag is cleared', lostStore.comments[0].anchorStatus === 'mapped', String(lostStore.comments[0].anchorStatus))
const after = resolveStore(lostStore, afterDelete)
check('resolveStore no longer reports it lost', after.lost === 0, JSON.stringify(after))
check('the reply still points at the root', lostStore.comments.find((item) => item.body === '回复也要保留。').parentId === comment.id, '')
check('the author can still edit it after reattaching', canEditComment(lostStore.comments[0], 'Alice Chen') === true, '')
check('an empty selection cannot reattach', reattachComment(lostStore, comment.id, afterDelete, 5, 5) === null, '')
check('a missing id returns null', reattachComment(lostStore, 'c_NOPE', afterDelete, 0, 3) === null, '')

console.log('REATTACH: ' + results.filter(Boolean).length + '/' + results.length + ' ok')
process.exit(results.every(Boolean) ? 0 : 1)
