/**
 * 渲染管线冒烟：把 `client.js` 里 `/* github-md:render:start *\/` 与 `/* github-md:render:end *\/`
 * 之间的纯函数截出来，放进 jsdom + 真实 marked / DOMPurify / KaTeX 里跑。
 *
 * jsdom 只在开发时使用（devDependency）；也可以用 `GITHUB_MD_TEST_ROOT` 指向别的装有 jsdom 的目录。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const require = createRequire(import.meta.url)
let jsdom = null
try {
  jsdom = require('jsdom')
} catch {
  const jsdomRoot = process.env.GITHUB_MD_TEST_ROOT ?? ''
  if (jsdomRoot === '') {
    throw new Error('未找到 jsdom：请先 npm install，或设置 GITHUB_MD_TEST_ROOT 指向装有 jsdom 的目录')
  }
  jsdom = createRequire(join(jsdomRoot, 'package.json'))('jsdom')
}
const { JSDOM } = jsdom
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:49758/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.DOMParser = dom.window.DOMParser

/**
 * 以 CommonJS 语义执行 vendor 里的 UMD 文件（插件的 package.json 是 type:module，
 * 直接 require 会被 Node 当成 ESM 加载）。
 * @param relative - vendor 下的相对路径。
 * @returns `module.exports`。
 */
function loadUmd(relative) {
  const code = readFileSync(join(root, 'vendor', relative), 'utf8')
  const module = { exports: {} }
  const run = new Function('module', 'exports', 'window', 'document', 'self', 'globalThis', `${code}\n;return module.exports`)
  return run(module, module.exports, dom.window, dom.window.document, dom.window, globalThis)
}

const markedModule = loadUmd('marked.umd.js')
const marked = markedModule
const purifyModule = loadUmd('purify.min.js')
const DOMPurify = typeof purifyModule === 'function' && purifyModule.sanitize === undefined
  ? purifyModule(dom.window)
  : purifyModule
const katexModule = loadUmd('katex/katex.min.js')
const katex = katexModule.katex ?? katexModule

/**
 * 以浏览器全局语义执行一份 IIFE vendor 脚本（脚本自己挂 `window.*`）。
 * @param relative - vendor 下的相对路径。
 * @returns 无。
 */
function loadIife(relative) {
  const code = readFileSync(join(root, 'vendor', relative), 'utf8')
  new Function('window', 'document', code)(dom.window, dom.window.document)
}

loadIife('site-glyphs.js')
const siteGlyphs = dom.window.__githubMdSiteGlyphs
globalThis.__githubMdSiteGlyphs = siteGlyphs
loadIife('marked-footnote.umd.js')
const markedFootnote = globalThis.markedFootnote
loadIife('shiki.js')
const shiki = dom.window.__githubMdShiki
globalThis.__githubMdShiki = shiki

const source = readFileSync(join(root, 'client.js'), 'utf8')
const start = source.indexOf('/* github-md:render:start')
const end = source.indexOf('/* github-md:render:end */')
if (start === -1 || end === -1) throw new Error('找不到 render 标记')
const snippet = source.slice(source.indexOf('\n', start) + 1, end)
const exportsFromSnippet = new Function(`${snippet}; return { createMarkdownRenderer, splitFrontmatter, escapeHtml }`)()
const renderer = exportsFromSnippet.createMarkdownRenderer({
  marked,
  DOMPurify,
  katex,
  shiki,
  markedFootnote,
  footnotesLabel: '脚注',
  doc: dom.window.document,
})

const assert = (condition, message) => { if (!condition) throw new Error(`断言失败：${message}`) }

