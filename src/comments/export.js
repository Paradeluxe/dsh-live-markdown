/**
 * 把侧车里的批注写回 Word：markdown 偏移 → docx 偏移 → 原生批注部件。
 *
 * 与 import.js 对称：导入是 docx → markdown，导出是 markdown → docx。
 * 映射是启发式的（markdown 里的 `#` `**` `[]()` 在 docx 里不存在），所以每一步都统计
 * mapped / approx / lost，绝不假装全部成功。
 */
import { readDocxComments } from './docx-comments.js'
import { exportDocxComments } from './docx-export.js'
import { toDocxComments } from './model.js'

/** 去掉 markdown 标记，只留纯文本（用于段落级兜底定位）。 */
export function stripMarkdown(value) {
  return String(value ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/`{1,3}/gu, '')
    .replace(/\*\*|__/gu, '')
    .replace(/(^|\s)[*_]/gu, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gmu, '')
    .replace(/^\s{0,3}>\s?/gmu, '')
    .replace(/^\s{0,3}(?:[-+*]|\d+\.)\s+/gmu, '')
    .replace(/\|/gu, ' ')
    .replace(/[ \t]+/gu, ' ')
    .trim()
}

/**
 * 在 docx 文本里为每条批注找回锚点。
 * @param {object} store 侧车
 * @param {string} markdownText markdown 正文
 * @param {string} docxText docx 摊平文本
 * @returns {{ mapped: number, approx: number, lost: number }}
 */
export function mapMarkdownAnchorsToDocx(store, markdownText, docxText) {
  const stats = { mapped: 0, approx: 0, lost: 0 }
  const markdown = String(markdownText ?? '')
  const docx = String(docxText ?? '')
  const paragraphAt = (text, position) => {
    const before = text.lastIndexOf('\n', Math.max(0, position - 1))
    const after = text.indexOf('\n', Math.max(0, position))
    return {
      start: before < 0 ? 0 : before + 1,
      end: after < 0 ? text.length : after,
    }
  }
  for (const comment of store.comments) {
    const quote = comment.anchor === undefined || comment.anchor === null ? '' : String(comment.anchor.quote ?? '')
    if (quote === '') {
      comment.anchor = { ...comment.anchor, start: null, end: null }
      comment.anchorStatus = 'lost'
      stats.lost += 1
      continue
    }
    const direct = docx.indexOf(quote)
    if (direct >= 0) {
      comment.anchor = { ...comment.anchor, start: direct, end: direct + quote.length }
      comment.anchorStatus = 'mapped'
      stats.mapped += 1
      continue
    }
    // 忽略空白差异（markdown 的硬换行 / 表格竖线在 docx 里是空格或没有）
    const pattern = quote.split(/\s+/u).filter((part) => part !== '').map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('\\s*')
    if (pattern !== '') {
      const match = new RegExp(pattern, 'u').exec(docx)
      if (match !== null) {
        comment.anchor = { ...comment.anchor, start: match.index, end: match.index + match[0].length }
        comment.anchorStatus = 'approx'
        stats.approx += 1
        continue
      }
    }
    // 段落兜底：用批注所在 markdown 段落的纯文本，在 docx 里找同一段，再在段内找 quote
    const position = typeof comment.anchor.start === 'number' ? comment.anchor.start : 0
    const paragraph = markdown.slice(paragraphAt(markdown, position).start, paragraphAt(markdown, position).end)
    const plain = stripMarkdown(paragraph)
    if (plain.length >= 8) {
      const needle = plain.slice(0, Math.min(40, plain.length))
      const found = docx.indexOf(needle)
      if (found >= 0) {
        const located = docx.indexOf(quote, found)
        if (located >= 0 && located < found + paragraph.length + 40) {
          comment.anchor = { ...comment.anchor, start: located, end: located + quote.length }
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

/**
 * 生成带批注的 docx。
 * @param {{ docxBuffer: Buffer, store: object, markdownText: string }} input
 * @returns {{ buffer: Buffer, stats: { mapped: number, approx: number, lost: number }, comments: number }}
 */
export function exportDocxFromSidecar(input) {
  const parsed = readDocxComments(input.docxBuffer)
  const stats = mapMarkdownAnchorsToDocx(input.store, input.markdownText, parsed.text)
  const buffer = exportDocxComments(input.docxBuffer, toDocxComments(input.store))
  return { buffer, stats, comments: input.store.comments.filter((comment) => comment.deleted !== true).length }
}
