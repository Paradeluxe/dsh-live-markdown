/**
 * Host 半边：发插件自带的浏览器库（marked / DOMPurify / KaTeX / Shiki），并为 Markdown 工作台
 * 提供受工作区约束的文件列表 / 读取 / 保存接口。
 *
 * 预览正文仍由官方文档预览加载器交给浏览器；工作台的文件操作只允许落在当前 Session 的
 * 工作区根目录内（路径 resolve 后做前缀校验，挡 `..` 与绝对路径逃逸），并限制读写大小。
 */
import { execFile } from 'node:child_process'
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { get } from 'node:https'
import { promisify } from 'node:util'
import { dirname, extname, normalize, resolve as resolvePath, sep } from 'node:path'
import { sidecarPathFor, readStoreFile, writeStoreFile } from './src/comments/store-io.js'
import { fileURLToPath } from 'node:url'

/** Loader 行名（与 cordis.patch.yml 的 insert 行对应）。 */
export const name = 'github-md'

/** 静态资源、工作区文件访问与会话工作目录。 */
export const inject = ['webServer', 'sessions', 'workingDirectory']

/** 资源根：`<plugin>/vendor/`。 */
const VENDOR_DIR = fileURLToPath(new URL('./vendor/', import.meta.url))
/** 浏览器侧拼出来的前缀，必须与 client.js 的 `ASSET_BASE` 逐字一致。 */
const ASSET_PREFIX = '/github-md/vendor/'
/** 工作台 API 前缀。 */
const WORKSPACE_PREFIX = '/github-md/workspace/'
/** 版本检测 API 前缀。 */
const UPDATE_PREFIX = '/github-md/update/'
/** 批注侧车 API 前缀。 */
const COMMENTS_PREFIX = '/github-md/comments/'
/** GitHub 仓库（owner/name）。 */
const UPDATE_REPO = 'Paradeluxe/dsh-live-markdown'
/** 版本检测结果缓存时长（GitHub 未认证接口限流 60 次/小时）。 */
const UPDATE_CACHE_MS = 10 * 60 * 1000
/** 插件安装目录（index.js 所在目录）。 */
const PLUGIN_DIR = fileURLToPath(new URL('.', import.meta.url))
/** 检测结果缓存。 */
let updateCache = { at: 0, value: null }
const execFileAsync = promisify(execFile)
/** 单个 Markdown 文件读写上限。 */
const MAX_TEXT_BYTES = 4 * 1024 * 1024
/** 允许工作台打开/保存的扩展名。 */
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdx'])
/** 允许拖拽/粘贴写入的图片扩展名。 */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.bmp'])
/** 单个图片资源大小上限（16 MiB）。 */
const MAX_ASSET_BYTES = 16 * 1024 * 1024
/** 工作台文件树里忽略的目录（噪音目录，不包含用户文档）。 */
const IGNORED_DIRECTORIES = new Set(['node_modules', '__pycache__', '.git', '.venv', 'venv', 'dist', 'build', 'target', '.next', '.cache'])

/** 扩展名 → 媒体类型（KaTeX 的字体也在 vendor 里）。 */
const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
}

/**
 * 发一个 vendor 文件。
 * @param req - Node 请求（只用 method）。
 * @param res - Node 应答。
 * @param pathname - 已解析的 URL pathname。
 * @returns 应答写完即返回。
 */
async function serveAsset(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    res.setHeader('allow', 'GET, HEAD')
    res.end()
    return
  }
  if (!pathname.startsWith(ASSET_PREFIX)) {
    res.statusCode = 404
    res.end()
    return
  }
  let relative
  try {
    relative = decodeURIComponent(pathname.slice(ASSET_PREFIX.length))
  } catch {
    res.statusCode = 400
    res.end()
    return
  }
  const resolved = normalize(VENDOR_DIR + relative)
  if (!resolved.startsWith(VENDOR_DIR.endsWith(sep) ? VENDOR_DIR : VENDOR_DIR + sep)) {
    res.statusCode = 403
    res.end()
    return
  }
  try {
    const body = await readFile(resolved)
    res.statusCode = 200
    res.setHeader('content-type', MIME[extname(resolved).toLowerCase()] ?? 'application/octet-stream')
    res.setHeader('cache-control', 'no-store')
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    res.end(body)
  } catch {
    res.statusCode = 404
    res.end()
  }
}

