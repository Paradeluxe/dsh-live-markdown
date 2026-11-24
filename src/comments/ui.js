/**
 * CM6 里的批注 UI：正文高亮 + 页边标记 + 悬浮批注卡片（对齐 Word 的批注体验）。
 *
 * 为什么不是常驻侧栏：DSH 的文档面板通常只有 500–700px 宽，248px 的常驻卡片会压住正文。
 * 所以改成 Word 的另一种形态：
 *   - 正文里高亮被批注的范围；
 *   - 右边距一排小圆点标记（已解决的是灰色空心），悬停高亮或点圆点才展开悬浮卡片；
 *   - 卡片里可以回复、解决/重新打开、删除。
 *
 * 数据流：
 *   GET  /github-md/comments/load?sessionId=…&path=…
 *   POST /github-md/comments/save { sessionId, path, store, baseMtimeMs }
 */
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view'
import { StateEffect, StateField } from '@codemirror/state'
import { buildThreads, createComment, createReply, deleteComment, editComment, parseStore, resolveStore, serializeStore, setResolved } from './model.js'

const STYLE_ID = 'gh-md-comments-style'
const CARD_WIDTH = 264

const CSS = `
.gh-md-comment-mark{background:rgba(255,193,7,.18);border-bottom:1px solid rgba(255,193,7,.55);border-radius:2px;transition:background-color .12s ease}
.gh-md-comment-mark.is-active{background:rgba(255,193,7,.45)}
.gh-md-comments-layer{position:absolute;top:0;left:0;width:100%;height:0;pointer-events:none;z-index:24;font-family:var(--dsw-font,system-ui,sans-serif);font-size:12px;line-height:1.5}
.gh-md-comment-dot{position:absolute;pointer-events:auto;width:11px;height:11px;border-radius:50%;border:1.5px solid #d9a10a;background:#ffd76a;box-sizing:border-box;cursor:pointer;transition:transform .12s ease,opacity .12s ease}
.gh-md-comment-dot:hover{transform:scale(1.15)}
.gh-md-comment-dot[data-resolved="1"]{background:transparent;border-color:#b8c0c8}
.gh-md-comment-card{position:absolute;pointer-events:auto;display:none;width:${CARD_WIDTH}px;box-sizing:border-box;padding:10px 12px 8px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,#fff);border:1px solid var(--dsw-alias-border-l2,#d0d7de);box-shadow:0 6px 22px rgb(0 0 0 / 16%);max-height:60vh;overflow:auto}
.gh-md-comment-card.is-open{display:block}
.gh-md-comment-card[data-resolved="1"]{opacity:.78}
.gh-md-comment-head{display:flex;align-items:center;gap:8px;margin-bottom:6px;min-width:0}
.gh-md-comment-avatar{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;color:#fff;font-size:10px;font-weight:600;flex:none}
.gh-md-comment-author{font-weight:600;color:var(--dsw-alias-label-primary,#1f2328);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px}
.gh-md-comment-time{color:var(--dsw-alias-label-tertiary,#8c959f);font-size:11px;white-space:nowrap;margin-left:auto}
.gh-md-comment-body{color:var(--dsw-alias-label-primary,#1f2328);white-space:pre-wrap;word-break:break-word}
.gh-md-comment-replies{margin-top:6px;padding-top:6px;border-top:1px solid var(--dsw-alias-border-l1,#eaeef2);display:flex;flex-direction:column;gap:6px}
.gh-md-comment-reply{display:flex;gap:6px}
.gh-md-comment-reply .gh-md-comment-avatar{width:16px;height:16px;font-size:8px;margin-top:2px}
.gh-md-comment-reply-main{min-width:0;flex:1}
.gh-md-comment-actions{display:flex;gap:2px;margin-top:6px;flex-wrap:wrap}
.gh-md-comment-action{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#57606a);font:inherit;font-size:11px;padding:2px 6px;border-radius:5px;cursor:pointer}
.gh-md-comment-action:hover{background:var(--dsw-alias-interactive-bg-hover,rgb(0 0 0 / 6%))}
.gh-md-comment-action.is-primary{color:var(--dsw-alias-state-info-primary,#0969da)}
.gh-md-comment-form{margin-top:6px;display:flex;flex-direction:column;gap:6px}
.gh-md-comment-input{width:100%;box-sizing:border-box;min-height:52px;resize:vertical;font:inherit;font-size:12px;padding:6px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,#d0d7de);background:var(--dsw-alias-bg-layer-1,#f6f8fa);color:inherit}
.gh-md-comment-input:focus{outline:2px solid rgb(9 105 218 / 35%);outline-offset:0}
.gh-md-comment-form-row{display:flex;gap:6px;justify-content:flex-end}
.gh-md-comment-btn{appearance:none;font:inherit;font-size:11px;padding:3px 10px;border-radius:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,#d0d7de);background:var(--dsw-alias-bg-layer-2,#fff);color:inherit}
.gh-md-comment-btn.is-primary{background:var(--dsw-alias-state-info-primary,#0969da);border-color:transparent;color:#fff}
.gh-md-comments-add{position:absolute;z-index:26;pointer-events:auto;display:none;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,#d0d7de);background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-secondary,#57606a);font-size:11px;cursor:pointer;box-shadow:0 1px 4px rgb(0 0 0 / 12%)}
.gh-md-comments-add:hover{color:#fff;background:var(--dsw-alias-state-info-primary,#0969da);border-color:transparent}
.gh-md-comments-add.is-visible{display:inline-flex}
.gh-md-comments-lost{position:absolute;left:12px;top:8px;pointer-events:auto;max-width:420px;padding:6px 10px;border-radius:8px;border:1px solid var(--dsw-alias-state-warning-primary,#b4690e);color:var(--dsw-alias-state-warning-primary,#b4690e);background:rgb(180 105 14 / 8%);font-size:11px}
`

