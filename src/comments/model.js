/**
 * markdown 侧的批注模型 + 侧车文件（<doc>.comments.json）。
 *
 * 设计要点：
 *  - 正文一个字都不改，批注全放侧车；
 *  - 锚点同时存「偏移 + 原文 + 前后文」，偏移失效时用 quote+prefix/suffix 重新定位（W3C Web Annotation 的组合选择器）；
 *  - 线程与 Word 一致：根批注带 resolved，回复挂在 parentId 下；删除用墓碑（deleted 标记），便于多用户合并；
 *  - 与 docx 互通：toDocxComments / fromDocxComments，字段与 docx-export.js 对齐。
 */

export const COMMENT_STORE_VERSION = 1
export const CONTEXT_CHARS = 32

const AUTHOR_COLORS = ['#8b6cef', '#2f81f7', '#1a7f37', '#bf8700', '#cf222e', '#8250df', '#0969da', '#bc4c00']

/** 稳定 id：c_ + 8 位 hex（与 docx 的 durableId 同形，方便互通）。 */
export function makeCommentId(random = Math.random) {
  let value = 0
  for (let index = 0; index < 8; index += 1) value = (value << 4) | Math.floor(random() * 16)
  return 'c_' + (value >>> 0).toString(16).toUpperCase().padStart(8, '0')
}

export function shortHash(value) {
  let hash = 2166136261
  for (const char of String(value)) {
    hash ^= char.codePointAt(0)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash >>> 0
}

/** 作者颜色：按名字散列固定取色（Word 也是按作者固定一个头像色）。 */
export function authorColor(name) {
  return AUTHOR_COLORS[shortHash(name) % AUTHOR_COLORS.length]
}

export function initialsOf(name) {
  const value = String(name ?? '').trim()
  if (value === '') return '?'
  const parts = value.split(/[\s._-]+/u).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return value.slice(0, 2).toUpperCase()
}

/** 把作者信息规范成 { name, initials, email, color }。 */
export function normalizeAuthor(input) {
  const name = String(input?.name ?? input ?? '').trim()
  return {
    name,
    initials: String(input?.initials ?? initialsOf(name)),
    email: input?.email ?? null,
    color: input?.color ?? authorColor(name),
  }
}

function sortByPosition(left, right) {
  const leftStart = left.anchor?.start ?? Number.MAX_SAFE_INTEGER
  const rightStart = right.anchor?.start ?? Number.MAX_SAFE_INTEGER
  if (leftStart !== rightStart) return leftStart - rightStart
  // 同一位置的批注：根排回复前面（和 Word 的 comments.xml 顺序一致）
  const leftRoot = left.parentId === null || left.parentId === undefined
  const rightRoot = right.parentId === null || right.parentId === undefined
  if (leftRoot !== rightRoot) return leftRoot ? -1 : 1
  const byTime = String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''))
  if (byTime !== 0) return byTime
  return String(left.id).localeCompare(String(right.id))
}

export function emptyStore() {
  return { version: COMMENT_STORE_VERSION, documentHash: null, comments: [] }
}

/** 解析侧车 JSON（容忍缺字段），返回规范化的 store。 */
export function parseStore(input) {
  const raw = typeof input === 'string' ? JSON.parse(input) : (input ?? {})
  const version = Number(raw.version ?? COMMENT_STORE_VERSION)
  const comments = Array.isArray(raw.comments) ? raw.comments.map((comment) => ({
    id: String(comment.id ?? makeCommentId()),
    paraId: comment.paraId ?? null,
    durableId: comment.durableId ?? null,
    parentId: comment.parentId === null || comment.parentId === undefined ? null : String(comment.parentId),
    resolved: comment.resolved === true,
    deleted: comment.deleted === true,
    deletedAt: comment.deletedAt ?? null,
    author: normalizeAuthor(comment.author),
    createdAt: comment.createdAt ?? new Date().toISOString(),
    modifiedAt: comment.modifiedAt ?? comment.createdAt ?? new Date().toISOString(),
    body: String(comment.body ?? ''),
    anchor: normalizeAnchor(comment.anchor),
  })) : []
  return { version, documentHash: raw.documentHash ?? null, comments: comments.sort(sortByPosition) }
}

function normalizeAnchor(anchor) {
  if (anchor === null || anchor === undefined) return { start: null, end: null, quote: '', prefix: '', suffix: '' }
  const start = Number.isInteger(anchor.start) ? anchor.start : null
  const end = Number.isInteger(anchor.end) ? anchor.end : start
  return {
    start,
    end,
    quote: String(anchor.quote ?? ''),
    prefix: String(anchor.prefix ?? ''),
    suffix: String(anchor.suffix ?? ''),
  }
}

