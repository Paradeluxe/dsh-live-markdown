/**
 * markdown 侧批注模型的回归测试：
 *   node scripts/comments-model-test.mjs
 *
 * 覆盖：侧车 JSON 往返、锚点重定位（前移/移动/丢失）、线程与解决、删除墓碑、
 * 多用户合并（新增/编辑冲突/删除传播）、docx 互通（toDocxComments → 导出 → 读回 → fromDocxComments）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import {
  anchorAt, buildThreads, createComment, createReply, deleteComment, editComment,
  emptyStore, fromDocxComments, mapDocxAnchorsToMarkdown, mergeStores, normalizeDurableId,
  parseStore, resolveAnchor, resolveStore, serializeStore, setResolved, toDocxComments,
} from '../src/comments/model.js'
import { readDocxComments } from '../src/comments/docx-comments.js'
import { exportDocxComments } from '../src/comments/docx-export.js'

const results = []
const check = (name, ok, detail) => {
  results.push(ok === true)
  console.log((ok === true ? '[OK] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' — ' + detail))
}

// ---- 1. 侧车 JSON 往返 ----
const text = '# 标题\n\n第一段提到了 alpha 实验的设计，第二句补充了 beta 条件。\n\n第二段引用 gamma 结果。\n'
const store = emptyStore()
const first = createComment(store, { author: { name: 'Alice Chen', email: 'alice@example.edu' }, body: '这里要补引用。', start: 14, end: 25, text })
const reply = createReply(store, first.id, { author: { name: 'Bob Wu' }, body: '下一版补上。', text })
check('anchor quote matches the source text', first.anchor.quote === text.slice(14, 25), JSON.stringify(first.anchor.quote))
check('reply links to the root', reply.parentId === first.id, String(reply.parentId))
check('author gets initials and a colour', first.author.initials === 'AC' && /^#[0-9a-f]{6}$/u.test(first.author.color), JSON.stringify(first.author))
const parsed = parseStore(serializeStore(store))
const parsedRoot = parsed.comments.find((comment) => comment.id === first.id)
check('store survives JSON round trip', parsed.comments.length === 2 && parsedRoot !== undefined && parsedRoot.anchor.quote === first.anchor.quote, JSON.stringify(parsed.comments.map((comment) => comment.id)))
check('root sorts before its reply at the same position', parsed.comments[0].id === first.id, JSON.stringify(parsed.comments.map((comment) => ({ id: comment.id, parentId: comment.parentId }))))
check('serialized JSON is stable and ends with a newline', serializeStore(store) === serializeStore(parseStore(serializeStore(store))), '')
check('threads group the reply under the root', buildThreads(parsed.comments).length === 1 && buildThreads(parsed.comments)[0].replies.length === 1, '')

// ---- 2. 锚点重定位 ----
const shifted = '\n\n' + text
const shiftedResult = resolveAnchor(shifted, first.anchor)
check('anchor follows text inserted before it', shiftedResult.status === 'moved' && shifted.slice(shiftedResult.start, shiftedResult.end) === first.anchor.quote, JSON.stringify(shiftedResult))
const edited = text.replace('第一段提到了 alpha', '第一段里提到了 alpha')
const editedResult = resolveAnchor(edited, first.anchor)
const editedQuote = editedResult.start === null ? '' : edited.slice(editedResult.start, editedResult.end)
check('anchor survives edits inside its prefix', editedResult.status === 'moved' && editedQuote === first.anchor.quote, JSON.stringify({ status: editedResult.status, quote: editedQuote }))
const deleted = text.replace(first.anchor.quote, '被删掉的一段')
const deletedResult = resolveAnchor(deleted, first.anchor)
check('anchor is reported lost when its text is gone', deletedResult.status === 'lost' && deletedResult.start === null, JSON.stringify(deletedResult))

const store2 = parseStore(serializeStore(store))
const stats = resolveStore(store2, shifted)
check('resolveStore reports moved anchors', stats.moved === 2 && stats.lost === 0, JSON.stringify(stats))
const resolvedRoot = store2.comments.find((comment) => comment.id === first.id)
check('resolveStore rewrites the offsets', shifted.slice(resolvedRoot.anchor.start, resolvedRoot.anchor.end) === first.anchor.quote, '')

// ---- 3. 编辑 / 解决 / 删除 ----
editComment(store2, first.id, '改过的正文。')
const editedRoot = store2.comments.find((comment) => comment.id === first.id)
check('editing a comment updates body and timestamp', editedRoot.body === '改过的正文。' && Date.parse(editedRoot.modifiedAt) > Date.parse(editedRoot.createdAt), JSON.stringify({ createdAt: editedRoot.createdAt, modifiedAt: editedRoot.modifiedAt }))
setResolved(store2, first.id, true)
check('resolving a thread sets the root flag', store2.comments.find((comment) => comment.id === first.id).resolved === true, '')
setResolved(store2, first.id, false)
check('reopening clears the flag', store2.comments.find((comment) => comment.id === first.id).resolved === false, '')
setResolved(store2, reply.id, true)
check('resolving a reply targets the thread root', store2.comments.find((comment) => comment.id === first.id).resolved === true, '')
setResolved(store2, reply.id, false)
check('reopening from a reply also targets the root', store2.comments.find((comment) => comment.id === first.id).resolved === false, '')
deleteComment(store2, reply.id)
const visibleAfterDelete = buildThreads(store2.comments)
check('deleted replies disappear from threads', visibleAfterDelete[0].replies.length === 0 && store2.comments.find((comment) => comment.id === reply.id).deleted === true, JSON.stringify({ replies: visibleAfterDelete[0].replies.length, deleted: store2.comments.find((comment) => comment.id === reply.id).deleted }))
deleteComment(store2, first.id)
check('deleting a root cascades to its replies', store2.comments.filter((comment) => comment.deleted === true).length === 2 && buildThreads(store2.comments).length === 0, String(store2.comments.filter((comment) => comment.deleted === true).length))

// ---- 4. 多用户合并 ----
const userA = parseStore(serializeStore(store))
const userB = parseStore(serializeStore(store))
const addedByB = createComment(userB, { author: { name: 'Carol' }, body: 'B 新加的批注。', start: 40, end: 46, text })
editComment(userB, first.id, 'B 改过的正文。')
const merged = mergeStores(userA, userB)
check('merge keeps both users\' comments', merged.comments.length === 3, String(merged.comments.length))
check('merge takes the newer edit', merged.comments.find((comment) => comment.id === first.id).body === 'B 改过的正文。', '')
const syncA = parseStore(serializeStore(merged))
deleteComment(syncA, addedByB.id)
const mergedAfterDelete = mergeStores(syncA, userB)
check('merge propagates deletion tombstones', mergedAfterDelete.comments.find((comment) => comment.id === addedByB.id).deleted === true, JSON.stringify(mergedAfterDelete.comments.find((comment) => comment.id === addedByB.id)?.deleted))
const staleEdit = parseStore(serializeStore(store))
editComment(staleEdit, first.id, 'A 的旧改法。')
staleEdit.comments.find((comment) => comment.id === first.id).modifiedAt = '2000-01-01T00:00:00.000Z'
const mergedConflict = mergeStores(merged, staleEdit)
check('a stale edit never overwrites a newer one', mergedConflict.comments.find((comment) => comment.id === first.id).body === 'B 改过的正文。', JSON.stringify(mergedConflict.comments.find((comment) => comment.id === first.id)?.body))

// ---- 5. docx 互通 ----
const SOURCE = 'E:/hermes_playground/docx-testbed/test_with_comments.docx'
const sourceBuffer = readFileSync(SOURCE)
const docxResult = readDocxComments(sourceBuffer)
const fromDocx = fromDocxComments(docxResult)
const docxNodeCount = docxResult.comments.length + docxResult.comments.reduce((total, thread) => total + thread.replies.length, 0)
check('fromDocxComments keeps every comment', fromDocx.comments.length === docxNodeCount, JSON.stringify({ store: fromDocx.comments.length, docx: docxNodeCount }))
const repliesInStore = fromDocx.comments.filter((comment) => comment.parentId !== null)
check('fromDocxComments maps durableIds and parents', repliesInStore.length > 0 && fromDocx.comments.every((comment) => /^c_[0-9A-F]{8}$/u.test(comment.id)) && repliesInStore.every((comment) => fromDocx.comments.some((other) => other.id === comment.parentId)), JSON.stringify(repliesInStore.slice(0, 2).map((comment) => ({ id: comment.id, parentId: comment.parentId }))))
const storeThreads = buildThreads(fromDocx.comments)
check('threads survive the docx import', storeThreads.length === docxResult.comments.length && storeThreads.some((thread) => thread.replies.length > 0), JSON.stringify({ threads: storeThreads.length, withReplies: storeThreads.filter((thread) => thread.replies.length > 0).length }))

const emptyQuotes = fromDocx.comments.filter((comment) => comment.anchor.quote === '').length
const mapStats = mapDocxAnchorsToMarkdown(fromDocx, docxResult.text, docxResult.text)
check('mapping docx anchors onto the same text is exact', mapStats.lost === emptyQuotes && mapStats.mapped === fromDocx.comments.length - emptyQuotes, JSON.stringify({ ...mapStats, emptyQuotes }))

const storeForDocx = emptyStore()
const needle = 'Centre for Cognitive and Brain Sciences'
const anchorStart = docxResult.text.indexOf(needle)
const c1 = createComment(storeForDocx, { author: { name: 'Alice Chen', initials: 'AC' }, body: '根批注。', start: anchorStart, end: anchorStart + needle.length, text: docxResult.text })
createReply(storeForDocx, c1.id, { author: { name: 'Bob Wu', initials: 'BW' }, body: '回复。', text: docxResult.text })
setResolved(storeForDocx, c1.id, true)
const exported = exportDocxComments(sourceBuffer, toDocxComments(storeForDocx))
const out = 'E:/hermes_playground/.dsh-scratch/word-comments/model-roundtrip.docx'
writeFileSync(out, exported)
const back = readDocxComments(exported)
check('model → docx keeps both comments', back.comments.length === 1 && back.comments[0].replies.length === 1, JSON.stringify({ threads: back.comments.length, replies: back.comments[0]?.replies.length }))
check('model → docx keeps the resolved flag', back.comments[0].resolved === true, '')
check('model → docx keeps the anchored text', back.comments[0].anchor.quote === needle, JSON.stringify(back.comments[0].anchor.quote))
check('model → docx keeps the author', back.comments[0].author === 'Alice Chen' && back.comments[0].replies[0].author === 'Bob Wu', JSON.stringify([back.comments[0].author, back.comments[0].replies[0].author]))
check('durableId is normalised below 0x80000000', normalizeDurableId('FFFFFFFF') === '7FFFFFFF' && normalizeDurableId('c_37B0C978') === '37B0C978', JSON.stringify([normalizeDurableId('FFFFFFFF'), normalizeDurableId('c_37B0C978')]))

console.log('MODEL: ' + results.filter(Boolean).length + '/' + results.length + ' ok')
console.log('round-trip docx:', out)
process.exit(results.every(Boolean) ? 0 : 1)
