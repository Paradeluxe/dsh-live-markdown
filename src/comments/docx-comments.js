/**
 * 从 docx 里读出 Word 批注（comments.xml / commentsExtended.xml / commentsIds.xml /
 * commentsExtensible.xml / people.xml），并把正文锚点换算成纯文本偏移。
 *
 * 只依赖 node:zlib（见 ./zip.js），不执行任何文档里的代码，也不写文件。
 */
import { openZip } from './zip.js'

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** 解 XML 实体：命名实体 + 十进制/十六进制数字实体。 */
export function decodeXmlEntities(value) {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/gu, (match, token) => {
    if (token.startsWith('#x') || token.startsWith('#X')) return String.fromCodePoint(Number.parseInt(token.slice(2), 16))
    if (token.startsWith('#')) return String.fromCodePoint(Number.parseInt(token.slice(1), 10))
    const named = XML_ENTITIES[token]
    return named === undefined ? match : named
  })
}

const ATTRIBUTE = /([A-Za-z0-9:]+)="([^"]*)"/gu

function readAttributes(tag) {
  const attributes = {}
  for (const match of tag.matchAll(ATTRIBUTE)) {
    const name = match[1]
    if (name.startsWith('xmlns')) continue
    attributes[name] = decodeXmlEntities(match[2])
  }
  return attributes
}

/** 取一个元素里的纯文本（w:t 依次拼接，w:tab/w:br 换成空白）。 */
function elementText(xml) {
  let text = ''
  const token = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/gu
  for (const match of xml.matchAll(token)) {
    if (match[1] !== undefined) text += decodeXmlEntities(match[1])
    else if (match[0].startsWith('<w:tab')) text += '\t'
    else if (match[0].startsWith('<w:br')) text += '\n'
  }
  return text
}

/**
 * 解析 word/comments.xml。
 * 一条批注 = 若干 w:p；第一段的 annotationRef 是标记，不产生文字。
 * paraId 取**最后一段**：commentsExtended 用这个 id 指代整条批注（Word 实测行为）。
 */
export function parseCommentsXml(xml) {
  const comments = []
  if (xml === null) return comments
  const body = xml.slice(xml.indexOf('<w:comments') + 1)
  const commentPattern = /<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/gu
  for (const match of body.matchAll(commentPattern)) {
    const attributes = readAttributes(match[1])
    const inner = match[2]
    const paragraphs = []
    let lastParaId = null
    for (const paragraphMatch of inner.matchAll(/<w:p\b([^>]*)>([\s\S]*?)<\/w:p>/gu)) {
      const paragraphAttributes = readAttributes(paragraphMatch[1])
      if (paragraphAttributes['w14:paraId'] !== undefined) lastParaId = paragraphAttributes['w14:paraId']
      paragraphs.push(elementText(paragraphMatch[2]))
    }
    // 自闭合段落 <w:p .../>（空段落）
    if (paragraphs.length === 0) paragraphs.push('')
    comments.push({
      id: Number(attributes['w:id'] ?? '-1'),
      author: attributes['w:author'] ?? '',
      initials: attributes['w:initials'] ?? '',
      date: attributes['w:date'] ?? null,
      paraId: lastParaId,
      paragraphs,
      body: paragraphs.join('\n\n').replace(/\n{3,}/gu, '\n\n').trimEnd(),
    })
  }
  return comments
}

/** commentsExtended：paraId → { parentParaId, done }。 */
export function parseCommentsExtendedXml(xml) {
  const extended = new Map()
  if (xml === null) return extended
  for (const match of xml.matchAll(/<w15:commentEx\b([^>]*)\/?>/gu)) {
    const attributes = readAttributes(match[1])
    const paraId = attributes['w15:paraId']
    if (paraId === undefined) continue
    extended.set(paraId, {
      parentParaId: attributes['w15:paraIdParent'] ?? null,
      done: attributes['w15:done'] === '1' || attributes['w15:done'] === 'true',
    })
  }
  return extended
}

/** commentsIds：paraId → durableId。 */
export function parseCommentsIdsXml(xml) {
  const ids = new Map()
  if (xml === null) return ids
  for (const match of xml.matchAll(/<w16cid:commentId\b([^>]*)\/?>/gu)) {
    const attributes = readAttributes(match[1])
    if (attributes['w16cid:paraId'] !== undefined && attributes['w16cid:durableId'] !== undefined) {
      ids.set(attributes['w16cid:paraId'], attributes['w16cid:durableId'])
    }
  }
  return ids
}

/** commentsExtensible：durableId → dateUtc（真正的 UTC 时间）。 */
export function parseCommentsExtensibleXml(xml) {
  const dates = new Map()
  if (xml === null) return dates
  for (const match of xml.matchAll(/<w16cex:commentExtensible\b([^>]*)\/?>/gu)) {
    const attributes = readAttributes(match[1])
    if (attributes['w16cex:durableId'] !== undefined) dates.set(attributes['w16cex:durableId'], attributes['w16cex:dateUtc'] ?? null)
  }
  return dates
}

/** people.xml：作者名 → { providerId, userId }。 */
export function parsePeopleXml(xml) {
  const people = new Map()
  if (xml === null) return people
  for (const match of xml.matchAll(/<w15:person\b([^>]*)>([\s\S]*?)<\/w15:person>/gu)) {
    const attributes = readAttributes(match[1])
    const author = attributes['w15:author']
    if (author === undefined) continue
    const info = /<w15:presenceInfo\b([^>]*)\/?>/u.exec(match[2])
    people.set(author, {
      providerId: info === null ? null : readAttributes(info[1])['w15:providerId'] ?? null,
      userId: info === null ? null : readAttributes(info[1])['w15:userId'] ?? null,
    })
  }
  return people
}

