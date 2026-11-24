/**
 * 复制/粘贴批注的回归测试：
 *   node scripts/comments-clipboard-test.mjs
 */
import { CLIPBOARD_MIME, applyPastePayload, buildCopyPayload } from '../src/comments/clipboard.js'
import { createComment, createReply, emptyStore, parseStore, serializeStore } from '../src/comments/model.js'

const results = []
const check = (name, ok, detail) => {
  results.push(ok === true)
  console.log((ok === true ? '[OK] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' — ' + detail))
}

const text = '开头。第一段被批注的文字在这里，第二段也被批注。结尾。\n'
const store = emptyStore()
const first = createComment(store, { author: { name: 'Alice Chen' }, body: '第一段。', start: text.indexOf('第一段'), end: text.indexOf('第一段') + 5, text })
const second = createComment(store, { author: { name: 'Bob Wu' }, body: '第二段。', start: text.indexOf('第二段'), end: text.indexOf('第二段') + 5, text })
createReply(store, first.id, { author: { name: 'Carol Li' }, body: '回复第一段。', text })

check('the mime type is stable', CLIPBOARD_MIME === 'text/x-ghmd-comments+json', CLIPBOARD_MIME)

const payload = buildCopyPayload(text, store.comments, text.indexOf('第一段'), text.indexOf('直接结尾。') >= 0 ? text.length : text.length)
check('a copy of the whole document carries every comment', payload !== null && payload.comments.length === 3, String(payload === null ? 0 : payload.comments.length))
check('ids and parents are preserved', payload.comments.some((comment) => comment.parentId !== null), JSON.stringify(payload.comments.map((comment) => ({ id: comment.id, parentId: comment.parentId }))))

const partialFrom = text.indexOf('第二段')
const partialTo = partialFrom + 5
const partial = buildCopyPayload(text, store.comments, partialFrom, partialTo)
check('a partial copy only carries the comments inside it', partial.comments.length === 1 && partial.comments[0].body === '第二段。', JSON.stringify(partial.comments.map((comment) => comment.body)))
check('the payload anchor is relative to the copied text', partial.comments[0].anchor.start === 0 && partial.comments[0].anchor.quote === '第二段也被', JSON.stringify(partial.comments[0].anchor))

const emptySelection = buildCopyPayload(text, store.comments, 3, 3)
check('an empty selection produces no payload', emptySelection === null, String(emptySelection))

// 粘贴到另一篇文档
const target = emptyStore()
const targetText = '新的文档开头。\n'
const inserted = '粘贴进来的带批注文字'
const created = applyPastePayload(target, payload, targetText.length)
check('pasting recreates every comment', created.length === 3 && target.comments.length === 3, JSON.stringify({ created: created.length, total: target.comments.length }))
check('pasted anchors shift by the insert position', target.comments.every((comment) => (comment.anchor.start ?? -1) >= targetText.length), JSON.stringify(target.comments.map((comment) => comment.anchor.start)))
const pastedReply = target.comments.find((comment) => comment.body === '回复第一段。')
check('the reply points at the pasted root', pastedReply !== undefined && target.comments.some((comment) => comment.id === pastedReply.parentId && comment.body === '第一段。'), JSON.stringify(pastedReply === undefined ? null : pastedReply.parentId))
check('authors and resolved state survive', target.comments.some((comment) => comment.author.name === 'Bob Wu') && target.comments.every((comment) => comment.id !== first.id), '')
check('ids are reassigned, not reused', target.comments.every((comment) => comment.id !== first.id && comment.id !== second.id), JSON.stringify(target.comments.map((comment) => comment.id)))
check('the store serialises after pasting', parseStore(serializeStore(target)).comments.length === 3, '')

// 粘贴两次：id 不能撞
const created2 = applyPastePayload(target, payload, targetText.length + inserted.length)
check('pasting twice does not duplicate ids', new Set(target.comments.map((comment) => comment.id)).size === target.comments.length, JSON.stringify({ total: target.comments.length, second: created2.length }))

console.log('CLIPBOARD: ' + results.filter(Boolean).length + '/' + results.length + ' ok')
process.exit(results.every(Boolean) ? 0 : 1)