/**
 * 读取并解析 JSON 请求体，带大小上限。
 * @param req - Node 请求。
 * @param limit - 最大字节数。
 * @returns 解析后的对象。
 */
async function readJsonBody(req, limit = MAX_TEXT_BYTES) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > limit) throw new Error('payload too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text === '' ? {} : JSON.parse(text)
}

/**
 * 发送 JSON 应答。
 * @param res - Node 应答。
 * @param status - HTTP 状态码。
 * @param value - JSON 可序列化对象。
 * @returns 无。
 */
function sendJson(res, status, value) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(value))
}

/**
 * 取 Session 的工作区根目录。
 * @param ctx - Host 根上下文。
 * @param sessionId - Session id。
 * @returns 根目录，或 null。
 */
function workspaceRootOf(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return null
  const session = ctx.sessions.get(sessionId)
  if (session === undefined) return null
  const root = ctx.workingDirectory.get(session)
  return typeof root === 'string' && root !== '' ? resolvePath(root) : null
}

/**
 * 把工作区相对路径解析到根目录内；越界返回 null。
 * @param root - 工作区根目录。
 * @param relative - 相对路径。
 * @returns 绝对路径或 null。
 */
function resolveInside(root, relative) {
  const candidate = typeof relative === 'string' && relative !== '' ? relative : '.'
  const absolute = candidate.startsWith('/') || candidate.startsWith('\\') || /^[A-Za-z]:[\\/]/u.test(candidate)
  const target = absolute ? resolvePath(candidate) : resolvePath(root, candidate)
  const prefix = root.endsWith(sep) ? root : root + sep
  if (target !== root && !target.startsWith(prefix)) return null
  return target
}

/**
 * 递归收集工作区里的 Markdown 文件（供选择器搜索）。
 * @param root - 工作区根目录。
 * @param relative - 起始相对目录。
 * @param depth - 当前深度。
 * @param out - 输出数组。
 * @returns 无。
 */
async function collectMarkdownFiles(root, relative = '', depth = 0, out = []) {
  if (depth > 8 || out.length >= 2000) return
  const directory = resolveInside(root, relative)
  if (directory === null) return
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const next = relative === '' ? entry.name : `${relative}/${entry.name}`
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue
      await collectMarkdownFiles(root, next, depth + 1, out)
      if (out.length >= 2000) return
      continue
    }
    if (!MARKDOWN_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue
    const info = await stat(resolvePath(directory, entry.name)).catch(() => undefined)
    out.push({
      name: entry.name,
      path: next,
      dir: relative,
      size: info?.size ?? 0,
      mtimeMs: info?.mtimeMs ?? 0,
    })
  }
}

/**
 * 列出工作区内一个目录的直接子项。
 * @param root - 工作区根目录。
 * @param relative - 相对目录。
 * @returns 文件树节点。
 */
async function listWorkspaceDirectory(root, relative) {
  const directory = resolveInside(root, relative)
  if (directory === null) throw Object.assign(new Error('path outside workspace'), { code: 'outside' })
  const entries = await readdir(directory, { withFileTypes: true })
  const rows = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue
    if (entry.isDirectory()) {
      rows.push({ name: entry.name, kind: 'directory', path: relative === '' ? entry.name : `${relative}/${entry.name}` })
      continue
    }
    if (!MARKDOWN_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue
    const info = await stat(resolvePath(directory, entry.name)).catch(() => undefined)
    rows.push({
      name: entry.name,
      kind: 'file',
      path: relative === '' ? entry.name : `${relative}/${entry.name}`,
      size: info?.size ?? 0,
      mtimeMs: info?.mtimeMs ?? 0,
    })
  }
  rows.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1))
  return rows
}

/**
 * 读一个工作区 Markdown 文件。
 * @param root - 工作区根目录。
 * @param relative - 相对路径。
 * @returns 文件内容与元信息。
 */
async function readWorkspaceFile(root, relative) {
  const target = resolveInside(root, relative)
  if (target === null) throw Object.assign(new Error('path outside workspace'), { code: 'outside' })
  if (!MARKDOWN_EXTENSIONS.has(extname(target).toLowerCase())) throw Object.assign(new Error('not a Markdown file'), { code: 'extension' })
  const info = await stat(target)
  if (!info.isFile()) throw Object.assign(new Error('not a file'), { code: 'not-file' })
  if (info.size > MAX_TEXT_BYTES) throw Object.assign(new Error('file too large'), { code: 'too-large' })
  const content = await readFile(target, 'utf8')
  return { path: relative, absolutePath: target, content, size: info.size, mtimeMs: info.mtimeMs }
}

