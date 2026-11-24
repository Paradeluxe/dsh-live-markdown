/**
 * 把批注写回 docx：生成 comments.xml / commentsExtended.xml / commentsIds.xml /
 * commentsExtensible.xml / people.xml，并在 document.xml 里插入
 * commentRangeStart/End + commentReference，最后重新打包。
 *
 * 锚点用**纯文本偏移**表示，和 docx-comments.js 的 parseDocumentAnchors 同一套摊平规则，
 * 所以「读出来 → 改 → 写回去」不会漂。
 */
import { openZip, readZipDirectory, readZipEntry } from './zip.js'
import { writeZip } from './zip-write.js'

const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  w14: 'http://schemas.microsoft.com/office/word/2010/wordml',
  w15: 'http://schemas.microsoft.com/office/word/2012/wordml',
  w16cid: 'http://schemas.microsoft.com/office/word/2016/wordml/cid',
  w16cex: 'http://schemas.microsoft.com/office/word/2018/wordml/cex',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
}

const CONTENT_TYPES = {
  'word/comments.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml',
  'word/commentsExtended.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml',
  'word/commentsIds.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsIds+xml',
  'word/commentsExtensible.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtensible+xml',
  'word/people.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.people+xml',
}

const RELATIONSHIPS = [
  { type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments', target: 'comments.xml' },
  { type: 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended', target: 'commentsExtended.xml' },
  { type: 'http://schemas.microsoft.com/office/2016/09/relationships/commentsIds', target: 'commentsIds.xml' },
  { type: 'http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible', target: 'commentsExtensible.xml' },
  { type: 'http://schemas.microsoft.com/office/2011/relationships/people', target: 'people.xml' },
]

const COMMENT_PARTS = ['word/comments.xml', 'word/commentsExtended.xml', 'word/commentsIds.xml', 'word/commentsExtensible.xml', 'word/people.xml']

export function escapeXml(value) {
  return String(value)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
}

/**
 * 8 位大写十六进制 paraId / durableId。
 * **实测规则**：Word 要求最高位为 0（值 < 0x80000000）。用满 32 位随机值时，
 * 约一半的批注会丢掉线程 / 已解决状态——同一份数据生成两次，一次 ancestor=1、一次 ancestor=none，
 * 差别只在这些 id 的取值。Word 自己写的 paraId 全部是 0x0..0x7 开头。
 */
export function randomParaId() {
  for (;;) {
    const value = Math.floor(Math.random() * 0x80000000) >>> 0
    if (value !== 0) return value.toString(16).toUpperCase().padStart(8, '0')
  }
}

/** 从 styles.xml 里按「样式名」反查 styleId（Word 模板里叫 commenttext / annotationreference）。 */
export function resolveStyleIds(stylesXml) {
  const result = { commentText: null, commentReference: null }
  if (stylesXml === null) return result
  for (const match of stylesXml.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/gu)) {
    const id = /w:styleId="([^"]+)"/u.exec(match[1])
    const name = /<w:name w:val="([^"]+)"\s*\/>/u.exec(match[2])
    if (id === null || name === null) continue
    const normalized = name[1].toLowerCase().replace(/\s+/gu, '')
    if (normalized === 'commenttext' || normalized === 'commenttextcomment') result.commentText = id[1]
    if (normalized === 'annotationreference' || normalized === 'commentreference') result.commentReference = id[1]
  }
  return result
}