/** 序列化成稳定的 JSON 文本（排序 + 固定键序，git 友好）。 */
export function serializeStore(store) {
  const comments = store.comments
    .slice()
    .sort(sortByPosition)
    .map((comment) => ({
      id: comment.id,
      paraId: comment.paraId ?? null,
      durableId: comment.durableId ?? null,
      parentId: comment.parentId ?? null,
      resolved: comment.resolved === true,
      deleted: comment.deleted === true ? true : undefined,
      deletedAt: comment.deleted ? comment.deletedAt ?? null : undefined,
      author: normalizeAuthor(comment.author),
      createdAt: comment.createdAt,
      modifiedAt: comment.modifiedAt,
      body: comment.body,
      anchor: {
        start: comment.anchor?.start ?? null,
        end: comment.anchor?.end ?? null,
        quote: comment.anchor?.quote ?? '',
        prefix: comment.anchor?.prefix ?? '',
        suffix: comment.anchor?.suffix ?? '',
      },
    }))
  const clean = JSON.stringify({ version: COMMENT_STORE_VERSION, documentHash: store.documentHash ?? null, comments }, (key, value) => (value === undefined ? undefined : value), 2)
  return clean + '\n'
}

/** 在 text 里给 start/end 补上 quote 与前后文。 */
export function anchorAt(text, start, end) {
  const safeStart = Math.max(0, Math.min(start, text.length))
  const safeEnd = Math.max(safeStart, Math.min(end, text.length))
  return {
    start: safeStart,
    end: safeEnd,
    quote: text.slice(safeStart, safeEnd),
    prefix: text.slice(Math.max(0, safeStart - CONTEXT_CHARS), safeStart),
    suffix: text.slice(safeEnd, Math.min(text.length, safeEnd + CONTEXT_CHARS)),
  }
}

function commonSuffixLength(left, right) {
  let count = 0
  while (count < left.length && count < right.length && left[left.length - 1 - count] === right[right.length - 1 - count]) count += 1
  return count
}

function commonPrefixLength(left, right) {
  let count = 0
  while (count < left.length && count < right.length && left[count] === right[count]) count += 1
  return count
}

/**
 * 把锚点对到当前 text 上。
 * @returns {{ start: number, end: number, status: 'ok'|'moved'|'lost' }}
 */
export function resolveAnchor(text, anchor) {
  if (anchor === null || anchor === undefined || anchor.quote === '') {
    return { start: anchor?.start ?? null, end: anchor?.end ?? null, status: anchor?.start === null || anchor?.start === undefined ? 'lost' : 'ok' }
  }
  const { quote, prefix, suffix } = anchor
  if (anchor.start !== null && anchor.start !== undefined) {
    const candidate = text.slice(anchor.start, anchor.start + quote.length)
    if (candidate === quote) return { start: anchor.start, end: anchor.start + quote.length, status: 'ok' }
  }
  const candidates = []
  let index = text.indexOf(quote)
  while (index >= 0) {
    candidates.push(index)
    if (candidates.length >= 64) break
    index = text.indexOf(quote, index + 1)
  }
  if (candidates.length === 0) return { start: null, end: null, status: 'lost' }
  let best = candidates[0]
  let bestScore = -1
  for (const candidate of candidates) {
    const before = text.slice(Math.max(0, candidate - prefix.length), candidate)
    const after = text.slice(candidate + quote.length, candidate + quote.length + suffix.length)
    const score = commonSuffixLength(before, prefix) + commonPrefixLength(after, suffix)
    const distance = anchor.start === null || anchor.start === undefined ? 0 : Math.abs(candidate - anchor.start)
    if (score > bestScore || (score === bestScore && distance < Math.abs(best - (anchor.start ?? 0)))) {
      best = candidate
      bestScore = score
    }
    void before
  }
  return { start: best, end: best + quote.length, status: best === anchor.start ? 'ok' : 'moved' }
}

/**
 * 对整份 store 做锚点重定位，返回统计。
 * 找到的会写回 start/end；找不到的保留 quote 并标记 lost（不静默丢批注）。
 */