/**
 * 保存一个工作区 Markdown 文件。
 * @param root - 工作区根目录。
 * @param relative - 相对路径。
 * @param content - UTF-8 文本。
 * @returns 保存后的元信息。
 */
async function saveWorkspaceFile(root, relative, content, base) {
  const target = resolveInside(root, relative)
  if (target === null) throw Object.assign(new Error('path outside workspace'), { code: 'outside' })
  if (!MARKDOWN_EXTENSIONS.has(extname(target).toLowerCase())) throw Object.assign(new Error('not a Markdown file'), { code: 'extension' })
  if (Buffer.byteLength(content, 'utf8') > MAX_TEXT_BYTES) throw Object.assign(new Error('file too large'), { code: 'too-large' })
  // 乐观并发：客户端带上「上次读到的内容」，磁盘上的内容变了就拒绝写入，
  // 让前端弹「外部已修改」而不是把别人的改动静默覆盖掉。
  if (typeof base === 'string') {
    let diskText = ''
    try {
      diskText = await readFile(target, 'utf8')
    } catch {
      diskText = ''
    }
    const normalize = (value) => String(value).replace(/\r\n/gu, '\n')
    if (normalize(diskText) !== normalize(base)) {
      throw Object.assign(new Error('file changed on disk'), { code: 'conflict' })
    }
  }
  await writeFile(target, content, 'utf8')
  const info = await stat(target)
  return { path: relative, absolutePath: target, size: info.size, mtimeMs: info.mtimeMs }
}

/**
 * 处理工作台 API 请求。
 * @param ctx - Host 根上下文。
 * @param req - Node 请求。
 * @param res - Node 应答。
 * @param pathname - URL pathname。
 * @param search - URL search params。
 * @returns 无。
 */
/**
 * 写入一个工作区图片资源（拖拽/粘贴图片时使用）。
 * @param root - 工作区根目录。
 * @param relative - 相对路径。
 * @param base64 - base64 编码的二进制。
 * @returns 保存后的元信息。
 */
async function saveWorkspaceAsset(root, relative, base64) {
  const target = resolveInside(root, relative)
  if (target === null) throw Object.assign(new Error('path outside workspace'), { code: 'outside' })
  if (!IMAGE_EXTENSIONS.has(extname(target).toLowerCase())) throw Object.assign(new Error('not an image'), { code: 'extension' })
  const buffer = Buffer.from(String(base64), 'base64')
  if (buffer.byteLength === 0) throw Object.assign(new Error('empty asset'), { code: 'empty' })
  if (buffer.byteLength > MAX_ASSET_BYTES) throw Object.assign(new Error('asset too large'), { code: 'too-large' })
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, buffer)
  return { path: relative, absolutePath: target, size: buffer.byteLength }
}

/**
 * 批注侧车读写：`<doc>.comments.json`。
 *   GET  /github-md/comments/load?sessionId=…&path=<工作区相对路径>
 *   POST /github-md/comments/save  { sessionId, path, store, baseMtimeMs? }
 * 只允许落在当前 Session 的工作区里；写盘是原子的，磁盘版本更新时按 id 合并，谁的修改都不丢。
 * @param ctx - Host 根上下文。
 * @param req - 请求。
 * @param res - 响应。
 * @param pathname - 已匹配 COMMENTS_PREFIX 的路径。
 * @param search - 查询参数。
 * @returns 无。
 */