const absolutePath = 'E:\\hermes_playground\\jspace-repo\\README.md'
const sample = [
  '## Hello <sup>1</sup>',
  '',
  'Author <sup>2</sup>, ^3^ and H~2~O, with ~~gone~~ text.',
  '',
  '| A | B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '| A | B | C | D |',
  '| :-- | :-: | --: | --- |',
  '| 1 | 2 | 3 | 4 |',
  '',
  '- [x] done',
  '- [ ] todo',
  '',
  '```bash',
  'pip install -e "git+https://example.com/x"',
  '```',
  '',
  '```groovy',
  'println "hi"',
  '```',
  '',
  '```BASH',
  'echo hi',
  '```',
  '',
  '[repo](https://github.com/anthropics/jacobian-lens)',
  '',
  'URL as code `https://example.com/x` and image link [![fig](figures/fig1.png)](https://example.com).',
  '',
  'A claim with a note[^Note] and the same note again[^note].',
  '',
  '[^NOTE]: The footnote body with *emphasis*.',
  '',
  'Inline math $a^2 + b^2$ and display:',
  '',
  '$$',
  '\\frac{1}{2}',
  '$$',
  '',
  '![fig](figures/fig1.png)',
  '',
  '<script>window.__pwned = true</script>',
  '',
  'Inline math $x^2$ works.',
  '',
  '$$',
  'a^2 + b^2 = c^2',
  '$$',
].join('\n')

const html = renderer.render(sample, absolutePath)