/**
 * 解析正文锚点，同时把文档摊平成纯文本。
 * 返回 { text, anchors }，anchors 里每条是 { id, start, end, marks }。
 */
export function parseDocumentAnchors(xml) {
  const reads = []
  const anchors = new Map()
  let text = ''
  if (xml === null) return { text, anchors }
  const token = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:commentRangeStart\b([^>]*)\/?>|<w:commentRangeEnd\b([^>]*)\/?>|<w:commentReference\b([^>]*)\/?>|<\/w:p>|<w:tab\/>|<w:br\/>/gu
  const ensure = (id) => {
    if (!anchors.has(id)) anchors.set(id, { id, start: null, end: null, marks: [] })
    return anchors.get(id)
  }
  for (const match of xml.matchAll(token)) {
    if (match[1] !== undefined) { text += decodeXmlEntities(match[1]); continue }
    if (match[2] !== undefined) { ensure(Number(readAttributes(match[2])['w:id'])).start = text.length; continue }
    if (match[3] !== undefined) {
      const anchor = ensure(Number(readAttributes(match[3])['w:id']))
      if (anchor.end === null) anchor.end = text.length
      continue
    }
    if (match[4] !== undefined) {
      const anchor = ensure(Number(readAttributes(match[4])['w:id']))
      anchor.marks.push(text.length)
      continue
    }
    if (match[0] === '</w:p>') { text += '\n'; continue }
    if (match[0].startsWith('<w:tab')) { text += '\t'; continue }
    if (match[0].startsWith('<w:br')) { text += '\n' }
  }
  for (const anchor of anchors.values()) {
    if (anchor.start === null && anchor.marks.length > 0) anchor.start = anchor.marks[0]
    if (anchor.end === null) anchor.end = anchor.start
  }
  return { text, anchors }
}

/** 把线程接起来：根批注带 replies，回复带 parentId。 */
export function buildThreads(comments, extended, ids, dates, people) {
  const byParaId = new Map()
  for (const comment of comments) {
    if (comment.paraId !== null) byParaId.set(comment.paraId, comment)
  }
  const nodes = comments.map((comment) => {
    const extra = comment.paraId === null ? undefined : extended.get(comment.paraId)
    const durableId = comment.paraId === null ? null : ids.get(comment.paraId) ?? null
    return {
      ...comment,
      durableId,
      dateUtc: durableId === null ? null : dates.get(durableId) ?? null,
      resolved: extra?.done === true,
      parentId: null,
      replies: [],
      identity: people.get(comment.author) ?? null,
    }
  })
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const roots = []
  for (const node of nodes) {
    const extra = node.paraId === null ? undefined : extended.get(node.paraId)
    const parentPara = extra?.parentParaId ?? null
    const parent = parentPara === null ? undefined : byParaId.get(parentPara)
    if (parent !== undefined && byId.has(parent.id)) {
      node.parentId = parent.id
      byId.get(parent.id).replies.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

/**
 * 读一份 docx 的全部批注。
 * @param {Buffer} buffer docx 字节
 * @returns {{ comments: any[], anchors: Map<number, any>, people: Map<string, any>, text: string }}
 */
export function readDocxComments(buffer) {
  const zip = openZip(buffer)
  const comments = parseCommentsXml(zip.text('word/comments.xml'))
  const extended = parseCommentsExtendedXml(zip.text('word/commentsExtended.xml'))
  const ids = parseCommentsIdsXml(zip.text('word/commentsIds.xml'))
  const dates = parseCommentsExtensibleXml(zip.text('word/commentsExtensible.xml'))
  const people = parsePeopleXml(zip.text('word/people.xml'))
  const { text, anchors } = parseDocumentAnchors(zip.text('word/document.xml'))
  const threads = buildThreads(comments, extended, ids, dates, people)
  for (const thread of threads) {
    for (const node of [thread, ...thread.replies]) {
      const anchor = anchors.get(node.id) ?? null
      node.anchor = anchor === null ? null : {
        start: anchor.start,
        end: anchor.end,
        quote: anchor.start === null || anchor.end === null ? '' : text.slice(anchor.start, anchor.end),
      }
    }
  }
  return { comments: threads, anchors, people, text, flat: comments }
}

/** 把读到的结构压成便于 diff 的摘要（测试与日志用）。 */
export function summarizeDocxComments(result) {
  const threads = result.comments
  const nodes = threads.flatMap((thread) => [thread, ...thread.replies])
  const replyCount = nodes.length - threads.length
  return {
    threads: threads.length,
    replies: replyCount,
    nodes: nodes.length,
    // 线程级：只有根批注带 w15:done。Word 的 Comment.Done 对线程内每条都返回 true，
    // 所以拿 COM 的 done 计数对照时，这个数会等于 resolvedThreads + 它们的回复数。
    resolvedThreads: threads.filter((thread) => thread.resolved).length,
    resolvedNodes: nodes.filter((node) => node.resolved).length,
    authors: Array.from(new Set(result.flat.map((comment) => comment.author))).sort(),
    emptyAnchors: nodes.filter((node) => node.anchor === null || node.anchor.quote === '').length,
    firstThread: threads[0] === undefined ? null : {
      id: threads[0].id,
      author: threads[0].author,
      date: threads[0].date,
      dateUtc: threads[0].dateUtc,
      durableId: threads[0].durableId,
      resolved: threads[0].resolved,
      quote: threads[0].anchor === null ? null : threads[0].anchor.quote,
      body: threads[0].body.slice(0, 120),
      replies: threads[0].replies.length,
    },
  }
}