async function serveCommentsApi(ctx, req, res, pathname, search) {
  const action = pathname.slice(COMMENTS_PREFIX.length)
  try {
    if (action === 'load' && req.method === 'GET') {
      const root = workspaceRootOf(ctx, search.get('sessionId') ?? '')
      if (root === null) return sendJson(res, 404, { error: 'workspace-unknown' })
      const markdownPath = search.get('path') ?? ''
      const target = resolveInside(root, markdownPath)
      if (target === null) return sendJson(res, 403, { error: 'outside-workspace' })
      const sidecar = sidecarPathFor(target)
      const result = await readStoreFile(sidecar)
      return sendJson(res, 200, {
        ok: true,
        path: markdownPath,
        sidecar: sidecar.slice(root.length + 1).split(sep).join('/'),
        exists: result.exists,
        mtimeMs: result.mtimeMs,
        error: result.error,
        store: result.store,
      })
    }
    if (action === 'save' && req.method === 'POST') {
      let body = ''
      req.setEncoding('utf8')
      await new Promise((resolveDone) => {
        req.on('data', (chunk) => {
          if (body.length < 8 * 1024 * 1024) body += chunk
        })
        req.on('end', () => resolveDone())
        req.on('error', () => resolveDone())
      })
      let payload = null
      try {
        payload = body === '' ? null : JSON.parse(body)
      } catch {
        payload = null
      }
      if (payload === null || typeof payload !== 'object') return sendJson(res, 400, { error: 'bad-json' })
      const root = workspaceRootOf(ctx, payload.sessionId ?? '')
      if (root === null) return sendJson(res, 404, { error: 'workspace-unknown' })
      const markdownPath = typeof payload.path === 'string' ? payload.path : ''
      if (markdownPath === '') return sendJson(res, 400, { error: 'path-required' })
      const target = resolveInside(root, markdownPath)
      if (target === null) return sendJson(res, 403, { error: 'outside-workspace' })
      if (payload.store === null || typeof payload.store !== 'object') return sendJson(res, 400, { error: 'store-required' })
      const sidecar = sidecarPathFor(target)
      const saved = await writeStoreFile(sidecar, payload.store, { baseMtimeMs: typeof payload.baseMtimeMs === 'number' ? payload.baseMtimeMs : null })
      return sendJson(res, 200, {
        ok: true,
        path: markdownPath,
        sidecar: sidecar.slice(root.length + 1).split(sep).join('/'),
        mtimeMs: saved.mtimeMs,
        merged: saved.merged,
        store: saved.store,
      })
    }
    return sendJson(res, 404, { error: 'unknown-action', action })
  } catch (error) {
    return sendJson(res, 500, { error: 'comments-failed', message: error instanceof Error ? error.message : String(error) })
  }
}

async function serveWorkspaceApi(ctx, req, res, pathname, search) {
  const action = pathname.slice(WORKSPACE_PREFIX.length)
  try {
    if (action === 'list' && req.method === 'GET') {
      const sessionId = search.get('sessionId') ?? ''
      const root = workspaceRootOf(ctx, sessionId)
      if (root === null) return sendJson(res, 404, { error: 'workspace-unknown' })
      const rows = await listWorkspaceDirectory(root, search.get('path') ?? '')
      return sendJson(res, 200, { root, path: search.get('path') ?? '', entries: rows })
    }
    if (action === 'tree' && req.method === 'GET') {
      const sessionId = search.get('sessionId') ?? ''
      const root = workspaceRootOf(ctx, sessionId)
      if (root === null) return sendJson(res, 404, { error: 'workspace-unknown' })
      const files = []
      await collectMarkdownFiles(root, '', 0, files)
      files.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path))
      return sendJson(res, 200, { root, files })
    }
    if (action === 'diagnose' && req.method === 'POST') {
      // 客户端把「预览里的结构性事实」上报到这里，落在插件目录的 diagnostics.log（JSONL），
      // 专门用来排查「图片不显示」这类只能在实际桌面端复现的问题。
      let body = ''
      req.setEncoding('utf8')
      req.on('data', (chunk) => {
        if (body.length < 200000) body += chunk
      })
      req.on('end', () => {
        try {
          const record = { at: new Date().toISOString(), data: JSON.parse(body === '' ? '{}' : body) }
          void appendFile(new URL('./diagnostics.log', import.meta.url), JSON.stringify(record) + '\n', 'utf8')
        } catch {}
        sendJson(res, 200, { ok: true })
      })
      return
    }
    if (action === 'read' && req.method === 'GET') {
      const sessionId = search.get('sessionId') ?? ''
      const root = workspaceRootOf(ctx, sessionId)
      if (root === null) return sendJson(res, 404, { error: 'workspace-unknown' })
      const file = await readWorkspaceFile(root, search.get('path') ?? '')
      return sendJson(res, 200, file)
    }
    if (action === 'stat' && req.method === 'GET') {
      // 图片版本探测：客户端拿 mtimeMs 给 /api/file 加 ?v= 破浏览器缓存（该路由是 immutable）。
      const sessionId = search.get('sessionId') ?? ''
      const root = workspaceRootOf(ctx, sessionId)
      if (root === null) return sendJson(res, 404, { error: 'workspace-unknown' })
      let requested = []
      try {
        const parsed = JSON.parse(search.get('paths') ?? '[]')
        if (Array.isArray(parsed)) requested = parsed
      } catch {
        requested = []
      }
      const files = {}
      for (const entry of requested.slice(0, 400)) {
        if (typeof entry !== 'string' || entry === '') continue
        const target = resolveInside(root, entry)
        if (target === null) continue
        try {
          const info = await stat(target)
          if (info.isFile()) files[entry] = { mtimeMs: info.mtimeMs, size: info.size }
        } catch {}
      }
      return sendJson(res, 200, { files })
    }
    if (action === 'asset' && req.method === 'POST') {
      const body = await readJsonBody(req)
      const root = workspaceRootOf(ctx, body.sessionId)
      if (root === null) return sendJson(res, 404, { error: 'workspace-unknown' })
      if (typeof body.path !== 'string' || typeof body.base64 !== 'string') return sendJson(res, 400, { error: 'bad-request' })
      const saved = await saveWorkspaceAsset(root, body.path, body.base64)
      return sendJson(res, 200, saved)
    }
    if (action === 'save' && req.method === 'POST') {
      const body = await readJsonBody(req)
      const root = workspaceRootOf(ctx, body.sessionId)
      if (root === null) return sendJson(res, 404, { error: 'workspace-unknown' })
      if (typeof body.path !== 'string' || typeof body.content !== 'string') return sendJson(res, 400, { error: 'bad-request' })
      const saved = await saveWorkspaceFile(root, body.path, body.content, typeof body.base === 'string' ? body.base : undefined)
      return sendJson(res, 200, saved)
    }
    res.statusCode = 405
    res.end()
  } catch (error) {
    const code = error !== null && error !== undefined && typeof error.code === 'string' ? error.code : 'failed'
    const status = code === 'outside' || code === 'extension' ? 403 : code === 'too-large' ? 413 : code === 'conflict' ? 409 : 400
    sendJson(res, status, { error: code, message: error instanceof Error ? error.message : String(error) })
  }
}

