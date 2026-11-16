# dsh-live-markdown

English | [中文](README.zh.md)

**Obsidian-style Live Preview for Markdown inside [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).** A Markdown file opens in a single view where every block renders in place, and only the block — or the whole selection — you are editing shows its raw Markdown. No more switching between a rendered page and a source buffer.

![Live Preview](docs/screenshots/live-preview.png)

## What you get

- **Block-level editing.** The active line (or the active selection) shows source; everything else stays rendered — the Live Preview behaviour of Obsidian.
- **Measured against real Obsidian.** The numbers come from reading Obsidian 1.15.1 through the DevTools protocol, not from guessing: body line-height **1.5**, heading `padding-top` **16px**, list rows **26–27px**, table cells **29.8px** tall with **4px/8px** padding and **1px `#e4e4e4`** borders, tables sized to content, image radius **4px**.
- **Images.** A full-line `![[image.png]]` renders as a block widget so it occupies exactly its own height (no phantom line box), `![[image.png|300]]` sets the width, and **double-click** opens an Obsidian-style lightbox: 90 % black backdrop, image fitted to the viewport, filename titlebar, close with backdrop click or <kbd>Esc</kbd>.
- **Folding** for headings, bullet lists, ordered lists and task lists — hover the row for the chevron; folded state is remembered per file.
- **Editing keymap** that behaves like Obsidian: <kbd>Enter</kbd> continues or exits lists/quotes, <kbd>Backspace</kbd> removes a list marker, <kbd>Tab</kbd>/<kbd>Shift+Tab</kbd> indent, <kbd>Ctrl+B</kbd>/<kbd>Ctrl+I</kbd> toggle bold/italic, <kbd>Ctrl+K</kbd> inserts a wikilink, <kbd>Ctrl+Enter</kbd> toggles a task, <kbd>Ctrl+Shift+K</kbd> deletes a line, <kbd>Ctrl+Shift+V</kbd> pastes plain text, <kbd>Ctrl+S</kbd> saves.
- **Tables** edit in place: click a cell and type, <kbd>Tab</kbd> moves between cells, right-click for insert/delete row or column and alignment.
- **Blocks** render with Obsidian's look: callouts (type colours, Lucide icons, `-`/`+` folding), quotes, task lists, code fences with a language label and copy button, KaTeX math, frontmatter properties card (tags as pills), footnotes as superscripts, `==highlight==`, `<kbd>`.
- **Links and embeds.** `[[note|alias]]` renders with the alias, `![[note]]` embeds the target note inline, hovering a wikilink shows a preview card, `![[image]]`/`![alt](image)` render inline.
- **Images you paste or drop** are written next to the note and inserted as `![[name]]`.
- **Long documents stay fast.** Decorations are built per viewport: a 6 600-line note rebuilds its decorations in ~5 ms and completes a keystroke in ~10 ms.
- **No keystrokes lost.** Change propagation is throttled for performance but flushed before saving, switching files, or unmounting.

## Screenshots

Tables and images follow Obsidian's box metrics; the table is sized to its content, the image fills the text column:

![Table and image metrics](docs/screenshots/table-image.png)