function ensureStyle() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

function formatTime(iso) {
  try {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ''
    const pad = (value) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  } catch {
    return ''
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
}

const setComments = StateEffect.define()

const commentsField = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    let store = null
    for (const effect of transaction.effects) if (effect.is(setComments)) store = effect.value
    if (store === null) {
      if (transaction.docChanged) return value.map(transaction.changes)
      return value
    }
    const ranges = []
    for (const comment of store.comments) {
      if (comment.deleted === true) continue
      const start = comment.anchor.start
      if (start === null || start === undefined) continue
      const from = Math.max(0, Math.min(start, transaction.state.doc.length))
      const to = Math.max(from, Math.min(comment.anchor.end ?? from, transaction.state.doc.length))
      if (to <= from) continue
      ranges.push(Decoration.mark({ class: 'gh-md-comment-mark', attributes: { 'data-comment-id': comment.parentId ?? comment.id } }).range(from, to))
    }
    return Decoration.set(ranges, true)
  },
  provide: (field) => EditorView.decorations.from(field),
})

/**
 * @param {{ path?: string, sessionId?: string, editable?: boolean, author?: { name: string, email?: string|null } }} options
 * @returns {import('@codemirror/state').Extension}
 */
export function createCommentsExtension(options = {}) {
  const context = {
    path: typeof options.path === 'string' ? options.path : '',
    sessionId: typeof options.sessionId === 'string' ? options.sessionId : '',
    editable: options.editable === true,
    author: options.author ?? { name: '我', email: null },
  }

  class CommentsPlugin {
    constructor(view) {
      this.view = view
      this.store = parseStore({ version: 1, comments: [] })
      this.baseMtimeMs = null
      this.cards = new Map()
      this.dots = new Map()
      this.openId = null
      this.hoveredId = null
      this.lostCount = 0
      this.lastSavedSignature = null
      this.refreshScheduled = false
      this.syncScheduled = false
      ensureStyle()
      if (window.getComputedStyle(view.scrollDOM).position === 'static') view.scrollDOM.style.position = 'relative'
      this.layer = document.createElement('div')
      this.layer.className = 'gh-md-comments-layer'
      this.addButton = document.createElement('button')
      this.addButton.type = 'button'
      this.addButton.className = 'gh-md-comments-add'
      this.addButton.textContent = '＋ 批注'
      view.scrollDOM.appendChild(this.layer)
      view.scrollDOM.appendChild(this.addButton)

      this.onMouseUp = () => this.syncAddButton()
      this.onScroll = () => this.layout()
      this.onResize = () => this.layout()
      this.onEscape = (event) => {
        if (event.key !== 'Escape') return
        if (this.openId !== null) {
          this.openCard(null)
        }
      }
      view.dom.addEventListener('mouseup', this.onMouseUp)
      view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true })
      window.addEventListener('resize', this.onResize)
      document.addEventListener('keydown', this.onEscape, true)
      this.addButton.addEventListener('mousedown', (event) => { event.preventDefault(); event.stopPropagation() })
      this.addButton.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        this.createFromSelection()
      })
      const markId = (event) => {
        const element = event.target instanceof Element ? event.target.closest('.gh-md-comment-mark') : null
        return element === null ? null : element.getAttribute('data-comment-id')
      }
      view.dom.addEventListener('mouseover', (event) => {
        const id = markId(event)
        if (id === null) return
        this.setHovered(id)
      })
      view.dom.addEventListener('mouseout', (event) => {
        const id = markId(event)
        if (id === null) return
        if (event.relatedTarget instanceof Element && event.relatedTarget.closest('.gh-md-comment-mark')?.getAttribute('data-comment-id') === id) return
        this.setHovered(null)
      })
      view.dom.addEventListener('click', (event) => {
        const id = markId(event)
        if (id === null) return
        this.openCard(this.openId === id ? null : id)
      })
      void this.load()
    }

    async load() {
      if (context.path === '' || context.sessionId === '') return
      try {
        const query = '/github-md/comments/load?sessionId=' + encodeURIComponent(context.sessionId) + '&path=' + encodeURIComponent(context.path)
        const response = await fetch(query, { headers: { accept: 'application/json' } })
        if (!response.ok) return
        const payload = await response.json()
        if (payload === null || typeof payload !== 'object' || payload.ok !== true) return
        this.store = parseStore(payload.store)
        this.baseMtimeMs = typeof payload.mtimeMs === 'number' ? payload.mtimeMs : null
        this.refresh()
      } catch {}
    }

    refresh() {
      if (this.view.destroyed === true) return
      const stats = resolveStore(this.store, this.view.state.doc.toString())
      this.lostCount = stats.lost
      this.view.dispatch({ effects: setComments.of(this.store) })
      this.render()
      this.layout()
    }

    scheduleRefresh() {
      if (this.refreshScheduled) return
      this.refreshScheduled = true
      const run = () => {
        this.refreshScheduled = false
        this.refresh()
      }
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
      else window.setTimeout(run, 16)
    }

    scheduleSyncAdd() {
      if (this.syncScheduled) return
      this.syncScheduled = true
      const run = () => {
        this.syncScheduled = false
        this.syncAddButton()
      }
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
      else window.setTimeout(run, 16)
    }

    async save() {
      if (context.path === '' || context.sessionId === '') return
      const signature = serializeStore(this.store)
      if (signature === this.lastSavedSignature) return
      this.lastSavedSignature = signature
      try {
        const response = await fetch('/github-md/comments/save', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: context.sessionId, path: context.path, store: this.store, baseMtimeMs: this.baseMtimeMs }),
        })
        if (!response.ok) return
        const payload = await response.json()
        if (payload === null || typeof payload !== 'object' || payload.ok !== true) return
        if (payload.merged === true) {
          this.store = parseStore(payload.store)
          this.lastSavedSignature = serializeStore(this.store)
          this.refresh()
        }
        if (typeof payload.mtimeMs === 'number') this.baseMtimeMs = payload.mtimeMs
      } catch {}
    }

    createFromSelection() {
      const range = this.view.state.selection.main
      if (range.empty) return
      const comment = createComment(this.store, {
        author: context.author,
        body: '',
        start: range.from,
        end: range.to,
        text: this.view.state.doc.toString(),
      })
      this.refresh()
      this.openCard(comment.id)
      this.openComposer(comment.id, true)
    }

    openComposer(commentId, isNew = false) {
      const card = this.cards.get(commentId)
      if (card === undefined) return
      if (card.querySelector('.gh-md-comment-form') !== null) return
      const form = document.createElement('div')
      form.className = 'gh-md-comment-form'
      form.innerHTML = '<textarea class="gh-md-comment-input" placeholder="写一条批注…（Ctrl+Enter 提交）"></textarea><div class="gh-md-comment-form-row"><button type="button" class="gh-md-comment-btn" data-act="cancel">取消</button><button type="button" class="gh-md-comment-btn is-primary" data-act="submit">' + (isNew ? '添加' : '保存') + '</button></div>'
      card.appendChild(form)
      const textarea = form.querySelector('textarea')
      if (isNew !== true) textarea.value = this.store.comments.find((item) => item.id === commentId)?.body ?? ''
      const submit = () => {
        const body = textarea.value.trim()
        if (body === '') return
        editComment(this.store, commentId, body)
        this.refresh()
        void this.save()
        if (this.openId !== commentId) this.openCard(commentId)
      }
      const cancel = () => {
        form.remove()
        if (isNew === true) {
          this.store.comments = this.store.comments.filter((item) => item.id !== commentId)
          this.refresh()
          this.openCard(null)
        }
      }
      form.querySelector('[data-act="submit"]').addEventListener('click', (event) => { event.preventDefault(); submit() })
      form.querySelector('[data-act="cancel"]').addEventListener('click', (event) => { event.preventDefault(); cancel() })
      textarea.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey === true || event.metaKey === true)) { event.preventDefault(); submit() }
        if (event.key === 'Escape') { event.preventDefault(); cancel() }
      })
      this.layout()
      textarea.focus()
    }

    replyTo(commentId) {
      const card = this.cards.get(commentId)
      if (card === undefined) return
      if (card.querySelector('.gh-md-comment-form[data-mode="reply"]') !== null) return
      const form = document.createElement('div')
      form.className = 'gh-md-comment-form'
      form.dataset.mode = 'reply'
      form.innerHTML = '<textarea class="gh-md-comment-input" placeholder="回复…（Ctrl+Enter 提交）"></textarea><div class="gh-md-comment-form-row"><button type="button" class="gh-md-comment-btn" data-act="cancel">取消</button><button type="button" class="gh-md-comment-btn is-primary" data-act="submit">回复</button></div>'
      card.appendChild(form)
      const textarea = form.querySelector('textarea')
      const submit = () => {
        const body = textarea.value.trim()
        if (body === '') return
        createReply(this.store, commentId, { author: context.author, body, text: this.view.state.doc.toString() })
        this.refresh()
        this.openCard(commentId)
        void this.save()
      }
      form.querySelector('[data-act="submit"]').addEventListener('click', (event) => { event.preventDefault(); submit() })
      form.querySelector('[data-act="cancel"]').addEventListener('click', (event) => { event.preventDefault(); form.remove(); this.layout() })
      textarea.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey === true || event.metaKey === true)) { event.preventDefault(); submit() }
        if (event.key === 'Escape') { event.preventDefault(); form.remove() }
      })
      this.layout()
      textarea.focus()
    }

    setHovered(commentId) {
      if (this.hoveredId === commentId) return
      this.hoveredId = commentId
      for (const mark of Array.from(this.view.dom.querySelectorAll('.gh-md-comment-mark'))) {
        mark.classList.toggle('is-active', commentId !== null && mark.getAttribute('data-comment-id') === commentId)
      }
      for (const [id, dot] of this.dots) dot.classList.toggle('is-active', id === commentId)
      if (commentId !== null && this.openId === null) this.previewCard(commentId)
      else if (commentId === null && this.openId === null) this.previewCard(null)
    }

    previewCard(commentId) {
      for (const [id, card] of this.cards) card.classList.toggle('is-open', commentId !== null && id === commentId)
      this.layout()
    }

    openCard(commentId) {
      this.openId = commentId
      for (const [id, card] of this.cards) card.classList.toggle('is-open', id === commentId)
      for (const [id, dot] of this.dots) dot.classList.toggle('is-open', id === commentId)
      this.layout()
    }

    render() {
      const threads = buildThreads(this.store.comments)
      const seen = new Set()
      for (const thread of threads) {
        seen.add(thread.id)
        let dot = this.dots.get(thread.id)
        if (dot === undefined) {
          dot = document.createElement('div')
          dot.className = 'gh-md-comment-dot'
          dot.setAttribute('role', 'button')
          dot.title = '查看批注'
          dot.addEventListener('mousedown', (event) => { event.preventDefault(); event.stopPropagation() })
          dot.addEventListener('mouseenter', () => this.setHovered(thread.id))
          dot.addEventListener('mouseleave', () => this.setHovered(null))
          dot.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
            this.openCard(this.openId === thread.id ? null : thread.id)
          })
          this.layer.appendChild(dot)
          this.dots.set(thread.id, dot)
        }
        dot.setAttribute('data-resolved', thread.resolved ? '1' : '0')
        dot.title = thread.author.name + '：' + (thread.body === '' ? '（空批注）' : thread.body.slice(0, 40))

        let card = this.cards.get(thread.id)
        if (card === undefined) {
          card = document.createElement('div')
          card.className = 'gh-md-comment-card'
          this.layer.appendChild(card)
          this.cards.set(thread.id, card)
        }
        card.dataset.commentId = thread.id
        card.setAttribute('data-resolved', thread.resolved ? '1' : '0')
        card.classList.toggle('is-open', this.openId === thread.id)
        card.innerHTML = this.cardHtml(thread)
        this.bindCard(card, thread)
      }
      for (const [id, node] of Array.from(this.dots)) {
        if (seen.has(id)) continue
        node.remove()
        this.dots.delete(id)
      }
      for (const [id, node] of Array.from(this.cards)) {
        if (seen.has(id)) continue
        node.remove()
        this.cards.delete(id)
        if (this.openId === id) this.openId = null
      }
      if (this.lostCount > 0) {
        if (this.lostNotice === undefined || this.lostNotice.parentNode === null) {
          this.lostNotice = document.createElement('div')
          this.lostNotice.className = 'gh-md-comments-lost'
          this.layer.appendChild(this.lostNotice)
        }
        this.lostNotice.textContent = this.lostCount + ' 条批注的原文已被删除（锚点丢失）'
      } else if (this.lostNotice !== undefined) {
        this.lostNotice.remove()
        this.lostNotice = undefined
      }
    }

    cardHtml(thread) {
      const author = thread.author
      const showName = author.initials !== author.name
      const replies = thread.replies.map((reply) => '<div class="gh-md-comment-reply"><span class="gh-md-comment-avatar" style="background:' + escapeHtml(reply.author.color) + '">' + escapeHtml(reply.author.initials) + '</span><div class="gh-md-comment-reply-main"><div>' + (reply.author.initials !== reply.author.name ? '<span class="gh-md-comment-author">' + escapeHtml(reply.author.name) + '</span> ' : '') + '<span class="gh-md-comment-time">' + escapeHtml(formatTime(reply.createdAt)) + '</span></div><div class="gh-md-comment-body">' + escapeHtml(reply.body) + '</div></div></div>').join('')
      return '<div class="gh-md-comment-head"><span class="gh-md-comment-avatar" style="background:' + escapeHtml(author.color) + '">' + escapeHtml(author.initials) + '</span>' + (showName ? '<span class="gh-md-comment-author">' + escapeHtml(author.name) + '</span>' : '') + '<span class="gh-md-comment-time">' + escapeHtml(formatTime(thread.createdAt)) + '</span></div><div class="gh-md-comment-body">' + escapeHtml(thread.body) + '</div>' + (replies === '' ? '' : '<div class="gh-md-comment-replies">' + replies + '</div>') + '<div class="gh-md-comment-actions"><button type="button" class="gh-md-comment-action is-primary" data-act="reply">回复</button><button type="button" class="gh-md-comment-action" data-act="resolve">' + (thread.resolved ? '重新打开' : '解决') + '</button><button type="button" class="gh-md-comment-action" data-act="delete">删除</button></div>'
    }

    bindCard(card, thread) {
      card.querySelector('[data-act="reply"]').addEventListener('click', (event) => { event.preventDefault(); this.replyTo(thread.id) })
      card.querySelector('[data-act="resolve"]').addEventListener('click', (event) => {
        event.preventDefault()
        setResolved(this.store, thread.id, thread.resolved !== true)
        this.refresh()
        this.openCard(thread.id)
        void this.save()
      })
      card.querySelector('[data-act="delete"]').addEventListener('click', (event) => {
        event.preventDefault()
        deleteComment(this.store, thread.id)
        this.openId = null
        this.refresh()
        void this.save()
      })
      card.addEventListener('mouseenter', () => this.setHovered(thread.id))
      card.addEventListener('mouseleave', () => {
        if (this.openId !== thread.id) this.setHovered(null)
      })
    }

    syncAddButton() {
      if (context.editable !== true) { this.addButton.classList.remove('is-visible'); return }
      const range = this.view.state.selection.main
      if (range.empty) { this.addButton.classList.remove('is-visible'); return }
      try {
        const coords = this.view.coordsAtPos(range.to)
        const scrollerRect = this.view.scrollDOM.getBoundingClientRect()
        const left = coords.right - scrollerRect.left + this.view.scrollDOM.scrollLeft
        const top = coords.bottom - scrollerRect.top + this.view.scrollDOM.scrollTop + 4
        this.addButton.style.left = Math.max(8, Math.min(left, scrollerRect.width - 76)) + 'px'
        this.addButton.style.top = top + 'px'
        this.addButton.classList.add('is-visible')
      } catch {
        this.addButton.classList.remove('is-visible')
      }
    }

    layout() {
      const scrollerRect = this.view.scrollDOM.getBoundingClientRect()
      const scrollTop = this.view.scrollDOM.scrollTop
      const scrollLeft = this.view.scrollDOM.scrollLeft
      const right = scrollerRect.width + scrollLeft
      for (const thread of buildThreads(this.store.comments)) {
        const dot = this.dots.get(thread.id)
        const card = this.cards.get(thread.id)
        if (dot === undefined || card === undefined) continue
        let top = 24
        let lineTop = 24
        try {
          const position = Math.min(thread.anchor.start ?? 0, this.view.state.doc.length)
          const coords = this.view.coordsAtPos(position)
          top = coords.top - scrollerRect.top + scrollTop
          lineTop = top
        } catch {}
        dot.style.left = Math.max(8, right - 20) + 'px'
        dot.style.top = (top + 1) + 'px'
        const cardLeft = Math.max(8, right - CARD_WIDTH - 30)
        const cardTop = Math.max(8, lineTop - 6)
        card.style.left = cardLeft + 'px'
        card.style.top = cardTop + 'px'
      }
    }

    update(update) {
      if (update.docChanged) this.scheduleRefresh()
      else this.layout()
      if (update.selectionSet || update.docChanged) this.scheduleSyncAdd()
      else this.layout()
    }

    destroy() {
      this.view.dom.removeEventListener('mouseup', this.onMouseUp)
      this.view.scrollDOM.removeEventListener('scroll', this.onScroll)
      window.removeEventListener('resize', this.onResize)
      document.removeEventListener('keydown', this.onEscape, true)
      this.layer.remove()
      this.addButton.remove()
    }
  }

  const plugin = ViewPlugin.fromClass(CommentsPlugin)
  return [commentsField, plugin]
}