export function resolveStore(store, text) {
  const stats = { ok: 0, moved: 0, lost: 0 }
  for (const comment of store.comments) {
    if (comment.deleted) continue
    const result = resolveAnchor(text, comment.anchor)
    if (result.status === 'lost') {
      stats.lost += 1
      comment.anchor = { ...comment.anchor, start: null, end: null }
      continue
    }
    stats[result.status] += 1
    if (result.start !== comment.anchor.start || result.end !== comment.anchor.end) {
      comment.anchor = { ...comment.anchor, start: result.start, end: result.end }
    }
  }
  return stats
}

/** 按引用关系组装线程：根 + replies（有序）。 */
export function buildThreads(comments) {
  const visible = comments.filter((comment) => comment.deleted !== true)
  const byId = new Map(visible.map((comment) => [comment.id, comment]))
  const roots = []
  const repliesByParent = new Map()
  for (const comment of visible) {
    if (comment.parentId !== null && comment.parentId !== undefined && byId.has(comment.parentId)) {
      if (!repliesByParent.has(comment.parentId)) repliesByParent.set(comment.parentId, [])
      repliesByParent.get(comment.parentId).push(comment)
    } else {
      roots.push(comment)
    }
  }
  for (const root of roots) {
    const replies = repliesByParent.get(root.id) ?? []
    replies.sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))
    root.replies = replies
  }
  return roots.sort(sortByPosition)
}

/** 单调时间戳：同一毫秒内连续修改也要能排序，否则合并时「谁更新」会打平。 */
function nextIso(previous) {
  const now = Date.now()
  const previousTime = Date.parse(previous ?? '') || 0
  return new Date(Math.max(now, previousTime + 1)).toISOString()
}

function touch(comment) {
  comment.modifiedAt = nextIso(comment.modifiedAt)
}

/** 新建一条根批注。 */
export function createComment(store, { author, body, start, end, text, id }) {
  const comment = {
    id: id ?? makeCommentId(),
    paraId: null,
    durableId: null,
    parentId: null,
    resolved: false,
    deleted: false,
    deletedAt: null,
    author: normalizeAuthor(author),
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
    body: String(body ?? ''),
    anchor: text === undefined ? normalizeAnchor({ start, end }) : anchorAt(text, start ?? 0, end ?? start ?? 0),
  }
  store.comments.push(comment)
  store.comments.sort(sortByPosition)
  return comment
}

/** 回复：挂在根批注下（Word 里回复就是另一条批注）。 */
export function createReply(store, parentId, { author, body, text, id }) {
  const parent = store.comments.find((comment) => comment.id === parentId)
  if (parent === undefined) throw new Error('comment not found: ' + parentId)
  const root = parent.parentId === null ? parent : store.comments.find((comment) => comment.id === parent.parentId) ?? parent
  const reply = {
    id: id ?? makeCommentId(),
    paraId: null,
    durableId: null,
    parentId: root.id,
    resolved: false,
    deleted: false,
    deletedAt: null,
    author: normalizeAuthor(author),
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
    body: String(body ?? ''),
    anchor: root.anchor.quote === '' || text === undefined ? { ...root.anchor } : anchorAt(text, root.anchor.start, root.anchor.end),
  }
  store.comments.push(reply)
  return reply
}

/**
 * 把丢失锚点的批注重新挂到一段文字上（Word 的批注气泡可以拖到别处，这里用「挂到选区」代替）。
 * @param {object} store
 * @param {string} id
 * @param {string} text 当前正文
 * @param {number} from
 * @param {number} to
 * @returns {object|null}
 */
export function reattachComment(store, id, text, from, to) {
  const comment = store.comments.find((item) => item.id === id)
  if (comment === undefined) return null
  if (to <= from) return null
  comment.anchor = anchorAt(text, from, to)
  comment.anchorStatus = 'mapped'
  touch(comment)
  // 回复跟根批注共用同一段原文（Word 里回复本来就挂在同一个 Scope 上）
  if (comment.parentId === null || comment.parentId === undefined) {
    for (const reply of store.comments) {
      if (reply.parentId !== comment.id || reply.deleted === true) continue
      reply.anchor = anchorAt(text, from, to)
      reply.anchorStatus = 'mapped'
      touch(reply)
    }
  }
  return comment
}

/**
 * 能不能改这条批注的正文：Word 里只有作者能改自己的批注文字（别人可以回复、可以删除）。
 * @param {object} comment
 * @param {string} authorName 当前署名
 * @returns {boolean}
 */
export function canEditComment(comment, authorName) {
  if (comment === null || comment === undefined || comment.deleted === true) return false
  const mine = comment.author === null || comment.author === undefined ? '' : String(comment.author.name ?? '')
  return mine !== '' && mine === String(authorName ?? '')
}