Double-click an image for the lightbox (same structure as Obsidian's: backdrop, fitted image, filename titlebar):

![Image lightbox](docs/screenshots/lightbox.png)

Headings, paragraphs and lists use Obsidian's measured row heights:

![Spacing](docs/screenshots/spacing.png)

## Install

### Requirements

- DSH **0.2.2-rc.3** or newer (declared as `engines.dsh`). The plugin is a DSH *bundle*: it needs no install script, so no build approval is requested.
- Nothing else. CodeMirror 6, marked, KaTeX, DOMPurify, Shiki and the Literata font are vendored inside the package, so the preview works offline.

### From GitHub

```sh
dsh plugin --profile desktop add github:Paradeluxe/dsh-live-markdown
```

Use the profile you actually run — `desktop` for the Desktop app. In the app you can also use **Plugins → Add plugin** and point it at a local checkout.

### From npm

```sh
dsh plugin --profile desktop add @paradeluxe/dsh-live-markdown
```

If that package is not on npm yet, use the GitHub command above; both install the same code.

### Turn it on

Open **Plugins**, find **Obsidian-style Markdown preview** and make sure it is enabled, then open any `.md` file from the workspace panel. The preview header keeps a switch back to the official renderer, so nothing is forced on you.

## Obsidian parity

[`PARITY.md`](PARITY.md) lists 52 Live Preview behaviours with their status and the check that covers each one. A few entries from the measured set:

| Behaviour | Obsidian 1.15.1 (measured) | This plugin |
|---|---|---|
| Active block shows source, the rest renders | ✓ | ✓ |
| Unfocused editor renders everything | ✓ | ✓ |
| Active range = whole selection | ✓ | ✓ |
| Body / heading row heights | 24px / 45–48px (16px heading padding) | 24px / 44–47px |
| Table cells | 29.8px tall, `4px 8px` padding, 1px `#e4e4e4` | 29.8px, `4px 8px`, 1px `#e4e4e4` |
| Image click | single click does nothing, double-click opens lightbox | same |
| Lightbox | `.lightbox` + `rgba(0,0,0,.9)` backdrop + filename bar | same |
| Wikilink click | opens the target note | copies the target (see limitations) |

Known limitations, recorded honestly in `PARITY.md`:

- **Wikilink/embed clicks copy the target instead of opening it** — DSH's document preview has no host API for opening another file.
- **The properties card edits raw YAML**; Obsidian's property type picker and "add property" affordances are not replicated.
- Graph view, backlinks, command palette and Vim mode are host or editor features outside a Markdown renderer.
- Colours approximate Obsidian's light theme; dark-theme tuning is basic.

## How it works

`index.js` is the Host half: it registers the document-preview renderer and a small workspace API (list/tree/read/save plus `asset` for pasted images) on the desktop app's local server. `client.js` is the web half: it owns the preview panel, mounts one CodeMirror 6 `EditorView` for the whole note, and keeps decorations, block widgets, fold state, selection, undo history and save throttling in per-file memory. `src/cm6-entry.js` is the CodeMirror side of that editor and is bundled into `vendor/cm6-live-preview.js` by `scripts/build-client.mjs`.

## Verification

Every number quoted above was measured against a real DSH instance with Playwright, and against Obsidian 1.15.1 for the layout values. [docs/VERIFICATION.md](docs/VERIFICATION.md) records the environment, the 42-script GUI suite, the measurements behind each claim, and what remains unverified.

## Development

```sh
npm install
npm run build:client   # src/cm6-entry.js -> vendor/cm6-live-preview.js
npm run smoke          # renders a sample document through the Host renderer
```

The plugin is verified against DSH 0.2.2-rc.3 with an automated Playwright suite (42 scripts / >200 assertions) that drives a real DSH instance: active-line semantics, folding, keymap, tables, callouts, embeds, image paste, lightbox, long-document scrolling and save/reopen integrity. The suite runs against a throwaway DSH profile; it is not shipped in this package.

## Third-party assets

Vendored under `vendor/`, each under its own licence:

| Asset | Licence |
|---|---|
| CodeMirror 6 | MIT |
| marked, marked-footnote | MIT |
| KaTeX | MIT |
| Shiki | MIT |
| DOMPurify | Apache-2.0 OR MPL-2.0 |
| Literata (font) | SIL Open Font License 1.1 |

## License

MIT — see [LICENSE](LICENSE).

## 1.0.1（v1.0.1）

- 把开发期的测量与设计记录并入仓库：`docs/SPEC.md`（逐轮实现记录与实测数据）、`docs/DESIGN.md`（架构决策）。
- `scripts/render-smoke.mjs` 不再依赖外部目录，`npm install && npm run smoke` 即可运行。
- 这个仓库同时也是开发用工作副本，验证环境通过 `link:` 指向它，避免"开发目录 / 发布仓库"两份代码漂移。

- 重建窗口内可能出现"占位克隆 + 真实编辑器"并存，已加去重（宿主里只保留真实编辑器），占位克隆 `pointer-events:none`，真实编辑器带 `data-ghmd-live` 标记。

## 1.0.2（v1.0.2）

- 每个文件记住滚动位置：切走再回来、或宿主重挂载预览时，不再跳回文档顶部。
- 排查打字时"闪动/跳动"：在真实实例里用脚本逐字输入（英文 26 键、中文输入法组合输入、长文档内部滚动、小窗口）采样光标屏幕坐标与滚动位置，未复现光标或滚动位移；本轮先修掉"重挂载跳回顶部"这一确定会跳的原因。

## 1.0.3（v1.0.3）

修掉「一打字就闪、跳」的根因：DSH 文档预览在文件内容/mtime 变化时会重建整个预览组件，自动保存因此每 200ms 一次地把编辑器拆掉重建，表现为页面闪动。

- 自动保存防抖 200ms → 700ms（只在停手后写盘；`Ctrl+S` 立即保存）；
- 预览重建时用**上一帧 DOM 克隆占位**（React ref 在 paint 前填充），新编辑器挂载后替换占位，逐帧采样 **0 空白帧**；
- 配合 1.0.2 的滚动位置记忆与已有的光标/折叠记忆，重建后光标、滚动位置保持不变。

## 1.0.4（v1.0.4）

- 自动保存防抖进一步提到 **1500ms**：连续打字（含 1 秒内的停顿）不再触发重建，撤销栈因此不会被重建打断；
- 重挂载占位只对**同一个文件**复用（切换文件时不再可能闪现上一篇内容）；
- 关闭窗口/切后台时用 `sendBeacon` 兜底保存（防抖期间的输入不会丢）；
- 占位快照 `pointer-events:none`，真实编辑器 `data-ghmd-live="1"`，宿主里始终只有一份真实编辑器。

## 保存行为（实测）

没有保存按钮，写盘是自动的。实测（真实 GUI，Playwright 轮询文件内容）：

| 触发方式 | 落盘延迟 |
|---|---|
| 停手后自动保存 | **约 1.5 秒**（防抖 1500ms + 一次往返，实测 1652ms） |
| `Ctrl+S`（编辑器内） | **立即**（实测 0ms） |
| 关闭窗口 / 页面卸载 | 立即（`pagehide` + `sendBeacon` 兜底） |
| 关闭预览标签页 | 不立即，但挂起的保存计时器仍会执行（实测 1.5 秒内落盘） |

右下角有一个保存状态提示（保存中… / 已保存；失败时显示原因并可点击重试），它不是保存按钮。

## 1.0.5（v1.0.5）：可见期间不再写盘，所以不会再闪

根因：DSH 预览层在文件变化（mtime/内容）时会重建整个预览组件，读盘 → 重建 → 重挂载。只要写盘发生在**你正看着的时候**，就必然有一帧重绘。

1.0.5 的做法：**你看着的时候不写盘**，把写盘安排到"看不见"的时机——重建发生在你看不到的时候，视觉上永不闪。

| 什么时候保存 | 说明 |
|---|---|
| 窗口失焦 / 切到别的应用 | 立刻写盘（此时你在看别的窗口） |
| 关闭/切换预览标签页 | 卸载时立刻写盘 |
| 关闭窗口 / 页面隐藏 | `pagehide` + `sendBeacon` |
| 编辑器内 `Ctrl+S` | 立刻写盘（你主动要求的） |
| 连续 30 分钟盯着文档不操作 | 兜底写一次（防止崩溃丢内容，正常使用几乎不会触发） |

实测（真实 GUI，逐帧采样）：可见状态下连续打字并等待，**350 帧内编辑器节点身份变化 0 次、空白帧 0、滚动位移 0**；窗口失焦后 1 秒内落盘。

代价：**可见期间不会自动落盘**（这是"永不闪"的前提）。如果你习惯随时关掉进程，按 `Ctrl+S` 或切一下窗口即可保存。

## 1.0.6（v1.0.6）：重做折叠箭头

旧版用的是文字三角 `▸/▾`（14×10 的字符盒 + 负边距），和文字基线对不齐，标题越大越明显（实测偏低 2.5–4.5px），字形也糙。

- 换成 **16×16 圆角描边 SVG chevron**（1.7px 描边、圆头圆角），展开时旋转 90° 指向下，折叠时指向右，过渡 160ms；
- 尺寸随层级：h1 20px → h6 15px，列表/任务 15px（`--gh-md-chevron-size`）；
- 用 `--gh-md-chevron-shift` 逐层级修正，实测**全部上下文与文字中心偏差 ≤ 0.5px**（h1–h6、有序、无序、任务实测 0–0.1px）；
- 只在悬停该行时出现（opacity 0 → 1），折叠状态常显；悬停有 4% 淡色圆形底，颜色随主题走 `--dsw-alias-label-*`；
- callout 标题栏的折叠箭头也换成同一套 SVG。

![折叠箭头](docs/screenshots/chevron.png)