assert(html.includes('<sup>1</sup>'), '原始 HTML 的 <sup> 应保留')
assert(html.includes('<sup>2</sup>') && html.includes('<sup>3</sup>'), '^3^ 应转成 <sup>')
assert(html.includes('<sub>2</sub>'), '~2~ 应转成 <sub>')
assert(html.includes('<del>gone</del>'), '~~gone~~ 仍应是 GFM 删除线')
assert(html.includes('<table>'), 'GFM 表格应保留')
assert(/<input[^>]*type="checkbox"/.test(html), '任务列表应渲染 checkbox')
assert(/src="http:\/\/127\.0\.0\.1:49758\/api\/file\?path=/.test(html), `本地图片应改写成 /api/file：${html.slice(0, 400)}`)
assert(html.includes('figures'), '图片路径应带上相对目录')
assert(!html.includes('window.__pwned'), '<script> 内容应被 DOMPurify 清掉')
assert(html.includes('class="katex"'), `行内数学应渲染 KaTeX：${html.slice(0, 800)}`)
assert(html.includes('katex-display'), '块级数学应渲染 KaTeX display')
assert(/<h2 id="hello-1">/.test(html), '标题应带锚点 id')
assert(html.includes('gh-md-code-card'), `代码块应渲染成代码卡：${html.slice(-600)}`)
assert(html.includes('gh-md-code-language">bash'), '代码卡应显示语言')
assert(html.includes('gh-md-code-language">groovy'), '扩展后的 Shiki 应支持 groovy')
assert(html.includes('gh-md-code-language">BASH'), '语言大小写应保留在代码卡上')
assert(shiki.supports('BASH') === true && shiki.supports('sv') === true && shiki.supports('json5') === false, 'Shiki 别名表应与官方一致且大小写不敏感')
assert(html.includes('data-copy-label="复制"'), '代码卡按钮文案应可本地化')
assert(html.includes('class="shiki css-variables"'), '代码卡应带 Shiki 高亮')
assert(html.includes('gh-md-code-action'), '代码卡应有复制/换行按钮')
assert(html.includes('gh-md-table-fill'), '表格应使用 fill 容器')
assert(!html.includes('md-table-wide'), '表格不再按列数切成 max-content 宽表')
assert(html.includes('text-align: center'), '表格对齐应转成 inline style')
assert(html.includes('gh-md-link-icon'), '外链应带站点图标')
assert(html.includes('M12 .297c'), 'github 链接应使用 GitHub 站点图标')
assert(html.includes('note<sup>1</sup>') && html.includes('again<sup>1</sup>'), '脚注引用应为数字上标（大小写不敏感）')
assert(html.includes('data-footnotes') && html.includes('class="footnotes"'), '应有脚注区')
assert(!/data-user-content-fn-ref/.test(html), '脚注引用锚点应被拆掉')
assert(html.includes('user-content-fn-note'), '脚注 li 应带官方 id')
assert((html.match(/<li id="user-content-fn-/g) ?? []).length === 1, '大小写不同的引用应合并到同一条脚注')
assert(html.includes('↩'), '脚注回跳应为纯文本 ↩')
assert(!/href="#user-content-fn-ref/.test(html), '回跳锚点应被拆掉')
assert(html.includes('id="footnote-label"'), '脚注标题应保留官方 id')
assert(html.includes('katex'), '数学应交给 KaTeX')
assert(!html.includes('gh-md-math-block'), '块级数学不应再套自建 wrapper')
assert(html.includes('contains-task-list') && html.includes('task-list-item'), '任务列表应带官方类名')
assert(/<code><a href="https:\/\/example\.com\/x"[^>]*>.*<\/a><\/code>/.test(html), 'URL 行内代码应变成可点链接')
assert(/<a href="https:\/\/example\.com"[^>]*><img/.test(html), '纯图片链接不应带图标')

// 桌面端基址是自定义协议：/api/file 图片会解析成 dsh-app://app/...，DOMPurify 必须放行。
const desktopDom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'dsh-app://app/' })
const desktopRenderer = exportsFromSnippet.createMarkdownRenderer({
  marked,
  DOMPurify,
  katex,
  doc: desktopDom.window.document,
})
const desktopHtml = desktopRenderer.render('![fig](figures/fig1.png)', absolutePath)
assert(
  desktopHtml.includes('dsh-app://app/api/file?path='),
  `桌面端局部图片应改写成 dsh-app://app/api/file：${desktopHtml}`,
)

assert(exportsFromSnippet.splitFrontmatter('---\ntitle: x\n---\n# Hi').source === 'title: x', 'frontmatter 应被拆出来')
assert(exportsFromSnippet.splitFrontmatter('---\ntitle: x\n---\n# Hi').body.trim() === '# Hi', 'frontmatter 之后的正文应保留')
assert(exportsFromSnippet.splitFrontmatter('---\ntitle: x\n---\n# Hi').prefix === '---\ntitle: x\n---\n', 'frontmatter 前缀应保留分隔符')

// 块渲染（就地编辑）：与整篇 parse 同语义，同时返回每个顶层块在源文里的区间。
const blockSample = [
  '## Hello <sup>1</sup>',
  '',
  'Author ^3^ text.',
  '',
  '| A | B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '```js',
  'const x = 1',
  '```',
  '',
  '![fig](figures/fig1.png)',
  '',
  'Footnote[^note].',
  '',
  '[^NOTE]: note body.',
].join('\n')
const document = renderer.renderDocument(blockSample, absolutePath)
assert(document.blocks.length === 6, `应有 6 个可编辑块，实际 ${document.blocks.length}`)
assert(
  document.blocks.map((block) => block.type).join(',') === 'heading,paragraph,table,code,paragraph,paragraph',
  `块类型顺序不对：${document.blocks.map((block) => block.type).join(',')}`,
)
for (const [index, block] of document.blocks.entries()) {
  assert(
    blockBlockSlicesMatch(blockSample, block),
    `第 ${index} 块的原文区间与 raw 不一致：start=${block.start} end=${block.end} raw=${JSON.stringify(block.raw.slice(0, 40))} slice=${JSON.stringify(blockSample.slice(block.start, block.end).slice(0, 40))}`,
  )
  assert(block.html.trim() !== '', `第 ${index} 块应有渲染结果`)
}
function blockBlockSlicesMatch(source, block) {
  return source.slice(block.start, block.end) === block.raw
}
assert(document.blocks[0].html.includes('<h2'), '标题块应渲染成 h2')
assert(document.blocks[2].html.includes('gh-md-table-fill'), '表格块应带 fill 容器')
assert(document.blocks[3].html.includes('gh-md-code-card'), '代码块应渲染成代码卡')
assert(document.blocks[4].html.includes('api/file?path='), '图片块应改写成 /api/file')
assert(document.trailingHtml.includes('data-footnotes'), '脚注区应作为静态尾段返回')
assert(!document.trailingHtml.includes('gh-md-block-editor'), '尾段不应带编辑器外壳')
const emptyDocument = renderer.renderDocument('', absolutePath)
assert(emptyDocument.blocks.length === 0, '空文档应没有可编辑块')

// 与 Obsidian 默认一致：单个换行渲染成 <br>，空行才分段。
const softBreakHtml = renderer.render('first line\nsecond line', absolutePath)
assert(softBreakHtml.includes('<br>'), `单个换行应渲染成 <br>（Obsidian 默认）：${softBreakHtml}`)
const paragraphHtml = renderer.render('first paragraph\n\nsecond paragraph', absolutePath)
assert((paragraphHtml.match(/<p>/gu) ?? []).length === 2, `空行应分成两个段落：${paragraphHtml}`)

console.log('RENDER OK', { htmlLength: html.length, sampleHead: html.slice(0, 240) })