/** 把本地时间按 Word 的习惯写成「本地时间 + Z」。 */
function wordDate(iso) {
  const date = iso === null || iso === undefined ? new Date() : new Date(iso)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}Z`
}

function utcDate(iso) {
  const date = iso === null || iso === undefined ? new Date() : new Date(iso)
  return date.toISOString().replace(/\.\d{3}Z$/u, 'Z')
}

const TOKEN = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:r(?:\s[^>]*)?>|<w:rPr>[\s\S]*?<\/w:rPr>|<\/w:r>|<\/w:p>|<w:commentRangeStart\b[^>]*\/>|<w:commentRangeEnd\b[^>]*\/>|<w:commentReference\b[^>]*\/>/gu

/** 把「解码后的字符数」换算成原始 XML 字符串里的下标（处理 &amp; 这类实体）。 */
function rawIndexForDecoded(raw, decodedIndex) {
  let decoded = 0
  let index = 0
  while (index < raw.length && decoded < decodedIndex) {
    if (raw[index] === '&') {
      const end = raw.indexOf(';', index)
      if (end > index) {
        index = end + 1
        decoded += 1
        continue
      }
    }
    index += 1
    decoded += 1
  }
  return index
}

/** 删掉已有的批注部件、锚点和关系，得到一份「干净」的 docx（用于重新导出）。 */
export function stripComments(buffer) {
  const zip = openZip(buffer)
  const entries = []
  for (const name of zip.names()) {
    if (COMMENT_PARTS.includes(name)) continue
    entries.push({ name, data: zip.bytes(name) })
  }
  const documentXml = stripAnchors(zip.text('word/document.xml'))
  const relsXml = stripRels(zip.text('word/_rels/document.xml.rels'))
  const contentTypesXml = stripContentTypes(zip.text('[Content_Types].xml'))
  return { entries, documentXml, relsXml, contentTypesXml }
}

export function stripAnchors(documentXml) {
  if (documentXml === null) return ''
  const withoutMarkers = documentXml
    .replace(/<w:commentRangeStart\b[^>]*\/>/gu, '')
    .replace(/<w:commentRangeEnd\b[^>]*\/>/gu, '')
    .replace(/<w:commentReference\b[^>]*\/>/gu, '')
  // 参考标记删掉后那个 run 可能只剩 rPr（空 run），清掉它。
  // 用「到第一个 </w:r> 为止」的匹配：run 不会嵌套，绝不能跨到后面的 run，
  // 否则会把中间的正文一起吃掉（之前用 <w:rPr>[\s\S]*?<\/w:rPr> 就踩过这个坑）。
  return withoutMarkers.replace(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/gu, (run) => {
    if (run.includes('<w:t') || run.includes('<w:tab') || run.includes('<w:br') || run.includes('<w:drawing') || run.includes('<w:pict')) return run
    return ''
  })
}

function stripRels(relsXml) {
  if (relsXml === null) return ''
  let next = relsXml
  for (const relationship of RELATIONSHIPS) {
    next = next.replace(new RegExp(`<Relationship[^>]*Target="${relationship.target.replace('.', '\\.')}"[^>]*/>`, 'gu'), '')
  }
  return next
}

function stripContentTypes(contentTypesXml) {
  if (contentTypesXml === null) return ''
  let next = contentTypesXml
  for (const name of COMMENT_PARTS) {
    next = next.replace(new RegExp(`<Override PartName="/${name.replace('.', '\\.')}"[^>]*/>`, 'gu'), '')
  }
  return next
}

/**
 * 在 document.xml 里按纯文本偏移插锚点。
 * 规则：偏移落在两段 run 之间 → 直接插在 run 前；落在某个 <w:t> 内部 → 把 run 切开。
 * @param {string} documentXml
 * @param {Array<{ id: number, start: number, end: number }>} anchors
 * @param {{ commentReferenceStyle: string|null }} styles
 */
export function injectAnchors(documentXml, anchors, styles = { commentReferenceStyle: null }) {
  const insertions = new Map()
  const add = (offset, kind, id) => {
    if (!insertions.has(offset)) insertions.set(offset, [])
    insertions.get(offset).push({ kind, id })
  }
  for (const anchor of anchors) {
    add(anchor.start, 'start', anchor.id)
    add(anchor.end, 'end', anchor.id)
  }
  if (insertions.size === 0) return documentXml
  const offsets = Array.from(insertions.keys()).sort((a, b) => a - b)
  const referenceStyle = styles.commentReferenceStyle === null || styles.commentReferenceStyle === undefined
    ? ''
    : `<w:rPr><w:rStyle w:val="${styles.commentReferenceStyle}"/></w:rPr>`

  const markers = (offset) => {
    const list = insertions.get(offset) ?? []
    let out = ''
    for (const item of list) {
      if (item.kind !== 'end') continue
      out += `<w:commentRangeEnd w:id="${item.id}"/><w:r>${referenceStyle}<w:commentReference w:id="${item.id}"/></w:r>`
    }
    for (const item of list) {
      if (item.kind === 'start') out += `<w:commentRangeStart w:id="${item.id}"/>`
    }
    return out
  }

  let textLength = 0
  let output = ''
  let lastIndex = 0
  let runProps = ''

  for (const match of documentXml.matchAll(TOKEN)) {
    const token = match[0]
    const index = match.index ?? 0
    output += documentXml.slice(lastIndex, index)
    lastIndex = index + token.length

    if (match[1] !== undefined) {
      const rawText = match[1]
      const decodedLength = rawText.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/gu, 'x').length
      const base = textLength
      const inner = offsets.filter((offset) => offset > base && offset < base + decodedLength)
      if (inner.length === 0) {
        output += token
        textLength += decodedLength
        continue
      }
      // 原始 token 自带 <w:t ...> 开标签，这里自己写第一段：开标签 → 文字 → 关标签，
      // 之后每个切点都是「关 run + 标记 + 重开 run + 开 <w:t>」，最后补剩余文字和闭标签。
      let cursorRaw = 0
      output += '<w:t xml:space="preserve">'
      for (const offset of inner) {
        const rawIndex = rawIndexForDecoded(rawText, offset - base)
        output += rawText.slice(cursorRaw, rawIndex)
        output += '</w:t></w:r>'
        output += markers(offset)
        output += `<w:r>${runProps}<w:t xml:space="preserve">`
        cursorRaw = rawIndex
      }
      output += rawText.slice(cursorRaw) + '</w:t>'
      textLength += decodedLength
      continue
    }
    if (match[0] === '<w:r>' || /^<w:r(?:\s[^>]*)?>$/u.test(match[0])) {
      // run 边界：这个位置的锚点要插在 run 前面
      if (insertions.has(textLength)) output += markers(textLength)
      runProps = ''
      output += token
      continue
    }
    if (match[0].startsWith('<w:rPr>')) {
      runProps = token
      output += token
      continue
    }
    if (match[0] === '</w:r>') {
      output += token
      continue
    }
    if (match[0] === '</w:p>') {
      if (insertions.has(textLength)) output += markers(textLength)
      output += token
      textLength += 1
      continue
    }
    if (match[0].startsWith('<w:commentRange') || match[0].startsWith('<w:commentReference')) continue
    if (match[0].startsWith('<w:tab') || match[0].startsWith('<w:br')) {
      output += token
      textLength += 1
      continue
    }
    output += token
  }
  output += documentXml.slice(lastIndex)
  return output
}

/** 生成五个批注部件的 XML。 */
export function buildCommentParts(comments, styles = { commentText: null, commentReference: null }, usedParaIds = new Set()) {
  const byId = new Map(comments.map((comment) => [comment.id, comment]))
  // Word 要求每个段落有唯一的 w14:paraId；commentEx/commentsIds 用**最后一段**的 id 指代整条批注。
  // 一段一个 id 很重要：所有段落共用一个 id 时 Word 认不出 commentEx，done / 回复线程会全部失效。
  const makeParaId = () => {
    for (;;) {
      const candidate = randomParaId()
      if (!usedParaIds.has(candidate)) {
        usedParaIds.add(candidate)
        return candidate
      }
    }
  }
  const paragraphIds = new Map()
  const paraIds = new Map()
  const durableIds = new Map()
  for (const comment of comments) {
    const body = String(comment.body ?? '').split(/\n{2,}/u)
    const ids = body.map(() => makeParaId())
    paragraphIds.set(comment.id, ids)
    paraIds.set(comment.id, ids[ids.length - 1])
    durableIds.set(comment.id, comment.durableId ?? makeParaId())
  }
  const styleIds = styles ?? { commentText: null, commentReference: null }
  const textStyle = styleIds.commentText === null ? '' : `<w:pPr><w:pStyle w:val="${styleIds.commentText}"/></w:pPr>`
  const refStyle = styleIds.commentReference === null ? '' : `<w:rPr><w:rStyle w:val="${styleIds.commentReference}"/></w:rPr>`

  const commentXml = []
  for (const comment of comments) {
    const paragraphs = String(comment.body ?? '').split(/\n{2,}/u).map((line) => line.replace(/\n/gu, ' '))
    const body = paragraphs.length === 0 ? [''] : paragraphs
    const paragraphIdList = paragraphIds.get(comment.id) ?? []
    const inner = body.map((paragraph, index) => {
      const first = index === 0
      const marks = first ? `<w:r>${refStyle}<w:annotationRef/></w:r>` : ''
      const text = paragraph === '' ? '' : `<w:r><w:t xml:space="preserve">${escapeXml(paragraph)}</w:t></w:r>`
      return `<w:p w14:paraId="${paragraphIdList[index] ?? randomParaId()}" w14:textId="77777777" w:rsidR="00000000" w:rsidRDefault="00000000">${textStyle}${marks}${text}</w:p>`
    }).join('')
    commentXml.push(`<w:comment w:id="${comment.id}" w:author="${escapeXml(comment.author ?? '')}" w:date="${comment.date ?? wordDate(comment.createdAt)}" w:initials="${escapeXml(comment.initials ?? '')}">${inner}</w:comment>`)
  }

  const commentsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments xmlns:w="${NS.w}" xmlns:w14="${NS.w14}" xmlns:mc="${NS.mc}" mc:Ignorable="w14">${commentXml.join('')}</w:comments>`

  const extended = comments.map((comment) => {
    const parent = comment.parentId === null || comment.parentId === undefined ? undefined : byId.get(comment.parentId)
    const parentAttr = parent === undefined ? '' : ` w15:paraIdParent="${paraIds.get(parent.id)}"`
    const done = comment.resolved === true ? '1' : '0'
    return `<w15:commentEx w15:paraId="${paraIds.get(comment.id)}"${parentAttr} w15:done="${done}"/>`
  }).join('')
  const commentsExtendedXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w15:commentsEx xmlns:w15="${NS.w15}" xmlns:mc="${NS.mc}" mc:Ignorable="w15">${extended}</w15:commentsEx>`

  const idsXml = comments.map((comment) => `<w16cid:commentId w16cid:paraId="${paraIds.get(comment.id)}" w16cid:durableId="${durableIds.get(comment.id)}"/>`).join('')
  const commentsIdsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w16cid:commentsIds xmlns:w16cid="${NS.w16cid}" xmlns:mc="${NS.mc}" mc:Ignorable="w16cid">${idsXml}</w16cid:commentsIds>`

  const extensible = comments.map((comment) => `<w16cex:commentExtensible w16cex:durableId="${durableIds.get(comment.id)}" w16cex:dateUtc="${comment.dateUtc ?? utcDate(comment.createdAt)}"/>`).join('')
  const commentsExtensibleXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w16cex:commentsExtensible xmlns:w16cex="${NS.w16cex}" xmlns:mc="${NS.mc}" mc:Ignorable="w16cex">${extensible}</w16cex:commentsExtensible>`

  const identities = new Map()
  for (const comment of comments) {
    const author = comment.author ?? ''
    if (author === '') continue
    const identity = comment.identity ?? (comment.email === undefined || comment.email === null ? null : {
      providerId: 'PeoplePicker',
      userId: 'S::' + comment.email + '::' + randomParaId(),
    })
    if (!identities.has(author)) identities.set(author, identity)
  }
  const people = Array.from(identities.entries()).map(([author, identity]) => {
    const presence = identity === null || identity === undefined
      ? ''
      : `<w15:presenceInfo w15:providerId="${escapeXml(identity.providerId ?? 'PeoplePicker')}" w15:userId="${escapeXml(identity.userId ?? '')}"/>`
    return `<w15:person w15:author="${escapeXml(author)}">${presence}</w15:person>`
  }).join('')
  const peopleXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w15:people xmlns:w15="${NS.w15}" xmlns:mc="${NS.mc}" mc:Ignorable="w15">${people}</w15:people>`

  return {
    'word/comments.xml': commentsXml,
    'word/commentsExtended.xml': commentsExtendedXml,
    'word/commentsIds.xml': commentsIdsXml,
    'word/commentsExtensible.xml': commentsExtensibleXml,
    'word/people.xml': peopleXml,
  }
}

