import { readFileSync } from 'node:fs'
import { readDocxComments } from '../src/comments/docx-comments.js'

const path = process.argv[2]
const result = readDocxComments(readFileSync(path))
const nodes = result.comments.flatMap((thread) => [thread, ...thread.replies])
console.log('threads=' + result.comments.length + ' nodes=' + nodes.length)
for (const thread of result.comments) {
  console.log(JSON.stringify({
    id: thread.id,
    paraId: thread.paraId,
    resolved: thread.resolved,
    author: thread.author,
    replies: thread.replies.map((reply) => ({ id: reply.id, done: reply.resolved, parentId: reply.parentId, author: reply.author })),
  }))
}
console.log('nodes with resolved=' + nodes.filter((node) => node.resolved).length)
