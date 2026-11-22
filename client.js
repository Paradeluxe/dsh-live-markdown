/**
 * 浏览器半边：给右侧栏注册一个「实时预览」的 Markdown 文档渲染器（Live Preview）。
 *
 * 官方 Markdown 渲染器（`@deepseek-ai/dsh-client-ui-primitives` 的 `MarkdownText`）把原始 HTML
 * 当字面文本、片段锚点被协议白名单挡掉，因此 `<sup>/<sub>` 与 `^x^` / `~x~` 都不会变成上下标。
 * 本插件在文档渲染器注册表里加一个 `extension` 档的实现（默认接走 `.md` / `.markdown`）：
 *
 * - marked（GFM）+ DOMPurify：原始 HTML 经消毒后渲染，`<sup>` / `<sub>` 自然生效；
 * - 自定义 inline 扩展：`^上标^`、`~下标~`（Pandoc 风格；`~~删除线~~` 仍归 GFM）；
 * - KaTeX 渲染 `$…$` / `$$…$$`（缺库时退化为原文，不报错）；
 * - 本地图片按「当前文档所在目录」解析成 `/api/file`；相对链接渲染为不可点的文本（避免把
 *   整个 GUI 导航走）；
 * - 标题自动生成锚点 id，`#标题` 链接可跳。
 *
 * 浏览器库（marked / DOMPurify / KaTeX）由 Host 半边的 `/github-md/vendor/*` 静态路由提供，
 * 首次挂载时懒加载。官方 Markdown 渲染器不会消失：预览头部的「打开方式」里仍可切回去。
 */