export function editComment(store, id, body) {
  const comment = store.comments.find((item) => item.id === id)
  if (comment === undefined) return null
  comment.body = String(body ?? '')
  touch(comment)
  return comment
}

/** 解决/重新打开：Word 的 done 写在线程根上，回复跟着根走。 */
export function setResolved(store, id, resolved = true) {
  const comment = store.comments.find((item) => item.id === id)
  if (comment === undefined) return null
  const root = comment.parentId === null ? comment : store.comments.find((item) => item.id === comment.parentId) ?? comment
  root.resolved = resolved === true
  touch(root)
  return root
}

/** 删除：根批注级联回复；留下墓碑以便多用户合并时把删除传播出去。 */
export function deleteComment(store, id) {
  const comment = store.comments.find((item) => item.id === id)
  if (comment === undefined) return 0
  const now = new Date().toISOString()
  const targets = [comment, ...store.comments.filter((item) => item.parentId === comment.id)]
  for (const target of targets) {
    target.deleted = true
    target.deletedAt = now
    target.modifiedAt = now
  }
  return targets.length
}

/**
 * 多用户合并：按 id 对齐，取 modifiedAt 更新的一份；墓碑优先（删除要传播）。
 * 同一个锚点被多人各加一条批注时会都保留（Word 也是这样）。
 */
export function mergeStores(left, right) {
  const byId = new Map()
  for (const comment of left.comments) byId.set(comment.id, comment)
  for (const incoming of right.comments) {
    const existing = byId.get(incoming.id)
    if (existing === undefined) {
      byId.set(incoming.id, incoming)
      continue
    }
    byId.set(incoming.id, chooseNewer(existing, incoming))
  }
  return { version: COMMENT_STORE_VERSION, documentHash: right.documentHash ?? left.documentHash ?? null, comments: Array.from(byId.values()).sort(sortByPosition) }
}

function chooseNewer(existing, incoming) {
  if (existing.deleted === true && incoming.deleted !== true) return existing
  if (incoming.deleted === true && existing.deleted !== true) return incoming
  const existingTime = Date.parse(existing.modifiedAt) || 0
  const incomingTime = Date.parse(incoming.modifiedAt) || 0
  if (incomingTime !== existingTime) return incomingTime > existingTime ? incoming : existing
  if (incoming.resolved !== existing.resolved) return incoming.resolved ? incoming : existing
  return String(incoming.body).length >= String(existing.body).length ? incoming : existing
}

/**
 * 转成 docx-export.js 需要的结构（数字 id 用于 w:id，durableId 用于 commentsIds）。
 * 回复的 resolved 恒为 false：done 只写在线程根上。
 */
export function toDocxComments(store) {
  const visible = store.comments.filter((comment) => comment.deleted !== true)
  const roots = visible.filter((comment) => comment.parentId === null || comment.parentId === undefined)
  const replies = visible.filter((comment) => comment.parentId !== null && comment.parentId !== undefined)
  const ordered = []
  for (const root of roots.sort(sortByPosition)) {
    ordered.push(root)
    for (const reply of replies.filter((item) => item.parentId === root.id)) ordered.push(reply)
  }
  for (const reply of replies) if (!ordered.includes(reply)) ordered.push(reply)
  const idMap = new Map()
  let nextId = 1
  for (const comment of ordered) idMap.set(comment.id, nextId++)
  return ordered.map((comment) => ({
    id: idMap.get(comment.id),
    author: comment.author.name,
    initials: comment.author.initials,
    email: comment.author.email ?? null,
    createdAt: comment.createdAt,
    date: null,
    resolved: comment.parentId === null ? comment.resolved === true : false,
    parentId: comment.parentId === null || comment.parentId === undefined ? null : idMap.get(comment.parentId) ?? null,
    body: comment.body,
    durableId: normalizeDurableId(comment.durableId ?? comment.id),
    paraId: null,
    anchor: { start: comment.anchor.start ?? 0, end: comment.anchor.end ?? comment.anchor.start ?? 0 },
  }))
}

/** docx 的 durableId/paraId 是 8 位 hex 且最高位为 0；从我们的 id（c_XXXXXXXX）里取出来。 */
export function normalizeDurableId(value) {
  const hex = String(value ?? '').replace(/[^0-9a-fA-F]/gu, '').toUpperCase().slice(-8)
  if (hex.length !== 8) return null
  const number = Number.parseInt(hex, 16)
  if (!Number.isFinite(number)) return null
  return (number & 0x7fffffff).toString(16).toUpperCase().padStart(8, '0')
}

