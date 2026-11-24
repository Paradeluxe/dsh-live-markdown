/**
 * markdown → 纯文本索引：为了把 docx 里的批注原文映射回 markdown 偏移。
 *
 * 输出的 \`plain\` 是去掉标记（#、**、`、链接语法等）后的文字，\`map\` 里每个字符对应它在 markdown 里的下标；
 * 于是「在 plain 里找到 quote」可以精确换算回 markdown 的 start/end。
 */

const LIST_MARKER = /^\s{0,3}(?:[-+*]|\d+\.)\s+/
const HEADING_MARKER = /^\s{0,3}#{1,6}\s+/
const QUOTE_MARKER = /^\s{0,3}>\s?/

/**
 * @param {string} markdown
 * @returns {{ plain: string, map: number[] }}
 */
export function buildPlainIndex(markdown) {
  const text = String(markdown ?? '')
  const out = []
  const map = []
  const push = (char, index) => {
    out.push(char)
    map.push(index)
  }
  let index = 0
  let atLineStart = true
  while (index < text.length) {
    const rest = text.slice(index)
    if (atLineStart) {
      const heading = HEADING_MARKER.exec(rest)
      if (heading !== null) { index += heading[0].length; atLineStart = false; continue }
      const quote = QUOTE_MARKER.exec(rest)
      if (quote !== null) { index += quote[0].length; atLineStart = false; continue }
      const list = LIST_MARKER.exec(rest)
      if (list !== null) { index += list[0].length; atLineStart = false; continue }
    }
    const char = text[index]
    if (char === '\n') {
      push('\n', index)
      index += 1
      atLineStart = true
      continue
    }
    if (char === '`') {
      // 行内代码的反引号去掉，内容保留；围栏代码块整段跳过标记
      if (text.startsWith('```', index)) {
        const closing = text.indexOf('```', index + 3)
        index = closing < 0 ? index + 3 : closing + 3
        continue
      }
      index += 1
      continue
    }
    // 图片 ![alt](url) 整段跳过；链接 [text](url) 保留 text
    if (char === '!' && text[index + 1] === '[') {
      const close = text.indexOf(')', index)
      index = close < 0 ? index + 2 : close + 1
      continue
    }
    if (char === '[') {
      index += 1
      continue
    }
    if (char === ']' && text[index + 1] === '(') {
      const close = text.indexOf(')', index)
      index = close < 0 ? index + 2 : close + 1
      continue
    }
    if (char === '*' || char === '_') {
      index += 1
      continue
    }
    if (char === '|') {
      // 表格竖线换成空格，避免把两列粘成一个词
      push(' ', index)
      index += 1
      continue
    }
    push(char, index)
    atLineStart = false
    index += 1
  }
  return { plain: out.join(''), map }
}

/**
 * 在纯文本里找 quote（忽略空白差异），并换算回 markdown 偏移。
 * @param {{ plain: string, map: number[] }} index
 * @param {string} quote
 * @returns {{ start: number, end: number } | null}
 */
export function findInPlain(index, quote) {
  const target = String(quote ?? '').trim()
  if (target === '' || index.map.length === 0) return null
  const tokens = target.split(/\s+/u).filter((token) => token !== '')
  if (tokens.length === 0) return null
  const pattern = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('\\s+')
  const match = new RegExp(pattern, 'u').exec(index.plain)
  if (match === null) return null
  const startPlain = match.index
  const endPlain = match.index + match[0].length - 1
  const start = index.map[startPlain]
  const end = index.map[Math.min(endPlain, index.map.length - 1)] + 1
  if (typeof start !== 'number' || typeof end !== 'number' || end <= start) return null
  return { start, end }
}