/** 补 relationships 与 content types。 */
function addPackageInfo(relsXml, contentTypesXml) {
  let rels = relsXml
  const existing = new Set()
  for (const match of rels.matchAll(/<Relationship\b[^>]*Id="([^"]+)"/gu)) existing.add(match[1])
  let counter = 1
  const nextId = () => {
    for (;;) {
      const id = 'rId' + counter
      counter += 1
      if (!existing.has(id)) { existing.add(id); return id }
    }
  }
  for (const relationship of RELATIONSHIPS) {
    const already = new RegExp(`Target="${relationship.target.replace('.', '\\.')}"`, 'u').test(rels)
    if (already) continue
    rels = rels.replace('</Relationships>', `<Relationship Id="${nextId()}" Type="${relationship.type}" Target="${relationship.target}"/></Relationships>`)
  }
  let contentTypes = contentTypesXml
  for (const [name, type] of Object.entries(CONTENT_TYPES)) {
    if (contentTypes.includes(`/${name}"`)) continue
    contentTypes = contentTypes.replace('</Types>', `<Override PartName="/${name}" ContentType="${type}"/></Types>`)
  }
  return { relsXml: rels, contentTypesXml: contentTypes }
}

/** 确保 settings.xml 里有 compatibilityMode=15（否则 Word 打开是「兼容性模式」，批注 UI 退化）。 */
export function ensureCompatibilityMode(settingsXml) {
  if (settingsXml === null) return null
  if (/w:name="compatibilityMode"/u.test(settingsXml)) {
    return settingsXml.replace(/(<w:compatSetting w:name="compatibilityMode" w:uri="[^"]*" w:val=")\d+("\/>)/u, '$115$2')
  }
  const block = '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>'
  if (settingsXml.includes('<w:compat>')) return settingsXml.replace('<w:compat>', '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>')
  return settingsXml.replace('</w:settings>', block + '</w:settings>')
}

/**
 * 主入口：读入一份 docx（可以已经有批注，会被清掉），按给定的纯文本偏移写入批注。
 * @param {Buffer} buffer
 * @param {Array<object>} comments 见 buildCommentParts
 */
export function exportDocxComments(buffer, comments) {
  const zip = openZip(buffer)
  const styles = resolveStyleIds(zip.text('word/styles.xml'))
  const stripped = stripComments(buffer)
  const anchors = []
  let nextId = 1
  const prepared = comments.map((comment) => {
    const id = Number(comment.id ?? nextId)
    nextId = Math.max(nextId, id) + 1
    return { ...comment, id }
  })
  for (const comment of prepared) {
    const anchor = comment.anchor ?? {}
    const start = Number(anchor.start ?? 0)
    const end = Number(anchor.end ?? start)
    anchors.push({ id: comment.id, start: Math.min(start, end), end: Math.max(start, end) })
  }
  const documentXml = injectAnchors(stripped.documentXml, anchors, { commentReferenceStyle: styles.commentReference })
  const usedParaIds = new Set()
  for (const match of documentXml.matchAll(/w14:paraId="([0-9A-Fa-f]{8})"/gu)) usedParaIds.add(match[1].toUpperCase())
  const parts = buildCommentParts(prepared, styles, usedParaIds)
  const packageInfo = addPackageInfo(stripped.relsXml, stripped.contentTypesXml)
  const settings = ensureCompatibilityMode(zip.text('word/settings.xml'))

  const entries = []
  for (const entry of stripped.entries) {
    if (entry.name === 'word/document.xml') entries.push({ name: entry.name, data: Buffer.from(documentXml, 'utf8') })
    else if (entry.name === 'word/_rels/document.xml.rels') entries.push({ name: entry.name, data: Buffer.from(packageInfo.relsXml, 'utf8') })
    else if (entry.name === '[Content_Types].xml') entries.push({ name: entry.name, data: Buffer.from(packageInfo.contentTypesXml, 'utf8') })
    else if (entry.name === 'word/settings.xml' && settings !== null) entries.push({ name: entry.name, data: Buffer.from(settings, 'utf8') })
    else entries.push(entry)
  }
  for (const [name, xml] of Object.entries(parts)) entries.push({ name, data: Buffer.from(xml, 'utf8') })
  return writeZip(entries)
}

/** 测试辅助：直接从字节里读某个部件（不做解析）。 */
export function readPart(buffer, name) {
  const directory = readZipDirectory(buffer)
  const entry = directory.get(name)
  return entry === undefined ? null : readZipEntry(buffer, entry).toString('utf8')
}
