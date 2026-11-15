/**
 * Host 半边：发插件自带的浏览器库（marked / DOMPurify / KaTeX / Shiki），并为 Markdown 工作台
 * 提供受工作区约束的文件列表 / 读取 / 保存接口。
 *
 * 预览正文仍由官方文档预览加载器交给浏览器；工作台的文件操作只允许落在当前 Session 的
 * 工作区根目录内（路径 resolve 后做前缀校验，挡 `..` 与绝对路径逃逸），并限制读写大小。
 */
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, normalize, resolve as resolvePath, sep } from 'node:path'
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
async function saveWorkspaceFile(root, relative, content) {
  const target = resolveInside(root, relative)
  if (target === null) throw Object.assign(new Error('path outside workspace'), { code: 'outside' })
  if (!MARKDOWN_EXTENSIONS.has(extname(target).toLowerCase())) throw Object.assign(new Error('not a Markdown file'), { code: 'extension' })
  if (Buffer.byteLength(content, 'utf8') > MAX_TEXT_BYTES) throw Object.assign(new Error('file too large'), { code: 'too-large' })
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
    if (action === 'read' && req.method === 'GET') {
      const sessionId = search.get('sessionId') ?? ''
      const root = workspaceRootOf(ctx, sessionId)
      if (root === null) return sendJson(res, 404, { error: 'workspace-unknown' })
      const file = await readWorkspaceFile(root, search.get('path') ?? '')
      return sendJson(res, 200, file)
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
      const saved = await saveWorkspaceFile(root, body.path, body.content)
      return sendJson(res, 200, saved)
    }
    res.statusCode = 405
    res.end()
  } catch (error) {
    const code = error !== null && error !== undefined && typeof error.code === 'string' ? error.code : 'failed'
    const status = code === 'outside' || code === 'extension' ? 403 : code === 'too-large' ? 413 : 400
    sendJson(res, status, { error: code, message: error instanceof Error ? error.message : String(error) })
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
      if (url.pathname.startsWith(WORKSPACE_PREFIX)) {
        await serveWorkspaceApi(ctx, req, res, url.pathname, url.searchParams)
        return
      }
      await serveAsset(req, res, url.pathname)
    },
  }), 'github-md: vendor + workspace routes')
  logger?.info?.('[github-md] routes ready: /github-md/vendor/ and /github-md/workspace/')
}