/** 读取当前安装的插件版本（package.json）。 */
async function readInstalledVersion() {
  const raw = await readFile(new URL('./package.json', import.meta.url), 'utf8')
  return String(JSON.parse(raw).version ?? '0.0.0')
}

/** 安装形态：git 仓库可以一键更新，其它（拷贝/解压）只能手动下载。 */
async function detectInstallKind() {
  try {
    const info = await stat(resolvePath(PLUGIN_DIR, '.git'))
    return info.isDirectory() ? 'git' : 'copy'
  } catch {
    return 'copy'
  }
}

/** 把 'v1.2.3' / '1.2.3-beta.1' 解析成数字数组，用于比较。 */
function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(String(value ?? '').replace(/^v/u, ''))
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** 比较两个版本号：a > b 返回 1，相等 0，a < b 返回 -1。 */
function compareVersions(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (left === null || right === null) return 0
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1
  }
  return 0
}

/** 请求 GitHub 最新 release（无认证，带超时）。 */
function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const request = get({
      hostname: 'api.github.com',
      path: '/repos/' + UPDATE_REPO + '/releases/latest',
      headers: {
        'user-agent': 'dsh-live-markdown-updater',
        accept: 'application/vnd.github+json',
      },
      timeout: 8000,
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        if (response.statusCode !== 200) {
          reject(new Error('github-http-' + String(response.statusCode)))
          return
        }
        try {
          resolve(JSON.parse(body))
        } catch (error) {
          reject(error instanceof Error ? error : new Error('bad-json'))
        }
      })
    })
    request.on('timeout', () => request.destroy(new Error('github-timeout')))
    request.on('error', (error) => reject(error))
  })
}

/**
 * 检查是否有新版本。
 * @param force - 是否忽略缓存。
 * @returns 检测结果。
 */