;(() => {
  window.__ModuleLoader__.load({
    id: '@paradeluxe/dsh-live-markdown',
    factory(require) {
      const React = require('react')

      /** 本地化命名空间。 */
      const NS = 'githubMarkdown'
      /** 文档渲染器 id：元数据与 keyed 子 slot 的 key 必须一致。 */
      const RENDERER_ID = '@paradeluxe/dsh-live-markdown/live-markdown'
      /** 浏览器库前缀：必须与 Host 半边 index.js 的 ASSET_PREFIX 逐字一致。 */
      const ASSET_PREFIX = '/github-md/vendor/'
      /** 客户端构建号。 */
      const BUILD_STAMP = '1.3.15'

      /** 批量问 Host 要图片 mtime（只允许工作区内路径）。 */
      async function fetchImageVersions(sessionId, paths) {
        const unique = Array.from(new Set(paths.filter((entry) => typeof entry === 'string' && entry !== '')))
        if (unique.length === 0 || sessionId === '') return
        try {
          const response = await fetch('/github-md/workspace/stat?sessionId=' + encodeURIComponent(sessionId)
            + '&paths=' + encodeURIComponent(JSON.stringify(unique.slice(0, 200))), { headers: { accept: 'application/json' } })
          if (!response.ok) return
          const data = await response.json()
          const files = data !== null && typeof data === 'object' && data.files !== undefined && data.files !== null ? data.files : {}
          for (const [path, info] of Object.entries(files)) {
            if (info !== null && typeof info === 'object' && typeof info.mtimeMs === 'number') {
              imageVersionCache.set(imageVersionKey(path), info.mtimeMs)
            }
          }
        } catch {}
      }

      /**
       * 扫描预览里的本地图片，按 Host 上的 mtime 更新 src 上的 ?v=（文件被外部替换后能刷新）。
       * @param root - 预览根节点。
       * @param sessionId - 当前会话。
       * @returns 无。
       */
      async function refreshPreviewImageVersions(root, sessionId) {
        if (root === null || root === undefined || sessionId === '') return
        const entries = []
        for (const image of Array.from(root.querySelectorAll('img'))) {
          const src = image.getAttribute('src') ?? ''
          if (src.includes('api/file?') === false) continue
          let url
          try {
            url = new URL(src, document.baseURI)
          } catch {
            continue
          }
          const path = url.searchParams.get('path')
          if (path === null || path === '') continue
          entries.push({ image, url, path })
        }
        if (entries.length === 0) return
        await fetchImageVersions(sessionId, entries.map((entry) => entry.path))
        for (const entry of entries) {
          const version = imageVersionCache.get(imageVersionKey(entry.path))
          if (typeof version !== 'number') continue
          const value = String(Math.round(version))
          if (entry.url.searchParams.get('v') === value) continue
          entry.url.searchParams.set('v', value)
          entry.image.setAttribute('src', entry.url.href)
        }
      }
/** 图片灯箱（与 Obsidian 内置 lightbox 一致：90% 黑底 + 等比适配 + 文件名标题栏）。 */
function openImageLightbox(src, title) {
  const existing = document.querySelector('.gh-md-lightbox')
  if (existing !== null) existing.remove()
  const overlay = document.createElement('div')
  overlay.className = 'gh-md-lightbox'
  overlay.setAttribute('tabindex', '-1')

  const bg = document.createElement('div')
  bg.className = 'gh-md-lightbox-bg'

  const content = document.createElement('div')
  content.className = 'gh-md-lightbox-content'

  const titlebar = document.createElement('div')
  titlebar.className = 'gh-md-lightbox-title'
  titlebar.textContent = typeof title === 'string' && title !== '' ? title : ''

  const image = document.createElement('img')
  image.className = 'gh-md-lightbox-image'
  image.setAttribute('src', src)
  image.setAttribute('alt', titlebar.textContent)
  image.setAttribute('draggable', 'false')

  content.appendChild(image)
  overlay.appendChild(bg)
  overlay.appendChild(content)
  overlay.appendChild(titlebar)

  // 滚轮缩放 + 放大后拖拽平移（Obsidian 的大图预览也支持滚轮缩放）。
  const MIN_SCALE = 1
  const MAX_SCALE = 8
  let scale = 1
  let offsetX = 0
  let offsetY = 0
  let dragging = false
  let dragMoved = 0
  let dragStartX = 0
  let dragStartY = 0
  let dragOriginX = 0
  let dragOriginY = 0

  /**
   * 平移量限制：让视口中心始终落在图片上（图片不会被拖到完全看不见）。
   * 以「图片自身中心 + 偏移」记位置，|offset| <= 缩放后宽度的一半即可保证这一点。
   */
  const clampOffset = () => {
    if (scale <= 1.0001) {
      offsetX = 0
      offsetY = 0
      return
    }
    const limitX = (image.offsetWidth * scale) / 2
    const limitY = (image.offsetHeight * scale) / 2
    offsetX = Math.min(limitX, Math.max(-limitX, offsetX))
    offsetY = Math.min(limitY, Math.max(-limitY, offsetY))
  }
  const applyTransform = () => {
    clampOffset()
    image.style.transform = 'translate(' + offsetX.toFixed(2) + 'px, ' + offsetY.toFixed(2) + 'px) scale(' + scale.toFixed(4) + ')'
    image.style.cursor = scale > 1 ? 'grab' : 'zoom-in'
  }
  const resetTransform = () => {
    scale = 1
    offsetX = 0
    offsetY = 0
    applyTransform()
  }
  const zoomAt = (clientX, clientY, nextScale) => {
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale))
    if (Math.abs(clamped - scale) < 0.0005) return
    const ratio = clamped / scale
    const centerX = window.innerWidth / 2
    const centerY = window.innerHeight / 2
    // translate 先于 scale 生效：保持指针下的图像点不动。
    offsetX = (clientX - centerX) - ((clientX - centerX) - offsetX) * ratio
    offsetY = (clientY - centerY) - ((clientY - centerY) - offsetY) * ratio
    scale = clamped
    if (scale <= 1.0001) {
      // 缩回适配尺寸：图片应当正对屏幕中心，不再保留"朝鼠标方向"的偏移。
      offsetX = 0
      offsetY = 0
    }
    applyTransform()
  }

  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    document.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('resize', onResize)
    overlay.remove()
  }
  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (event.key === '0') {
      event.preventDefault()
      resetTransform()
    }
  }
  const onResize = () => { resetTransform() }

  const onWheel = (event) => {
    event.preventDefault()
    event.stopPropagation()
    const factor = Math.exp(-event.deltaY * 0.0016)
    zoomAt(event.clientX, event.clientY, scale * factor)
  }
  overlay.addEventListener('wheel', onWheel, { passive: false })

  image.addEventListener('pointerdown', (event) => {
    if (scale <= 1) return
    event.preventDefault()
    dragging = true
    dragMoved = 0
    dragStartX = event.clientX
    dragStartY = event.clientY
    dragOriginX = offsetX
    dragOriginY = offsetY
    try { image.setPointerCapture(event.pointerId) } catch {}
    image.style.cursor = 'grabbing'
  })
  image.addEventListener('pointermove', (event) => {
    if (!dragging) return
    dragMoved = Math.max(dragMoved, Math.abs(event.clientX - dragStartX) + Math.abs(event.clientY - dragStartY))
    offsetX = dragOriginX + (event.clientX - dragStartX)
    offsetY = dragOriginY + (event.clientY - dragStartY)
    applyTransform()
    image.style.cursor = 'grabbing'
  })
  const endDrag = (event) => {
    if (!dragging) return
    dragging = false
    try { image.releasePointerCapture(event.pointerId) } catch {}
    applyTransform()
  }
  image.addEventListener('pointerup', endDrag)
  image.addEventListener('pointercancel', endDrag)
  // 双击图片：重置缩放。
  image.addEventListener('dblclick', (event) => {
    event.preventDefault()
    event.stopPropagation()
    resetTransform()
  })

  // 打开后的极短时间里忽略点击：单击打开灯箱后，用户「双击」的第二次点击会落在遮罩上，
  // 否则会出现「打开又立刻被关掉」的抖动。
  const openedAt = performance.now()
  overlay.addEventListener('mousedown', (event) => {
    if (performance.now() - openedAt < 450) return
    if (event.target === overlay || event.target === bg || event.target === content) {
      event.preventDefault()
      close()
    }
  })
  // 拖拽结束时不要因为 click 落在遮罩/内容上而误关闭。
  overlay.addEventListener('click', (event) => {
    if (dragMoved > 4) {
      dragMoved = 0
      event.preventDefault()
      event.stopPropagation()
    }
  })
  /**
   * 高瘦图（例如 A4 比例的论文插图）：按 96vw 铺满宽度打开，让内容能看清；
   * 之后滚轮可以缩回「适配尺寸」（scale=1），也能继续放大。
   */
  const fitWidthForTallImage = () => {
    try {
      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return
      const viewportAspect = window.innerWidth / Math.max(1, window.innerHeight)
      const imageAspect = image.naturalWidth / image.naturalHeight
      if (imageAspect >= viewportAspect * 0.85) return
      const targetWidth = window.innerWidth * 0.96
      const width = image.offsetWidth
      if (width <= 0) return
      const nextScale = Math.min(MAX_SCALE, Math.max(1, targetWidth / width))
      if (nextScale <= 1.0001) return
      scale = nextScale
      offsetX = 0
      offsetY = 0
      applyTransform()
    } catch {}
  }
  image.addEventListener('load', fitWidthForTallImage, { once: true })
  if (image.complete === true) fitWidthForTallImage()

  document.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('resize', onResize)
  document.body.appendChild(overlay)
  overlay.focus()
  applyTransform()
}

/** 上一次图片点击（用于识别「快速点两下」），click 级监听，不受 DOM 重建影响。 */
let lastImageClick = null

/** 供 CM6 bundle 复用：点击图片时打开带滚轮缩放的灯箱。 */
function exposeImageLightbox() {
  try {
    window.__ghMdOpenImageLightbox = (src, title) => { openImageLightbox(src, title) }
  } catch {}
}

function installImageLightbox() {
  if (typeof document === 'undefined') return
  if (document.documentElement.dataset.ghMdLightbox === '1') return
  document.documentElement.dataset.ghMdLightbox = '1'
  document.addEventListener('click', (event) => {
    const target = event.target
    if (target === null || target === undefined || typeof target.closest !== 'function') return
    const image = target.closest('img')
    if (image === null || !image.closest('.gh-md-document')) return
    const src = image.getAttribute('src') ?? ''
    if (src === '') return
    const now = performance.now()
    const previous = lastImageClick
    const closeInTime = previous !== null && now - previous.time < 500 && previous.src === src
    const closeInSpace = previous !== null && Math.abs(event.clientX - previous.x) < 14 && Math.abs(event.clientY - previous.y) < 14
    if (closeInTime && closeInSpace) {
      lastImageClick = null
      event.preventDefault()
      openImageLightbox(src, image.getAttribute('alt') ?? '')
      return
    }
    lastImageClick = { src, time: now, x: event.clientX, y: event.clientY }
  }, true)
}
      const SETTINGS_KEY = 'github-md:settings:v1'
      /** 工作区文件接口前缀：必须与 Host 半边 index.js 的 WORKSPACE_PREFIX 逐字一致。 */
      const WORKBENCH_API = '/github-md/workspace/'
      /** 阅读排版默认值（不再提供设置页；需要调整时改这里）。 */
      const DEFAULT_SETTINGS = {
        readFont: 'sans',
        readSize: 16,
        readLine: 1.5,
        readWidth: 760,
        readPad: 28,
        codeFont: 'mono',
        codeSize: 13,
        codeLine: 1.6,
      }
      /** 字体选项。 */
      const FONT_STACKS = {
        sans: 'var(--dsw-font, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif)',
        serif: '"Literata Variable", "Noto Serif SC", "Source Han Serif SC", Georgia, "SimSun", serif',
        mono: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)',
      }
      const CODE_FONT_STACKS = {
        mono: FONT_STACKS.mono,
        sans: FONT_STACKS.sans,
      }

      /**
       * 读取设置；坏数据回退默认值。
       * @returns 完整设置对象。
       */
      function readSettings() {
        try {
          const raw = localStorage.getItem(SETTINGS_KEY)
          if (raw === null) return { ...DEFAULT_SETTINGS }
          const parsed = JSON.parse(raw)
          return {
            ...DEFAULT_SETTINGS,
            ...parsed,
            readSize: Math.min(22, Math.max(13, Number(parsed.readSize) || DEFAULT_SETTINGS.readSize)),
            readLine: Math.min(2.1, Math.max(1.4, Number(parsed.readLine) || DEFAULT_SETTINGS.readLine)),
            readWidth: Math.min(1100, Math.max(560, Number(parsed.readWidth) || DEFAULT_SETTINGS.readWidth)),
            readPad: Math.min(56, Math.max(12, Number(parsed.readPad) || DEFAULT_SETTINGS.readPad)),
            codeSize: Math.min(18, Math.max(11, Number(parsed.codeSize) || DEFAULT_SETTINGS.codeSize)),
            codeLine: Math.min(2.1, Math.max(1.3, Number(parsed.codeLine) || DEFAULT_SETTINGS.codeLine)),
          }
        } catch {
          return { ...DEFAULT_SETTINGS }
        }
      }

      /**
       * 把设置写进 documentElement 的 CSS 变量，预览与编辑器共用。
       * @param settings - 设置对象。
       * @returns 无。
       */
      function applySettings(settings) {
        const root = document.documentElement
        root.style.setProperty('--gh-md-read-font', FONT_STACKS[settings.readFont] ?? FONT_STACKS.sans)
        root.style.setProperty('--gh-md-read-size', `${settings.readSize}px`)
        root.style.setProperty('--gh-md-read-line', String(settings.readLine))
        root.style.setProperty('--gh-md-read-width', `${settings.readWidth}px`)
        root.style.setProperty('--gh-md-read-pad', `${settings.readPad}px`)
        root.style.setProperty('--gh-md-code-font', CODE_FONT_STACKS[settings.codeFont] ?? CODE_FONT_STACKS.mono)
        root.style.setProperty('--gh-md-code-size', `${settings.codeSize}px`)
        root.style.setProperty('--gh-md-code-line', String(settings.codeLine))
      }


      /** 中文文案。 */
      const zh = {
        title: 'Live Preview Markdown',
        loading: 'Markdown 渲染中…',
        failed: 'Markdown 渲染器加载失败',
        footnotes: '脚注',
        codeLabel: '代码块',
        wrapLabel: '自动换行',
        copyLabel: '复制',
        copiedLabel: '已复制',
        quoteLabel: '引用',
        quoteDone: '已加入引用块',
        quoteDoneText: '已降级为文本引用',
        quoteFailed: '引用失败',
        workbenchTitle: 'Markdown 工作台',
        workbenchDescription: '在右侧栏里浏览、编辑并保存工作区的 Markdown 文件',
        workbenchFiles: '文件',
        workbenchEmpty: '还没有打开文件',
        workbenchChoose: '选择文件',
        workbenchEmptyTitle: '编辑 Markdown',
        workbenchEmptyDesc: '从当前工作区选择一个 .md 文件开始阅读和编辑。',
        workbenchPickTitle: '选择 Markdown 文件',
        workbenchOpenTitle: '打开 Markdown 文件',
        workbenchKeyOpen: '打开',
        workbenchKeyClose: '关闭',
        workbenchSearch: '搜索 Markdown 文件…',
        workbenchNoMatches: '没有匹配的文件',
        workbenchFilesUnit: '个文件',
        workbenchRecent: '最近修改',
        workbenchSource: '源码',
        workbenchPreview: '预览',
        workbenchSplit: '分栏',
        workbenchSave: '保存',
        workbenchSaved: '已保存',
        workbenchUnsaved: '未保存',
        workbenchOutline: '大纲',
        workbenchRefresh: '刷新',
        workbenchNoWorkspace: '当前会话没有工作区目录',
        workbenchLoadFailed: '加载失败',
        workbenchClose: '关闭',
        settingsTitle: '设置',
        settingsBack: '返回',
        settingsReading: '阅读',
        settingsEditor: '编辑器',
        settingsFont: '字体',
        settingsFontSans: '系统',
        settingsFontSerif: '衬线',
        settingsFontMono: '等宽',
        settingsSize: '字号',
        settingsLineHeight: '行高',
        settingsWidth: '内容宽度',
        settingsPadding: '页边距',
        settingsCodeFont: '代码字体',
        settingsCodeSize: '代码字号',
        settingsTabSize: 'Tab 宽度',
        settingsLineNumbers: '显示行号',
        settingsWrap: '自动换行',
        settingsReset: '恢复默认',
        settingsRecommended: '推荐值',
        settingsPreview: '预览',
        settingsOn: '开',
        settingsOff: '关',
        editLabel: '编辑',
        editHere: '在此编辑',
        editSource: '源码',
        editLive: '实时',
        editPreview: '预览',
        editSave: '保存',
        editRetry: '重试保存',
        editConflict: '外部已修改 · 重新载入',
        editReload: '重新载入磁盘版本',
        editSaving: '保存中…',
        editSaved: '已保存',
        editFailed: '保存失败',
        editDirty: '未保存',
        editExit: '退出编辑',
        editExitToPreview: '回预览',
        editDiscard: '放弃未保存的修改？',
        editUnavailable: '当前文档不可写',
        readOnlyNotice: '只读：该文件不在当前工作区内，无法保存',
      }

      /** 英文文案。 */
      const en = {
        title: 'Live Preview Markdown',
        loading: 'Rendering Markdown…',
        failed: 'Markdown renderer failed to load',
        footnotes: 'Footnotes',
        codeLabel: 'Code block',
        wrapLabel: 'Wrap',
        copyLabel: 'Copy',
        copiedLabel: 'Copied',
        quoteLabel: 'Quote',
        quoteDone: 'Added as quote chip',
        quoteDoneText: 'Downgraded to text quote',
        quoteFailed: 'Quote failed',
        workbenchTitle: 'Markdown Workbench',
        workbenchDescription: 'Browse, edit and save workspace Markdown files in the right sidebar',
        workbenchFiles: 'Files',
        workbenchEmpty: 'No file open yet',
        workbenchChoose: 'Choose file',
        workbenchEmptyTitle: 'Edit Markdown',
        workbenchEmptyDesc: 'Choose a .md file from the workspace to read and edit.',
        workbenchPickTitle: 'Choose a Markdown file',
        workbenchOpenTitle: 'Open a Markdown file',
        workbenchKeyOpen: 'Open',
        workbenchKeyClose: 'Close',
        workbenchSearch: 'Search Markdown files…',
        workbenchNoMatches: 'No matching files',
        workbenchFilesUnit: 'files',
        workbenchRecent: 'Recently modified',
        workbenchSource: 'Source',
        workbenchPreview: 'Preview',
        workbenchSplit: 'Split',
        workbenchSave: 'Save',
        workbenchSaved: 'Saved',
        workbenchUnsaved: 'Unsaved',
        workbenchOutline: 'Outline',
        workbenchRefresh: 'Refresh',
        workbenchNoWorkspace: 'This session has no workspace directory',
        workbenchLoadFailed: 'Failed to load',
        workbenchClose: 'Close',
        settingsTitle: 'Settings',
        settingsBack: 'Back',
        settingsReading: 'Reading',
        settingsEditor: 'Editor',
        settingsFont: 'Font',
        settingsFontSans: 'System',
        settingsFontSerif: 'Serif',
        settingsFontMono: 'Mono',
        settingsSize: 'Size',
        settingsLineHeight: 'Line height',
        settingsWidth: 'Content width',
        settingsPadding: 'Page margin',
        settingsCodeFont: 'Code font',
        settingsCodeSize: 'Code size',
        settingsTabSize: 'Tab width',
        settingsLineNumbers: 'Line numbers',
        settingsWrap: 'Wrap lines',
        settingsReset: 'Reset',
        settingsRecommended: 'Recommended',
        settingsPreview: 'Preview',
        settingsOn: 'On',
        settingsOff: 'Off',
        editLabel: 'Edit',
        editHere: 'Edit here',
        editSource: 'Source',
        editLive: 'Live',
        editPreview: 'Preview',
        editSave: 'Save',
        editRetry: 'Retry save',
        editConflict: 'Changed on disk - Reload',
        editReload: 'Reload the file from disk',
        editSaving: 'Saving…',
        editSaved: 'Saved',
        editFailed: 'Save failed',
        editDirty: 'Unsaved',
        editExit: 'Exit edit',
        editExitToPreview: 'Back to preview',
        editDiscard: 'Discard unsaved changes?',
        editUnavailable: 'This document is not writable',
        readOnlyNotice: 'Read-only: this file is outside the current workspace and cannot be saved',
      }

      const h = React.createElement

      /* github-md:render:start —— 渲染管线（纯函数，scripts/render-smoke.mjs 按标记截出来跑） */

      /**
       * 图片版本缓存：绝对路径 → 最后看到的 mtimeMs。
       * /api/file 的响应是 cache-control: private, max-age=31536000, immutable，
       * 文件名不变时浏览器永远不会重新取，所以 URL 上要带 ?v=mtime 才更新。
       */
      const imageVersionCache = new Map()
      const imageVersionKey = (path) => String(path).replace(/\\/gu, '/').toLowerCase()
      const imageVersionParam = (absolutePath) => {
        const version = imageVersionCache.get(imageVersionKey(absolutePath))
        return typeof version === 'number' ? '&v=' + String(Math.round(version)) : ''
      }

      /**
       * HTML 转义，只用于「渲染失败」和 frontmatter 的兜底输出。
       * @param text - 任意文本。
       * @returns 可安全放进 innerHTML 的字符串。
       */
      function escapeHtml(text) {
        return String(text ?? '').replace(/[&<>"']/g, (ch) => ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[ch])
      }

      /**
       * 把开头的 YAML frontmatter 从正文里拆出来（不解析 YAML，原样显示）。
       * @param text - 整篇 Markdown。
       * @returns `{ body, source, prefix }`：正文、frontmatter 原文（没有时为 null）与原文前缀
       *（含分隔符，保存时原样拼回）。
       */
      function splitFrontmatter(text) {
        if (typeof text !== 'string' || !text.startsWith('---')) return { body: text, source: null, prefix: '' }
        const match = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text)
        if (match === null) return { body: text, source: null, prefix: '' }
        return { body: text.slice(match[0].length), source: match[1], prefix: text.slice(0, match[0].length) }
      }

      /**
       * 判断是不是「浏览器自己会处理」的绝对 URL（含 `C:\` 这种 Windows 盘符，那不算 URL）。
       * @param value - 待判断的字符串。
       * @returns 是否为 http(s) / data / blob / 协议相对等绝对地址。
       */
      function isAbsoluteUrl(value) {
        if (/^[a-z]:[\\/]/i.test(value)) return false
        return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)
      }

      /**
       * 标题 slug（GitHub 风格：小写、去标点、空格转连字符）。
       * @param text - 标题文本。
       * @returns 锚点 id 基础值。
       */
      function slugify(text) {
        return String(text ?? '')
          .trim()
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s-]/gu, '')
          .replace(/\s+/g, '-')
      }

      /* ---- 以下图标 / 代码卡 HTML 与官方 Markdown 组件同一份几何，px 对齐用 ---- */

      /** 官方「代码块」标签（未识别语言时代码卡左上角显示它）。 */
      const CODE_BLOCK_LABEL = '代码块'

      /** 复制图标（官方 `IconCopyOutlineRegular`，1px 描边，14px）。 */
      const ICON_COPY = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" stroke-width="1" class="gh-md-icon-copy"><rect x="1.52075" y="4.07373" width="10.3932" height="10.3932" rx="2" stroke="currentColor"></rect><path d="M11.9792 1.53296C13.36 1.53296 14.4792 2.65225 14.4792 4.03296V9.42847C14.4792 10.3756 13.9521 11.1987 13.1755 11.6228V10.3298C13.3652 10.0787 13.4792 9.7674 13.4792 9.42847V4.03296C13.4792 3.20453 12.8077 2.53296 11.9792 2.53296H6.58374C6.27966 2.53301 5.99684 2.6235 5.7605 2.77905H4.42358C4.85652 2.03463 5.66056 1.53304 6.58374 1.53296H11.9792Z" fill="currentColor"></path></svg>'

      /** 复制成功图标（官方 `IconCheckOutlineRegular`）。 */
      const ICON_CHECK = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" stroke-width="1" class="gh-md-icon-check"><path d="M2.25 8.5L5.49732 11.7473C5.90519 12.1552 6.57263 12.1344 6.95426 11.7018L13.75 4" stroke="currentColor"></path></svg>'

      /** 换行图标（官方 `IconWrapFillRegular`）。 */
      const ICON_WRAP = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" class="gh-md-icon-wrap"><path d="M10.9999 8C10.9999 6.89543 10.1046 6 9 6H4.5V5H9C10.6568 5 11.9999 6.34315 11.9999 8C11.9999 9.65685 10.6568 11 9 11H6.20703L6.85351 11.6465L6.14648 12.3535L4.64652 10.8536C4.45126 10.6583 4.45126 10.3417 4.64652 10.1464L6.14648 8.64648L6.85351 9.35352L6.20703 10H9C10.1046 10 10.9999 9.10457 10.9999 8Z" fill="currentColor"></path><path d="M2 15H1V1H2V15Z" fill="currentColor"></path><path d="M15 15H14V1H15V15Z" fill="currentColor"></path></svg>'

      /** 取消换行图标（官方 `IconNowrapFillRegular`）。 */
      const ICON_NOWRAP = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" class="gh-md-icon-nowrap"><path d="M2 15H1V1H2V15Z" fill="currentColor"></path><path d="M12.3535 7.64645C12.5487 7.84171 12.5487 8.15829 12.3535 8.35355L9.85352 10.8535L9.14648 10.1465L10.793 8.5H3.5V7.5H10.793L9.14648 5.85352L9.85352 5.14648L12.3535 7.64645Z" fill="currentColor"></path><path d="M15 15H14V1H15V15Z" fill="currentColor"></path></svg>'

      /** 未知站点的地球图标（官方 `GlobeOutlineArtwork`，1.3px 描边）。 */
      const ICON_GLOBE = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" stroke-width="1.3"><path d="M7.99986 14.0887C11.3626 14.0887 14.0886 11.3627 14.0886 7.99998C14.0886 4.63727 11.3626 1.91125 7.99986 1.91125C4.63715 1.91125 1.91113 4.63727 1.91113 7.99998C1.91113 11.3627 4.63715 14.0887 7.99986 14.0887Z" stroke="currentColor"></path><path d="M2.34619 8H13.6538" stroke="currentColor" stroke-linecap="square"></path><path d="M7.99976 14.0889C9.23509 14.0889 10.1743 11.3629 10.1743 8.00006C10.1743 4.63739 9.23509 1.91138 7.99976 1.91138" stroke="currentColor"></path><path d="M7.99973 14.0889C6.76445 14.0889 5.8252 11.3629 5.8252 8.00006C5.8252 4.63739 6.76445 1.91138 7.99973 1.91138" stroke="currentColor"></path></svg>'

      /**
       * 外链的站点图标：官方 LinkIconMedium 用 simple-icons 的 host→mark 映射，
       * 匹配不到时退回地球图标。
       * @param href - 链接地址。
       * @returns SVG 字符串（无图标时返回地球图标）。
       */
      function linkGlyphSvg(href) {
        const glyphs = globalThis.__githubMdSiteGlyphs
        if (glyphs !== undefined && glyphs !== null) {
          let host = ''
          try {
            const url = new URL(href)
            if (url.protocol === 'http:' || url.protocol === 'https:') host = url.hostname.toLowerCase()
          } catch {
            host = ''
          }
          if (host !== '') {
            let best = ''
            let bestLength = 0
            for (const suffix of Object.keys(glyphs)) {
              if ((host === suffix || host.endsWith(`.${suffix}`)) && suffix.length > bestLength) {
                best = glyphs[suffix]
                bestLength = suffix.length
              }
            }
            if (best !== '') {
              return `<svg width="14" height="14" viewBox="-2 -2 28 28" fill="none" aria-hidden="true" class="gh-md-link-icon"><path d="${best}" fill="currentColor"></path></svg>`
            }
          }
        }
        return ICON_GLOBE.replace('<svg ', '<svg class="gh-md-link-icon" ')
      }

      /**
       * 一张官方同款代码卡（含语言条、换行/复制按钮与 Shiki 高亮）。
       * @param code - 围栏内文本（marked 已去掉尾部换行）。
       * @param lang - 围栏 info string。
       * @param shiki - 可选的 Shiki API；没有时渲染官方 plain 分支。
       * @returns 代码卡 HTML。
       */
      function codeFenceHtml(code, lang, shiki, labels) {
        const info = typeof lang === 'string' && lang !== '' ? lang : undefined
        const grammar = info === undefined ? undefined : /^[\w-]+/.exec(info)?.[0]
        const api = shiki ?? globalThis.__githubMdShiki ?? null
        const supported = api !== null && grammar !== undefined && api.supports(grammar)
        const text = labels !== undefined && labels !== null && typeof labels.codeLabel === 'string' ? labels : { codeLabel: CODE_BLOCK_LABEL, wrapLabel: '自动换行', copyLabel: '复制', copiedLabel: '已复制' }
        const language = supported ? grammar : text.codeLabel
        let body
        if (supported) {
          const highlighted = api.highlight(code, grammar)
          if (highlighted !== null) {
            body = highlighted
          }
        }
        if (body === undefined) {
          const lines = code.split('\n').map((line, index) => `${index > 0 ? '\n' : ''}<span class="line">${escapeHtml(line)}</span>`).join('')
          body = `<pre class="gh-md-code-plain"><code>${lines}</code></pre>`
        }
        return `<div class="gh-md-code-card gh-md-code-block md-code-block" data-code-wrap="true"><div class="gh-md-code-banner-wrap"><div class="gh-md-code-header" data-code-block-banner><div class="gh-md-code-heading"><span class="gh-md-code-language">${escapeHtml(language)}</span></div><div class="gh-md-code-actions"><button type="button" class="gh-md-code-action" aria-label="${escapeHtml(text.wrapLabel)}" aria-pressed="true" data-gh-code-wrap>${ICON_NOWRAP}${ICON_WRAP}</button><button type="button" class="gh-md-code-action" aria-label="${escapeHtml(text.copyLabel)}" data-gh-code-copy data-copied="false" data-copy-label="${escapeHtml(text.copyLabel)}" data-copied-label="${escapeHtml(text.copiedLabel ?? text.copyLabel)}">${ICON_COPY}${ICON_CHECK}</button></div></div></div><div class="gh-md-code-content">${body}</div></div>`
      }

      /**
       * 把一个元素替换成它的子节点（保留子节点自身结构）。
       * @param element - 要拆掉的元素。
       * @returns 无。
       */
      function unwrapElement(element) {
        const parent = element.parentNode
        if (parent === null) return
        while (element.firstChild !== null) parent.insertBefore(element.firstChild, element)
        parent.removeChild(element)
      }

      /**
       * 造一套渲染函数（marked 实例按篇创建，避免多标签页共享可变状态）。
       *
       * @param env - `{ marked, DOMPurify, katex, doc }`：第三方库与 document。
       * @returns `{ render }`：`render(markdown, absolutePath)` 返回消毒后的 HTML。
       */
      function createMarkdownRenderer(env) {
        const { marked, DOMPurify, katex, shiki, doc, markedFootnote, footnotesLabel, codeLabels } = env
        const hasKatex = katex !== undefined && katex !== null
        const shikiApi = shiki ?? null

        /** `^上标^`（Pandoc 风格，内容不能含空白，避免吃掉正常脱字符）。 */
        const superscript = {
          name: 'githubMdSuperscript',
          level: 'inline',
          start(src) {
            const index = src.indexOf('^')
            return index === -1 ? undefined : index
          },
          tokenizer(src) {
            const match = /^\^([^\s^]+?)\^/.exec(src)
            if (match === null) return undefined
            return { type: 'githubMdSuperscript', raw: match[0], text: match[1], tokens: this.lexer.inlineTokens(match[1]) }
          },
          renderer(token) {
            return `<sup>${this.parser.parseInline(token.tokens)}</sup>`
          },
        }

        /** `~下标~`（Pandoc 风格；`~~删除线~~` 交给 GFM，不在这里抢）。 */
        const subscript = {
          name: 'githubMdSubscript',
          level: 'inline',
          start(src) {
            const index = src.indexOf('~')
            return index === -1 ? undefined : index
          },
          tokenizer(src) {
            if (src.startsWith('~~')) return undefined
            const match = /^~(?!~)([^\s~]+?)~(?!~)/.exec(src)
            if (match === null) return undefined
            return { type: 'githubMdSubscript', raw: match[0], text: match[1], tokens: this.lexer.inlineTokens(match[1]) }
          },
          renderer(token) {
            return `<sub>${this.parser.parseInline(token.tokens)}</sub>`
          },
        }

        /**
         * 官方同款 TeX 渲染：严格模式失败后 `strict:'ignore'` 重试，再失败输出 KaTeX 错误 span。
         * @param value - TeX 源。
         * @param displayMode - 是否块级公式。
         * @returns KaTeX 的 HTML 字符串。
         */
        function renderTex(value, displayMode) {
          try {
            return katex.renderToString(value, { displayMode, throwOnError: true })
          } catch (error) {
            try {
              return katex.renderToString(value, { displayMode, strict: 'ignore', throwOnError: false })
            } catch {
              return `<span class="katex-error" style="color:#cc0000" title="${escapeHtml(String(error))}">${escapeHtml(value)}</span>`
            }
          }
        }

        /** `$…$` 行内数学（KaTeX 缺席时由调用方不注册这个扩展）。 */
        const inlineMath = {
          name: 'githubMdInlineMath',
          level: 'inline',
          start(src) {
            const index = src.indexOf('$')
            return index === -1 ? undefined : index
          },
          tokenizer(src) {
            if (src.startsWith('$$')) return undefined
            const match = /^\$(?!\s)((?:\\.|[^$\n])+?)(?<!\s)\$(?!\d)/.exec(src)
            if (match === null) return undefined
            return { type: 'githubMdInlineMath', raw: match[0], text: match[1] }
          },
          renderer(token) {
            return renderTex(token.text, false)
          },
        }

        /** `$$…$$` 块级数学。 */
        const blockMath = {
          name: 'githubMdBlockMath',
          level: 'block',
          start(src) {
            const index = src.indexOf('$$')
            return index === -1 ? undefined : index
          },
          tokenizer(src) {
            const match = /^\$\$[ \t]*\r?\n([\s\S]+?)\r?\n\$\$[ \t]*(?:\r?\n|$)/.exec(src)
            if (match === null) return undefined
            return { type: 'githubMdBlockMath', raw: match[0], text: match[1] }
          },
          renderer(token) {
            return renderTex(token.text, true)
          },
        }

        /**
         * 把 Markdown 图片的 src 解析成本地 `/api/file` 地址。
         * @param src - 作者写的图片地址。
         * @param absolutePath - 当前文档的 Host 绝对路径（可能没有）。
         * @returns 可用的 URL；解析不了时返回 undefined。
         */
        function resolveImage(src, absolutePath) {
          if (typeof src !== 'string' || src === '') return undefined
          if (isAbsoluteUrl(src)) return src
          if (typeof absolutePath !== 'string' || absolutePath === '') return undefined
          const raw = src.split(/[?#]/)[0]
          let decoded
          try {
            decoded = decodeURIComponent(raw)
          } catch {
            return undefined
          }
          if (decoded === '') return undefined
          const directory = absolutePath.slice(0, Math.max(absolutePath.lastIndexOf('/'), absolutePath.lastIndexOf('\\')) + 1)
          const absolute = /^[a-z]:[\\/]/i.test(decoded) ? decoded : `${directory}${decoded}`
          try {
            return new URL(`api/file?path=${encodeURIComponent(absolute)}${imageVersionParam(absolute)}`, doc.baseURI).href
          } catch {
            return undefined
          }
        }

        /**
         * 本地图片换成 `/api/file`；外链保持；解析不了的相对地址去掉 src（别让浏览器去请求 GUI 路由）。
         * @param root - 已消毒的 DOM 片段。
         * @param absolutePath - 当前文档绝对路径。
         * @returns 无。
         */
        function rewriteImages(root, absolutePath) {
          for (const image of root.querySelectorAll('img')) {
            const src = image.getAttribute('src') ?? ''
            const resolved = resolveImage(src, absolutePath)
            if (resolved !== undefined) {
              image.setAttribute('src', resolved)
              continue
            }
            if (!isAbsoluteUrl(src)) image.removeAttribute('src')
          }
        }

        /** 标题加锚点 id；同一 id 递增后缀。脚注区的 sr-only 标题沿用官方 id。 */
        function addHeadingIds(root, seenHeadings) {
          const seen = seenHeadings ?? new Map()
          for (const heading of root.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
            if (heading.closest('section[data-footnotes]') !== null) continue
            const base = slugify(heading.textContent) || 'section'
            const count = seen.get(base) ?? 0
            seen.set(base, count + 1)
            heading.id = count === 0 ? base : `${base}-${count}`
          }
        }

        /**
         * 外链新窗口打开；相对链接退化成纯文本（DSH 预览没有把工作区文件路由接出来，
         * 真让浏览器导航会把整个 GUI 带走）。
         */
        function decorateLinks(root) {
          for (const anchor of root.querySelectorAll('a')) {
            const href = anchor.getAttribute('href') ?? ''
            if (/^https?:\/\//i.test(href)) {
              anchor.setAttribute('target', '_blank')
              anchor.setAttribute('rel', 'noopener noreferrer')
              continue
            }
            if (href.startsWith('#') || /^(?:mailto:|tel:|data:|blob:)/i.test(href)) continue
            // 官方文档预览没有文件 delegate：相对链接退化成纯文本。
            anchor.replaceWith(doc.createTextNode(anchor.textContent ?? href))
          }
        }

        /**
         * 建一个带全部扩展与 renderer 的 marked 实例（脚注等状态每次渲染独立）。
         * @returns marked 实例。
         */
        function createInstance(absolutePath) {
          // 与 Obsidian 默认设置一致（Strict line breaks 关闭）：源码里的单个换行渲染成 <br>，
          // 空行才分段。这样在块编辑器里按 Enter 敲出来的换行，提交后能真的看见。
          const instance = new marked.Marked({ gfm: true, breaks: true })
          if (typeof markedFootnote === 'function') {
            instance.use(markedFootnote({
              prefixId: 'user-content-fn-',
              description: typeof footnotesLabel === 'string' && footnotesLabel !== '' ? footnotesLabel : '脚注',
              footnoteDivider: false,
            }))
          }
          instance.use({
            extensions: hasKatex
              ? [superscript, subscript, inlineMath, blockMath]
              : [superscript, subscript],
            // 图片地址在**消毒之前**解析成绝对的 /api/file 地址：DOMPurify 会把
            // `E:/...` 这种「未知协议」的 src 当成不安全地址直接删掉。
            renderer: {
              code(token) {
                const text = token !== null && token !== undefined && typeof token.text === 'string' ? token.text : ''
                const lang = token !== null && token !== undefined && typeof token.lang === 'string' ? token.lang : undefined
                const empty = text === ''
                if (empty) {
                  const languageClass = typeof lang === 'string' && lang !== '' ? ` class="language-${escapeHtml(lang)}"` : ''
                  return `<pre class="gh-md-code-empty"><code${languageClass}></code></pre>`
                }
                const grammar = typeof lang === 'string' ? /^[\w-]+/.exec(lang)?.[0] : undefined
                if (grammar === 'math' && hasKatex) {
                  return renderTex(`${text}\n`, true)
                }
                return codeFenceHtml(text, lang, shikiApi, codeLabels)
              },
              link(token) {
                const href = token !== null && token !== undefined && typeof token.href === 'string' ? token.href : ''
                const inner = this.parser.parseInline(token.tokens)
                const children = token !== null && token !== undefined && Array.isArray(token.tokens) ? token.tokens : []
                const onlyImages = children.length > 0 && children.every((child) => child !== null && child !== undefined && (child.type === 'image' || child.type === 'imageReference'))
                let external = false
                try {
                  const url = new URL(href)
                  external = url.protocol === 'http:' || url.protocol === 'https:'
                } catch {
                  external = false
                }
                const mailto = /^mailto:/i.test(href)
                // 官方文档预览没有文件 delegate：相对链接 / 片段链接退化为纯文本。
                if (!external && !mailto) return inner
                const glyph = external && !onlyImages ? linkGlyphSvg(href) : ''
                return `<a href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${glyph}${inner}</a>`
              },
              codespan(token) {
                const value = token !== null && token !== undefined && typeof token.text === 'string' ? token.text.replace(/\r?\n|\r/g, ' ') : ''
                if (value.trim() === value) {
                  try {
                    const url = new URL(value)
                    if (url.protocol === 'http:' || url.protocol === 'https:') {
                      return `<code><a href="${escapeHtml(value)}" target="_blank" rel="noopener noreferrer">${linkGlyphSvg(value)}${escapeHtml(value)}</a></code>`
                    }
                  } catch {
                    // 不是绝对 URL：按普通行内代码渲染。
                  }
                }
                return `<code>${escapeHtml(value)}</code>`
              },
              image(token) {
                const href = token !== null && token !== undefined && typeof token.href === 'string' ? token.href : ''
                const text = token !== null && token !== undefined && typeof token.text === 'string' ? token.text : ''
                const resolved = resolveImage(href, absolutePath)
                if (resolved === undefined) return escapeHtml(text)
                return `<img src="${escapeHtml(resolved)}" alt="${escapeHtml(text)}">`
              },
            },
          })
          return instance
        }

        /**
         * 消毒一段 marked 输出的 HTML（允许 SVG / MathML 与桌面端自定义协议）。
         * @param html - marked 生成的 HTML。
         * @returns 消毒后的 HTML。
         */
        function sanitizeHtml(html) {
          return DOMPurify.sanitize(html, {
            USE_PROFILES: { html: true, svg: true, mathMl: true },
            // 桌面端页面基址是自定义协议（`dsh-app://app/`），`/api/file` 图片会解析成
            // `dsh-app://app/api/file?...`。DOMPurify 默认只放行 http(s)/mailto 等，
            // 不把这几个自定义协议加进来，图片的 src 会被整条剥掉（只剩 alt 文本）。
            ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|callto|sms|cid|xmpp|dsh-app|dsh-resource):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
          })
        }

        /**
         * 官方 DOM 对齐：表格自适应容器、任务列表类名、脚注锚点、图片、标题锚点、链接。
         * @param root - 消毒后的 DOM 片段。
         * @param absolutePath - 当前文档绝对路径。
         * @param seenHeadings - 跨块共享的标题 slug 计数。
         * @returns 无。
         */
        function decorateFragment(root, absolutePath, seenHeadings) {
          // 官方表格样式挂在它的滚动容器类上（`_tableScroll_xxx th/td`），并按列数区分
          // 「填充列宽」与「宽表横向滚动」。这里照抄同一套判定：≥4 列且不在引用里 = 宽表。
          for (const table of Array.from(root.querySelectorAll('table'))) {
            for (const cell of Array.from(table.querySelectorAll('th[align],td[align]'))) {
              const align = cell.getAttribute('align')
              cell.removeAttribute('align')
              if (align === 'left' || align === 'right' || align === 'center') cell.style.textAlign = align
            }
            const scroll = doc.createElement('div')
            // 全部表格自适应列宽；列很多、单元格最小宽度撑不下时由容器横向滚动兜底。
            scroll.className = 'gh-md-table-scroll gh-md-table-fill'
            scroll.tabIndex = 0
            scroll.setAttribute('role', 'region')
            scroll.setAttribute('aria-label', '表格，可横向滚动')
            table.replaceWith(scroll)
            scroll.appendChild(table)
          }
          // 官方任务列表带 `contains-task-list` / `task-list-item` 类（DOM 对齐，视觉不变）。
          for (const list of Array.from(root.querySelectorAll('ul,ol'))) {
            if (list.querySelector('input[type=checkbox]') !== null) list.classList.add('contains-task-list')
          }
          for (const item of Array.from(root.querySelectorAll('li'))) {
            if (item.querySelector(':scope > input[type=checkbox], :scope > p > input[type=checkbox]') !== null) item.classList.add('task-list-item')
          }
          // 任务列表的复选框在阅读态可点：去掉 disabled，点击时切源码里的 [ ] / [x]。
          for (const checkbox of Array.from(root.querySelectorAll('input[type=checkbox]'))) {
            checkbox.removeAttribute('disabled')
            checkbox.classList.add('gh-md-task-checkbox')
          }
          // 官方脚注：正文里只留 `<sup>N</sup>`，尾部的回跳是纯文本「↩ / ↩²」；
          // marked-footnote 会生成可点锚点，这里按官方 DOM 把锚点拆掉（保留子节点，
          // 这样多引用时的 `<sup>2</sup>` 仍然是上标）。
          for (const anchor of Array.from(root.querySelectorAll('sup > a[href^="#user-content-fn-"]'))) {
            unwrapElement(anchor)
          }
          for (const anchor of Array.from(root.querySelectorAll('section[data-footnotes] a[href^="#user-content-fn-ref-"]'))) {
            unwrapElement(anchor)
          }
          const footnoteSection = root.querySelector('section[data-footnotes]')
          if (footnoteSection !== null) {
            const label = footnoteSection.firstElementChild
            if (label !== null && label.tagName === 'H2') label.id = 'footnote-label'
            for (const item of Array.from(footnoteSection.querySelectorAll('li[id^="user-content-fn-"]'))) {
              item.id = `user-content-fn-${item.id.slice('user-content-fn-'.length).toLowerCase()}`
            }
          }
          rewriteImages(root, absolutePath)
          addHeadingIds(root, seenHeadings)
          decorateLinks(root)
        }

        /**
         * 渲染整篇 Markdown（保持旧接口：冒烟测试与降级路径都用它）。
         * @param text - Markdown 正文（不含 frontmatter）。
         * @param absolutePath - 当前文档的 Host 绝对路径，用于解析本地图片。
         * @returns 消毒后的 HTML 字符串。
         */
        function render(text, absolutePath) {
          const source = typeof text === 'string' ? text : ''
          try {
            const instance = createInstance(absolutePath)
            const template = doc.createElement('template')
            template.innerHTML = sanitizeHtml(instance.parse(source))
            decorateFragment(template.content, absolutePath, new Map())
            return template.innerHTML
          } catch (error) {
            const message = error !== null && error !== undefined && error.message !== undefined ? error.message : String(error)
            return `<div class="gh-md-error">Markdown 渲染失败：${escapeHtml(message)}</div><pre class="gh-md-fallback">${escapeHtml(source)}</pre>`
          }
        }

        /** 不属于「可编辑块」的顶层 token：空白、链接定义、脚注定义、脚注区。 */
        const NON_BLOCK_TYPES = new Set(['space', 'def', 'footnote', 'footnotes'])

        /**
         * 整篇渲染，但给每个顶层可见块加 `<!--ghmdb:n-->` 哨兵，返回按块切开的 HTML。
         *
         * 哨兵不是直接拼在 Markdown 源里（那会打乱 marked-footnote 的脚注容器），而是作为
         * 额外的 `html` token 插进 token 流再交给 parser —— 所以整篇的语义（脚注、引用式链接、
         * 列表松紧）和一次性 `parse` 完全一致。
         * @param text - Markdown 正文（不含 frontmatter）。
         * @param absolutePath - 当前文档的 Host 绝对路径，用于解析本地图片。
         * @returns `{ blocks, trailingHtml }`：块数组（含原文区间）与哨兵之后的尾段（脚注区）；
         *   哨兵对不上时退回整篇只读渲染（blocks 为空）。
         */
        function renderDocument(text, absolutePath) {
          const source = typeof text === 'string' ? text : ''
          try {
            const instance = createInstance(absolutePath)
            const lexer = new instance.Lexer(instance.defaults)
            const tokens = lexer.lex(source)
            // token 的原文区间：marked 保证 raw 按序拼起来即源文。扩展注入的占位 token
            //（例如 marked-footnote 的 `footnotes` 容器，raw 是说明文字）在源文里找不到，
            // 直接跳过且不推进游标。
            const ranges = new Map()
            let cursor = 0
            for (const token of tokens) {
              const raw = typeof token.raw === 'string' ? token.raw : ''
              if (raw === '') continue
              const found = source.indexOf(raw, cursor)
              if (found === -1) continue
              ranges.set(token, { start: found, end: found + raw.length })
              cursor = found + raw.length
            }
            // 与 marked.parse 相同的 walkTokens：marked-footnote 在这里把脚注区挪到文末。
            const walk = instance.defaults.walkTokens
            if (typeof walk === 'function') instance.walkTokens(tokens, walk)
            const markedTokens = []
            const blocks = []
            for (const token of tokens) {
              markedTokens.push(token)
              if (NON_BLOCK_TYPES.has(token.type)) continue
              const range = ranges.get(token)
              if (range === undefined || range.end <= range.start) continue
              const index = blocks.length
              blocks.push({ type: token.type, raw: token.raw, start: range.start, end: range.end, html: '', editable: true })
              const marker = `<!--ghmdb:${index}-->`
              markedTokens.push({ type: 'html', raw: marker, text: marker, pre: false })
            }
            const html = instance.parser(markedTokens, instance.defaults)
            const parts = html.split(/<!--ghmdb:(\d+)-->/u)
            if (blocks.length === 0 || parts.length !== blocks.length * 2 + 1) {
              return { blocks: [], trailingHtml: render(source, absolutePath) }
            }
            const seenHeadings = new Map()
            for (let index = 0; index < blocks.length; index += 1) {
              const fragment = doc.createElement('template')
              fragment.innerHTML = sanitizeHtml(parts[index * 2])
              decorateFragment(fragment.content, absolutePath, seenHeadings)
              blocks[index].html = fragment.innerHTML
              blocks[index].editable = blocks[index].html.trim() !== ''
            }
            const trailing = doc.createElement('template')
            trailing.innerHTML = sanitizeHtml(parts[parts.length - 1])
            decorateFragment(trailing.content, absolutePath, seenHeadings)
            return { blocks, trailingHtml: trailing.innerHTML }
          } catch (error) {
            const message = error !== null && error !== undefined && error.message !== undefined ? error.message : String(error)
            return {
              blocks: [],
              trailingHtml: `<div class="gh-md-error">Markdown 渲染失败：${escapeHtml(message)}</div><pre class="gh-md-fallback">${escapeHtml(source)}</pre>`,
            }
          }
        }

        return { render, renderDocument }
      }

      /* github-md:render:end */

      /** vendor 脚本的加载结果；同一页面只加载一次。 */
      let vendorPromise = null
      let codeMirrorPromise = null

      /** CM6 Live Preview bundle 的加载结果：模块初始化时预热，避免首次打开先渲染静态版本。 */
      let livePreviewScriptPromise = null

      /** 预热 CM6 bundle（幂等）。 */
      function ensureLivePreviewScript() {
        if (livePreviewScriptPromise !== null) return livePreviewScriptPromise
        try {
          if (typeof window !== 'undefined' && window.__ghMdCm6Disable === true) {
            livePreviewScriptPromise = Promise.resolve()
            return livePreviewScriptPromise
          }
          const base = new URL(ASSET_PREFIX, document.baseURI)
          const url = new URL('cm6-live-preview.js', base).href
          livePreviewScriptPromise = loadScriptOnce(url).catch((error) => {
            livePreviewScriptPromise = null
            throw error
          })
        } catch (error) {
          livePreviewScriptPromise = null
          return Promise.reject(error)
        }
        return livePreviewScriptPromise
      }

      /** Shiki 的加载结果；只在文档里存在围栏代码时才触发。 */
      let shikiPromise = null

      /**
       * 插一个脚本并等它加载完（同一 URL 只插一次）。
       * @param url - 同源脚本地址。
       * @returns 加载完成的 Promise。
       */
      /** 给静态资源 URL 加上构建版本号，确保升级后不会命中旧缓存。 */
      const withBuildVersion = (raw) => {
        try {
          const url = new URL(raw, document.baseURI)
          url.searchParams.set('v', BUILD_STAMP)
          return url.href
        } catch {
          return raw
        }
      }

      function loadScriptOnce(rawUrl) {
        const url = withBuildVersion(rawUrl)
        return new Promise((resolve, reject) => {
          const existing = document.querySelector(`script[data-github-md="${url}"]`)
          if (existing !== null) {
            if (existing.dataset.githubMdDone === '1') {
              resolve()
              return
            }
            existing.addEventListener('load', () => resolve(), { once: true })
            existing.addEventListener('error', () => reject(new Error(`脚本加载失败：${url}`)), { once: true })
            return
          }
          const script = document.createElement('script')
          script.src = url
          script.async = true
          script.dataset.githubMd = url
          script.addEventListener('load', () => {
            script.dataset.githubMdDone = '1'
            resolve()
          }, { once: true })
          script.addEventListener('error', () => reject(new Error(`脚本加载失败：${url}`)), { once: true })
          document.head.appendChild(script)
        })
      }

      /**
       * 插一份样式表（同一 URL 只插一次）。
       * @param href - 同源 CSS 地址。
       * @returns 无。
       */
      function loadStyleOnce(rawHref) {
        const href = withBuildVersion(rawHref)
        if (document.querySelector(`link[data-github-md="${href}"]`) !== null) return
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = href
        link.dataset.githubMd = href
        document.head.appendChild(link)
      }

      /**
       * 懒加载 CodeMirror 5 + Markdown 模式 + 编辑增强（行号、括号、当前行、搜索）。
       * @returns CodeMirror 构造函数。
       */
      function ensureCodeMirror() {
        if (codeMirrorPromise !== null) return codeMirrorPromise
        codeMirrorPromise = (async () => {
          const base = new URL(ASSET_PREFIX, document.baseURI).href
          loadStyleOnce(new URL('codemirror/codemirror.min.css', base).href)
          loadStyleOnce(new URL('codemirror/addon/dialog/dialog.min.css', base).href)
          const scripts = [
            'codemirror/codemirror.min.js',
            'codemirror/mode/xml.min.js',
            'codemirror/mode/markdown.min.js',
            'codemirror/mode/javascript.min.js',
            'codemirror/mode/css.min.js',
            'codemirror/mode/htmlmixed.min.js',
            'codemirror/addon/edit/closebrackets.min.js',
            'codemirror/addon/edit/matchbrackets.min.js',
            'codemirror/addon/selection/active-line.min.js',
            'codemirror/addon/search/searchcursor.min.js',
            'codemirror/addon/dialog/dialog.min.js',
            'codemirror/addon/search/search.min.js',
          ]
          for (const script of scripts) await loadScriptOnce(new URL(script, base).href)
          const CodeMirror = globalThis.CodeMirror
          if (typeof CodeMirror !== 'function') throw new Error('CodeMirror 未就绪')
          return CodeMirror
        })()
        return codeMirrorPromise
      }


      /**
       * 懒加载 marked / DOMPurify /（可选）KaTeX。
       * @returns 三个库（KaTeX 失败时为 undefined）。
       */
      function ensureVendor() {
        if (vendorPromise !== null) return vendorPromise
        vendorPromise = (async () => {
          const base = new URL(ASSET_PREFIX, document.baseURI).href
          await loadScriptOnce(new URL('marked.umd.js', base).href)
          await loadScriptOnce(new URL('purify.min.js', base).href)
          await loadScriptOnce(new URL('site-glyphs.js', base).href)
          let markedFootnote
          try {
            await loadScriptOnce(new URL('marked-footnote.umd.js', base).href)
            markedFootnote = globalThis.markedFootnote
          } catch {
            markedFootnote = undefined
          }
          let katex = globalThis.katex
          if (katex === undefined) {
            try {
              await loadScriptOnce(new URL('katex/katex.min.js', base).href)
              katex = globalThis.katex
            } catch {
              katex = undefined
            }
          }
          if (katex !== undefined) loadStyleOnce(new URL('katex/katex.min.css', base).href)
          const marked = globalThis.marked
          const DOMPurify = globalThis.DOMPurify
          if (marked === undefined || marked === null || typeof marked.Marked !== 'function') {
            throw new Error('marked 未就绪')
          }
          if (DOMPurify === undefined || DOMPurify === null || typeof DOMPurify.sanitize !== 'function') {
            throw new Error('DOMPurify 未就绪')
          }
          return { marked, DOMPurify, katex, markedFootnote }
        })()
        return vendorPromise
      }

      /**
       * 懒加载 Shiki（约 3 MB，只在文档里真有围栏代码时才加载）。
       * @returns `window.__githubMdShiki`。
       */
      function ensureShiki() {
        if (shikiPromise !== null) return shikiPromise
        shikiPromise = (async () => {
          const base = new URL(ASSET_PREFIX, document.baseURI).href
          await loadScriptOnce(new URL('shiki.js', base).href)
          const shiki = globalThis.__githubMdShiki
          if (shiki === undefined || shiki === null) throw new Error('Shiki 未就绪')
          return shiki
        })()
        return shikiPromise
      }

      /**
       * 文档里有没有围栏代码块（决定要不要加载 Shiki）。
       * @param text - Markdown 正文。
       * @returns 是否存在 ``` 或 ~~~ 围栏。
       */
      function hasCodeFence(text) {
        return typeof text === 'string' && /(^|\n)[ \t]*(```|~~~)/.test(text)
      }

      /**
       * 文档样式只插一次。
       *
       * 排版**不继承**预览面板的字体（文档预览的面板层级可能挂着等宽字体，早期版本直接
       * `font: var(--dsw-font, inherit)` 会把整篇渲染成等宽）。这里直接用主题里的官方
       * Markdown token（`--dsw-font-markdown-*`、`--dsw-font-family`、`--dsh-content-font-*`）
       * 把字体、字号、行高和边距钉死，效果与官方 Markdown 预览一致。
       * @returns 无。
       */
      function ensureDocumentStyle() {
        installImageLightbox()
        exposeImageLightbox()
        let style = document.querySelector('style[data-github-md="style"]')
        if (style === null) {
          style = document.createElement('style')
          style.dataset.githubMd = 'style'
          document.head.appendChild(style)
        }
        const css = `
@font-face{font-family:"Literata Variable";font-style:normal;font-weight:200 900;font-display:swap;src:url(${ASSET_PREFIX}literata/literata-latin-wght-normal.woff2) format("woff2-variations");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"Literata Variable";font-style:normal;font-weight:200 900;font-display:swap;src:url(${ASSET_PREFIX}literata/literata-latin-ext-wght-normal.woff2) format("woff2-variations");unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:"Literata Variable";font-style:italic;font-weight:200 900;font-display:swap;src:url(${ASSET_PREFIX}literata/literata-latin-wght-italic.woff2) format("woff2-variations");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"Literata Variable";font-style:italic;font-weight:200 900;font-display:swap;src:url(${ASSET_PREFIX}literata/literata-latin-ext-wght-italic.woff2) format("woff2-variations");unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
:root{--gh-md-ease:cubic-bezier(.2,.8,.2,1);--gh-md-ease-out:cubic-bezier(.16,1,.3,1)}
.gh-md-wb-btn,.gh-md-wb-iconbtn,.gh-md-wb-close,.gh-md-wb-seg button,.gh-md-set-seg button,.gh-md-set-toggle,.gh-md-doc-action,.gh-md-wb-launcher{transition:background-color .16s var(--gh-md-ease),color .16s var(--gh-md-ease),border-color .16s var(--gh-md-ease),box-shadow .16s var(--gh-md-ease),opacity .16s var(--gh-md-ease),transform .12s var(--gh-md-ease-out);touch-action:manipulation;-webkit-user-select:none;user-select:none}
.gh-md-wb-btn:active,.gh-md-wb-iconbtn:active,.gh-md-wb-close:active,.gh-md-set-seg button:active,.gh-md-wb-launcher:active{transform:scale(.97)}
@keyframes gh-md-fade-in{from{opacity:0}to{opacity:1}}
@keyframes gh-md-fade-out{from{opacity:1}to{opacity:0}}
@keyframes gh-md-pop-in{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes gh-md-pop-out{from{opacity:1;transform:translateY(0) scale(1)}to{opacity:0;transform:translateY(4px) scale(.99)}}
@media (prefers-reduced-motion:reduce){.gh-md-wb-btn,.gh-md-wb-iconbtn,.gh-md-wb-close,.gh-md-wb-seg button,.gh-md-set-seg button,.gh-md-set-toggle,.gh-md-doc-action,.gh-md-wb-launcher{transition:none}.gh-md-wb-picker,.gh-md-wb-picker-panel{animation:none!important}}
/* 高度自适应：短文档按内容收缩（不留大片空白），长文档在 max-height 处内部滚动，
   这样 CM6 仍有可滚动容器，能按视口虚拟渲染。 */
.gh-md-cm6-document{min-height:0}
.gh-md-cm6-document .cm-editor{height:auto;max-height:calc(100vh - 190px);background:transparent}
.gh-md-cm6-document .cm-scroller{overflow:auto;max-height:calc(100vh - 190px)}
.gh-md-cm6-long-badge{display:inline-block;margin-left:8px;padding:1px 8px;border-radius:999px;background:rgb(139 108 239 / 12%);color:#8b6cef;font-size:12px}
.gh-md-cm6-document .cm-content{min-height:0}
/* CM6 基础主题在 .cm-editor.cm-focused 上画 1px 点状聚焦框（深灰黑框）；LP 模式不需要它。 */
.gh-md-document .cm-editor,.gh-md-cm6-document .cm-editor,
.gh-md-document .cm-editor.cm-focused,.gh-md-cm6-document .cm-editor.cm-focused,
.gh-md-document .cm-editor:focus,.gh-md-cm6-document .cm-editor:focus,
.gh-md-document .cm-editor:focus-visible,.gh-md-cm6-document .cm-editor:focus-visible{outline:none!important}
.gh-md-document{min-width:0;overflow-wrap:anywhere;white-space:normal;padding:16px min(32px,5%) 24px;font-family:var(--gh-md-read-font,"Literata Variable","Noto Serif SC","Source Han Serif SC",Georgia,"SimSun",serif);font-size:var(--gh-md-read-size,16px);line-height:var(--gh-md-read-line,1.75);color:var(--dsw-alias-label-primary)}
.gh-md-document>:first-child,.gh-md-document p:first-child{margin-top:0!important}
.gh-md-document>:last-child,.gh-md-document p:last-child{margin-bottom:0!important}
.gh-md-document strong{font-weight:600}
.gh-md-document h1,.gh-md-document h2,.gh-md-document h3{margin:32px 0 16px}
.gh-md-document h1{font-family:inherit;font-size:1.618em;line-height:1.2;font-weight:700}
.gh-md-document h2{font-family:inherit;font-size:1.462em;line-height:1.2;font-weight:680}
.gh-md-document h3{font-family:inherit;font-size:1.318em;line-height:1.3;font-weight:660}
.gh-md-document h4{font-family:inherit;font-size:1.188em;line-height:1.4;font-weight:640;margin:16px 0}
.gh-md-document h5{font-family:inherit;font-size:1.076em;line-height:1.5;font-weight:620;margin:16px 0}
.gh-md-document h6{font-family:inherit;font-size:1em;line-height:1.5;font-weight:600;margin:16px 0}
/* 悬停标题时在左侧沟槽显示 Markdown 井号数量（Typora 式，不改变布局）。 */
.gh-md-document :is(h1,h2,h3,h4,h5,h6){position:relative}
.gh-md-document :is(h1,h2,h3,h4,h5,h6)::before{position:absolute;right:100%;top:.18em;padding-right:.55em;color:var(--dsw-alias-label-secondary);font-family:var(--ds-font-family-code);font-size:.6em;font-weight:600;line-height:1;letter-spacing:-.02em;white-space:nowrap;opacity:0;transform:translateX(4px);transition:opacity .12s ease,transform .12s ease;pointer-events:none;user-select:none}
.gh-md-document h1::before{content:"#"}
.gh-md-document h2::before{content:"##"}
.gh-md-document h3::before{content:"###"}
.gh-md-document h4::before{content:"####"}
.gh-md-document h5::before{content:"#####"}
.gh-md-document h6::before{content:"######"}
.gh-md-document :is(h1,h2,h3,h4,h5,h6):hover::before,.gh-md-document :is(h1,h2,h3,h4,h5,h6):focus-visible::before{opacity:.75;transform:translateX(0)}
.gh-md-document :where(h1,h2,h3,h4,h5,h6) strong{font-weight:inherit}
.gh-md-document :where(h4,h5,h6)+:where(ul,ol){margin-top:8px}
.gh-md-document :where(h4,h5,h6):has(+:where(ul,ol)){margin-bottom:8px}
.gh-md-document p{margin:16px 0}
.gh-md-document a{color:var(--dsw-alias-link);font-weight:500;transition:box-shadow var(--ds-transition-duration) var(--ds-ease-in-out);position:relative;text-decoration:none;border-left:3px solid rgb(255 255 255 / 0);border-right:3px solid rgb(255 255 255 / 0);border-top:2px solid rgb(255 255 255 / 0);border-bottom:2px solid rgb(255 255 255 / 0);margin-left:-3px;margin-right:-3px}
.gh-md-document a:hover,.gh-md-document a:focus{outline:none;text-decoration:underline dotted var(--dsw-alias-link);text-underline-offset:3px}
.gh-md-document a:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
.gh-md-document .gh-md-link-icon{flex:none;width:1.1em;height:1.1em;vertical-align:-.25em;margin-right:5px}
.gh-md-document ul,.gh-md-document ol{margin:16px 0;padding-left:18px}
.gh-md-document li:not(:first-child){margin-top:6px}
.gh-md-document li::marker{line-height:28px;color:var(--dsw-alias-label-secondary)}
.gh-md-document :where(ul,ol) ol{list-style-position:inside;padding-left:0}
.gh-md-document :where(ul,ol) ol li p{display:inline}
.gh-md-document li>:where(ul,ol){margin-top:4px}
.gh-md-document li>p{margin:8px 0}
.gh-md-document li>*:first-child{margin-top:0}
.gh-md-document li>*:last-child:not(.gh-md-code-card){margin-bottom:0}
.gh-md-document hr{display:block;border:none;height:.5px;margin:32px 0;background:var(--dsw-alias-border-l2)}
.gh-md-document blockquote{border-left:2px solid var(--dsw-alias-label-caption);margin:16px 0;padding-left:24px}
.gh-md-document input[type=checkbox]{margin:0 8px 0 0;accent-color:var(--dsw-alias-label-secondary)}
.gh-md-document pre{margin:16px 0;padding:12px 16px;background:var(--dsw-alias-bg-layer-2);border-radius:6px;overflow:auto;font-family:var(--ds-font-family-code);font-size:calc(12px + var(--dsh-code-font-delta,0px));line-height:calc(19px + var(--dsh-code-font-delta,0px))}
.gh-md-document pre code{background:transparent;border:0;padding:0;font:inherit}
.gh-md-document :not(pre)>code{display:inline-flex;align-items:center;box-sizing:border-box;font:var(--dsw-font-markdown-code);font-family:var(--ds-font-family-code);font-size:.875em!important;line-height:1.55;background-color:var(--dsw-alias-markdown-inline-code);border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);padding:0 5px}
.gh-md-document :where(h1,h2,h3,h4,h5,h6) code{font:inherit;font-family:var(--ds-font-family-code)}
.gh-md-document .gh-md-table-scroll{max-width:100%;overflow-x:auto;overscroll-behavior-x:contain;container-type:inline-size}
.gh-md-document .gh-md-table-scroll:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
.gh-md-document table{width:auto;max-width:100%;border-collapse:collapse;table-layout:auto;font-size:16px;line-height:1.3}
.gh-md-document th{text-align:start;padding:4px 8px;border:1px solid var(--gh-md-table-border,#e4e4e4);font-family:inherit;font-size:16px;line-height:1.3;font-weight:600;overflow-wrap:break-word;word-break:normal;white-space:normal}
.gh-md-document td{padding:4px 8px;border:1px solid var(--gh-md-table-border,#e4e4e4);font-family:inherit;font-size:16px;line-height:1.3;overflow-wrap:break-word;word-break:normal;white-space:normal}
/* 表格不再强制最小列宽：与 Obsidian 一样按内容宽度并在窄栏内自动换行。 */
.gh-md-document table code{font-size:12px}
.gh-md-document img{display:block;width:auto;max-width:100%;height:auto;margin:0;border-radius:4px;background:var(--dsw-alias-bg-base);object-fit:contain}
.gh-md-document img{cursor:zoom-in}
.gh-md-lightbox{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;outline:none}
.gh-md-lightbox-bg{position:absolute;inset:0;background:rgb(0 0 0/90%)}
.gh-md-lightbox-content{position:relative;display:flex;align-items:center;justify-content:center;max-width:96vw;max-height:92vh}
.gh-md-lightbox-image{max-width:96vw;max-height:92vh;border-radius:4px;box-shadow:0 8px 32px rgb(0 0 0/45%);cursor:zoom-in;transform-origin:center center;user-select:none;touch-action:none}
.gh-md-lightbox-title{position:absolute;top:12px;left:0;right:0;text-align:center;color:rgb(255 255 255/92%);font-size:13px;pointer-events:none}
/* 顶层块包装器用 display:contents：既让点击命中「这一块」，又让块内元素仍按文档直接子元素排布。 */
.gh-md-document .gh-md-block{display:contents}
.gh-md-document .gh-md-static{display:block}
.gh-md-document .gh-md-block:first-child>*:first-child{margin-top:0!important}
.gh-md-document .gh-md-block:last-of-type>*:last-child{margin-bottom:0!important}
.gh-md-block-editor{display:block;margin:0;padding:0;border-radius:0;background:transparent;box-shadow:none}
.gh-md-block-editor .CodeMirror{height:auto;background:transparent;color:var(--dsw-alias-label-primary);font-family:var(--gh-md-read-font,"Literata Variable","Noto Serif SC","Source Han Serif SC",Georgia,"SimSun",serif);font-size:var(--gh-md-read-size,16px);line-height:var(--gh-md-read-line,1.65)}
.gh-md-block-editor .CodeMirror-scroll{overflow:visible!important;min-height:0}
.gh-md-block-editor .CodeMirror-lines{padding:2px 0}
.gh-md-block-editor .CodeMirror pre.CodeMirror-line,.gh-md-block-editor .CodeMirror pre.CodeMirror-line-like{padding:0 2px}
.gh-md-block-editor .CodeMirror-gutters{display:none}
.gh-md-block-editor .CodeMirror-cursor{border-left:1.5px solid var(--dsw-alias-label-primary)}
.gh-md-block-editor .CodeMirror-selected{background:var(--dsw-alias-bg-document-selection)}
.gh-md-block-editor .CodeMirror-activeline-background{background:transparent}
.gh-md-block-editor .cm-s-github-md .cm-header,.gh-md-block-editor .cm-s-github-md .cm-strong,.gh-md-block-editor .cm-s-github-md .cm-em,.gh-md-block-editor .cm-s-github-md .cm-link,.gh-md-block-editor .cm-s-github-md .cm-url,.gh-md-block-editor .cm-s-github-md .cm-quote,.gh-md-block-editor .cm-s-github-md .cm-comment,.gh-md-block-editor .cm-s-github-md .cm-variable-2,.gh-md-block-editor .cm-s-github-md .cm-variable-3,.gh-md-block-editor .cm-s-github-md .cm-atom,.gh-md-block-editor .cm-s-github-md .cm-number,.gh-md-block-editor .cm-s-github-md .cm-keyword,.gh-md-block-editor .cm-s-github-md .cm-string,.gh-md-block-editor .cm-s-github-md .cm-def,.gh-md-block-editor .cm-s-github-md .cm-tag,.gh-md-block-editor .cm-s-github-md .cm-attribute,.gh-md-block-editor .cm-s-github-md .cm-bracket,.gh-md-block-editor .cm-s-github-md .cm-hr{color:inherit}
.gh-md-block-editor .cm-s-github-md .cm-strong{font-weight:600}
.gh-md-block-editor .cm-s-github-md .cm-em{font-style:italic}
.gh-md-block-editor .cm-s-github-md .cm-formatting,.gh-md-block-editor .cm-s-github-md span[class*="cm-formatting"]{color:var(--dsw-alias-label-tertiary)}
.gh-md-block-editor .CodeMirror .gh-md-lp-hidden{display:none}
.gh-md-block-editor .CodeMirror .gh-md-lp-syntax{color:var(--dsw-alias-label-tertiary)}
.gh-md-block-editor .CodeMirror .gh-md-lp-strong{font-weight:700}
.gh-md-block-editor .CodeMirror .gh-md-lp-em{font-style:italic}
.gh-md-block-editor .CodeMirror .gh-md-lp-strike{text-decoration:line-through}
.gh-md-block-editor .CodeMirror .gh-md-lp-code{background:rgb(175 184 193 / 20%);border-radius:4px;padding:0 2px;font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:.92em}
.gh-md-block-editor .CodeMirror .gh-md-lp-link{color:var(--dsw-alias-state-info-primary,#0969da);text-decoration:underline;text-underline-offset:2px}
.gh-md-block-editor .CodeMirror .gh-md-lp-h1{font-size:1.7em;font-weight:700;line-height:1.3}
.gh-md-block-editor .CodeMirror .gh-md-lp-h2{font-size:1.45em;font-weight:700;line-height:1.35}
.gh-md-block-editor .CodeMirror .gh-md-lp-h3{font-size:1.25em;font-weight:600;line-height:1.4}
.gh-md-block-editor .CodeMirror .gh-md-lp-h4{font-size:1.12em;font-weight:600;line-height:1.45}
.gh-md-block-editor .CodeMirror .gh-md-lp-h5{font-size:1.04em;font-weight:600;line-height:1.5}
.gh-md-block-editor .CodeMirror .gh-md-lp-h6{font-size:1em;font-weight:600;line-height:1.5}
.gh-md-document{position:relative}
@keyframes gh-md-undo-flash{0%{background-color:color-mix(in srgb,var(--dsw-alias-state-info-primary,#0969da) 16%,transparent)}100%{background-color:transparent}}
.gh-md-block.gh-md-undo-flash{animation:gh-md-undo-flash .8s ease-out}
.gh-md-cell-input{position:absolute;z-index:40;box-sizing:border-box;padding:2px 6px;border:1.5px solid var(--dsw-alias-state-info-primary,#0969da);border-radius:4px;background:var(--dsw-alias-bg-elevated,#fff);color:var(--dsw-alias-label-primary,inherit);font:inherit;outline:none}
.gh-md-block input[type=checkbox].gh-md-task-checkbox{cursor:pointer;accent-color:var(--dsw-alias-state-info-primary,#0969da)}
.gh-md-block-editor .CodeMirror .gh-md-lp-image{display:inline-block;vertical-align:middle;max-width:100%}
.gh-md-block-editor .CodeMirror .gh-md-lp-image img{max-width:100%;max-height:200px;border-radius:6px;vertical-align:middle}
.gh-md-block-editor .CodeMirror .gh-md-lp-fence{color:var(--dsw-alias-label-tertiary)}
.gh-md-block-editor .CodeMirror .gh-md-hl-keyword{color:#cf222e}
.gh-md-block-editor .CodeMirror .gh-md-hl-string{color:#0a3069}
.gh-md-block-editor .CodeMirror .gh-md-hl-comment{color:#6e7781;font-style:italic}
.gh-md-block-editor .CodeMirror .gh-md-hl-number{color:#0550ae}
.gh-md-block-editor .CodeMirror .gh-md-lp-codeblock{background:rgb(175 184 193 / 10%);font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:.94em}
.gh-md-block-editor .CodeMirror .gh-md-lp-bullet{color:var(--dsw-alias-label-secondary);font-weight:700}
.gh-md-block-editor .CodeMirror .gh-md-lp-bullet-number{color:var(--dsw-alias-label-secondary);font-weight:600}
.gh-md-block-editor .CodeMirror .gh-md-lp-quote{border-left:3px solid var(--dsw-alias-border-l2);padding-left:8px;color:var(--dsw-alias-label-secondary)}
.gh-md-copy-hint{position:fixed;right:22px;bottom:52px;z-index:131;display:inline-flex;align-items:center;gap:6px;max-width:min(420px,calc(100vw - 44px));height:26px;padding:0 10px;border-radius:6px;border:.5px solid var(--dsw-alias-border-l2,#d0d7de);background:var(--dsw-alias-bg-layer-1,#f6f8fa);color:var(--dsw-alias-label-secondary,#57606a);font:500 12px/1 var(--dsw-font,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);box-shadow:0 2px 8px rgb(31 35 40 / 8%)}
.gh-md-copy-hint-text{flex:none}
.gh-md-copy-hint-detail{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary,#8c959f);font-weight:400}
.gh-md-save-pill{position:fixed;right:22px;bottom:18px;z-index:130;display:inline-flex;align-items:center;height:24px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font,inherit);font-size:11px;line-height:1;box-shadow:0 4px 14px rgb(0 0 0 / 10%);cursor:default}
.gh-md-save-pill[data-tone=saving]{color:var(--dsw-alias-label-secondary)}
.gh-md-save-pill[data-tone=saved]{color:var(--dsw-alias-state-success-primary,var(--dsw-alias-label-secondary))}
.gh-md-save-pill[data-tone=error]{color:var(--dsw-alias-state-error-primary,#c0392b);cursor:pointer}
.gh-md-save-pill[data-tone=conflict]{color:var(--dsw-alias-state-warning-primary,#b4690e);cursor:pointer}
.gh-md-document .katex-display{max-width:100%;overflow-x:auto;overflow-y:hidden}
.gh-md-document .gh-md-frontmatter{border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-family:var(--ds-font-family-code);font-size:12px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 14px;padding:8px 10px}
.gh-md-document .gh-md-local-link{color:inherit;text-decoration:underline dotted;cursor:help}
.gh-md-document .gh-md-error{margin:0 0 10px;padding:8px 10px;border-radius:6px;color:var(--dsw-alias-state-error-primary,#c0392b);background:var(--dsw-alias-bg-layer-2)}
.gh-md-status{padding:12px;color:var(--dsw-alias-label-tertiary);font-size:.92em}
.gh-md-status[data-tone=error]{color:var(--dsw-alias-state-error-primary,#c0392b)}
.gh-md-editbar{position:sticky;top:0;z-index:9;display:flex;align-items:center;gap:8px;min-height:36px;margin:0 0 12px;padding:6px 16px;box-sizing:border-box;flex-wrap:wrap;row-gap:4px;background:var(--dsw-alias-bg-base);border-bottom:1px solid var(--dsw-alias-border-l1);font-family:var(--dsw-font,inherit)}
.gh-md-editbar-name{min-width:0;max-width:42%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.gh-md-editbar-spacer{flex:1}
.gh-md-editbar-btn{display:inline-flex;align-items:center;justify-content:center;height:26px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font,inherit);font-size:12px;font-weight:500;line-height:1;white-space:nowrap;cursor:pointer}
.gh-md-editbar-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.gh-md-editbar-btn[disabled]{opacity:.45;cursor:default}
.gh-md-editbar-btn[data-primary=true]{border-color:transparent;background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff}
.gh-md-editbar-btn:focus-visible,.gh-md-editbar-seg button:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.gh-md-editbar-seg{display:inline-flex;padding:2px;gap:2px;border-radius:7px;background:var(--dsw-alias-bg-layer-2)}
.gh-md-editbar-seg button{height:24px;padding:0 8px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font,inherit);font-size:12px;font-weight:500;line-height:1;white-space:nowrap;cursor:pointer}
.gh-md-editbar-seg button[aria-pressed=true]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgb(0 0 0 / 8%)}
.gh-md-editbar-status{min-width:0;font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.gh-md-editbar-status[data-tone=dirty]{color:var(--dsw-alias-state-warn-primary)}
.gh-md-editbar-status[data-tone=failed]{color:var(--dsw-alias-state-error-primary,#c0392b);font-weight:600}
.gh-md-edit-error{display:flex;align-items:center;gap:8px;margin:0 0 8px;padding:6px 8px;border:1px solid var(--dsw-alias-state-error-primary,#c0392b);border-radius:6px;color:var(--dsw-alias-state-error-primary,#c0392b);font-size:12px;line-height:18px}
.gh-md-source{display:block;width:100%;min-height:60vh;padding:0 16px 40px;border:0;border-radius:4px;outline:none;resize:vertical;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:13px/21px var(--ds-font-family-code);white-space:pre-wrap;overflow-wrap:anywhere;tab-size:2;box-sizing:border-box}
.gh-md-source:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.gh-md-quote-button{position:fixed;z-index:100;transform:translateX(-50%);display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px 0 8px;border:1px solid var(--dsw-alias-border-l2,rgb(0 0 0 / 12%));border-radius:8px;background:var(--dsw-alias-bg-elevated,#fff);color:var(--dsw-alias-label-primary);box-shadow:0 2px 10px rgb(0 0 0 / 14%);font:500 12px/1 var(--dsw-font-family);cursor:pointer;white-space:nowrap;user-select:none;transition:background .12s ease,box-shadow .12s ease}
.gh-md-quote-button:hover{background:var(--dsw-alias-bg-layer-2,#f5f6f8);box-shadow:0 3px 14px rgb(0 0 0 / 18%)}
.gh-md-quote-button:active{transform:translateX(-50%) scale(.98)}
.gh-md-quote-button-icon{font-size:17px;line-height:1;margin-top:-1px;color:var(--dsw-alias-brand-primary,#4d6bfe)}
.gh-md-quote-button[data-tone=done]{color:var(--dsw-alias-state-success-primary,var(--dsw-alias-label-primary));cursor:default}
.gh-md-quote-button[data-tone=error]{color:var(--dsw-alias-label-error,#c0392b);cursor:default}
.gh-md-code-card{position:relative;margin:16px 0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-markdown-code-block);border-radius:var(--dsw-radius-lg);font:var(--dsw-font-markdown-code-block);--dsl-code-block-border-radius:var(--dsw-radius-lg);--dsl-code-block-background:var(--dsw-alias-markdown-code-block);--dsl-code-block-content-font:13px/21px var(--ds-font-family-code);--dsl-code-block-banner-font:11px/18px var(--dsw-font-family)}
.gh-md-code-card:not(:last-child){margin-bottom:11px}
.gh-md-code-banner-wrap{position:sticky;top:0;z-index:6;background-color:var(--dsw-alias-bg-base);border-top-left-radius:var(--dsl-code-block-border-radius);border-top-right-radius:var(--dsl-code-block-border-radius)}
.gh-md-code-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 18px 8px 22px;background:var(--dsl-code-block-background);border-top-left-radius:inherit;border-top-right-radius:inherit;color:var(--dsw-alias-label-secondary);font:11px/18px var(--dsw-font-family)}
.gh-md-code-heading{display:flex;align-items:baseline;gap:12px;min-width:0}
.gh-md-code-language{color:var(--dsw-alias-label-tertiary);flex:none;font-family:var(--ds-font-family-code)}
.gh-md-code-actions{display:flex;align-items:center;gap:4px;flex:none}
.gh-md-code-action{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-secondary);background:transparent;cursor:pointer}
@media (hover:hover){.gh-md-code-action:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.gh-md-code-action:focus-visible{outline:1px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.gh-md-code-action svg{display:block}
.gh-md-code-action .gh-md-icon-check{display:none}
.gh-md-code-action .gh-md-icon-wrap{display:none}
.gh-md-code-card[data-code-wrap=false] .gh-md-icon-nowrap{display:none}
.gh-md-code-card[data-code-wrap=false] .gh-md-icon-wrap{display:block}
.gh-md-code-action[data-copied=true] .gh-md-icon-copy{display:none}
.gh-md-code-action[data-copied=true] .gh-md-icon-check{display:block}
.gh-md-code-content{display:contents}
.gh-md-document .gh-md-code-card pre{font:var(--dsl-code-block-content-font);padding:6px 22px 20px;margin:0!important;overflow-x:auto;white-space:pre-wrap;word-break:normal;overflow-wrap:anywhere;background:var(--dsl-code-block-background);border-bottom-left-radius:var(--dsl-code-block-border-radius);border-bottom-right-radius:var(--dsl-code-block-border-radius)}
.gh-md-document .gh-md-code-card pre.shiki{background:var(--dsl-code-block-background)!important}
.gh-md-document .gh-md-code-card pre code{font:inherit;background:none;padding:0}
.gh-md-code-card[data-code-wrap=false] pre{white-space:pre;overflow-wrap:normal}
.gh-md-document pre.gh-md-code-empty{margin:16px 0;padding:0;background:transparent;border-radius:0;font:inherit;font-family:var(--ds-font-family-code);overflow:auto}
.gh-md-wb{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font,inherit)}
.gh-md-wb-head{display:flex;align-items:center;gap:8px;flex-wrap:nowrap;padding:8px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;box-sizing:border-box;background:var(--dsw-alias-bg-base)}
.gh-md-wb-name{min-width:0;max-width:72%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}
.gh-md-wb-spacer{flex:1}
.gh-md-wb-textbtn{display:inline-flex;align-items:center;height:26px;padding:0 8px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font,inherit);font-size:12px;font-weight:500;line-height:1;text-decoration:none;white-space:nowrap;cursor:pointer}
.gh-md-wb-textbtn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.gh-md-wb-textbtn[aria-expanded=true]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.gh-md-wb-actions{display:inline-flex;align-items:center;gap:6px}
.gh-md-wb-seg{display:inline-flex;gap:2px}
.gh-md-wb-seg button{display:inline-flex;align-items:center;justify-content:center;height:24px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font,inherit);font-size:12px;font-weight:500;line-height:1;text-decoration:none;white-space:nowrap;cursor:pointer;transition:background-color .14s var(--gh-md-ease),color .14s var(--gh-md-ease)}
.gh-md-wb-seg button:hover{color:var(--dsw-alias-label-primary)}
.gh-md-wb-seg button[aria-pressed=true]{background:var(--dsw-alias-button-ghost-active-fill);color:var(--dsw-alias-label-primary)}
.gh-md-wb-state{flex:none;min-width:0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap;font-variant-numeric:tabular-nums}
.gh-md-wb-state[data-tone=failed]{color:color-mix(in srgb, var(--dsw-alias-state-error-primary,#c0392b) 86%, var(--dsw-alias-label-primary));font-weight:600}
.gh-md-wb-save-slot{display:inline-block;width:66px;height:26px;flex:none}
.gh-md-wb-btn{display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font,inherit);font-size:12px;font-weight:500;line-height:1;white-space:nowrap;cursor:pointer}
.gh-md-wb-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gh-md-wb-btn[disabled]{opacity:.45;cursor:default}
.gh-md-wb-btn:focus-visible,.gh-md-wb-seg button:focus-visible,.gh-md-wb-launcher:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.gh-md-wb-status{min-width:0;font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.gh-md-wb-status[data-tone=dirty]{color:var(--dsw-alias-state-warn-primary)}
.gh-md-wb-status[data-tone=failed]{color:var(--dsw-alias-state-error-primary,#c0392b);font-weight:600}
.gh-md-wb-body{flex:1;min-height:0;overflow:auto;position:relative}
.gh-md-wb-preview{max-width:calc(var(--gh-md-read-width,760px) + 2 * var(--gh-md-read-pad,28px));margin:0 auto;padding:var(--gh-md-read-pad,28px) var(--gh-md-read-pad,28px) 56px;box-sizing:border-box}
.gh-md-wb-preview .gh-md-document{padding:0;max-width:var(--gh-md-read-width,760px);margin:0 auto}
.gh-md-wb-source{display:block;width:100%;max-width:820px;margin:0 auto;min-height:100%;height:auto;padding:20px 28px 48px;border:0;outline:none;resize:none;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:13px/21px var(--ds-font-family-code);white-space:pre-wrap;overflow-wrap:anywhere;tab-size:2;box-sizing:border-box}
.gh-md-wb-source:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:-2px}
.gh-md-wb-body[data-mode=source]{overflow:hidden}
.gh-md-cm-host{height:100%;min-height:100%;display:flex;flex-direction:column;overflow:hidden}
.gh-md-cm-host .CodeMirror{height:100%;flex:1;max-width:900px;margin:0 auto;background:transparent;color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code);font-size:var(--gh-md-code-size,13px);line-height:var(--gh-md-code-line,1.7)}
.gh-md-cm-host .CodeMirror-scroll{min-height:100%}
.gh-md-cm-host .CodeMirror-lines{padding:18px 0 56px}
.gh-md-cm-host .CodeMirror pre.CodeMirror-line,.gh-md-cm-host .CodeMirror pre.CodeMirror-line-like{padding:0 20px 0 6px}
.gh-md-cm-host .CodeMirror-gutters{background:var(--dsw-alias-bg-base);border-right:1px solid var(--dsw-alias-border-l1)}
.gh-md-cm-host .CodeMirror-linenumber{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:inherit;padding:0 10px 0 12px;min-width:30px}
/* 实时面用「阅读」排版：正文字体/字号/行高/内容宽度，并隐藏行号，让它读起来就是预览。 */
/* 实时面：由 React 属性驱动，不依赖装饰器是否跑起来。 */
.gh-md-cm-host[data-gh-md-live=true] .CodeMirror{max-width:calc(var(--gh-md-read-width,760px) + 2 * var(--gh-md-read-pad,28px));margin:0 auto;font-family:var(--gh-md-read-font,inherit);font-size:var(--gh-md-read-size,16px);line-height:var(--gh-md-read-line,1.65);background:transparent}
.gh-md-cm-host[data-gh-md-live=true] .CodeMirror-lines{padding:22px 0 56px}
.gh-md-cm-host[data-gh-md-live=true] .CodeMirror-gutters{display:none}
.gh-md-cm-host[data-gh-md-live=true] .CodeMirror-gutter-wrapper{display:none}
.gh-md-cm-host[data-gh-md-live=true] .CodeMirror-linewidget{display:none}
.gh-md-cm-host[data-gh-md-live=true] .CodeMirror-activeline-background{background:transparent}
.gh-md-cm-host[data-gh-md-live=true] pre.CodeMirror-line,.gh-md-cm-host[data-gh-md-live=true] pre.CodeMirror-line-like{padding:0 var(--gh-md-read-pad,28px)}
.gh-md-cm-host .CodeMirror.gh-md-live{max-width:calc(var(--gh-md-read-width,760px) + 2 * var(--gh-md-read-pad,28px));margin:0 auto;font-family:var(--gh-md-read-font,inherit);font-size:var(--gh-md-read-size,16px);line-height:var(--gh-md-read-line,1.65);background:transparent}
.gh-md-cm-host .CodeMirror.gh-md-live .CodeMirror-lines{padding:22px 0 56px}
.gh-md-cm-host .gh-md-live .CodeMirror-gutters{display:none}
.gh-md-cm-host .gh-md-live .CodeMirror-gutter-wrapper{display:none}
.gh-md-cm-host .CodeMirror.gh-md-live pre.CodeMirror-line,.gh-md-cm-host .gh-md-live pre.CodeMirror-line-like{padding:0 var(--gh-md-read-pad,28px)}
.gh-md-cm-host .cm-live-mark{color:var(--dsw-alias-label-tertiary);opacity:.55;font-weight:600}
.gh-md-cm-host .cm-live-strong{font-weight:600}
.gh-md-cm-host .cm-live-em{font-style:italic}
.gh-md-cm-host .cm-live-del{text-decoration:line-through;opacity:.75}
.gh-md-cm-host .cm-live-link{color:var(--dsw-alias-link);text-decoration:underline;text-underline-offset:2px}
.gh-md-cm-host .cm-live-code{font-family:var(--ds-font-family-code);font-size:.9em;background:var(--dsw-alias-markdown-inline-code);border-radius:4px;padding:1px 4px}
.gh-md-cm-host .cm-live-quote{background:var(--dsw-alias-bg-layer-1);box-shadow:inset 2px 0 0 var(--dsw-alias-border-l4);color:var(--dsw-alias-label-secondary)}
.gh-md-cm-host .cm-live-hr{display:block;height:1px;margin:8px 0;background:var(--dsw-alias-border-l3)}
.gh-md-cm-host .cm-live-bullet{color:var(--dsw-alias-label-secondary);font-weight:600}
.gh-md-cm-host .cm-live-pipe{color:var(--dsw-alias-border-l4);font-weight:400}
.gh-md-cm-host .cm-live-img{display:block;max-width:100%;max-height:420px;margin:4px 0;border-radius:6px;object-fit:contain}
.gh-md-cm-host span.cm-live-h1,.gh-md-cm-host span.cm-live-h2,.gh-md-cm-host span.cm-live-h3,.gh-md-cm-host span.cm-live-h4,.gh-md-cm-host span.cm-live-h5,.gh-md-cm-host span.cm-live-h6{display:inline;line-height:1.35}
.gh-md-cm-host .cm-live-h1{font-size:1.45em;line-height:1.4;font-weight:700}
.gh-md-cm-host .cm-live-h2{font-size:1.3em;line-height:1.4;font-weight:700}
.gh-md-cm-host .cm-live-h3{font-size:1.16em;line-height:1.45;font-weight:700}
.gh-md-cm-host .cm-live-h4,.gh-md-cm-host .cm-live-h5,.gh-md-cm-host .cm-live-h6{font-weight:600}
.gh-md-cm-host .CodeMirror-cursor{border-left:1.5px solid var(--dsw-alias-label-primary)}
.gh-md-cm-host .CodeMirror-selected{background:var(--dsw-alias-bg-document-selection)}
.gh-md-cm-host .CodeMirror-activeline-background{background:var(--dsw-alias-interactive-bg-hover)}
.gh-md-cm-host .CodeMirror-matchingbracket{color:var(--dsw-alias-label-primary);border-bottom:1px solid var(--dsw-alias-label-primary)}
.gh-md-cm-host .CodeMirror-nonmatchingbracket{color:var(--dsw-alias-state-error-primary)}
.gh-md-cm-host .CodeMirror-dialog{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-bottom:1px solid var(--dsw-alias-border-l2);font-family:var(--dsw-font,inherit);font-size:12px;padding:6px 10px}
.gh-md-cm-host .CodeMirror-dialog input{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:5px;padding:3px 6px;font-family:inherit;font-size:12px}
.gh-md-cm-host .CodeMirror-dialog button{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:5px;font:inherit;padding:2px 8px;cursor:pointer}
.gh-md-cm-host .CodeMirror-scrollbar-filler,.gh-md-cm-host .CodeMirror-gutter-filler{background:transparent}
.cm-s-github-md .cm-header{color:#0550ae;font-weight:700}
.cm-s-github-md .cm-strong{color:#953800;font-weight:600}
.cm-s-github-md .cm-em{color:#8250df;font-style:italic}
.cm-s-github-md .cm-link{color:#0969da;text-decoration:underline}
.cm-s-github-md .cm-url{color:#1a7f37}
.cm-s-github-md .cm-quote{color:#57606a}
.cm-s-github-md .cm-comment{color:#6e7781;font-style:italic}
.cm-s-github-md .cm-variable-2{color:#953800}
.cm-s-github-md .cm-variable-3{color:#8250df}
.cm-s-github-md .cm-atom{color:#cf222e}
.cm-s-github-md .cm-number{color:#0550ae}
.cm-s-github-md .cm-keyword{color:#cf222e}
.cm-s-github-md .cm-string{color:#0a3069}
.cm-s-github-md .cm-def{color:#8250df}
.cm-s-github-md .cm-tag{color:#116329}
.cm-s-github-md .cm-attribute{color:#0550ae}
.cm-s-github-md .cm-bracket{color:#57606a}
.cm-s-github-md .cm-formatting{color:#8b949e}
.cm-s-github-md .cm-hr{color:#8b949e}
body[data-ds-dark-theme] .cm-s-github-md .cm-header{color:#79c0ff}
body[data-ds-dark-theme] .cm-s-github-md .cm-strong{color:#ffa657}
body[data-ds-dark-theme] .cm-s-github-md .cm-em{color:#d2a8ff}
body[data-ds-dark-theme] .cm-s-github-md .cm-link{color:#79c0ff}
body[data-ds-dark-theme] .cm-s-github-md .cm-url{color:#7ee787}
body[data-ds-dark-theme] .cm-s-github-md .cm-quote{color:#8b949e}
body[data-ds-dark-theme] .cm-s-github-md .cm-comment{color:#8b949e}
body[data-ds-dark-theme] .cm-s-github-md .cm-variable-2{color:#ffa657}
body[data-ds-dark-theme] .cm-s-github-md .cm-variable-3{color:#d2a8ff}
body[data-ds-dark-theme] .cm-s-github-md .cm-atom{color:#ff7b72}
body[data-ds-dark-theme] .cm-s-github-md .cm-number{color:#79c0ff}
body[data-ds-dark-theme] .cm-s-github-md .cm-keyword{color:#ff7b72}
body[data-ds-dark-theme] .cm-s-github-md .cm-string{color:#a5d6ff}
body[data-ds-dark-theme] .cm-s-github-md .cm-def{color:#d2a8ff}
body[data-ds-dark-theme] .cm-s-github-md .cm-tag{color:#7ee787}
body[data-ds-dark-theme] .cm-s-github-md .cm-attribute{color:#79c0ff}
body[data-ds-dark-theme] .cm-s-github-md .cm-bracket{color:#8b949e}
body[data-ds-dark-theme] .cm-s-github-md .cm-formatting{color:#6e7681}
.gh-md-wb-empty{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;min-height:240px;padding:24px;color:var(--dsw-alias-label-tertiary);font-size:13px;text-align:center}
.gh-md-wb-picker{position:absolute;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;background:rgb(0 0 0 / 20%);backdrop-filter:blur(4px);animation:gh-md-fade-in .18s var(--gh-md-ease-out)}
.gh-md-wb-picker[data-closing=true]{animation:gh-md-fade-out .15s ease-in forwards}
.gh-md-wb-picker-panel{display:flex;flex-direction:column;width:min(600px,100%);max-height:min(72%,680px);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;box-shadow:0 20px 60px rgb(0 0 0 / 16%);overflow:hidden;animation:gh-md-pop-in .22s var(--gh-md-ease-out)}
.gh-md-wb-picker[data-closing=true] .gh-md-wb-picker-panel{animation:gh-md-pop-out .15s ease-in forwards}
.gh-md-wb-picker-head{display:flex;align-items:flex-start;gap:8px;padding:18px 18px 6px;color:var(--dsw-alias-label-primary)}
.gh-md-wb-picker-title{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.gh-md-wb-picker-title-main{font-size:15px;font-weight:600;line-height:22px}
.gh-md-wb-picker-title-sub{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.gh-md-wb-search{display:flex;align-items:center;gap:8px;margin:10px 14px 6px;padding:0 10px;height:36px;border:1px solid transparent;border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.gh-md-wb-search:focus-within{border-color:var(--dsw-alias-border-l2);box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent)}
.gh-md-wb-search input{flex:1;min-width:0;height:100%;border:0;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font,inherit);font-size:13px}
.gh-md-wb-search input::placeholder{color:var(--dsw-alias-label-secondary)}
.gh-md-wb-row-main{display:flex;align-items:baseline;gap:8px;min-width:0;flex:1}
.gh-md-wb-row-dir{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-secondary)}
.gh-md-wb-link{display:inline-flex;align-items:center;height:22px;padding:0 6px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font,inherit);font-size:11px;font-weight:500;line-height:1;text-decoration:none;white-space:nowrap;cursor:pointer}
.gh-md-wb-link:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.gh-md-wb-link:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
.gh-md-wb-picker-foot{display:flex;align-items:center;gap:8px;padding:8px 14px;border-top:1px solid var(--dsw-alias-border-l1);font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.gh-md-wb-picker-keys{display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-label-secondary)}
.gh-md-wb-picker-keys kbd{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 4px;border:0;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font,inherit);font-size:10px;line-height:1}
.gh-md-wb-status{display:inline-flex;align-items:center;gap:6px;min-width:0;font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.gh-md-wb-status[data-tone=failed]{color:var(--dsw-alias-state-error-primary,#c0392b);font-weight:600}
.gh-md-wb-picker-list{flex:1;min-height:0;overflow:auto;padding:4px 6px}
.gh-md-wb-row{display:flex;align-items:center;gap:10px;width:100%;min-height:40px;padding:6px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font,inherit);font-size:13px;font-weight:400;line-height:20px;text-align:left;cursor:pointer;box-sizing:border-box}
.gh-md-wb-row:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.gh-md-wb-row[data-active=true]{background:var(--dsw-alias-button-ghost-active-fill);color:var(--dsw-alias-label-primary);font-weight:500}
.gh-md-wb-row-caret{flex:none;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;color:var(--dsw-alias-label-secondary)}
.gh-md-wb-row-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;color:var(--dsw-alias-label-secondary)}
.gh-md-wb-row-icon svg,.gh-md-wb-empty-icon svg,.gh-md-wb-tab-title svg,.gh-md-doc-action svg{display:block}
.gh-md-wb-tab-title svg{flex:none}
.gh-md-wb-row-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.gh-md-wb-empty{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;min-height:280px;padding:36px;color:var(--dsw-alias-label-secondary);font-size:13px;text-align:center}
.gh-md-wb-empty-icon{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);margin-bottom:2px}
.gh-md-wb-empty-title{font-size:17px;font-weight:600;line-height:24px;color:var(--dsw-alias-label-primary)}
.gh-md-wb-empty-desc{max-width:300px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.gh-md-wb-close{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.gh-md-wb-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.gh-md-wb-close:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.gh-md-wb-tab-title{display:inline-flex;align-items:center;gap:6px;min-width:0;font-size:12px;font-weight:500;color:var(--dsw-alias-label-primary)}
.gh-md-wb-tab-title > span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gh-md-wb-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none}
.gh-md-wb-iconbtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.gh-md-wb-iconbtn:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.gh-md-set{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base)}
.gh-md-set-head{display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;box-sizing:border-box}
.gh-md-set-back{display:inline-flex;align-items:center;gap:6px;padding:0 8px 0 6px}
.gh-md-set-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.gh-md-set-body{flex:1;min-height:0;overflow:auto;width:100%;max-width:760px;margin:0 auto;padding:24px 20px 56px;box-sizing:border-box}
.gh-md-set-version{margin:4px 0 0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.gh-md-set-section{margin:0 0 30px}
.gh-md-set-section-title{margin:0 0 8px;font-size:13px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary)}
.gh-md-set-row{display:flex;align-items:center;gap:16px;min-height:46px;padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l1);box-sizing:border-box}
.gh-md-set-label{flex:1;min-width:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
.gh-md-set-seg{display:inline-flex;gap:2px;padding:2px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);flex:none}
.gh-md-set-seg button{height:26px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font,inherit);font-size:12px;font-weight:500;line-height:1;white-space:nowrap;cursor:pointer}
.gh-md-set-seg button[aria-pressed=true]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgb(0 0 0 / 10%),inset 0 0 0 1px var(--dsw-alias-border-l2)}
.gh-md-set-seg button:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
.gh-md-set-range{display:flex;align-items:center;gap:10px;width:min(260px,52%);flex:none}
.gh-md-set-range input[type=range]{-webkit-appearance:none;appearance:none;flex:1;min-width:0;height:16px;background:transparent;cursor:pointer}
.gh-md-set-range input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:999px;background:var(--dsw-alias-border-l3)}
.gh-md-set-range input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;margin-top:-5px;border-radius:50%;background:var(--dsw-alias-label-primary);border:2px solid var(--dsw-alias-bg-base);box-shadow:0 1px 3px rgb(0 0 0 / 20%)}
.gh-md-set-range input[type=range]:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:4px;border-radius:999px}
.gh-md-set-value{width:56px;flex:none;text-align:right;font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.gh-md-set-toggle{position:relative;width:36px;height:20px;padding:0;border:0;border-radius:999px;background:var(--dsw-alias-border-l3);cursor:pointer;flex:none;transition:background .18s var(--gh-md-ease),transform .12s var(--gh-md-ease-out)}
.gh-md-set-toggle[aria-checked=true]{background:var(--dsw-alias-label-primary)}
.gh-md-set-toggle:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.gh-md-set-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px rgb(0 0 0 / 18%);transition:transform .18s var(--gh-md-ease)}
.gh-md-set-toggle[aria-checked=true] .gh-md-set-knob{transform:translateX(16px)}
.gh-md-set-preview-wrap{padding-top:20px;border-top:1px solid var(--dsw-alias-border-l1)}
.gh-md-set-preview-title{margin:0 0 8px;font-size:11px;font-weight:600;line-height:16px;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:.06em}
.gh-md-set-sample{padding:0;max-width:var(--gh-md-read-width,760px)}
@media (max-width:520px){.gh-md-set-range{width:100%;flex:1}.gh-md-set-row{flex-wrap:wrap;gap:8px}.gh-md-set-label{flex-basis:100%}}
.gh-md-wb-launcher{display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font,inherit);font-size:12px;font-weight:500;line-height:1;cursor:pointer;white-space:nowrap}
.gh-md-wb-launcher:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.gh-md-wb-launcher-icon{display:inline-flex;flex:none}
.gh-md-doc-action{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer}
.gh-md-doc-action:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.gh-md-doc-action:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.gh-md-wb-btn[data-primary=true]{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,#fff);border-color:transparent;border-radius:8px;height:32px;padding:0 14px;font-size:13px;font-weight:500}
.gh-md-wb-save{display:inline-flex;align-items:center;justify-content:center;width:66px;height:26px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font,inherit);font-size:12px;font-weight:500;line-height:1;text-decoration:none;white-space:nowrap;cursor:pointer;box-sizing:border-box;transition:background-color .14s var(--gh-md-ease),border-color .14s var(--gh-md-ease),color .14s var(--gh-md-ease)}
.gh-md-wb-save:hover{background:var(--dsw-alias-bg-layer-3)}
.gh-md-wb-save[data-tone=failed]{border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary,#c0392b) 70%, transparent);background:transparent;color:color-mix(in srgb, var(--dsw-alias-state-error-primary,#c0392b) 86%, var(--dsw-alias-label-primary))}
.gh-md-wb-save[disabled]{cursor:default;opacity:.6}
.gh-md-wb-save:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.gh-md-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.gh-wb-toolbar{display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;min-height:44px;box-sizing:border-box;flex-wrap:nowrap;overflow-x:auto;white-space:nowrap}
.gh-wb-toolbar > *{flex:none}
.gh-wb-title{font-size:13px;font-weight:600;letter-spacing:.01em}
.gh-wb-path{font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:40%}
.gh-wb-spacer{flex:1}
.gh-wb-btn{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font,inherit);font-size:12px;font-weight:500;line-height:1;cursor:pointer;white-space:nowrap}
.gh-wb-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.gh-wb-btn[disabled]{opacity:.45;cursor:default}
.gh-wb-seg{display:inline-flex;padding:2px;gap:2px;border-radius:7px;background:var(--dsw-alias-bg-layer-2)}
.gh-wb-seg button{height:22px;padding:0 8px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font,inherit);font-size:12px;font-weight:500;line-height:1;cursor:pointer;white-space:nowrap}
.gh-wb-seg button[data-active=true]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgb(0 0 0 / 8%)}
.gh-wb-body{display:flex;flex:1;min-height:0}
.gh-wb-tree{width:236px;flex:none;border-right:1px solid var(--dsw-alias-border-l1);overflow:auto;padding:6px 4px}
.gh-wb-tree-row{display:flex;align-items:center;gap:5px;width:100%;height:26px;padding:0 6px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);font:12px/1 var(--dsw-font);text-align:left;cursor:pointer;overflow:hidden}
.gh-wb-tree-row:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.gh-wb-tree-row[data-active=true]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600}
.gh-wb-tree-caret{width:10px;flex:none;color:var(--dsw-alias-label-tertiary);font-size:10px}
.gh-wb-tree-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gh-wb-tree-dot{width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-label-tertiary);flex:none}
.gh-wb-main{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0}
.gh-wb-tabs{display:flex;align-items:flex-end;gap:2px;padding:4px 8px 0;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-x:auto;flex:none;min-height:34px;box-sizing:border-box}
.gh-wb-tab{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 6px 0 9px;border:1px solid transparent;border-bottom:0;border-radius:6px 6px 0 0;color:var(--dsw-alias-label-secondary);font:12px/1 var(--dsw-font);white-space:nowrap;cursor:pointer}
.gh-wb-tab[data-active=true]{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}
.gh-wb-tab-close{width:16px;height:16px;border:0;border-radius:4px;background:transparent;color:inherit;font-size:12px;line-height:1;cursor:pointer}
.gh-wb-tab-close:hover{background:var(--dsw-alias-bg-layer-2)}
.gh-wb-editor{display:flex;flex:1;min-height:0}
.gh-wb-source{flex:1;min-width:0;width:100%;border:0;outline:none;resize:none;padding:16px 20px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:13px/21px var(--ds-font-family-code);tab-size:2;white-space:pre;overflow:auto;box-sizing:border-box}
.gh-wb-preview{flex:1;min-width:0;overflow:auto;padding:20px 30px 40px;box-sizing:border-box}
.gh-wb-preview .gh-md-document{padding:0;max-width:none}
.gh-wb-empty{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;flex:1;color:var(--dsw-alias-label-tertiary);font-size:13px}
.gh-wb-outline{width:216px;flex:none;border-left:1px solid var(--dsw-alias-border-l1);overflow:auto;padding:10px 8px}
.gh-wb-outline-title{font:600 11px/1 var(--dsw-font);letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);padding:4px 6px 8px}
.gh-wb-outline-row{display:block;width:100%;padding:4px 6px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font,inherit);font-size:12px;line-height:18px;text-align:left;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gh-wb-outline-row:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.gh-wb-status{display:flex;align-items:center;gap:10px;padding:5px 12px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font:11px/16px var(--dsw-font);flex:none}
.gh-wb-status[data-dirty=true]{color:var(--dsw-alias-state-warn-primary)}
@container (max-width:900px){
.gh-wb-tree{position:absolute;left:0;top:0;bottom:0;z-index:8;width:260px;background:var(--dsw-alias-bg-overlay);border-right:1px solid var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-panel,0 8px 24px rgb(0 0 0 / 18%))}
.gh-wb-title,.gh-wb-path{display:none}
.gh-wb-editor{flex-direction:column}
.gh-wb-source,.gh-wb-preview{flex:1 1 50%;min-height:0}
.gh-wb-outline{position:absolute;right:0;top:0;bottom:0;z-index:6;background:var(--dsw-alias-bg-overlay);border-left:1px solid var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-panel,0 8px 24px rgb(0 0 0 / 18%))}
}
`
        // 热更新时模块会被重新执行，旧的 <style> 还留在页面里：这里覆写内容，
        // 否则改 CSS 永远看不到效果（只认第一次注入的那份）。
        if (style.textContent !== css) style.textContent = css
      }

      /**
       * 把选中的正文以官方引用节点插入当前会话的输入框（DSH 0.2.2 的 `message-quotes` 插件）。
       * @param ctx - 插件根上下文。
       * @param sessionId - 当前预览所属 Session。
       * @param text - 选中的纯文本。
       * @returns `applied` / `text` / `unavailable` / `failed` / `empty`（由调用方转成提示文案）。
       */
      function quoteToComposer(ctx, sessionId, text) {
        const value = typeof text === 'string' ? text.trim() : ''
        if (value === '') return 'empty'
        if (typeof sessionId !== 'string' || sessionId === '') return 'unavailable'
        try {
          const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
          const conversation = typeof ctx.get === 'function' ? ctx.get('conversation') : undefined
          if (sessions === undefined || sessions === null || conversation === undefined || conversation === null) return 'unavailable'
          const binding = sessions.binding(sessionId)
          if (binding === undefined || binding === null) return 'unavailable'
          const input = conversation.input
          if (input === undefined || input === null) return 'unavailable'
          let shell
          try {
            shell = typeof input.for === 'function' ? input.for(binding.ctx) : undefined
          } catch {
            shell = undefined
          }
          // 官方 insertQuote：插入 QuoteNode（composer 引用卡片 + 发送时 Markdown blockquote）。
          if (shell !== undefined && shell !== null && shell.actions !== undefined && shell.actions !== null && typeof shell.actions.insertQuote === 'function') {
            try {
              if (shell.actions.insertQuote(value)) return 'applied'
            } catch {
              // 落到下面的纯文本兜底。
            }
          }
          if (typeof input.requestDraftInitialization !== 'function') return 'unavailable'
          const quoted = value.split(/\r?\n/u).map((line) => `> ${line}`).join('\n')
          const status = input.requestDraftInitialization(binding, { prompt: quoted, whenDraftExists: 'append' })
          return status === 'applied' ? 'text' : status
        } catch {
          return 'failed'
        }
      }

      /**
       * 调用 Host 的工作区接口（read / save；tree 保留给旧版本兼容）。
       * @param action - 接口名。
       * @param options - query 或 body 参数。
       * @returns 解析后的 JSON。
       */
      async function workbenchRequest(action, options) {
        const params = new URLSearchParams()
        let body
        const isPost = action === 'save' || action === 'asset'
        if (isPost) {
          body = JSON.stringify(options)
        } else {
          for (const [key, value] of Object.entries(options)) {
            if (value !== undefined && value !== null) params.set(key, String(value))
          }
        }
        const query = params.toString()
        const suffix = isPost ? action : action + (query === '' ? '' : '?' + query)
        const response = await fetch(WORKBENCH_API + suffix, {
          method: isPost ? 'POST' : 'GET',
          headers: isPost ? { 'content-type': 'application/json' } : undefined,
          body,
        })
        let data = null
        try {
          data = await response.json()
        } catch {
          data = null
        }
        if (!response.ok) {
          const message = (data !== null && (data.message ?? data.error)) || 'HTTP ' + response.status
          const error = new Error(String(message))
          if (data !== null && typeof data.error === 'string') error.code = data.error
          throw error
        }
        return data ?? {}
      }

      /**
       * 把「浏览器选区在某个渲染块里的位置」换算成纯文本字符偏移。
       * @param root - 渲染块根元素。
       * @param x - 视口横坐标。
       * @param y - 视口纵坐标。
       * @returns 纯文本偏移；拿不到时返回 -1。
       */
      function plainOffsetFromPoint(root, x, y) {
        let node = null
        let offset = 0
        try {
          if (typeof document.caretRangeFromPoint === 'function') {
            const range = document.caretRangeFromPoint(x, y)
            if (range !== null && range.startContainer !== null && root.contains(range.startContainer)) {
              node = range.startContainer
              offset = range.startOffset
            }
          }
        } catch {}
        if (node === null) return -1
        let total = 0
        const walker = document.createTreeWalker(root, 4, null)
        while (walker.nextNode()) {
          if (walker.currentNode === node) return total + offset
          const value = walker.currentNode.nodeValue
          total += value === null || value === undefined ? 0 : value.length
        }
        return -1
      }

      /**
       * 把「渲染后纯文本下标」映射回「Markdown 原文下标」。
       *
       * Markdown 的标记（#、**、|、- 等）被渲染器吞掉，渲染文本基本是原文的子序列，
       * 因此逐字符向前找即可：命中位置单调递增，不会来回跳。
       * @param raw - 这一块在源文里的原文。
       * @param plain - 这一块渲染后的 textContent。
       * @returns 长度与 plain 相同的下标数组。
       */
      function alignPlainToSource(raw, plain) {
        const map = new Array(plain.length)
        let cursor = 0
        for (let index = 0; index < plain.length; index += 1) {
          const found = raw.indexOf(plain[index], cursor)
          if (found === -1) {
            map[index] = cursor
            continue
          }
          map[index] = found
          cursor = found + 1
        }
        return map
      }

      /**
       * 把一次点击换算成「块内原文的下标」，用来把光标放到点到的位置。
       * @param root - 渲染块根元素。
       * @param raw - 这一块的原文。
       * @param event - 点击事件。
       * @returns 原文下标（找不到时 0）。
       */
      function sourceOffsetOfClick(root, raw, event) {
        const plainOffset = plainOffsetFromPoint(root, event.clientX, event.clientY)
        if (plainOffset < 0) return 0
        const plain = root.textContent ?? ''
        if (plain === '') return 0
        const map = alignPlainToSource(raw, plain)
        const index = Math.max(0, Math.min(plainOffset, map.length - 1))
        const value = map[index]
        return typeof value === 'number' ? value : 0
      }

      /** 光标所在行是否在围栏代码块内（按光标之前的围栏行数判断）。 */
      function isInsideFence(cm, line) {
        let fence = null
        for (let index = 0; index < line; index += 1) {
          const match = /^\s*(```+|~~~+)/u.exec(cm.getLine(index))
          if (match === null) continue
          if (fence === null) fence = match[1][0]
          else if (match[1][0] === fence) fence = null
        }
        return fence !== null
      }

      /**
       * Obsidian 式换行：
       * - Enter 在正文里分段（插入空行）；在列表里续写下一项；在引用里续写 >；在代码块里普通换行；
       * - Shift+Enter 插入软换行（配合 breaks:true 渲染成 <br>）。
       * @param cm - CodeMirror 实例。
       * @param soft - 是否为 Shift+Enter。
       */
      function insertMarkdownNewline(cm, soft) {
        const cursor = cm.getCursor()
        if (soft) {
          // Obsidian：Shift+Enter 插入段内硬换行（行尾两个空格 + 换行）。
          cm.replaceSelection('  \n')
          return
        }
        if (isInsideFence(cm, cursor.line)) {
          cm.replaceSelection('\n')
          return
        }
        const line = cm.getLine(cursor.line)
        const emptyItem = /^(\s*)([-*+]|\d+[.)])\s*$/u.exec(line)
        if (emptyItem !== null) {
          // Obsidian：空列表项再按 Enter 退出列表（去掉标记，留一个空行）。
          cm.replaceRange('', { line: cursor.line, ch: 0 }, { line: cursor.line, ch: line.length })
          cm.setCursor({ line: cursor.line, ch: 0 })
          return
        }
        const list = /^(\s*)([-*+]|\d+[.)])\s+/u.exec(line)
        if (list !== null) {
          const indent = list[1]
          let marker = list[2]
          if (/^\d/u.test(marker)) marker = String(Number.parseInt(marker, 10) + 1) + marker.slice(-1)
          cm.replaceSelection('\n' + indent + marker + ' ')
          return
        }
        const quote = /^(\s*)>\s?/u.exec(line)
        if (quote !== null) {
          cm.replaceSelection('\n' + quote[1] + '> ')
          return
        }
        // Obsidian：Enter 只插入一个换行（同一段落内的软换行）；空行再按 Enter 才形成段落分隔。
        cm.replaceSelection('\n')
      }

      /**
       * 单块源码编辑器：把渲染块就地换成可编辑的 Markdown 原文（Obsidian Live Preview 的心智）。
       * 在 CodeMirror 里编辑，失焦或 Esc 提交，Ctrl+S 提交并落盘。
       * @param props - value / caret / onChange / onCommit / onSave。
       * @returns 编辑块元素。
       */
      function BlockEditor(props) {
        const hostRef = React.useRef(null)
        const cmRef = React.useRef(null)
        const doneRef = React.useRef(false)
        const propsRef = React.useRef(props)
        propsRef.current = props

        React.useEffect(() => {
          let alive = true
          let cm = null
          const commit = () => {
            if (doneRef.current || cm === null) return
            doneRef.current = true
            propsRef.current.onCommit(cm.getValue())
          }
          function moveTableCell(instance, direction) {
            const cursor = instance.getCursor()
            const line = instance.getLine(cursor.line)
            const firstCellCh = (text) => {
              const pipe = text.indexOf('|')
              let ch = pipe === -1 ? 0 : pipe + 1
              while (ch < text.length && text[ch] === ' ') ch += 1
              return ch
            }
            if (direction > 0) {
              const nextPipe = line.indexOf('|', cursor.ch + 1)
              if (nextPipe !== -1) {
                let ch = nextPipe + 1
                while (ch < line.length && line[ch] === ' ') ch += 1
                instance.setCursor({ line: cursor.line, ch })
                return
              }
              if (cursor.line + 1 < instance.lineCount()) {
                instance.setCursor({ line: cursor.line + 1, ch: firstCellCh(instance.getLine(cursor.line + 1)) })
                return
              }
              const columns = Math.max(1, instance.getLine(0).split('|').length - 2)
              const row = '|' + Array(columns).fill('   ').join('|') + '|'
              const lastLine = instance.lineCount() - 1
              instance.replaceRange('\n' + row, { line: lastLine, ch: instance.getLine(lastLine).length })
              instance.setCursor({ line: lastLine + 1, ch: 2 })
              return
            }
            const before = line.slice(0, cursor.ch)
            const prevPipe = before.lastIndexOf('|', before.length - 2)
            if (prevPipe > 0) {
              let ch = prevPipe + 1
              while (ch < line.length && line[ch] === ' ') ch += 1
              instance.setCursor({ line: cursor.line, ch })
              return
            }
            if (cursor.line > 0) {
              const prevLine = instance.getLine(cursor.line - 1)
              let ch = prevLine.lastIndexOf('|', prevLine.length - 2)
              if (ch < 0) ch = prevLine.length
              while (ch > 0 && prevLine[ch] === ' ') ch -= 1
              instance.setCursor({ line: cursor.line - 1, ch })
            }
          }
          function wrapSelection(marker) {
            const instance = cmRef.current
            if (instance === null) return
            const selected = instance.getSelection()
            if (selected === '') {
              instance.replaceSelection(marker + marker)
              instance.setCursor(instance.posFromIndex(instance.indexFromPos(instance.getCursor()) - marker.length))
            } else {
              instance.replaceSelection(marker + selected + marker)
            }
          }
          ensureCodeMirror().then((CodeMirror) => {
            if (!alive || hostRef.current === null) return
            cm = CodeMirror(hostRef.current, {
              value: typeof propsRef.current.value === 'string' ? propsRef.current.value : '',
              mode: 'markdown',
              lineNumbers: false,
              lineWrapping: true,
              theme: 'github-md',
              viewportMargin: Infinity,
              cursorBlinkRate: 530,
              extraKeys: {
                Enter: (instance) => {
                  if (propsRef.current.table === true) {
                    const firstLine = instance.getLine(0)
                    const columns = Math.max(1, firstLine.split('|').length - 2)
                    const row = '|' + Array(columns).fill('   ').join('|') + '|'
                    const lastLine = instance.lineCount() - 1
                    const endCh = instance.getLine(lastLine).length
                    instance.replaceRange('\n' + row, { line: lastLine, ch: endCh })
                    instance.setCursor({ line: lastLine + 1, ch: 2 })
                    return true
                  }
                  const cursor = instance.getCursor()
                  const line = instance.getLine(cursor.line)
                  const inFence = isInsideFence(instance, cursor.line)
                  const inList = /^(\s*)([-*+]|\d+[.)])(\s+|$)/u.test(line)
                  const inQuote = /^(\s*)>\s?/u.test(line)
                  insertMarkdownNewline(instance, false)
                  return true
                },
                'Shift-Enter': (instance) => {
                  if (propsRef.current.table === true) {
                    instance.replaceSelection('<br>')
                    return true
                  }
                  insertMarkdownNewline(instance, true)
                  return true
                },
                Backspace: (instance) => {
                  if (instance.somethingSelected()) return false
                  if (instance.indexFromPos(instance.getCursor()) !== 0) return false
                  if (typeof propsRef.current.onMergePrevious !== 'function') return false
                  return propsRef.current.onMergePrevious() === true
                },
                Delete: (instance) => {
                  if (instance.somethingSelected()) return false
                  const index = instance.indexFromPos(instance.getCursor())
                  if (index !== instance.getValue().length) return false
                  if (typeof propsRef.current.onMergeNext !== 'function') return false
                  return propsRef.current.onMergeNext() === true
                },
                Tab: (instance) => {
                  if (propsRef.current.table === true) {
                    moveTableCell(instance, 1)
                    return true
                  }
                  const ranges = instance.listSelections()
                  const first = ranges.length > 0 ? ranges[0] : null
                  if (first !== null && first.anchor.line !== first.head.line) {
                    const startLine = Math.min(first.anchor.line, first.head.line)
                    const endLine = Math.max(first.anchor.line, first.head.line)
                    instance.operation(() => {
                      for (let line = startLine; line <= endLine; line += 1) instance.replaceRange('  ', { line, ch: 0 })
                    })
                    return true
                  }
                  instance.replaceSelection('  ')
                  return true
                },
                'Shift-Tab': (instance) => {
                  if (propsRef.current.table === true) {
                    moveTableCell(instance, -1)
                    return true
                  }
                  const ranges = instance.listSelections()
                  const first = ranges.length > 0 ? ranges[0] : null
                  if (first !== null && first.anchor.line !== first.head.line) {
                    const startLine = Math.min(first.anchor.line, first.head.line)
                    const endLine = Math.max(first.anchor.line, first.head.line)
                    instance.operation(() => {
                      for (let line = startLine; line <= endLine; line += 1) {
                        const indent = /^ {1,2}/u.exec(instance.getLine(line))
                        if (indent !== null) instance.replaceRange('', { line, ch: 0 }, { line, ch: indent[0].length })
                      }
                    })
                    return true
                  }
                  const cursor = instance.getCursor()
                  const line = instance.getLine(cursor.line)
                  const indent = /^ {1,2}/u.exec(line)
                  if (indent !== null) {
                    instance.replaceRange('', { line: cursor.line, ch: 0 }, { line: cursor.line, ch: indent[0].length })
                    instance.setCursor({ line: cursor.line, ch: Math.max(0, cursor.ch - indent[0].length) })
                  }
                  return true
                },
                Down: (instance) => {
                  if (instance.somethingSelected()) return false
                  if (instance.getCursor().line !== instance.lineCount() - 1) return false
                  if (typeof propsRef.current.onMoveNext !== 'function') return false
                  return propsRef.current.onMoveNext() === true
                },
                Up: (instance) => {
                  if (instance.somethingSelected()) return false
                  if (instance.getCursor().line !== 0) return false
                  if (typeof propsRef.current.onMovePrevious !== 'function') return false
                  return propsRef.current.onMovePrevious() === true
                },
                Right: (instance) => {
                  if (instance.somethingSelected()) return false
                  if (instance.indexFromPos(instance.getCursor()) !== instance.getValue().length) return false
                  if (typeof propsRef.current.onMoveNext !== 'function') return false
                  return propsRef.current.onMoveNext() === true
                },
                Left: (instance) => {
                  if (instance.somethingSelected()) return false
                  if (instance.indexFromPos(instance.getCursor()) !== 0) return false
                  if (typeof propsRef.current.onMovePrevious !== 'function') return false
                  return propsRef.current.onMovePrevious() === true
                },
                'Ctrl-Enter': (instance) => {
                  const cursor = instance.getCursor()
                  const line = instance.getLine(cursor.line)
                  const match = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/u.exec(line)
                  if (match === null) return false
                  const toggled = match[2] === ' ' ? 'x' : ' '
                  instance.replaceRange(toggled, { line: cursor.line, ch: match[1].length }, { line: cursor.line, ch: match[1].length + 1 })
                  return true
                },
                'Cmd-Enter': (instance) => {
                  const cursor = instance.getCursor()
                  const line = instance.getLine(cursor.line)
                  const match = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/u.exec(line)
                  if (match === null) return false
                  const toggled = match[2] === ' ' ? 'x' : ' '
                  instance.replaceRange(toggled, { line: cursor.line, ch: match[1].length }, { line: cursor.line, ch: match[1].length + 1 })
                  return true
                },
                'Ctrl-Z': (instance) => {
                  if (instance.historySize().undo > 0) return false
                  if (typeof propsRef.current.onUndo !== 'function') return false
                  propsRef.current.onUndo()
                  return true
                },
                'Cmd-Z': (instance) => {
                  if (instance.historySize().undo > 0) return false
                  if (typeof propsRef.current.onUndo !== 'function') return false
                  propsRef.current.onUndo()
                  return true
                },
                'Ctrl-Y': (instance) => {
                  if (instance.historySize().redo > 0) return false
                  if (typeof propsRef.current.onRedo !== 'function') return false
                  propsRef.current.onRedo()
                  return true
                },
                'Cmd-Shift-Z': (instance) => {
                  if (instance.historySize().redo > 0) return false
                  if (typeof propsRef.current.onRedo !== 'function') return false
                  propsRef.current.onRedo()
                  return true
                },
                'Ctrl-B': () => { wrapSelection('**'); return true },
                'Cmd-B': () => { wrapSelection('**'); return true },
                'Ctrl-I': () => { wrapSelection('*'); return true },
                'Cmd-I': () => { wrapSelection('*'); return true },
                Esc: () => { commit(); return true },
                'Ctrl-S': () => { commit(); if (typeof propsRef.current.onSave === 'function') propsRef.current.onSave(); return true },
                'Cmd-S': () => { commit(); if (typeof propsRef.current.onSave === 'function') propsRef.current.onSave(); return true },
                'Ctrl-F': 'findPersistent',
                'Cmd-F': 'findPersistent',
              },
            })
            cmRef.current = cm
            cm.on('change', () => {
              // 每次输入都同步给父组件（只写 ref，不触发渲染）：提交时父组件手里永远是最新草稿。
              if (!doneRef.current && cm !== null && typeof propsRef.current.onChange === 'function') {
                propsRef.current.onChange(cm.getValue())
              }
            })
            const fit = () => {
              try {
                const height = Math.max(28, cm.getDoc().height + 8)
                cm.setSize('100%', height)
              } catch {}
            }
            fit()
            cm.on('change', fit)
            // Obsidian Live Preview 近似：非当前行隐藏 Markdown 标记，并给标题/粗体/斜体/行内代码上样式。
            const lpMarks = []
            const lpLineClasses = []
            let composing = false
            const decorate = () => {
              const instance = cmRef.current
              if (instance === null) return
              // 输入法组合期间不动装饰：markText/refresh 会打断中文候选词。
              if (composing) return
              for (const mark of lpMarks) mark.clear()
              lpMarks.length = 0
              for (const entry of lpLineClasses) instance.removeLineClass(entry.line, 'wrap', entry.cls)
              lpLineClasses.length = 0
              const cursorLine = instance.getCursor().line
              const total = instance.lineCount()
              let inFence = false
              for (let line = 0; line < total; line += 1) {
                const lineText = instance.getLine(line)
                const isCurrent = line === cursorLine
                const hide = (from, to) => {
                  if (to > from) lpMarks.push(instance.markText({ line, ch: from }, { line, ch: to }, { className: 'gh-md-lp-hidden' }))
                }
                const dim = (from, to) => {
                  if (to > from) lpMarks.push(instance.markText({ line, ch: from }, { line, ch: to }, { className: 'gh-md-lp-syntax' }))
                }
                const style = (from, to, cls) => {
                  if (to > from) lpMarks.push(instance.markText({ line, ch: from }, { line, ch: to }, { className: cls }))
                }
                // Obsidian 的规则：当前行保留语法标记（淡化显示），其它行把标记隐藏。
                const syntax = (from, to) => {
                  if (isCurrent) dim(from, to)
                  else hide(from, to)
                }
                const fenceMatch = /^\s*(```+|~~~+)/u.exec(lineText)
                if (fenceMatch !== null) {
                  syntax(0, lineText.length)
                  instance.addLineClass(line, 'wrap', 'gh-md-lp-fence')
                  lpLineClasses.push({ line, cls: 'gh-md-lp-fence' })
                  inFence = !inFence
                  continue
                }
                if (inFence) {
                  instance.addLineClass(line, 'wrap', 'gh-md-lp-codeblock')
                  lpLineClasses.push({ line, cls: 'gh-md-lp-codeblock' })
                  const codePattern = /(\/\/[^\n]*|#[^\n]*|'[^'\n]*'|"[^"\n]*"|`[^`\n]*`|\b\d+(?:\.\d+)?\b|\b(?:const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|new|this|true|false|null|undefined|def|lambda|True|False|None|pass|elif|try|except|with|as|in|not|and|or)\b)/gu
                  let codeMatch
                  while ((codeMatch = codePattern.exec(lineText)) !== null) {
                    const token = codeMatch[0]
                    let cls = 'gh-md-hl-keyword'
                    if (token.startsWith('//') || token.startsWith('#')) cls = 'gh-md-hl-comment'
                    else if (token.startsWith("'") || token.startsWith('"') || token.startsWith('`')) cls = 'gh-md-hl-string'
                    else if (/^\d/u.test(token)) cls = 'gh-md-hl-number'
                    lpMarks.push(instance.markText({ line, ch: codeMatch.index }, { line, ch: codeMatch.index + token.length }, { className: cls }))
                  }
                  continue
                }
                const bullet = /^(\s*)([-*+])(\s+)/u.exec(lineText)
                if (bullet !== null) {
                  const markerStart = bullet[1].length
                  if (isCurrent) {
                    dim(markerStart, markerStart + 1)
                  } else {
                    const bulletNode = document.createElement('span')
                    bulletNode.className = 'gh-md-lp-bullet'
                    bulletNode.textContent = '\u2022'
                    lpMarks.push(instance.markText({ line, ch: markerStart }, { line, ch: markerStart + 1 }, { replacedWith: bulletNode }))
                  }
                }
                const ordered = /^(\s*)(\d+[.)])(\s+)/u.exec(lineText)
                if (ordered !== null) {
                  const markerStart = ordered[1].length
                  const markerEnd = markerStart + ordered[2].length
                  if (isCurrent) dim(markerStart, markerEnd)
                  else lpMarks.push(instance.markText({ line, ch: markerStart }, { line, ch: markerEnd }, { className: 'gh-md-lp-bullet-number' }))
                }
                let offset = 0
                const heading = /^(#{1,6})(\s+)/u.exec(lineText)
                if (heading !== null) {
                  syntax(0, heading[0].length)
                  const cls = 'gh-md-lp-h' + heading[1].length
                  instance.addLineClass(line, 'wrap', cls)
                  lpLineClasses.push({ line, cls })
                  offset = heading[0].length
                }
                const quote = /^(\s*>+\s?)/u.exec(lineText.slice(offset))
                if (quote !== null) {
                  syntax(offset, offset + quote[0].length)
                  instance.addLineClass(line, 'wrap', 'gh-md-lp-quote')
                  lpLineClasses.push({ line, cls: 'gh-md-lp-quote' })
                  offset += quote[0].length
                }
                const rest = lineText.slice(offset)
                const pattern = /(!\[[^\]]*\]\([^)]*\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+\]\([^)]*\))/gu
                let match
                while ((match = pattern.exec(rest)) !== null) {
                  const start = offset + match.index
                  const token = match[0]
                  if (token.startsWith('![')) {
                    const imageMatch = /^!\[([^\]]*)\]\(([^)]*)\)/u.exec(token)
                    const resolved = imageMatch !== null && typeof propsRef.current.imageResolver === 'function' ? propsRef.current.imageResolver(imageMatch[2]) : undefined
                    if (!isCurrent && imageMatch !== null && typeof resolved === 'string') {
                      const wrapper = document.createElement('span')
                      wrapper.className = 'gh-md-lp-image'
                      const image = document.createElement('img')
                      image.setAttribute('src', resolved)
                      image.setAttribute('alt', imageMatch[1])
                      wrapper.appendChild(image)
                      image.addEventListener('load', () => {
                        try {
                          instance.refresh()
                          instance.setSize('100%', Math.max(28, instance.getDoc().height + 8))
                        } catch {}
                      })
                      lpMarks.push(instance.markText({ line, ch: start }, { line, ch: start + token.length }, { replacedWith: wrapper }))
                    } else {
                      syntax(start, start + token.length)
                    }
                    continue
                  }
                  if (token.startsWith('`')) {
                    syntax(start, start + 1)
                    style(start + 1, start + token.length - 1, 'gh-md-lp-code')
                    syntax(start + token.length - 1, start + token.length)
                  } else if (token.startsWith('**') || token.startsWith('__')) {
                    syntax(start, start + 2)
                    style(start + 2, start + token.length - 2, 'gh-md-lp-strong')
                    syntax(start + token.length - 2, start + token.length)
                  } else if (token.startsWith('~~')) {
                    syntax(start, start + 2)
                    style(start + 2, start + token.length - 2, 'gh-md-lp-strike')
                    syntax(start + token.length - 2, start + token.length)
                  } else if (token.startsWith('*') || token.startsWith('_')) {
                    syntax(start, start + 1)
                    style(start + 1, start + token.length - 1, 'gh-md-lp-em')
                    syntax(start + token.length - 1, start + token.length)
                  } else if (token.startsWith('[')) {
                    const close = token.indexOf('](')
                    syntax(start, start + 1)
                    style(start + 1, start + close, 'gh-md-lp-link')
                    syntax(start + close, start + token.length)
                  }
                }
              }
              try {
                instance.refresh()
                instance.setSize('100%', Math.max(28, instance.getDoc().height + 8))
              } catch {}
            }
            const compositionField = cm.getInputField()
            compositionField.addEventListener('compositionstart', () => {
              composing = true
            })
            compositionField.addEventListener('compositionend', () => {
              composing = false
              decorate()
            })
            let lpTimer = null
            const decorateSoon = () => {
              if (lpTimer !== null) window.clearTimeout(lpTimer)
              lpTimer = window.setTimeout(() => {
                lpTimer = null
                decorate()
              }, 80)
            }
            cm.on('cursorActivity', decorate)
            cm.on('change', decorateSoon)
            window.setTimeout(decorate, 0)
            window.setTimeout(fit, 0)
            const caret = Number(propsRef.current.caret)
            if (Number.isFinite(caret)) {
              const pos = cm.posFromIndex(Math.max(0, Math.min(caret, cm.getValue().length)))
              cm.setCursor(pos)
            }
            cm.focus()
          }).catch((error) => {
            if (hostRef.current !== null) hostRef.current.textContent = String(error?.message ?? error)
          })
          return () => {
            alive = false
            // 组件被卸载时把最后一次输入也塞回草稿（父组件的 onChange 只写 ref，不触发渲染）。
            if (!doneRef.current && cm !== null) {
              const value = cm.getValue()
              if (typeof propsRef.current.onFlush === 'function') propsRef.current.onFlush(value)
              else if (typeof propsRef.current.onChange === 'function') propsRef.current.onChange(value)
            }
            doneRef.current = true
            const instance = cmRef.current
            cmRef.current = null
            if (instance !== null) instance.getWrapperElement().remove()
          }
        }, [])

        return h('div', { className: 'gh-md-block-editor', 'data-editing': 'true' },
          h('div', { className: 'gh-md-block-editor-host', ref: hostRef }))
      }

      /**
       * 文档正文组件：渲染 Markdown，并把「点击某一块」变成「就地编辑这一块」。
       *
       * 阅读态是整个渲染好的文档；点任意段落 / 标题 / 表格 / 代码块 / 图片，只有这一块原地变成
       * Markdown 原文（CodeMirror），其余块保持渲染。点别处 / Esc 提交并重渲染，Ctrl+S 立即落盘。
       * 编辑过程中不写盘：写盘会让官方预览跟着重载，正在编辑的块会被卸载。
       * @param props - 官方预览的 slot props（content / resourceAddress / useResource / t / quoteSelection / sessionId）。
       * @returns 正文元素。
       */
      const cm6EditorMemory = new Map()
      const cm6HistoryMemory = new Map()
      const cm6FoldMemory = new Map()
      /** 每个文件记住滚动位置：宿主重挂载或切走再回来时恢复，避免跳回顶部。 */
      /** 保存防抖：默认 1500ms；集成测试可用 window.__ghMdSaveDelay 覆盖。 */
      const saveDebounceDelay = () => {
        const override = typeof window !== 'undefined' ? Number(window.__ghMdSaveDelay) : Number.NaN
        return Number.isFinite(override) && override > 0 ? override : 1500
      }
      const cm6ScrollMemory = new Map()
      /** 宿主重挂载预览时，用上一帧的编辑器 DOM 克隆做占位，避免出现空白帧（闪烁）。 */
      let cm6Placeholder = null
      let cm6PlaceholderScroll = 0
      let cm6PlaceholderPath = ''

      function MarkdownBody(props) {
        const { content } = props
        const t = props.t
        const quoteSelection = props.quoteSelection
        const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
        // 面板内跳转：body 注入的 useTabInfo 提供 tab.actions.openResource（同面板替换当前预览）。
        const useTabInfo = typeof props.useTabInfo === 'function' ? props.useTabInfo : null
        let tabActions = null
        try {
          const tabInfo = useTabInfo === null ? null : useTabInfo()
          tabActions = tabInfo !== null && tabInfo !== undefined && tabInfo.tab !== undefined ? tabInfo.tab.actions ?? null : null
        } catch {}
        const tabActionsRef = React.useRef(null)
        tabActionsRef.current = tabActions
        const resourceAddressRef = React.useRef(typeof props.resourceAddress === 'string' ? props.resourceAddress : '')
        resourceAddressRef.current = typeof props.resourceAddress === 'string' ? props.resourceAddress : ''
        const streamText = content !== null && content !== undefined && content.kind === 'text' && typeof content.text === 'string' ? content.text : ''
        const eof = content !== null && content !== undefined && content.kind === 'text' && content.eof === true
        const [quoteTarget, setQuoteTarget] = React.useState(null)
        const [quoteFeedback, setQuoteFeedback] = React.useState(null)
        const rootRef = React.useRef(null)
        const [vendor, setVendor] = React.useState(null)
        const vendorRef = React.useRef(null)
        const [failure, setFailure] = React.useState(null)
        const [shiki, setShiki] = React.useState(null)
        const [shikiFailed, setShikiFailed] = React.useState(false)
        const [docText, setDocText] = React.useState(streamText)
        const [editing, setEditing] = React.useState(null)
        const [cellEdit, setCellEdit] = React.useState(null)
        const cellEditRef = React.useRef(null)
        const cm6HostRef = React.useRef(null)
        const cm6PendingExternalRef = React.useRef(null)
        const cm6BlocksRendererRef = React.useRef(null)
        const cm6ShikiRef = React.useRef(null)
        const cm6ViewRef = React.useRef(null)
        // 首帧陷阱：bundle 已预热时直接以"已加载"初始化，避免先画一帧静态渲染再切换成编辑器。
        const [cm6Loaded, setCm6Loaded] = React.useState(() => {
          try {
            return typeof window !== 'undefined' && window.__ghMdCm6Disable !== true && window.__ghMdCm6LivePreview !== undefined
          } catch {
            return false
          }
        })
        /** CM6 bundle 加载失败或超时：放弃等待，退回静态渲染（此前只引用未定义，会直接抛 ReferenceError）。 */
        const [cm6GaveUp, setCm6GaveUp] = React.useState(false)
        const [editable, setEditable] = React.useState(false)
        /** 是否已确认「可写/只读」：确认前不要先渲染静态排版（与编辑器排版不同，会被看成样式错误）。 */
        const [editableKnown, setEditableKnown] = React.useState(false)
        const [saveState, setSaveState] = React.useState('idle')
        const [saveMessage, setSaveMessage] = React.useState('')
        /** 链接复制反馈：独立于保存状态，避免点链接时误显示"已保存"。 */
        const [copyHint, setCopyHint] = React.useState(null)
        const copyHintTimerRef = React.useRef(null)
        const docTextRef = React.useRef(streamText)
        const editingRef = React.useRef(null)
        const dirtyRef = React.useRef(false)
        /** 是否检测到「磁盘被外部修改」的冲突。 */
        const conflictRef = React.useRef(false)
        const commitEditingRef = React.useRef(null)
        const saveTimerRef = React.useRef(null)
        const saveStateTimerRef = React.useRef(null)
        const exactRef = React.useRef(false)
        const eolRef = React.useRef('\n')
        const savedTextRef = React.useRef('')
        /** 最后一次从磁盘读到 / 成功写回的内容：保存时作为"我基于哪一版"的基线。 */
        const lastDiskTextRef = React.useRef('')
        const pendingSaveTextRef = React.useRef('')
        /** 最近一次改动时间：可见状态下用 5 分钟兜底写盘。 */
        const dirtyAtRef = React.useRef(0)
        const pendingEditRef = React.useRef(null)
        const historyRef = React.useRef({ past: [], future: [] })
        const undoRef = React.useRef(null)
        const redoRef = React.useRef(null)
        const sourcePathRef = React.useRef(undefined)
        const blocksRef = React.useRef([])
        const aliveRef = React.useRef(true)
        const tr = (key, fallback) => (t !== undefined ? t(key) : fallback)


        // 官方文档预览不会把绝对路径塞进 props：它按 tab 的资源地址去资源模型里取，
        // 官方 MarkdownBody 也是这么做的（`useResource(resourceAddress).value.absolutePath`）。
        const resourceAddress = typeof props.resourceAddress === 'string' ? props.resourceAddress : ''
        const resource = typeof props.useResource === 'function' ? props.useResource(resourceAddress) : undefined
        const sourcePath = typeof props.sourcePath === 'string' && props.sourcePath !== ''
          ? props.sourcePath
          : (typeof resource?.value?.absolutePath === 'string' ? resource.value.absolutePath : undefined)

        /** 编辑器里预览图片用：把 Markdown 里的相对路径解析成 /api/file（与渲染态同一套规则）。 */
        const resolveImageForEditor = (src) => {
          if (typeof src !== 'string' || src === '') return undefined
          if (isAbsoluteUrl(src)) return src
          // 必须读 ref：CM6 视图只创建一次，闭包里的 sourcePath 可能是 undefined（恢复标签页时资源后到）。
          const sourcePath = sourcePathRef.current
          if (typeof sourcePath !== 'string' || sourcePath === '') return undefined
          void sourcePath
          const raw = src.split(/[?#]/)[0]
          let decoded
          try {
            decoded = decodeURIComponent(raw)
          } catch {
            return undefined
          }
          if (decoded === '') return undefined
          const directory = sourcePath.slice(0, Math.max(sourcePath.lastIndexOf('/'), sourcePath.lastIndexOf('\\')) + 1)
          const absolute = /^[a-z]:[\\/]/i.test(decoded) ? decoded : `${directory}${decoded}`
          try {
            return new URL(`api/file?path=${encodeURIComponent(absolute)}${imageVersionParam(absolute)}`, document.baseURI).href
          } catch {
            return undefined
          }
        }
        sourcePathRef.current = sourcePath

        // 文档绝对路径后到时（恢复标签页 / 资源异步加载），CM6 的图片解析器才有值：
        // 这里重建一次装饰，让图片 widget 真正生成。
        const cm6PathRef = React.useRef(undefined)
        React.useEffect(() => {
          if (typeof sourcePath !== 'string' || sourcePath === '') return
          if (cm6PathRef.current === sourcePath) return
          cm6PathRef.current = sourcePath
          const instance = cm6ViewRef.current
          if (instance !== null && instance !== undefined && typeof instance.refresh === 'function') {
            instance.refresh()
          }
        }, [sourcePath, cm6Loaded])

        // 图片版本：打开文档、内容重载、切回窗口时按 Host 上的 mtime 更新 /api/file 的 ?v=，
        // 否则 /api/file 的 immutable 缓存会让替换过的图片一直显示旧内容。
        // 预览是异步挂载的（占位 → CM6/静态），所以这里轮询等图片真正出现在 DOM 里。
        React.useEffect(() => {
          let cancelled = false
          let attempts = 0
          const currentRoot = () => {
            const staticRoot = rootRef.current
            if (staticRoot !== null && staticRoot !== undefined) return staticRoot
            const cm6Root = cm6HostRef.current
            return cm6Root === null || cm6Root === undefined ? null : cm6Root
          }
          const tick = () => {
            if (cancelled === true) return
            const root = currentRoot()
            if (root !== null && root.querySelector('img') !== null) {
              void refreshPreviewImageVersions(root, sessionId)
              return
            }
            attempts += 1
            if (attempts < 60) window.setTimeout(tick, 250)
          }
          tick()
          return () => { cancelled = true }
        }, [cm6Loaded, editable, docText, sessionId])

        // 诊断上报：预览渲染后、以及滚动时，把「结构性事实」写回 Host（插件目录 diagnostics.log）。
        // 只用于排查图片/路径这类只能在桌面端复现的问题。
        React.useEffect(() => {
          let lastPost = 0
          const post = () => {
            const now = Date.now()
            if (now - lastPost < 2500) return
            lastPost = now
            try {
              const collect = Array.from(document.querySelectorAll('.gh-md-document img'))
                .filter((node) => node.className !== 'cm-widgetBuffer')
                .slice(0, 12)
                .map((node) => ({
                  src: String(node.getAttribute('src') ?? '').slice(0, 240),
                  natural: [node.naturalWidth, node.naturalHeight],
                }))
              const payload = {
                baseURI: String(document.baseURI),
                hasEditor: document.querySelector('.cm-editor') !== null,
                hasBundle: typeof window.__ghMdCm6LivePreview !== 'undefined',
                editable: editable === true,
                sourcePath: typeof sourcePath === 'string' ? sourcePath : null,
                docLength: String(docText ?? '').length,
                imageLines: String(docText ?? '').split('\n').filter((line) => /^\s*!\[[^\]]*\]\([^)]+\)\s*$/u.test(line)).slice(0, 4),
                widgets: document.querySelectorAll('.gh-md-lp-image').length,
                images: collect,
                placeholder: Array.from(document.querySelectorAll('.gh-md-lp-image-missing')).map((node) => String(node.textContent).slice(0, 120)).slice(0, 4),
              }
              void fetch('/github-md/workspace/diagnose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
            } catch {}
          }
          const timer = window.setTimeout(post, 4000)
          document.addEventListener('scroll', post, true)
          return () => {
            window.clearTimeout(timer)
            document.removeEventListener('scroll', post, true)
          }
        }, [docText, sourcePath, cm6Loaded, editable])

        React.useEffect(() => {
          const onFocus = () => {
            const staticRoot = rootRef.current
            const root = staticRoot !== null && staticRoot !== undefined ? staticRoot : cm6HostRef.current
            void refreshPreviewImageVersions(root, sessionId)
          }
          window.addEventListener('focus', onFocus)
          return () => window.removeEventListener('focus', onFocus)
        }, [sessionId])

        React.useEffect(() => () => {
          aliveRef.current = false
          if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
          if (saveStateTimerRef.current !== null) window.clearTimeout(saveStateTimerRef.current)
          // 卸载（切 tab / 关预览）时把未落盘的草稿尽力发出去。
          if (dirtyRef.current && typeof sourcePathRef.current === 'string' && sessionId !== '') {
            try {
              const body = eolRef.current === '\r\n' ? docTextRef.current.replace(/\n/gu, '\r\n') : docTextRef.current
              fetch(WORKBENCH_API + 'save', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ sessionId, path: sourcePathRef.current, content: body, base: lastDiskTextRef.current }),
                keepalive: true,
              })
            } catch {}
          }
        }, [])

        React.useEffect(() => {
          let alive = true
          ensureVendor().then((loaded) => {
            if (alive) setVendor(loaded)
          }, (error) => {
            if (alive) setFailure(error)
          })
          return () => { alive = false }
        }, [])

        // 懒加载 CodeMirror 6 的 Live Preview 原型包（vendor/cm6-live-preview.js）。
        React.useEffect(() => {
          let alive = true
          // 测试环境可以关掉 CM6（旧 harness 仍验证 CM5 fallback）。
          if (window.__ghMdCm6Disable === true) return undefined
          let gaveUpTimer = 0
          ensureLivePreviewScript().then(() => {
            if (alive && window.__ghMdCm6LivePreview !== undefined) {
              window.clearTimeout(gaveUpTimer)
              setCm6Loaded(true)
              return
            }
            if (alive) setCm6GaveUp(true)
          }, () => {
            if (alive) setCm6GaveUp(true)
          })
          // 兜底：12s 还没就绪就别一直占位（宁可先用静态渲染）
          gaveUpTimer = window.setTimeout(() => {
            if (alive && window.__ghMdCm6LivePreview === undefined) setCm6GaveUp(true)
          }, 12000)
          return () => {
            alive = false
            window.clearTimeout(gaveUpTimer)
          }
        }, [])

        // 可写文件才切到 CM6 编辑器；只读文件继续用旧的只读渲染。
        // 真实浏览器用 useLayoutEffect：宿主重建时在 paint 前就位，占位快照不会被画出来（不闪）；
        // jsdom 集成测试里容器尚未挂载，沿用 useEffect。
        const cm6MountEffect = (typeof navigator !== 'undefined' && /jsdom/iu.test(String(navigator.userAgent ?? ''))) ? React.useEffect : React.useLayoutEffect
        cm6MountEffect(() => {
          if (!cm6Loaded || !editable) return undefined
          // 首帧陷阱：CM6 在 paint 前创建，而文档 CSS 原先在 useEffect（paint 后）才注入，
          // 重启后第一次打开会因为"无样式布局"量错尺寸/样式。这里先注入再建编辑器。
          ensureDocumentStyle()

          const host = cm6HostRef.current
          const api = window.__ghMdCm6LivePreview
          if (host === null || api === undefined || typeof api.createLivePreview !== 'function') return undefined
          if (cm6ViewRef.current !== null) return undefined
          // 清掉上一帧留下的占位克隆（组件重挂载时 ref 已经把它塞进 host）
          for (const stale of Array.from(host.querySelectorAll('[data-ghmd-placeholder="1"]'))) {
            if (stale.parentNode !== null) stale.parentNode.removeChild(stale)
          }
          cm6Placeholder = null
          const view = api.createLivePreview({
            onStateChange: (state) => {
              if (typeof sourcePath !== 'string' || sourcePath === '') return
              cm6EditorMemory.set(sourcePath, state)
              const history = cm6HistoryMemory.get(sourcePath)
              if (history === undefined) {
                cm6HistoryMemory.set(sourcePath, { past: [], future: [], last: state.text, lastHead: state.head })
                return
              }
              if (state.text === history.last) return
              const now = Date.now()
              if (now - (Number(history.lastPushAt) || 0) > 600) {
                history.past.push({ text: history.last, head: history.lastHead })
                if (history.past.length > 100) history.past.shift()
                history.future.length = 0
                history.lastPushAt = now
              }
              history.last = state.text
              history.lastHead = state.head
            },
            foldedLines: typeof sourcePath === 'string' ? cm6FoldMemory.get(sourcePath) : undefined,
            onFoldChange: (lines) => {
              if (typeof sourcePath !== 'string') return
              if (!Array.isArray(lines)) return
              if (lines.length === 0) cm6FoldMemory.delete(sourcePath)
              else cm6FoldMemory.set(sourcePath, lines.slice(0, 200))
            },
            saveNow: () => {
              void persist()
            },
            undoFallback: () => {
              const history = typeof sourcePath === 'string' ? cm6HistoryMemory.get(sourcePath) : undefined
              if (history === undefined || history.past.length === 0) return undefined
              const previous = history.past.pop()
              history.future.push({ text: history.last, head: history.lastHead })
              history.last = previous.text
              history.lastHead = previous.head
              return previous
            },
            redoFallback: () => {
              const history = typeof sourcePath === 'string' ? cm6HistoryMemory.get(sourcePath) : undefined
              if (history === undefined || history.future.length === 0) return undefined
              const next = history.future.pop()
              history.past.push({ text: history.last, head: history.lastHead })
              history.last = next.text
              history.lastHead = next.head
              return next
            },
            parent: host,
            doc: docTextRef.current,
            onChange: (value) => {
              if (value === docTextRef.current) return
              docTextRef.current = value
              dirtyRef.current = true
              scheduleSave()
            },
            resolveImage: resolveImageForEditor,
            renderMath: (tex, display) => {
              const current = vendorRef.current
              const katex = current === null || current === undefined ? undefined : current.katex
              if (katex === undefined || katex === null || typeof katex.renderToString !== 'function') return undefined
              try {
                return katex.renderToString(tex, { displayMode: display === true, throwOnError: false })
              } catch {
                return undefined
              }
            },
            insertAsset: (fileName, dataUrl) => {
              if (typeof dataUrl !== 'string' || dataUrl.startsWith('data:') === false) return
              if (typeof sourcePath !== 'string' || sourcePath === '') return
              if (sessionId === '') return
              const comma = dataUrl.indexOf(',')
              if (comma < 0) return
              const base64 = dataUrl.slice(comma + 1)
              const rawName = String(fileName === undefined || fileName === null ? '' : fileName).trim()
              const dot = rawName.lastIndexOf('.')
              const stem = (dot > 0 ? rawName.slice(0, dot) : rawName).replace(/[\\/:*?"<>|]/gu, '-') || 'image'
              const extension = dot > 0 ? rawName.slice(dot).toLowerCase() : '.png'
              const directory = sourcePath.slice(0, Math.max(sourcePath.lastIndexOf('/'), sourcePath.lastIndexOf('\\')) + 1)
              const stamp = Date.now().toString(36)
              const relativeName = stem + '-' + stamp + extension
              const absolute = directory + relativeName
              workbenchRequest('asset', { sessionId, path: absolute, base64 }).then(() => {
                const host = cm6ViewRef.current
                if (host === null || host === undefined) return
                const view = host.view
                const head = view.state.selection.main.head
                const insert = '![[' + relativeName + ']]'
                view.dispatch({ changes: { from: head, to: head, insert }, selection: { anchor: head + insert.length } })
                view.focus()
              }, (error) => {
                console.error('[gh-md-asset] save failed', String(error && error.message ? error.message : error))
              })
            },
            resolveEmbed: (target, container) => {
              const attempt = (remaining) => {
                const current = vendorRef.current
                if (current === null || current === undefined) {
                  if (remaining > 0) window.setTimeout(() => attempt(remaining - 1), 300)
                  return
                }
                if (sessionId === '') return
                const clean = String(target).split('|')[0].trim()
                if (clean === '') return
                const directory = sourcePath.slice(0, Math.max(sourcePath.lastIndexOf('/'), sourcePath.lastIndexOf('\\')) + 1)
                const withExt = /\.[a-z0-9]+$/iu.test(clean) ? clean : clean + '.md'
                const absolute = /^[a-z]:[\\/]/iu.test(withExt) ? withExt : directory + withExt
                workbenchRequest('read', { sessionId, path: absolute }).then((data) => {
                  if (container.isConnected !== true) return
                  const renderer = createMarkdownRenderer({
                    marked: current.marked,
                    DOMPurify: current.DOMPurify,
                    katex: current.katex,
                    shiki: null,
                    markedFootnote: current.markedFootnote,
                    footnotesLabel: tr('footnotes', '脚注'),
                    codeLabels: {
                      codeLabel: tr('codeLabel', '代码块'),
                      wrapLabel: tr('wrapLabel', '自动换行'),
                      copyLabel: tr('copyLabel', '复制'),
                      copiedLabel: tr('copiedLabel', '已复制'),
                    },
                    doc: document,
                  })
                  const split = splitFrontmatter(String(data.content ?? ''))
                  try {
                    container.innerHTML = renderer.render(split.body, absolute)
                  } catch (error) {
                    console.error('[gh-md-embed] render failed', String(error && error.message ? error.message : error))
                  }
                }, (error) => {
                  console.error('[gh-md-embed] read failed', String(error && error.message ? error.message : error))
                })
              }
              attempt(10)
            },
            renderInlineHtml: (html) => {
              const vendor = vendorRef.current
              if (vendor === null || vendor === undefined) return undefined
              const purifier = vendor.DOMPurify
              if (purifier === null || purifier === undefined || typeof purifier.sanitize !== 'function') return undefined
              try {
                return purifier.sanitize(String(html), {
                  ALLOWED_TAGS: ['kbd', 'sup', 'sub', 'mark', 'u', 's', 'del', 'ins', 'b', 'strong', 'i', 'em', 'span', 'br', 'small', 'abbr', 'cite', 'q', 'code', 'var', 'samp'],
                  ALLOWED_ATTR: ['style', 'class', 'title'],
                })
              } catch {
                return undefined
              }
            },
            renderBlocks: (text) => {
              const vendor = vendorRef.current
              if (vendor === null || vendor === undefined) return undefined
              try {
                if (cm6BlocksRendererRef.current === null) {
                  cm6BlocksRendererRef.current = createMarkdownRenderer({
                    marked: vendor.marked,
                    DOMPurify: vendor.DOMPurify,
                    katex: vendor.katex,
                    shiki: cm6ShikiRef.current,
                    markedFootnote: vendor.markedFootnote,
                    footnotesLabel: tr('footnotes', '脚注'),
                    codeLabels: {
                      codeLabel: tr('codeLabel', '代码块'),
                      wrapLabel: tr('wrapLabel', '自动换行'),
                      copyLabel: tr('copyLabel', '复制'),
                      copiedLabel: tr('copiedLabel', '已复制'),
                    },
                    doc: document,
                  })
                }
                return cm6BlocksRendererRef.current.render(String(text), sourcePath)
              } catch {
                return undefined
              }
            },
            renderCode: (source, lang) => {
              const api = globalThis.__githubMdShiki
              if (api === null || api === undefined) return undefined
              const grammar = /^([\w-]+)/u.exec(String(lang ?? ''))?.[1]
              if (grammar === undefined) return undefined
              try {
                if (typeof api.supports === 'function' && api.supports(grammar) !== true) return undefined
                return api.highlight(source, grammar)
              } catch {
                return undefined
              }
            },
            renderInline: (text) => {
              const current = vendorRef.current
              if (current === null || current === undefined) return undefined
              try {
                const html = current.marked.parseInline(String(text))
                return current.DOMPurify.sanitize(html)
              } catch {
                return undefined
              }
            },
          })
          cm6ViewRef.current = view
          try { view.view.dom.dataset.ghmdLive = '1' } catch {}
          // 极端情况下占位克隆可能残留：确保宿主里只有这一个真实编辑器
          try {
            for (const candidate of Array.from(host.querySelectorAll('.cm-editor'))) {
              if (candidate !== view.view.dom) candidate.remove()
            }
          } catch {}
          // 恢复上次滚动位置（宿主重挂载后不会跳回顶部），并持续记录
          try {
            const scroller = view.view.scrollDOM
            const saved = typeof sourcePath === 'string' ? cm6ScrollMemory.get(sourcePath) : undefined
            if (typeof saved === 'number' && Number.isFinite(saved) && saved > 0) scroller.scrollTop = saved
            let scrollTimer = 0
            const onScroll = () => {
              if (scrollTimer !== 0) return
              scrollTimer = window.setTimeout(() => {
                scrollTimer = 0
                if (typeof sourcePath === 'string') cm6ScrollMemory.set(sourcePath, Math.round(scroller.scrollTop))
              }, 250)
            }
            scroller.addEventListener('scroll', onScroll, { passive: true })
            view.__ghMdScrollCleanup = () => {
              scroller.removeEventListener('scroll', onScroll)
              if (scrollTimer !== 0) window.clearTimeout(scrollTimer)
              if (typeof sourcePath === 'string') cm6ScrollMemory.set(sourcePath, Math.round(scroller.scrollTop))
            }
          } catch {}
          // 官方预览在保存后会重挂载正文；恢复上次光标位置与焦点，避免光标跳回文档开头。restore cm6 memory
          try {
            const memory = typeof sourcePath === 'string' ? cm6EditorMemory.get(sourcePath) : undefined
            if (memory !== undefined) {
              const anchor = Math.min(Number(memory.head) || 0, view.view.state.doc.length)
              view.view.dispatch({ selection: { anchor } })
              if (memory.focused === true) {
                window.setTimeout(() => {
                  try { view.view.focus() } catch {}
                }, 0)
              }
            }
          } catch {}
          return () => {
            // 卸载时落盘：关闭预览标签页也不会丢最后一段输入
            try { if (dirtyRef.current === true) void persist() } catch {}
            cm6ViewRef.current = null
            // 重挂载前留一份"上一帧"的 DOM 克隆，新编辑器挂载前用它占位
            try {
              const dom = view.view.dom
              cm6PlaceholderScroll = Math.round(view.view.scrollDOM.scrollTop)
              cm6Placeholder = dom.cloneNode(true)
              cm6Placeholder.dataset.ghmdPlaceholder = '1'
              cm6PlaceholderPath = typeof sourcePath === 'string' ? sourcePath : ''
            } catch {}
            try { if (typeof view.__ghMdScrollCleanup === 'function') view.__ghMdScrollCleanup() } catch {}
            try {
              const scroller = view.view.scrollDOM
              if (typeof sourcePath === 'string') cm6ScrollMemory.set(sourcePath, Math.round(scroller.scrollTop))
            } catch {}
            view.destroy()
          }
        }, [cm6Loaded, editable])

        // 官方预览 / 流式内容变化时同步进编辑器（自己输入不经过这里）。
        React.useEffect(() => {
          const wrapper = cm6ViewRef.current
          if (wrapper === null) return
          const current = wrapper.view.state.doc.toString()
          if (current === docText) return
          // 只差尾部空白（流式/保存回读常见）就不打断编辑器
          if (current.replace(/\s+$/u, '') === docText.replace(/\s+$/u, '')) return
          if (dirtyRef.current) {
            // 有未落盘的本地改动：外部内容只提示，不覆盖编辑器。
            conflictRef.current = true
            setSaveState('conflict')
            setSaveMessage(tr('editConflict', '外部已修改 · 重新载入'))
            return
          }
          const host = cm6HostRef.current
          const active = document.activeElement
          const focused = host !== null && active !== null && active !== undefined && host.contains(active) && active !== document.body
          if (focused) {
            // 用户正在输入：先记下来，失焦后再同步，避免光标被重置
            cm6PendingExternalRef.current = docText
            return
          }
          wrapper.view.dispatch({ changes: { from: 0, to: wrapper.view.state.doc.length, insert: docText } })
        }, [docText])

        // 失焦时应用挂起的外部内容（如果仍然不同）
        React.useEffect(() => {
          if (!cm6Loaded || !editable) return undefined
          const host = cm6HostRef.current
          if (host === null) return undefined
          const onFocusOut = () => {
            window.setTimeout(() => {
              const pending = cm6PendingExternalRef.current
              if (pending === null || pending === undefined) return
              cm6PendingExternalRef.current = null
              const wrapper = cm6ViewRef.current
              if (wrapper === null) return
              const current = wrapper.view.state.doc.toString()
              if (current === pending) return
              if (current.replace(/\s+$/u, '') === pending.replace(/\s+$/u, '')) return
              wrapper.view.dispatch({ changes: { from: 0, to: wrapper.view.state.doc.length, insert: pending } })
            }, 0)
          }
          host.addEventListener('focusout', onFocusOut)
          return () => host.removeEventListener('focusout', onFocusOut)
        }, [cm6Loaded, editable])

        // CM6 里悬停 wikilink 显示目标笔记预览（与 Obsidian 页面预览一致）。
        React.useEffect(() => {
          if (typeof sourcePath !== 'string' || sourcePath === '') return undefined
          let removed = false
          const closePreview = () => {
            const node = document.getElementById('gh-md-link-preview')
            if (node !== null) node.remove()
          }
          const showPreview = (href, left, top) => {
            const vendor = vendorRef.current
            if (vendor === null || vendor === undefined) return
            if (sessionId === '') return
            const clean = String(href).split('|')[0].split('#')[0].trim()
            if (clean === '' || /^https?:/iu.test(clean)) return
            const directory = sourcePath.slice(0, Math.max(sourcePath.lastIndexOf('/'), sourcePath.lastIndexOf('\\')) + 1)
            const withExt = /\.[a-z0-9]+$/iu.test(clean) ? clean : clean + '.md'
            const absolute = /^[a-z]:[\\/]/iu.test(withExt) ? withExt : directory + withExt
            workbenchRequest('read', { sessionId, path: absolute }).then((data) => {
              if (removed) return
              closePreview()
              const card = document.createElement('div')
              card.id = 'gh-md-link-preview'
              card.className = 'gh-md-link-preview'
              const width = Math.max(240, Math.min(420, window.innerWidth - left - 24))
              card.style.left = String(Math.max(8, Math.min(left, window.innerWidth - width - 12))) + 'px'
              card.style.top = String(Math.max(8, Math.min(top, window.innerHeight - 140))) + 'px'
              card.style.width = String(width) + 'px'
              try {
                const renderer = createMarkdownRenderer({
                  marked: vendor.marked,
                  DOMPurify: vendor.DOMPurify,
                  katex: vendor.katex,
                  shiki: null,
                  markedFootnote: vendor.markedFootnote,
                  footnotesLabel: tr('footnotes', '脚注'),
                  codeLabels: {
                    codeLabel: tr('codeLabel', '代码块'),
                    wrapLabel: tr('wrapLabel', '自动换行'),
                    copyLabel: tr('copyLabel', '复制'),
                    copiedLabel: tr('copiedLabel', '已复制'),
                  },
                  doc: document,
                })
                const split = splitFrontmatter(String(data.content ?? ''))
                card.innerHTML = renderer.render(split.body, absolute)
              } catch {
                card.textContent = clean
              }
              document.body.appendChild(card)
            }, () => {})
          }
          window.__ghMdShowLinkPreview = (href, left, top) => {
            showPreview(href, left, top)
          }
          window.__ghMdHideLinkPreview = () => {
            closePreview()
          }
          return () => {
            removed = true
            window.__ghMdShowLinkPreview = undefined
            window.__ghMdHideLinkPreview = undefined
            closePreview()
          }
        }, [sourcePath, sessionId, cm6Loaded])

        // CM6 里点击渲染态链接：复制到剪贴板并用保存提示条显示（DSH 沙箱里不直接导航）。
        React.useEffect(() => {
          window.__ghMdOpenLink = (href, newTab) => {
            const raw = typeof href === 'string' ? href.trim() : ''
            if (raw === '') return
            const showCopyHint = (text) => {
              try {
                if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') void navigator.clipboard.writeText(raw)
              } catch {}
              setCopyHint({ text, detail: raw })
              if (copyHintTimerRef.current !== null) window.clearTimeout(copyHintTimerRef.current)
              copyHintTimerRef.current = window.setTimeout(() => {
                copyHintTimerRef.current = null
                setCopyHint(null)
              }, 2000)
            }
            // 外部链接：交给系统浏览器打开（不再只复制）。
            if (/^(?:https?|mailto):/iu.test(raw)) {
              let opened = null
              try { opened = window.open(raw, '_blank') } catch { opened = null }
              if (opened !== null && opened !== undefined) {
                try { opened.opener = null } catch {}
              } else {
                showCopyHint('链接已复制（浏览器拦截了打开）')
              }
              return
            }
            // 文档内链接 / wiki 链接：在右侧预览面板内跳转。
            const actions = tabActionsRef.current
            const base = resourceAddressRef.current
            if (actions !== null && actions !== undefined && typeof actions.openResource === 'function' && base !== '') {
              try {
                let target = raw
                // wiki 链接没有扩展名：补 .md；带 #锚点 的保留锚点。
                const hashIndex = target.indexOf('#')
                const hash = hashIndex >= 0 ? target.slice(hashIndex) : ''
                const pathPart = hashIndex >= 0 ? target.slice(0, hashIndex) : target
                if (/\.[a-z0-9]{1,8}$/iu.test(pathPart) === false) target = pathPart + '.md' + hash
                const address = new URL(target, base).href
                if (address.startsWith('dsh-resource:') === false) throw new Error('not a resource address')
                // 点链接 = 打开新标签页（不覆盖当前文档）；已经打开过的同一文档会被聚焦。
                // Ctrl/Cmd+Click 也走同一路径（宿主会聚焦已存在的标签，不会重复开）。
                void newTab
                actions.openResource(address)
                return
              } catch {}
            }
            showCopyHint('链接已复制')
          }
          return () => {
            window.__ghMdOpenLink = undefined
            if (copyHintTimerRef.current !== null) {
              window.clearTimeout(copyHintTimerRef.current)
              copyHintTimerRef.current = null
            }
          }
        }, [])

        React.useEffect(() => {
          cm6ShikiRef.current = shiki
          cm6BlocksRendererRef.current = null
          const wrapper = cm6ViewRef.current
          if (wrapper === null || shiki === null) return
          try {
            wrapper.view.dispatch({ selection: { anchor: wrapper.view.state.selection.main.head } })
          } catch {}
        }, [shiki])

        React.useEffect(() => {
          vendorRef.current = vendor
          // vendor（KaTeX 等）加载完成后强制重建一次 CM6 装饰，让数学公式从源码变成 widget。
          const view = cm6ViewRef.current
          if (vendor !== null && view !== null) {
            try {
              view.view.dispatch({ selection: { anchor: view.view.state.selection.main.head } })
            } catch {}
          }
        }, [vendor])

        React.useLayoutEffect(() => {
          ensureDocumentStyle()
        }, [])

        React.useEffect(() => {
          if (vendor === null || !hasCodeFence(docText)) return undefined
          let alive = true
          ensureShiki().then((loaded) => {
            if (alive) setShiki(loaded)
          }, () => {
            if (alive) setShikiFailed(true)
          })
          return () => { alive = false }
        }, [vendor, docText])

        // 精确源文读取：官方预览交给正文的是「按行流式拼接」的文本，保存时可能丢结尾换行；
        // 首次渲染后从 Host 读一次原文件，既能保留原字节，也顺带确认文件在当前工作区里可写。
        React.useEffect(() => {
          if (typeof sourcePath !== 'string' || sourcePath === '' || sessionId === '') return undefined
          let alive = true
          workbenchRequest('read', { sessionId, path: sourcePath }).then((data) => {
            if (!alive || !aliveRef.current) return
            exactRef.current = true
            setEditableKnown(true)
            setEditable(true)
            const rawText = String(data.content ?? '')
            // marked 的 token.raw 是 LF 归一化后的文本；内部统一用 LF 渲染/编辑，
            // 保存时再按原文件的换行风格写回，这样块区间能精确对回原文。
            eolRef.current = rawText.includes('\r\n') ? '\r\n' : '\n'
            const exactText = rawText.replace(/\r\n/gu, '\n')
            const previousDisk = lastDiskTextRef.current
            lastDiskTextRef.current = exactText
            if (editingRef.current !== null || dirtyRef.current) {
              // 本地有未落盘改动：外部内容不能悄悄顶掉它，也不能被我们覆盖；只提示冲突。
              if (exactText !== previousDisk && exactText !== savedTextRef.current) {
                conflictRef.current = true
                setSaveState('conflict')
                setSaveMessage(tr('editConflict', '外部已修改 · 重新载入'))
              }
              return
            }
            savedTextRef.current = exactText
            if (docTextRef.current !== exactText) {
              docTextRef.current = exactText
              setDocText(exactText)
            }
          }, () => {
            if (alive) setEditableKnown(true)
            if (alive) exactRef.current = false
          })
          return () => { alive = false }
        }, [eof, sourcePath, sessionId, streamText])

        // 精确源文没拿到时，跟随官方读取器交来的流式文本（只读展示）。
        React.useEffect(() => {
          if (exactRef.current) return
          if (editingRef.current !== null || dirtyRef.current) return
          if (typeof streamText !== 'string') return
          const normalizedStream = streamText.replace(/\r\n/gu, '\n')
          if (docTextRef.current === normalizedStream) return
          docTextRef.current = normalizedStream
          setDocText(normalizedStream)
        }, [streamText])

        const doc = React.useMemo(() => {
          if (vendor === null) return null
          if (hasCodeFence(docText) && shiki === null && !shikiFailed) return null
          const renderer = createMarkdownRenderer({
            marked: vendor.marked,
            DOMPurify: vendor.DOMPurify,
            katex: vendor.katex,
            shiki,
            markedFootnote: vendor.markedFootnote,
            footnotesLabel: tr('footnotes', '脚注'),
            codeLabels: {
              codeLabel: tr('codeLabel', '代码块'),
              wrapLabel: tr('wrapLabel', '自动换行'),
              copyLabel: tr('copyLabel', '复制'),
              copiedLabel: tr('copiedLabel', '已复制'),
            },
            doc: document,
          })
          const split = splitFrontmatter(docText)
          const rendered = renderer.renderDocument(split.body, sourcePath)
          return {
            frontmatter: split.source === null ? '' : '<pre class="gh-md-frontmatter">' + escapeHtml(split.source) + '</pre>',
            prefixLength: split.prefix.length,
            blocks: rendered.blocks,
            trailing: rendered.trailingHtml,
          }
        }, [vendor, shiki, shikiFailed, docText, sourcePath, t])
        blocksRef.current = doc === null ? [] : doc.blocks


        React.useEffect(() => {
          if (editing === null) return undefined
          const onPointerDown = (event) => {
            const target = event.target
            if (target !== null && target !== undefined && typeof target.closest === 'function' && target.closest('.gh-md-block-editor') !== null) return
            commitEditingRef.current?.()
          }
          document.addEventListener('mousedown', onPointerDown, true)
          return () => document.removeEventListener('mousedown', onPointerDown, true)
        }, [editing])

        /** 记一条撤销历史（提交时才记，输入过程中不记）。 */
        const recordHistory = (before, after, offset) => {
          if (typeof before !== 'string' || typeof after !== 'string' || before === after) return
          const history = historyRef.current
          history.past.push({ before, after, offset: typeof offset === 'number' ? offset : null })
          if (history.past.length > 100) history.past.shift()
          history.future.length = 0
        }

        /** 撤销 / 重做时把整篇文本换回去，并安排一次保存。 */
        const applyHistoryText = (next, offset) => {
          docTextRef.current = next
          dirtyRef.current = true
          editingRef.current = null
          setEditing(null)
          setDocText(next)
          if (typeof offset === 'number') {
            window.setTimeout(() => {
              const root = rootRef.current
              if (root === null) return
              const prefix = doc === null ? 0 : doc.prefixLength
              const bodyOffset = offset - prefix
              const index = blocksRef.current.findIndex((block) => bodyOffset >= block.start && bodyOffset <= block.end)
              if (index < 0) return
              const element = root.querySelector(`[data-gh-md-block="${index}"]`)
              if (element === null) return
              element.classList.add('gh-md-undo-flash')
              if (typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'center' })
              window.setTimeout(() => element.classList.remove('gh-md-undo-flash'), 800)
            }, 0)
          }
          if (saveTimerRef.current !== null) {
            window.clearTimeout(saveTimerRef.current)
            saveTimerRef.current = null
          }
          saveTimerRef.current = window.setTimeout(() => {
            saveTimerRef.current = null
            void persist()
          }, saveDebounceDelay())
        }

        const undo = () => {
          const history = historyRef.current
          const entry = history.past.pop()
          if (entry === undefined) return
          history.future.push(entry)
          applyHistoryText(entry.before, entry.offset)
        }

        const redo = () => {
          const history = historyRef.current
          const entry = history.future.pop()
          if (entry === undefined) return
          history.past.push(entry)
          applyHistoryText(entry.after, entry.offset)
        }
        undoRef.current = undo
        redoRef.current = redo

        React.useEffect(() => {
          const onKeyDown = (event) => {
            if (editingRef.current !== null) return
            if (!(event.ctrlKey || event.metaKey) || event.altKey) return
            const key = typeof event.key === 'string' ? event.key.toLowerCase() : ''
            if (key !== 'z' && key !== 'y') return
            const active = document.activeElement
            const inInput = active !== null && active !== undefined && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable === true)
            if (inInput) return
            const root = rootRef.current
            const focusOk = root !== null && (active === document.body || active === document.documentElement || root.contains(active))
            if (!focusOk) return
            if (key === 'y' || (key === 'z' && event.shiftKey === true)) {
              event.preventDefault()
              redoRef.current?.()
              return
            }
            event.preventDefault()
            undoRef.current?.()
          }
          document.addEventListener('keydown', onKeyDown, true)
          return () => document.removeEventListener('keydown', onKeyDown, true)
        }, [])

        // 分段 / 换行之后，等 doc 重新解析完，再把编辑器落到正确的块上。
        React.useEffect(() => {
          const pending = pendingEditRef.current
          if (pending === null || doc === null) return
          pendingEditRef.current = null
          const prefix = doc.prefixLength
          const bodyOffset = pending.offset - prefix
          const blocks = blocksRef.current
          const index = blocks.findIndex((block) => bodyOffset >= block.start && bodyOffset < block.end)
          if (index >= 0) beginEdit(index, Math.max(0, Math.min(pending.caret, blocks[index].end - blocks[index].start)))
          else beginVirtual(pending.offset)
        }, [doc])

        /** 把当前块在光标处分成两段：前一段重新渲染，后一段继续编辑（Obsidian 的 Enter）。 */
        const splitBlock = (caret) => {
          const session = editingRef.current
          if (session === null || session.virtual === true) return
          const text = docTextRef.current
          const value = text.slice(session.start, session.end)
          const clamped = Math.max(0, Math.min(caret, value.length))
          const left = value.slice(0, clamped).replace(/\s+$/u, '')
          const right = value.slice(clamped).replace(/^\s+/u, '')
          const next = text.slice(0, session.start) + left + '\n\n' + right + text.slice(session.end)
          docTextRef.current = next
          recordHistory(session.beforeText, next, session.start + left.length + 2)
          editingRef.current = null
          dirtyRef.current = true
          pendingEditRef.current = { offset: session.start + left.length + 2, caret: 0 }
          setEditing(null)
          setDocText(next)
        }

        /** 块首按 Backspace：与上一块合并（Obsidian 里删掉段落之间的空行）。 */
        const mergePrevious = () => {
          const session = editingRef.current
          if (session === null || session.virtual === true) return false
          const index = session.index
          if (index <= 0) return false
          const blocks = blocksRef.current
          const prev = blocks[index - 1]
          if (prev === undefined) return false
          const prefix = doc === null ? 0 : doc.prefixLength
          const prevStart = prefix + prev.start
          const prevEnd = prefix + prev.end
          const text = docTextRef.current
          const value = text.slice(session.start, session.end)
          const trimmed = text.slice(prevStart, prevEnd).replace(/\s+$/u, '')
          const next = text.slice(0, prevStart) + trimmed + value + text.slice(session.end)
          docTextRef.current = next
          recordHistory(session.beforeText, next, prevStart + trimmed.length)
          editingRef.current = null
          dirtyRef.current = true
          pendingEditRef.current = { offset: prevStart, caret: trimmed.length }
          setEditing(null)
          setDocText(next)
          return true
        }

        /** 块尾按 Delete：与下一块合并。 */
        const mergeNext = () => {
          const session = editingRef.current
          if (session === null || session.virtual === true) return false
          const blocks = blocksRef.current
          const nextBlock = blocks[session.index + 1]
          if (nextBlock === undefined) return false
          const prefix = doc === null ? 0 : doc.prefixLength
          const nextStart = prefix + nextBlock.start
          const nextEnd = prefix + nextBlock.end
          const text = docTextRef.current
          const value = text.slice(session.start, session.end)
          const trimmed = value.replace(/\s+$/u, '')
          const merged = trimmed + text.slice(nextStart, nextEnd)
          const next = text.slice(0, session.start) + merged + text.slice(nextEnd)
          docTextRef.current = next
          recordHistory(session.beforeText, next, session.start + trimmed.length)
          editingRef.current = null
          dirtyRef.current = true
          pendingEditRef.current = { offset: session.start, caret: trimmed.length }
          setEditing(null)
          setDocText(next)
          return true
        }

        /** 光标在块边界按上下/左右方向键：直接切到相邻块继续编辑（Obsidian 里光标可以跨块走）。 */
        const moveToAdjacentBlock = (direction) => {
          const session = editingRef.current
          if (session === null || session.virtual === true) return false
          const blocks = blocksRef.current
          const targetIndex = session.index + direction
          const target = blocks[targetIndex]
          if (target === undefined || target.editable === false) return false
          editingRef.current = null
          setEditing(null)
          beginEdit(targetIndex, direction > 0 ? 0 : target.end - target.start)
          return true
        }

        const hideSaveSoon = (delay) => {
          if (saveStateTimerRef.current !== null) window.clearTimeout(saveStateTimerRef.current)
          saveStateTimerRef.current = window.setTimeout(() => {
            saveStateTimerRef.current = null
            if (!aliveRef.current) return
            setSaveState('idle')
            setSaveMessage('')
          }, delay)
        }

        /** 关闭窗口/切后台时的兜底保存（sendBeacon 不受导航取消影响）。 */
        const flushBeacon = () => {
          if (!dirtyRef.current) return
          const path = sourcePathRef.current
          if (typeof path !== 'string' || path === '' || sessionId === '' || !exactRef.current) return
          const body = docTextRef.current
          if (body === savedTextRef.current) return
          try {
            const payload = JSON.stringify({ sessionId, path, content: body, base: lastDiskTextRef.current })
            const blob = new Blob([payload], { type: 'application/json' })
            if (navigator.sendBeacon !== undefined) navigator.sendBeacon(WORKBENCH_API + 'save', blob)
            pendingSaveTextRef.current = body
          } catch {}
        }

        React.useEffect(() => {
          if (typeof window === 'undefined') return undefined
          const flushWhenHidden = () => { if (!windowLooksVisible() && dirtyRef.current) void persist() }
          window.addEventListener('blur', flushWhenHidden)
          document.addEventListener('visibilitychange', flushWhenHidden)
          return () => {
            window.removeEventListener('blur', flushWhenHidden)
            document.removeEventListener('visibilitychange', flushWhenHidden)
          }
        }, [])

        React.useEffect(() => {
          const onHide = () => { flushBeacon() }
          window.addEventListener('pagehide', onHide)
          return () => { window.removeEventListener('pagehide', onHide); flushBeacon() }
        }, [])

        const persist = async () => {
          const path = sourcePathRef.current
          if (typeof path !== 'string' || path === '' || sessionId === '' || !exactRef.current) {
            setSaveState('error')
            setSaveMessage(tr('readOnlyNotice', '只读：该文件不在当前工作区内，无法保存'))
            hideSaveSoon(3200)
            return
          }
          if (saveTimerRef.current !== null) {
            window.clearTimeout(saveTimerRef.current)
            saveTimerRef.current = null
          }
          if (saveStateTimerRef.current !== null) {
            window.clearTimeout(saveStateTimerRef.current)
            saveStateTimerRef.current = null
          }
          // 内容没变就不写盘：否则每次失焦都会碰一次 mtime，预览会跟着整篇重载。
          // 同一份内容已经有一次保存在路上时也不再发：避免重复写盘引起重复重载。
          const snapshot = docTextRef.current
          if (snapshot === savedTextRef.current || snapshot === pendingSaveTextRef.current) {
            dirtyRef.current = false
            setSaveState('saved')
            hideSaveSoon(1200)
            return
          }
          setSaveState('saving')
          setSaveMessage('')
          pendingSaveTextRef.current = snapshot
          try {
            const body = eolRef.current === '\r\n' ? snapshot.replace(/\n/gu, '\r\n') : snapshot
            await workbenchRequest('save', { sessionId, path, content: body, base: lastDiskTextRef.current })
            savedTextRef.current = snapshot
            lastDiskTextRef.current = snapshot
            if (pendingSaveTextRef.current === snapshot) pendingSaveTextRef.current = ''
            dirtyRef.current = false
            if (!aliveRef.current) return
            setSaveState('saved')
            hideSaveSoon(1400)
          } catch (error) {
            if (pendingSaveTextRef.current === snapshot) pendingSaveTextRef.current = ''
            if (!aliveRef.current) return
            const code = error !== null && error !== undefined && typeof error.code === 'string' ? error.code : ''
            if (code === 'conflict') {
              // 磁盘被别人改了：保留本地草稿，提示用户选择「重新载入」。
              conflictRef.current = true
              setSaveState('conflict')
              setSaveMessage(tr('editConflict', '外部已修改 · 重新载入'))
              return
            }
            setSaveState('error')
            setSaveMessage(String(error?.message ?? error))
          }
        }

        /** 重新从磁盘载入（外部改动冲突时点保存提示触发）。 */
        const reloadFromDisk = async () => {
          const path = sourcePathRef.current
          if (typeof path !== 'string' || path === '' || sessionId === '') return
          try {
            const data = await workbenchRequest('read', { sessionId, path })
            const rawText = String(data.content ?? '')
            eolRef.current = rawText.includes('\r\n') ? '\r\n' : '\n'
            const diskText = rawText.replace(/\r\n/gu, '\n')
            lastDiskTextRef.current = diskText
            savedTextRef.current = diskText
            docTextRef.current = diskText
            dirtyRef.current = false
            conflictRef.current = false
            pendingSaveTextRef.current = ''
            setDocText(diskText)
            const wrapper = cm6ViewRef.current
            if (wrapper !== null) {
              try {
                wrapper.view.dispatch({ changes: { from: 0, to: wrapper.view.state.doc.length, insert: diskText } })
              } catch {}
            }
            if (saveStateTimerRef.current !== null) window.clearTimeout(saveStateTimerRef.current)
            setSaveState('saved')
            hideSaveSoon(1400)
          } catch (error) {
            setSaveState('error')
            setSaveMessage(String(error?.message ?? error))
          }
        }

        // 外部改动自动跟进（Obsidian 行为）：没在编辑区块时定期对比磁盘内容，变了就原地重载。
        // 稿子被外部脚本重新生成（图片同名替换、正文重排）后不需要手动刷新也不会一直看到旧内容。
        React.useEffect(() => {
          if (typeof sourcePath !== 'string' || sourcePath === '' || sessionId === '') return undefined
          // jsdom 集成测试里没有真实的磁盘读取：轮询会把测试用的桩内容当成「磁盘更新」把文档覆盖回去。
          if (typeof navigator !== 'undefined' && /jsdom/iu.test(String(navigator.userAgent ?? ''))) return undefined
          let alive = true
          let inFlight = false
          /** 宿主的「自动刷新」开关关掉时，不做外部改动跟进（与内置预览行为一致）。 */
          const autoRefreshEnabled = () => {
            try {
              const node = document.querySelector('[data-textpreview-tool="auto-refresh"]')
              if (node === null) return true
              return node.getAttribute('aria-pressed') !== 'false'
            } catch {
              return true
            }
          }
          const timer = window.setInterval(() => {
            if (!alive || inFlight) return
            try {
              if (document.hidden === true) return
            } catch {}
            if (autoRefreshEnabled() === false) return
            inFlight = true
            workbenchRequest('read', { sessionId, path: sourcePath }).then((data) => {
              inFlight = false
              if (!alive || !aliveRef.current) return
              const rawText = String(data.content ?? '')
              const diskText = rawText.replace(/\r\n/gu, '\n')
              if (diskText === lastDiskTextRef.current) return
              if (dirtyRef.current === true) {
                if (conflictRef.current !== true) {
                  conflictRef.current = true
                  setSaveState('conflict')
                  setSaveMessage(tr('editConflict', '外部已修改 · 重新载入'))
                }
                return
              }
              eolRef.current = rawText.includes('\r\n') ? '\r\n' : '\n'
              lastDiskTextRef.current = diskText
              savedTextRef.current = diskText
              docTextRef.current = diskText
              setDocText(diskText)
              const wrapper = cm6ViewRef.current
              if (wrapper !== null) {
                try {
                  wrapper.view.dispatch({ changes: { from: 0, to: wrapper.view.state.doc.length, insert: diskText } })
                } catch {}
              }
            }).catch(() => {
              inFlight = false
            })
          }, 2500)
          return () => {
            alive = false
            window.clearInterval(timer)
          }
        }, [sourcePath, sessionId])

        /** 窗口当前是否"用户看得见"：看得见时写盘会触发宿主重建预览（闪一下），所以只在看不见时自动写。 */
        const windowLooksVisible = () => {
          try {
            if (typeof document !== 'undefined' && document.hidden === true) return false
            if (typeof document !== 'undefined' && typeof document.hasFocus === 'function' && document.hasFocus() === false) return false
          } catch {}
          return true
        }
        /** 兜底：长时间（5 分钟）没有任何机会写盘时，允许在可见状态下写一次，避免崩溃丢太多。 */
        const VISIBLE_FALLBACK_MS = 1800000
        /** 集成测试可以用 window.__ghMdSaveDelay 覆盖防抖并保持"到点即写"的旧行为。 */
        const saveTestMode = () => {
          try {
            // jsdom 集成测试 / 显式覆盖：保持旧行为（到点即写），否则测试无法断言落盘
            if (/jsdom/iu.test(String(navigator.userAgent ?? ''))) return true
            const override = Number(window.__ghMdSaveDelay)
            return Number.isFinite(override) && override > 0
          } catch {
            return true
          }
        }
        const scheduleSave = () => {
          dirtyRef.current = true
          dirtyAtRef.current = Date.now()
          if (saveStateTimerRef.current !== null) {
            window.clearTimeout(saveStateTimerRef.current)
            saveStateTimerRef.current = null
          }
          if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
          if (saveTestMode()) {
            // 测试模式：到点就写，行为与 1.0.4 一致
            saveTimerRef.current = window.setTimeout(() => {
              saveTimerRef.current = null
              void persist()
            }, saveDebounceDelay())
            return
          }
          if (!windowLooksVisible()) {
            // 看不见（窗口失焦/页面隐藏）：立刻写，重建发生在用户看不到的时候
            void persist()
            return
          }
          saveTimerRef.current = window.setTimeout(() => {
            saveTimerRef.current = null
            if (!windowLooksVisible()) { void persist(); return }
            if (Date.now() - (dirtyAtRef.current ?? 0) >= VISIBLE_FALLBACK_MS) { void persist(); return }
            // 还在看：继续等，等用户切走/收起窗口时再写
            scheduleSave()
          }, saveDebounceDelay())
        }

        const beginEdit = (index, caret) => {
          const block = blocksRef.current[index]
          if (block === undefined || block.editable === false) return
          const prefixLength = doc === null ? 0 : doc.prefixLength
          const session = {
            index,
            caret,
            key: `${index}:${Date.now()}`,
            start: prefixLength + block.start,
            end: prefixLength + block.end,
          }
          session.beforeText = docTextRef.current
          editingRef.current = session
          setEditing(session)
        }

        /**
         * 在指定位置开一个「空段落」编辑器：两侧缺空行时自动补，提交后重新解析成段落。
         * Obsidian 里点最后一行下面的空白、或点两段之间的空隙，都是这个行为。
         * @param offset - 插入点在 docText 里的绝对偏移。
         */
        const beginVirtual = (offset) => {
          if (doc === null) return
          const original = docTextRef.current
          const at = Math.max(0, Math.min(offset, original.length))
          const before = original.slice(0, at)
          const after = original.slice(at)
          let prefix = ''
          if (before !== '' && !before.endsWith('\n\n')) prefix = before.endsWith('\n') ? '\n' : '\n\n'
          let suffix = ''
          if (after !== '' && !after.startsWith('\n\n')) suffix = after.startsWith('\n') ? '\n' : '\n\n'
          const session = {
            index: -1,
            virtual: true,
            caret: 0,
            key: 'virtual:' + Date.now(),
            start: at + prefix.length,
            end: at + prefix.length,
            originalText: original,
          }
          session.beforeText = original
          docTextRef.current = before + prefix + suffix + after
          editingRef.current = session
          setEditing(session)
        }

        const applyDraft = (index, value) => {
          const session = editingRef.current
          if (session === null || session.index !== index) return
          const text = docTextRef.current
          const next = text.slice(0, session.start) + value + text.slice(session.end)
          docTextRef.current = next
          session.end = session.start + value.length
          dirtyRef.current = true
          // 编辑过程中不写盘：写盘会让预览整篇重载，正在编辑的块会被卸载。
          // 草稿留在 docTextRef 里，失焦 / Esc / Ctrl+S 提交时再落盘。
        }

        /** 编辑器被卸载（切 tab / 关预览）时，把最后一份草稿补发出去。 */
        const flushDraft = (value) => {
          const session = editingRef.current
          // 已经提交过（editingRef 已清）时不要重复写：提交自己会安排一次落盘。
          if (session === null) return
          const text = docTextRef.current
          docTextRef.current = text.slice(0, session.start) + value + text.slice(session.end)
          dirtyRef.current = true
          const path = sourcePathRef.current
          if (typeof path !== 'string' || path === '' || sessionId === '' || !exactRef.current) return
          if (docTextRef.current === savedTextRef.current || docTextRef.current === pendingSaveTextRef.current) return
          pendingSaveTextRef.current = docTextRef.current
          try {
            const body = eolRef.current === '\r\n' ? docTextRef.current.replace(/\n/gu, '\r\n') : docTextRef.current
            fetch(WORKBENCH_API + 'save', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ sessionId, path, content: body, base: lastDiskTextRef.current }),
              keepalive: true,
            })
          } catch {}
        }

        /** 提交当前编辑块（不依赖 blur：点击的默认聚焦动作会把刚挂载的编辑器立刻 blur 掉）。 */
        const commitEditing = () => {
          const session = editingRef.current
          if (session === null) return
          editingRef.current = null
          setEditing(null)
          // 空段落里什么都没写：恢复原文，别把为插入而补的换行写进文件。
          if (session.virtual === true && session.start === session.end) {
            docTextRef.current = session.originalText
            return
          }
          recordHistory(session.beforeText, docTextRef.current, session.start + (Number(session.caret) || 0))
          setDocText(docTextRef.current)
          scheduleSave()
        }
        commitEditingRef.current = commitEditing

        const commitEdit = (index, value) => {
          const session = editingRef.current
          if (session === null || session.index !== index) return
          editingRef.current = null
          if (session.virtual === true && value === '') {
            docTextRef.current = session.originalText
            setEditing(null)
            return
          }
          const text = docTextRef.current
          const next = text.slice(0, session.start) + value + text.slice(session.end)
          docTextRef.current = next
          recordHistory(session.beforeText, next, session.start + Math.max(0, Math.min(Number(session.caret) || 0, value.length)))
          setEditing(null)
          setDocText(next)
          scheduleSave()
        }

        /** 点阅读态任务列表的复选框：切换源码里的 [ ] / [x] 并保存（Obsidian 里点复选框就能勾）。 */
        const toggleTaskCheckbox = (checkbox) => {
          if (!exactRef.current) {
            setSaveState('error')
            setSaveMessage(tr('readOnlyNotice', '只读：该文件不在当前工作区内，无法保存'))
            hideSaveSoon(3200)
            return
          }
          const blockElement = checkbox.closest('[data-gh-md-block]')
          if (blockElement === null) return
          const index = Number(blockElement.getAttribute('data-gh-md-block'))
          if (!Number.isInteger(index)) return
          const block = blocksRef.current[index]
          if (block === undefined) return
          const prefix = doc === null ? 0 : doc.prefixLength
          const start = prefix + block.start
          const end = prefix + block.end
          const text = docTextRef.current
          const raw = text.slice(start, end)
          const checkboxes = Array.from(blockElement.querySelectorAll('input[type=checkbox]'))
          const ordinal = checkboxes.indexOf(checkbox)
          if (ordinal < 0) return
          const pattern = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/gmu
          let match
          let seen = -1
          while ((match = pattern.exec(raw)) !== null) {
            seen += 1
            if (seen !== ordinal) continue
            const toggled = match[2] === ' ' ? 'x' : ' '
            const nextRaw = raw.slice(0, match.index + match[1].length) + toggled + raw.slice(match.index + match[1].length + 1)
            const updated = text.slice(0, start) + nextRaw + text.slice(end)
            docTextRef.current = updated
            recordHistory(text, updated)
            setDocText(updated)
            dirtyRef.current = true
            scheduleSave()
            return
          }
        }

        /** 提交单元格内联编辑：把新内容写回表格 raw。 */
        const commitCellEdit = () => {
          const current = cellEditRef.current
          if (current === null) return
          cellEditRef.current = null
          setCellEdit(null)
          const block = blocksRef.current[current.index]
          if (block === undefined) return
          const prefix = doc === null ? 0 : doc.prefixLength
          const blockStart = prefix + block.start
          const blockEnd = prefix + block.end
          const text = docTextRef.current
          const raw = text.slice(blockStart, blockEnd)
          const range = tableCellRange(raw, current.row, current.cell)
          if (range === null) return
          const inputElement = rootRef.current === null ? null : rootRef.current.querySelector('.gh-md-cell-input')
          const rawValue = inputElement === null ? current.value : inputElement.value
          const sanitized = String(rawValue).replace(/\r?\n/gu, ' ').replace(/\|/gu, '\\|')
          const nextRaw = raw.slice(0, range.start) + sanitized + raw.slice(range.end)
          const updated = text.slice(0, blockStart) + nextRaw + text.slice(blockEnd)
          if (updated === text) return
          docTextRef.current = updated
          recordHistory(text, updated)
          dirtyRef.current = true
          setDocText(updated)
          scheduleSave()
        }

        /** 代码卡的复制 / 换行按钮（内容是我们自己 innerHTML 写的，可安全改 DOM）。 */
        const onDocumentClick = (event) => {
          const target = event.target
          if (target === null || target === undefined || typeof target.closest !== 'function') return
          const taskCheckbox = target.closest('input[type=checkbox].gh-md-task-checkbox')
          if (taskCheckbox !== null && target.closest('.gh-md-block-editor') === null) {
            event.preventDefault()
            toggleTaskCheckbox(taskCheckbox)
            return
          }
          const tableCell = target.closest('td, th')
          if (tableCell !== null && target.closest('.gh-md-block-editor') === null) {
            const cellBlockElement = tableCell.closest('[data-gh-md-block]')
            if (cellBlockElement !== null) {
              const cellIndex = Number(cellBlockElement.getAttribute('data-gh-md-block'))
              const cellBlock = Number.isInteger(cellIndex) ? blocksRef.current[cellIndex] : undefined
              if (cellBlock !== undefined && cellBlock.type === 'table' && exactRef.current) {
                const rowElement = tableCell.parentElement
                const section = rowElement === null ? null : rowElement.parentElement
                const rows = section === null ? [] : Array.from(section.children)
                const rowIndex = rowElement === null ? -1 : rows.indexOf(rowElement)
                const cellIndexInRow = rowElement === null ? -1 : Array.from(rowElement.children).indexOf(tableCell)
                const isBody = section !== null && section.tagName !== undefined && section.tagName.toLowerCase() === 'tbody'
                const rawRow = isBody ? rowIndex + 2 : rowIndex
                const range = rowIndex >= 0 && cellIndexInRow >= 0 ? tableCellRange(cellBlock.raw, rawRow, cellIndexInRow) : null
                if (range !== null) {
                  event.preventDefault()
                  const rect = tableCell.getBoundingClientRect()
                  const rootRect = rootRef.current === null ? { left: 0, top: 0 } : rootRef.current.getBoundingClientRect()
                  const nextEdit = {
                    index: cellIndex,
                    row: rawRow,
                    cell: cellIndexInRow,
                    value: cellBlock.raw.slice(range.start, range.end),
                    left: rect.left - rootRect.left,
                    top: rect.top - rootRect.top,
                    width: rect.width,
                    height: rect.height,
                  }
                  cellEditRef.current = nextEdit
                  setCellEdit(nextEdit)
                  return
                }
              }
            }
          }
          const copyButton = target.closest('[data-gh-code-copy]')
          if (copyButton !== null) {
            const card = copyButton.closest('.gh-md-code-card')
            const codeNode = card === null ? null : card.querySelector('pre code, pre')
            if (codeNode !== null) {
              const value = codeNode.textContent ?? ''
              const done = () => {
                copyButton.dataset.copied = '1'
                copyButton.textContent = tr('copiedLabel', '已复制')
                window.setTimeout(() => {
                  copyButton.textContent = tr('copyLabel', '复制')
                  copyButton.dataset.copied = '0'
                }, 1600)
              }
              if (navigator.clipboard?.writeText !== undefined) navigator.clipboard.writeText(value).then(done, () => {})
            }
            return
          }
          const wrapButton = target.closest('[data-gh-code-wrap]')
          if (wrapButton !== null) {
            const card = wrapButton.closest('.gh-md-code-card')
            if (card !== null) {
              const next = card.dataset.wrap !== '1'
              card.dataset.wrap = next ? '1' : '0'
              wrapButton.setAttribute('aria-pressed', next ? 'true' : 'false')
            }
            return
          }
          if (target.closest('a, button, .gh-md-quote-button, .gh-md-save-pill') !== null) return
          // 任务列表的 checkbox 在渲染态是只读的：点在它上面时不要让它「假勾选」，而是进入整块编辑。
          if (target.matches !== undefined && target.matches('input[type=checkbox]')) event.preventDefault()
          if (editingRef.current !== null) return
          const selection = window.getSelection()
          if (selection !== null && selection.isCollapsed === false) return
          const blockEl = target.closest('[data-gh-md-block]')
          if (blockEl === null) {
            // 点文档末尾的空白：在最后一块下面继续写（Obsidian 里点最后一行下方即可继续输入）。
            if (!exactRef.current) {
              setSaveState('error')
              setSaveMessage(tr('readOnlyNotice', '只读：该文件不在当前工作区内，无法保存'))
              hideSaveSoon(3200)
              return
            }
            if (target.closest('.gh-md-static') !== null) return
            const root = rootRef.current
            if (root === null) return
            const prefixLength = doc === null ? 0 : doc.prefixLength
            const blockNodes = Array.from(root.querySelectorAll('[data-gh-md-block]'))
            let targetOffset = docTextRef.current.length
            for (const node of blockNodes) {
              const rect = node.getBoundingClientRect()
              if (event.clientY <= rect.bottom + 4) continue
              const index = Number(node.getAttribute('data-gh-md-block'))
              const block = blocksRef.current[index]
              if (block === undefined) continue
              targetOffset = prefixLength + block.end
            }
            beginVirtual(targetOffset)
            return
          }
          const index = Number(blockEl.getAttribute('data-gh-md-block'))
          if (!Number.isInteger(index)) return
          if (!exactRef.current) {
            setSaveState('error')
            setSaveMessage(tr('readOnlyNotice', '只读：该文件不在当前工作区内，无法保存'))
            hideSaveSoon(3200)
            return
          }
          const block = blocksRef.current[index]
          if (block === undefined || block.editable === false) return
          const tableCaret = block.type === 'table' ? tableCellOffsetOfClick(blockEl, block.raw, event) : undefined
          beginEdit(index, typeof tableCaret === 'number' ? tableCaret : sourceOffsetOfClick(blockEl, block.raw, event))
        }

        /**
         * 在表格 raw 里定位某个单元格内容的字符区间（去掉两侧空格）。
         * @param raw - 表格块原文。
         * @param rowIndex - 行号（表头 0，分隔线 1，正文从 2 开始）。
         * @param cellIndex - 第几个单元格。
         * @returns { start, end } 或 null。
         */
        const tableCellRange = (raw, rowIndex, cellIndex) => {
          const lines = raw.split('\n')
          const line = lines[rowIndex]
          if (typeof line !== 'string') return null
          let start = -1
          let end = -1
          let seen = -1
          for (let i = 0; i < line.length; i += 1) {
            if (line[i] !== '|') continue
            seen += 1
            if (seen === cellIndex) start = i + 1
            if (seen === cellIndex + 1) {
              end = i
              break
            }
          }
          if (start < 0) return null
          if (end < 0) end = line.length
          let contentStart = start
          while (contentStart < end && line[contentStart] === ' ') contentStart += 1
          let contentEnd = end
          while (contentEnd > contentStart && line[contentEnd - 1] === ' ') contentEnd -= 1
          let offset = 0
          for (let i = 0; i < rowIndex; i += 1) offset += lines[i].length + 1
          return { start: offset + contentStart, end: offset + contentEnd }
        }

        /**
         * 点渲染态表格的某个单元格时，把光标落到源码里对应的单元格开头（Obsidian 里点表格格子就进那个格子）。
         * @param blockElement - 渲染的块元素。
         * @param raw - 该块的 Markdown 原文。
         * @param event - 点击事件。
         * @returns 块内偏移；定位不了时返回 undefined。
         */
        const tableCellOffsetOfClick = (blockElement, raw, event) => {
          const target = event.target
          if (target === null || target === undefined || typeof target.closest !== 'function') return undefined
          const cell = target.closest('td, th')
          if (cell === null) return undefined
          const row = cell.parentElement
          if (row === null) return undefined
          const section = row.parentElement
          const rows = section === null ? [] : Array.from(section.children)
          const rowIndex = rows.indexOf(row)
          const cellIndex = Array.from(row.children).indexOf(cell)
          if (rowIndex < 0 || cellIndex < 0) return undefined
          const lines = raw.split('\n')
          const isBody = section !== null && section.tagName !== undefined && section.tagName.toLowerCase() === 'tbody'
          const lineIndex = isBody ? rowIndex + 2 : rowIndex
          const line = lines[lineIndex]
          if (typeof line !== 'string') return undefined
          let pipe = -1
          let seen = -1
          for (let i = 0; i < line.length; i += 1) {
            if (line[i] !== '|') continue
            seen += 1
            if (seen === cellIndex) {
              pipe = i
              break
            }
          }
          if (pipe < 0) return undefined
          let ch = pipe + 1
          while (ch < line.length && (line[ch] === ' ' || line[ch] === '\t')) ch += 1
          let offset = 0
          for (let i = 0; i < lineIndex; i += 1) offset += lines[i].length + 1
          return offset + ch
        }

        /** 记录一次选区，决定要不要浮出「引用」按钮。 */
        const captureSelection = () => {
          if (editingRef.current !== null) return
          const root = rootRef.current
          if (root === null) return
          const selection = window.getSelection()
          if (selection === null || selection.rangeCount === 0 || selection.isCollapsed || typeof quoteSelection !== 'function') {
            setQuoteTarget(null)
            return
          }
          const range = selection.getRangeAt(0)
          if (!root.contains(range.commonAncestorContainer)) {
            setQuoteTarget(null)
            return
          }
          const value = selection.toString().trim()
          if (value === '') {
            setQuoteTarget(null)
            return
          }
          const rect = range.getBoundingClientRect()
          setQuoteTarget({
            text: value,
            left: rect.left + rect.width / 2,
            top: rect.top - 34,
          })
        }

        /** 把选区交给官方引用动作。 */
        const quoteSelectedText = async () => {
          if (quoteTarget === null || typeof quoteSelection !== 'function') return
          const value = quoteTarget.text
          const anchor = { left: quoteTarget.left, top: quoteTarget.top }
          setQuoteTarget(null)
          let outcome = 'failed'
          try {
            outcome = await quoteSelection(value)
          } catch {
            outcome = 'failed'
          }
          if (outcome === 'applied') setQuoteFeedback({ tone: 'done', text: tr('quoteDone', '已加入引用块'), ...anchor })
          else if (outcome === 'text') setQuoteFeedback({ tone: 'done', text: tr('quoteDoneText', '已降级为文本引用'), ...anchor })
          else setQuoteFeedback({ tone: 'error', text: tr('quoteFailed', '引用失败'), ...anchor })
          window.setTimeout(() => setQuoteFeedback(null), 1800)
        }

        if (failure !== null) {
          return h('div', { className: 'gh-md-status', 'data-tone': 'error' }, (t !== undefined ? t('failed') : 'Markdown 渲染器加载失败') + '：' + String(failure.message ?? failure))
        }
        if (content === null || content === undefined || content.kind !== 'text') return null
        // 首次打开（尤其重启后第一次）：可写性未确认前，用与编辑器同一套容器的空白态占位，
        // 避免先渲染一版静态排版、随后切换成 Live Preview 造成的“错误样式”观感。
        // 首帧时 sourcePath/sessionId 可能还没填好，用 content 判断“这是一个可写的文本文档”。
        const renderSavePill = () => (saveState === 'idle'
          ? null
          : h('button', {
              type: 'button',
              className: 'gh-md-save-pill',
              'data-tone': saveState,
              title: saveState === 'conflict'
                ? tr('editReload', '重新载入磁盘版本')
                : saveState === 'error'
                  ? tr('editRetry', '重试')
                  : undefined,
              onClick: saveState === 'conflict'
                ? () => { void reloadFromDisk() }
                : saveState === 'error'
                  ? () => { void persist() }
                  : undefined,
            },
              saveState === 'saving'
                ? tr('editSaving', '保存中…')
                : saveState === 'saved'
                  ? tr('editSaved', '已保存')
                  : saveState === 'conflict'
                    ? (saveMessage !== '' ? saveMessage : tr('editConflict', '外部已修改 · 重新载入'))
                    : (saveMessage !== '' ? saveMessage : tr('editFailed', '保存失败'))))
        const cm6WritableCandidate = (typeof sourcePath === 'string' && sourcePath !== '' && sessionId !== '')
          || (content !== null && content !== undefined && content.kind === 'text')
        // 仅真实浏览器：jsdom 集成测试与显式禁用 CM6 时保持旧的"先静态后切换"行为。
        const cm6FirstOpenGuard = typeof navigator !== 'undefined'
          && /jsdom/iu.test(String(navigator.userAgent)) === false
          && typeof window !== 'undefined'
          && window.__ghMdCm6Disable !== true
        const cm6WaitingForReady = cm6FirstOpenGuard && cm6WritableCandidate && ((cm6Loaded === false && cm6GaveUp === false) || (editable === false && editableKnown === false))
        // 首次打开（尤其重启后第一次）：只要还没准备好可用编辑器，就用与编辑器同一套容器的空白态占位，
        // 绝不先渲染一版静态排版再切换 —— 那正是“第一次显示样式错误”的来源。
        if ((cm6Loaded && editable) || cm6WaitingForReady) {
          const cm6Pill = renderSavePill()
          const copyHintNode = copyHint === null
            ? null
            : h('div', { className: 'gh-md-copy-hint', title: copyHint.detail },
                h('span', { className: 'gh-md-copy-hint-text' }, copyHint.text),
                h('span', { className: 'gh-md-copy-hint-detail' }, copyHint.detail))
          return h(React.Fragment, null,
            copyHintNode,
            cm6Pill,
            h('div', {
              ref: (node) => {
                cm6HostRef.current = node
                // 组件重挂载时 React 在 paint 前调用 ref：先把上一帧的克隆放回去，避免空白闪一下
                if (node === null || node === undefined) return
                if (cm6Placeholder === null) return
                // 占位快照只对同一个文件有意义（切文件时用旧的会闪错内容）
                if (cm6PlaceholderPath !== (typeof sourcePath === 'string' ? sourcePath : '')) {
                  cm6Placeholder = null
                  return
                }
                if (node.childNodes.length > 0) return
                node.appendChild(cm6Placeholder)
                try {
                  const scroller = cm6Placeholder.querySelector('.cm-scroller')
                  if (scroller !== null) scroller.scrollTop = cm6PlaceholderScroll
                } catch {}
                cm6Placeholder = null
              },
              className: 'gh-md-document gh-md-cm6-document' + (String(docText ?? '').length > 60000 ? ' gh-md-cm6-long' : ''),
              'data-github-md': 'document',
            }))
        }
        if (doc === null) {
          return h('div', { className: 'gh-md-status', role: 'status', 'aria-live': 'polite' }, tr('loading', 'Markdown 渲染中…'))
        }
        const floating = quoteFeedback === null && quoteTarget === null ? null : h('button', {
          type: 'button',
          className: 'gh-md-quote-button',
          'data-tone': quoteFeedback === null ? 'idle' : quoteFeedback.tone,
          style: { left: (quoteFeedback === null ? quoteTarget.left : quoteFeedback.left) + 'px', top: (quoteFeedback === null ? quoteTarget.top : quoteFeedback.top) + 'px' },
          onMouseDown: (event) => event.preventDefault(),
          onClick: quoteFeedback === null ? quoteSelectedText : undefined,
        },
          h('span', { className: 'gh-md-quote-button-icon', 'aria-hidden': 'true' }, '“'),
          quoteFeedback === null ? tr('quoteLabel', '引用') : quoteFeedback.text)
        const nodes = []
        if (doc.frontmatter !== '') {
          nodes.push(h('div', { key: 'frontmatter', className: 'gh-md-static', dangerouslySetInnerHTML: { __html: doc.frontmatter } }))
        }
        let virtualPlaced = false
        const pushVirtualEditor = () => {
          virtualPlaced = true
          nodes.push(h(BlockEditor, {
            key: `edit:${editing.key}`,
            value: '',
            caret: 0,
            onChange: (value) => applyDraft(-1, value),
            onFlush: flushDraft,
            onCommit: (value) => commitEdit(-1, value),
            onSave: () => { void persist() },
          }))
        }
        doc.blocks.forEach((block, index) => {
          if (editing !== null && editing.virtual === true && virtualPlaced === false && doc.prefixLength + block.start >= editing.start) {
            pushVirtualEditor()
          }
          if (editing !== null && editing.index === index) {
            nodes.push(h(BlockEditor, {
              key: `edit:${editing.key}`,
              value: block.raw,
              caret: editing.caret,
              onChange: (value) => applyDraft(index, value),
              onFlush: flushDraft,
              onSplit: (caret) => splitBlock(caret),
              table: block.type === 'table',
              imageResolver: resolveImageForEditor,
              onMergePrevious: mergePrevious,
              onMergeNext: mergeNext,
              onMoveNext: () => moveToAdjacentBlock(1),
              onMovePrevious: () => moveToAdjacentBlock(-1),
              onUndo: () => undoRef.current?.(),
              onRedo: () => redoRef.current?.(),
              onCommit: (value) => commitEdit(index, value),
              onSave: () => { void persist() },
            }))
            return
          }
          if (block.html === '') return
          nodes.push(h('div', {
            key: `block:${index}`,
            className: 'gh-md-block',
            'data-gh-md-block': String(index),
            dangerouslySetInnerHTML: { __html: block.html },
          }))
        })
        if (editing !== null && editing.virtual === true && virtualPlaced === false) pushVirtualEditor()
        if (doc.trailing !== '') {
          nodes.push(h('div', { key: 'trailing', className: 'gh-md-static', dangerouslySetInnerHTML: { __html: doc.trailing } }))
        }
        const savePill = renderSavePill()
        if (cellEdit !== null) {
          nodes.push(h('input', {
            key: 'cell-edit',
            className: 'gh-md-cell-input',
            style: {
              left: cellEdit.left + 'px',
              top: cellEdit.top + 'px',
              width: Math.max(60, cellEdit.width) + 'px',
              height: Math.max(24, cellEdit.height) + 'px',
            },
            value: cellEdit.value,
            autoFocus: true,
            onChange: (event) => {
              const value = event.target.value
              setCellEdit((previous) => {
                if (previous === null) return previous
                const next = { ...previous, value }
                cellEditRef.current = next
                return next
              })
            },
            onKeyDown: (event) => {
              if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault()
                commitCellEdit()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                cellEditRef.current = null
                setCellEdit(null)
              }
            },
            onBlur: () => { commitCellEdit() },
          }))
        }
        return h(React.Fragment, null,
          floating,
          savePill,
          h('div', {
            ref: rootRef,
            className: 'gh-md-document',
            'data-github-md': 'document',
            onClick: onDocumentClick,
            onMouseUp: captureSelection,
            onKeyUp: captureSelection,
          }, nodes))
      }

      /** 统一画布上的 16px 图标：1.25px 细描边、圆头圆角。 */
      function iconSvg(size, ...children) {
        return h('svg', {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.25,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        }, ...children)
      }

      function apply(ctx) {
        if (typeof ctx.documentPreviews?.register !== 'function') return
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'github-md: dictionaries')
        ctx.effect(() => ctx.documentPreviews.register({
          id: RENDERER_ID,
          extensions: ['md', 'markdown'],
          priority: 'extension',
          title: () => t('title'),
          loading: 'text-pages',
          wrap: false,
        }), 'github-md: metadata')
        ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({
          name: 'sidebar.right.tab.document',
          key: RENDERER_ID,
          locale: NS,
          inject: (sessionId) => ({
            sessionId,
            quoteSelection: (text) => quoteToComposer(ctx, sessionId, text),
          }),
        }, MarkdownBody)), 'github-md: body')
      }

      // 模块热更新重新执行时也刷新一次样式：已挂载的预览不一定会重新 mount，
      // 否则用户会继续看到旧 CSS（早期就踩过这个坑）。
      try {
        ensureDocumentStyle()
        applySettings(readSettings())
        // 预热：重启后第一次打开文档时，CM6 bundle 与 vendor 已经就绪，
        // 不会再先渲染一帧"静态版本"再切换成编辑器。
        ensureLivePreviewScript().catch(() => {})
        ensureVendor().catch(() => {})
      } catch {
        // 非浏览器环境忽略。
      }

      return { name: 'github-md', inject: ['slots', 'locale', 'documentPreviews'], apply }
    },
  })
})()
/* ─────────────────────────────────────────────────────────────────────────────
 * 新版本提示：/github-md/update/check 由 Host 半边请求 GitHub（浏览器侧有 CORS 限制）。
 * 有新版本时右下角出现一个小条：更新 / 说明 / 关闭。关闭会把版本记到 localStorage，
 * 同一个版本不再打扰；出新版本会再次出现。
 * ───────────────────────────────────────────────────────────────────────────── */
;(() => {
  const SKIP_KEY = 'github-md:update-skipped'
  const STYLE_ID = 'gh-md-update-style'
  const PILL_ID = 'gh-md-update-pill'

  function readSkipped() {
    try { return window.localStorage.getItem(SKIP_KEY) ?? '' } catch { return '' }
  }
  function writeSkipped(version) {
    try { window.localStorage.setItem(SKIP_KEY, String(version)) } catch {}
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID) !== null) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = [
      '#gh-md-update-pill{position:fixed;left:18px;bottom:18px;z-index:2147483000;display:flex;align-items:center;gap:8px;padding:8px 10px 8px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,#ffffff);border:.5px solid var(--dsw-alias-border-l2,#d0d7de);box-shadow:0 6px 24px rgb(0 0 0 / 14%);font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:var(--dsw-alias-label-primary,#1f2328);max-width:min(420px,calc(100vw - 36px));}',
      '#gh-md-update-pill .gh-md-update-dot{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:var(--dsw-alias-state-info-primary,#0969da);color:#fff;font-size:11px;font-weight:700;flex:none;}',
      '#gh-md-update-pill .gh-md-update-text{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '#gh-md-update-pill button{appearance:none;border:.5px solid var(--dsw-alias-border-l2,#d0d7de);background:transparent;color:inherit;font:inherit;font-size:12px;padding:3px 8px;border-radius:6px;cursor:pointer;flex:none;}',
      '#gh-md-update-pill button:hover{background:var(--dsw-alias-interactive-bg-hover,rgb(0 0 0 / 6%));}',
      '#gh-md-update-pill button.gh-md-update-apply{background:var(--dsw-alias-state-info-primary,#0969da);border-color:transparent;color:#fff;}',
      '#gh-md-update-pill button.gh-md-update-apply:hover{filter:brightness(1.05);}',
      '#gh-md-update-pill button.gh-md-update-apply[disabled]{opacity:.6;cursor:default;}',
      '#gh-md-update-pill button.gh-md-update-skip{border-color:transparent;padding:3px 6px;font-size:14px;line-height:1;color:var(--dsw-alias-label-tertiary,#8c959f);}',
    ].join('\n')
    document.head.appendChild(style)
  }

  function removePill() {
    const existing = document.getElementById(PILL_ID)
    if (existing !== null) existing.remove()
  }

  function renderPill(info) {
    if (document.getElementById(PILL_ID) !== null) return
    ensureStyle()
    const pill = document.createElement('div')
    pill.id = PILL_ID
    pill.setAttribute('role', 'status')

    const dot = document.createElement('span')
    dot.className = 'gh-md-update-dot'
    dot.textContent = '↑'

    const label = document.createElement('span')
    label.className = 'gh-md-update-text'
    label.textContent = '有新版本 v' + info.latest + '（当前 v' + info.current + '）'

    const applyButton = document.createElement('button')
    applyButton.type = 'button'
    applyButton.className = 'gh-md-update-apply'
    applyButton.textContent = info.installKind === 'git' ? '更新' : '下载'
    applyButton.title = info.installKind === 'git' ? 'git pull 到最新版本，重启 DSH 后生效' : '打开发布页下载新版本'

    const notesButton = document.createElement('button')
    notesButton.type = 'button'
    notesButton.className = 'gh-md-update-notes'
    notesButton.textContent = '说明'

    const skipButton = document.createElement('button')
    skipButton.type = 'button'
    skipButton.className = 'gh-md-update-skip'
    skipButton.textContent = '×'
    skipButton.title = '这个版本不再提示'
    skipButton.setAttribute('aria-label', '忽略这个版本')

    const openRelease = () => {
      const url = typeof info.url === 'string' && info.url !== '' ? info.url : 'https://github.com/Paradeluxe/dsh-live-markdown/releases/latest'
      window.open(url, '_blank', 'noopener,noreferrer')
    }

    notesButton.addEventListener('click', openRelease)
    skipButton.addEventListener('click', () => {
      writeSkipped(info.latest)
      removePill()
    })

    applyButton.addEventListener('click', async () => {
      if (info.installKind !== 'git') {
        openRelease()
        return
      }
      applyButton.disabled = true
      applyButton.textContent = '更新中…'
      label.textContent = '正在更新到 v' + info.latest + '…'
      try {
        const response = await fetch('/github-md/update/apply', { method: 'POST' })
        const result = await response.json()
        if (result.ok === true) {
          label.textContent = '已更新到 v' + (result.to ?? info.latest) + '，重启 DSH 后生效'
          applyButton.remove()
          notesButton.remove()
          skipButton.textContent = '×'
        } else if (result.reason === 'manual') {
          label.textContent = '需要手动下载新版本'
          applyButton.remove()
          notesButton.textContent = '下载'
        } else {
          label.textContent = '更新失败，请手动更新'
          label.title = String(result.message ?? result.output ?? '')
          applyButton.textContent = '重试'
          applyButton.disabled = false
        }
      } catch (error) {
        label.textContent = '更新失败，请手动更新'
        label.title = String(error)
        applyButton.textContent = '重试'
        applyButton.disabled = false
      }
    })

    pill.appendChild(dot)
    pill.appendChild(label)
    pill.appendChild(applyButton)
    pill.appendChild(notesButton)
    pill.appendChild(skipButton)
    document.body.appendChild(pill)
  }

  async function checkForUpdate() {
    try {
      const response = await fetch('/github-md/update/check', { headers: { accept: 'application/json' } })
      if (!response.ok) return null
      const info = await response.json()
      if (info === null || typeof info !== 'object') return null
      if (info.hasUpdate !== true || typeof info.latest !== 'string') return info
      if (readSkipped() === info.latest) return info
      renderPill(info)
      return info
    } catch {
      return null
    }
  }

  window.__ghMdUpdate = { check: checkForUpdate, dismiss: removePill }

  if (typeof document !== 'undefined' && /^https?:$/u.test(window.location.protocol)) {
    const start = () => {
      window.setTimeout(() => { void checkForUpdate() }, 1500)
      // 长时间挂着的窗口也会看到新版本（Host 侧缓存 10 分钟，这里 4 小时查一次）。
      window.setInterval(() => { void checkForUpdate() }, 4 * 60 * 60 * 1000)
    }
    if (document.readyState === 'complete' || document.readyState === 'interactive') start()
    else window.addEventListener('DOMContentLoaded', start, { once: true })
  }
})()

