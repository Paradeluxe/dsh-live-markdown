/**
 * 复制/粘贴批注：对标 Word 的「复制带批注的文字，批注一起走」。
 *
 * 复制时把选区里的批注打包成一份相对选区的 payload（`text/x-ghmd-comments+json`），
 * 同时写普通 text/plain 保证其它应用照常粘贴；粘贴时若剪贴板里有这份 payload，
 * 就把文字插进去、把批注按相对偏移挂回文档，id 重新分配、回复关系保持。
 *
 * 注意：这里只处理「我们自己的 payload」。从 Word 复制进来的批注不走这条路径
 * （那需要解析 Word 的剪贴板格式，尚未实现）。
 */
export const CLIPBOARD_MIME = 'text/x-ghmd-comments+json'

/**
 * 生成复制 payload。
 * @param {string} text 整篇正文
 * @param {Array<object>} comments 侧车里的批注
 * @param {number} from 选区起点
 * @param {number} to 选区终点
 * @returns {{ version: number, text: string, comments: Array<object> } | null}
 */
export function buildCopyPayload(text, comments, from, to) {
  const start = Math.max(0, Math.min(from, to))
  const end = Math.max(start, Math.min(Math.max(from, to), text.length))
  if (end <= start) return null
  const source = text.slice(start, end)
  const picked = comments.filter((comment) => comment.deleted !== true)
  const ids = new Set(picked.map((comment) => comment.id))
  const selected = []
  for (const comment of picked) {
    const anchorStart = comment.anchor.start
    if (anchorStart === null || anchorStart === undefined) continue
    const anchorEnd = comment.anchor.end ?? anchorStart
    // 与选区有交集（0 长度锚点在选区内也算）
    const intersects = anchorStart === anchorEnd
      ? anchorStart >= start && anchorStart <= end
      : anchorEnd > start && anchorStart < end
    if (intersects === false) continue
    const relStart = Math.max(0, anchorStart - start)
    const relEnd = Math.max(relStart, Math.min(anchorEnd - start, source.length))
    selected.push({
      id: comment.id,
      parentId: comment.parentId !== null && ids.has(comment.parentId) ? comment.parentId : null,
      author: { ...comment.author },
      body: comment.body,
      resolved: comment.resolved === true,
      createdAt: comment.createdAt,
      modifiedAt: comment.modifiedAt,
      anchor: { start: relStart, end: relEnd, quote: source.slice(relStart, relEnd) },
    })
  }
  return { version: 1, text: source, comments: selected }
}

/**
 * 把 payload 里的批注挂到目标文档的 store 上（锚点按插入位置平移）。
 * @param {object} store 目标侧车
 * @param {object} payload buildCopyPayload 的结果
 * @param {number} insertAt 文字插入的位置
 * @returns {Array<object>} 新建的批注
 */
export function applyPastePayload(store, payload, insertAt) {
  if (payload === null || payload === undefined || Array.isArray(payload.comments) === false) return []
  const base = Math.max(0, Number(insertAt) || 0)
  const idMap = new Map()
  const created = []
  // 先建根，再建回复，保证 parentId 能映射到新 id
  const ordered = [...payload.comments].sort((left, right) => (left.parentId === null ? 0 : 1) - (right.parentId === null ? 0 : 1))
  for (const item of ordered) {
    const comment = {
      id: nextId(store, created),
      paraId: null,
      durableId: null,
      parentId: null,
      resolved: item.resolved === true,
      deleted: false,
      deletedAt: null,
      author: item.author,
      createdAt: item.createdAt ?? new Date().toISOString(),
      modifiedAt: item.modifiedAt ?? new Date().toISOString(),
      body: item.body ?? '',
      anchor: {
        start: base + (item.anchor?.start ?? 0),
        end: base + (item.anchor?.end ?? item.anchor?.start ?? 0),
        quote: item.anchor?.quote ?? '',
        prefix: '',
        suffix: '',
      },
      pasted: true,
    }
    if (item.parentId !== null && item.parentId !== undefined) {
      const mapped = idMap.get(item.parentId)
      comment.parentId = mapped ?? null
      if (mapped === undefined) continue
    }
    idMap.set(item.id, comment.id)
    store.comments.push(comment)
    created.push(comment)
  }
  store.comments.sort((left, right) => (left.anchor.start ?? 0) - (right.anchor.start ?? 0))
  return created
}

let counter = 0

function nextId(store, created) {
  const taken = new Set([...store.comments.map((comment) => comment.id), ...created.map((comment) => comment.id)])
  for (;;) {
    counter = (counter + 1) % 0xffffff
    const id = 'c_' + Date.now().toString(36).toUpperCase() + counter.toString(36).toUpperCase()
    if (taken.has(id) === false) return id
  }
}