async function checkForUpdate(force) {
  const now = Date.now()
  if (force !== true && updateCache.value !== null && now - updateCache.at < UPDATE_CACHE_MS) {
    return updateCache.value
  }
  let current = '0.0.0'
  try {
    current = await readInstalledVersion()
  } catch {}
  const result = {
    current,
    latest: null,
    hasUpdate: false,
    url: 'https://github.com/' + UPDATE_REPO + '/releases/latest',
    notes: '',
    publishedAt: null,
    installKind: await detectInstallKind(),
    checkedAt: new Date().toISOString(),
    error: null,
  }
  try {
    const release = await fetchLatestRelease()
    result.latest = String(release.tag_name ?? '').replace(/^v/u, '') || null
    if (typeof release.html_url === 'string' && release.html_url !== '') result.url = release.html_url
    if (typeof release.body === 'string') result.notes = release.body.slice(0, 4000)
    if (typeof release.published_at === 'string') result.publishedAt = release.published_at
    result.hasUpdate = result.latest !== null && compareVersions(result.latest, current) > 0
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
  }
  updateCache = { at: now, value: result }
  return result
}

/**
 * 一键更新：git 安装走 `git pull --ff-only`，其它安装形态返回手动更新提示。
 * @returns 更新结果。
 */
async function applyUpdate() {
  const from = await readInstalledVersion().catch(() => null)
  const kind = await detectInstallKind()
  const url = 'https://github.com/' + UPDATE_REPO + '/releases/latest'
  if (kind !== 'git') {
    return { ok: false, reason: 'manual', from, url, message: '当前安装不是 git 仓库，请从发布页下载新版本覆盖安装。' }
  }
  try {
    const fetched = await execFileAsync('git', ['-C', PLUGIN_DIR, 'fetch', '--tags', '--prune'], { timeout: 60000, windowsHide: true })
    const pulled = await execFileAsync('git', ['-C', PLUGIN_DIR, 'pull', '--ff-only'], { timeout: 60000, windowsHide: true })
    const to = await readInstalledVersion().catch(() => null)
    updateCache = { at: 0, value: null }
    return {
      ok: true,
      from,
      to,
      restartRequired: to !== from,
      url,
      output: (String(fetched.stdout ?? '') + String(pulled.stdout ?? '')).trim().slice(0, 2000),
    }
  } catch (error) {
    const stdout = error !== null && error !== undefined && typeof error.stdout === 'string' ? error.stdout : ''
    const stderr = error !== null && error !== undefined && typeof error.stderr === 'string' ? error.stderr : ''
    return {
      ok: false,
      reason: 'git-failed',
      from,
      url,
      message: error instanceof Error ? error.message : String(error),
      output: (stdout + stderr).trim().slice(0, 3000),
    }
  }
}

/**
 * 版本检测 / 一键更新 API。
 * @param req - Node 请求。
 * @param res - Node 应答。
 * @param pathname - URL pathname。
 * @param search - URL 查询参数。
 * @returns 应答写完即返回。
 */
async function serveUpdateApi(req, res, pathname, search) {
  const action = pathname.slice(UPDATE_PREFIX.length)
  try {
    if (action === 'check' && (req.method === 'GET' || req.method === 'HEAD')) {
      const result = await checkForUpdate(search.get('force') === '1')
      return sendJson(res, 200, result)
    }
    if (action === 'apply' && req.method === 'POST') {
      const result = await applyUpdate()
      return sendJson(res, 200, result)
    }
    res.statusCode = 405
    res.end()
  } catch (error) {
    sendJson(res, 500, { error: 'failed', message: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * 启动插件。
 * @param ctx - Host 根上下文。
 * @returns 无。
 */
export function apply(ctx) {
  const logger = ctx.logger ?? console
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/github-md',
    handler: async (req, res) => {
      let url
      try {
        url = new URL(req.url ?? '/', 'http://127.0.0.1')
      } catch {
        res.statusCode = 400
        res.end()
        return
      }
      if (url.pathname.startsWith(UPDATE_PREFIX)) {
        await serveUpdateApi(req, res, url.pathname, url.searchParams)
        return
      }
      if (url.pathname.startsWith(COMMENTS_PREFIX)) {
        await serveCommentsApi(ctx, req, res, url.pathname, url.searchParams)
        return
      }
      if (url.pathname.startsWith(WORKSPACE_PREFIX)) {
        await serveWorkspaceApi(ctx, req, res, url.pathname, url.searchParams)
        return
      }
      await serveAsset(req, res, url.pathname)
    },
  }), 'github-md: vendor + workspace routes')
  logger?.info?.('[github-md] routes ready: /github-md/vendor/, /github-md/workspace/ and /github-md/comments/')
}