/**
 * 从 docx 读取结果转成 store。
 * 锚点用的是 docx 摊平文本的偏移；要落到 markdown 上见 mapDocxAnchorsToMarkdown。
 */
export function fromDocxComments(result, { author = null } = {}) {
  const comments = []
  const idOf = (node) => 'c_' + (normalizeDurableId(node.durableId) ?? normalizeDurableId(String(node.id).padStart(8, '0').padStart(8, '0')) ?? makeCommentId().slice(2))
  const rootIdMap = new Map()
  for (const thread of result.comments) {
    const rootId = idOf(thread)
    rootIdMap.set(thread.id, rootId)
    comments.push({
      id: rootId,
      paraId: thread.paraId ?? null,
      durableId: normalizeDurableId(thread.durableId),
      parentId: null,
      resolved: thread.resolved === true,
      deleted: false,
      deletedAt: null,
      author: normalizeAuthor({ name: thread.author, initials: thread.initials, email: null }),
      createdAt: thread.dateUtc ?? thread.date ?? new Date().toISOString(),
      modifiedAt: thread.dateUtc ?? thread.date ?? new Date().toISOString(),
      body: thread.body,
      anchor: { start: thread.anchor?.start ?? null, end: thread.anchor?.end ?? null, quote: thread.anchor?.quote ?? '', prefix: '', suffix: '' },
    })
    for (const reply of thread.replies) {
      comments.push({
        id: idOf(reply),
        paraId: reply.paraId ?? null,
        durableId: normalizeDurableId(reply.durableId),
        parentId: rootId,
        resolved: false,
        deleted: false,
        deletedAt: null,
        author: normalizeAuthor({ name: reply.author, initials: reply.initials, email: null }),
        createdAt: reply.dateUtc ?? reply.date ?? new Date().toISOString(),
        modifiedAt: reply.dateUtc ?? reply.date ?? new Date().toISOString(),
        body: reply.body,
        anchor: { start: reply.anchor?.start ?? null, end: reply.anchor?.end ?? null, quote: reply.anchor?.quote ?? '', prefix: '', suffix: '' },
      })
    }
  }
  void author
  return { version: COMMENT_STORE_VERSION, documentHash: null, comments: comments.sort(sortByPosition) }
}

/**
 * 把 docx 文本上的锚点映射到 markdown 文本。
 * 先按 quote 直接找；找不到再按「docx 段落文本 → markdown 里的同一段」估算偏移。
 * 返回每条批注的 status：mapped / approx / lost。
 */
export function mapDocxAnchorsToMarkdown(store, docxText, markdownText) {
  const paragraphStarts = []
  let offset = 0
  for (const line of docxText.split('\n')) {
    paragraphStarts.push(offset)
    offset += line.length + 1
  }
  const paragraphIndexAt = (position) => {
    let low = 0
    let high = paragraphStarts.length - 1
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (paragraphStarts[mid] <= position) low = mid
      else high = mid - 1
    }
    return low
  }
  const stats = { mapped: 0, approx: 0, lost: 0 }
  for (const comment of store.comments) {
    const quote = comment.anchor.quote
    if (quote === '') {
      comment.anchor = { ...comment.anchor, start: null, end: null }
      comment.anchorStatus = 'lost'
      stats.lost += 1
      continue
    }
    const direct = markdownText.indexOf(quote)
    if (direct >= 0) {
      comment.anchor = anchorAt(markdownText, direct, direct + quote.length)
      comment.anchorStatus = 'mapped'
      stats.mapped += 1
      continue
    }
    // 近似：找到 docx 里含该 quote 的段落，再在 markdown 里找段落文本（去掉 markdown 标记后比较长度）
    const position = comment.anchor.start ?? 0
    const paragraphIndex = paragraphIndexAt(position)
    const paragraphText = docxText.split('\n')[paragraphIndex] ?? ''
    if (paragraphText !== '') {
      const needle = paragraphText.trim().slice(0, 40)
      const found = needle === '' ? -1 : markdownText.indexOf(needle)
      if (found >= 0) {
        const located = markdownText.indexOf(quote, found)
        if (located >= 0 && located < found + paragraphText.length + 40) {
          comment.anchor = anchorAt(markdownText, located, located + quote.length)
          comment.anchorStatus = 'approx'
          stats.approx += 1
          continue
        }
      }
    }
    comment.anchor = { ...comment.anchor, start: null, end: null }
    comment.anchorStatus = 'lost'
    stats.lost += 1
  }
  return stats
}
