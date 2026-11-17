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

## 1.0.7（v1.0.7）：修掉「重启后第一次打开样式不对」

原因有三层，都在首帧上：

1. **文档 CSS 在首帧之后才注入**：可写文件的文档样式（`style[data-github-md]`）原先在 `useEffect`（paint 之后）注入，而 CM6 编辑器在 `useLayoutEffect`（paint 之前）就创建了 → 第一帧按「无样式布局」渲染。现在**创建编辑器之前先注入 CSS**，样式 effect 也改成 layout effect。
2. **首帧先渲染静态排版**：`cm6Loaded` 初始为 `false`，即使 CM6 bundle 已就绪，第一次也会先画一版静态 Markdown（块间距、表格、标题排版都与 Live Preview 不同）再切换。现在 bundle 在**插件加载时就预热**，且 `cm6Loaded` 用 `window.__ghMdCm6LivePreview !== undefined` 同步初始化。
3. **可写性未确认时仍画静态排版**：确认可写是一次异步读取，确认前现在渲染与编辑器**同结构的空白占位**（同样的 `gh-md-document gh-md-cm6-document` 容器与 padding），读取完成直接挂编辑器，不再出现静态→编辑器的跳变。bundle 4 秒仍未加载出来则回退静态渲染，避免一直空白。

另外补了 **ResizeObserver**：编辑器尺寸变化（面板展开、窗口缩放、首次测量为 0）时重算装饰窗口并重建，避免首次挂载只渲染前几行的降级排版。

实测（真实 GUI，逐帧采样）：打开文档后**第一帧就是 CM6 Live Preview**（`editor: true`、`staticBlocks: 0`），`probeStaticSeen: false`；预热在打开文档前已完成（`window.__ghMdCm6LivePreview` 已定义、bundle script 已加载）。

## 1.0.8（v1.0.8）：点链接不再显示「已保存」

点链接时插件会把目标复制到剪贴板（DSH 沙箱里不直接导航），反馈原本借用了保存状态条：`setSaveState('saved')` + 自定义文案。但状态条在 `saved` 分支只渲染固定的「已保存」，不读自定义文案，于是看起来"点个链接却保存了"。

- 新增独立的复制提示条 `.gh-md-copy-hint`：显示「链接已复制 + 链接地址」，2 秒后自动消失，位置在保存状态条上方；
- 点链接**不再改动保存状态**（也不会触发写盘）；保存状态条只反映真正的保存（保存中… → 已保存）；
- 实测：点链接 → 只出现「链接已复制 https://…」、状态条不存在、剪贴板拿到地址、磁盘文件未被改写；真实保存仍然显示「保存中…」→「已保存」。

## 1.0.9（v1.0.9）：点击链接改为真正的跳转

之前"点链接 = 复制链接"是早期在 DSH 沙箱里找不到导航接口时的权宜之计。现在接上了宿主的标签导航接口，链接行为向 Obsidian 看齐：

| 链接类型 | 行为 |
|---|---|
| 文档内相对链接 `[说明](notes/other.md)` | 在右侧预览面板**同面板跳转**（替换当前标签） |
| Wiki 链接 `[[笔记]]` | 同上，自动补 `.md` |
| Ctrl/Cmd + 点击 | 在面板里**新开标签**打开，不替换当前文档 |
| 外部链接 `https://…` / `mailto:` | 交给系统浏览器/新标签打开 |
| 无法解析或浏览器拦截 | 退回"复制链接"并给出提示 |

实现要点：

- 地址解析基于当前标签的 `dsh-resource://file/session/<sessionId>/<path>` 地址做标准 URL 解析，所以空格/中文、`../`、`#锚点` 都按 URL 语义处理；
- 跳转调用预览标签自身的 `tab.actions.openResource(address, { replaceTab: true })`（来自宿主注入的 `useTabInfo`），因此是"替换当前预览"，不是再叠一个标签；
- 外部链接用 `window.open` 打开并清空 `opener`；被拦截时才显示复制提示条。

实测（真实 GUI）：

- markdown 相对链接 → 面板切到目标文档，标签数保持 1；
- `[[Wiki 目标]]`（无扩展名）→ 正确解析为 `Wiki 目标.md` 并跳转；
- 目标文档里的 `[[_gui_link_nav]]` 反跳回源文档同样生效；
- 外部链接 → 浏览器打开 `https://example.com/nav-check`，且**没有**出现复制提示。

## 1.0.10（v1.0.10）：点链接打开新标签，不再覆盖当前文档

1.0.9 的跳转是"替换当前预览标签"，用下来更像"覆盖"：跳进去以后原文档就没了。现在改成：

| 操作 | 行为 |
|---|---|
| 点击文档内链接 / Wiki 链接 | 在右侧面板**新开一个标签**打开目标文档，原文档标签保留 |
| 再次点击同一个目标 | 聚焦已经打开的那个标签，不会重复开 |
| 点击外部链接 | 交给浏览器新页面打开（行为不变） |
| 目标无法解析 / 弹窗被拦截 | 退回"复制链接"并提示 |

实测（真实 GUI）：点击相对链接后标签数 1 → 2、当前标签变为目标文档、原标签仍在；点回原标签正常；再点同一个 Wiki 链接标签数保持 2（去重聚焦）。

## 1.1.0（v1.1.0）：表格加行 / 加列（对齐 Obsidian）

先用 Obsidian 1.15 实测了它的表格交互，再照着做：

| Obsidian 的行为 | 实测值 | 本插件 |
|---|---|---|
| 表格**下方**悬停出现一条通栏 `+` | 高度 16px、整表宽、`cursor: s-resize`、透明度 0→1 | ✅ 一致 |
| 表格**右侧**悬停出现一条竖 `+` | 宽度 16px、整表高、`cursor: e-resize` | ✅ 一致 |
| `+` 图标 | lucide plus，16px 描边图标 | ✅ 同风格 16px 圆角描边 `+` |
| 点击下方 `+` | 末尾追加一整行（空单元格） | ✅ 一致 |
| 点击右侧 `+` | 末尾追加一整列（表头/分隔行/所有行都补） | ✅ 一致 |
| 右键表格 | 行/列的插入、删除、对齐菜单 | ✅ 已有菜单，本次一并保证加行加列后**画面同步刷新** |

另外修了一个从早期就存在的隐患：表格是"整块 widget"，直接在它自己的范围里改文本会让 CM6 在更新中途替换高度表（表现为表格不刷新，严重时直接报 `No tile`/编辑器报错）。现在改为三步：**先让表格回到源码态 → 再改文本 → 最后恢复渲染态**，每步都是独立 transaction；撤销/重做也验证可用。

实测（真实 GUI，`gui-table-add-check.mjs`，11 项全过）：`+` 的位置与光标形状、加行后行数 +1、加列后列数 +1、右键删除列画面同步、撤销后编辑器仍可输入、全程 **0 条 CM6 运行时报错**。

## 1.1.1（v1.1.1）：渲染器显示名改为「实时预览 Markdown」

文档预览里的渲染器下拉框原来显示「GitHub 风格 Markdown」，这是插件还是 `dsh-github-md` 时的旧名字，容易和仓库/插件名对不上。现在：

- 中文界面：**Live Preview Markdown**（纯英文，与插件名一致）；
- 英文界面：**Live Preview Markdown**。

只改显示名，内部 id（`@paradeluxe/dsh-live-markdown/live-markdown`）、路由前缀、设置键都保持不变，已打开的标签和本地设置不受影响。

## 1.1.2（v1.1.2）：渲染器名统一为纯英文

按需求把下拉框显示名统一为 **Live Preview Markdown**（中英文界面都一样，不再有「GitHub 风格 Markdown」或中英混排）。内部 id、路由前缀与设置键不变。

## 1.1.3（v1.1.3）：图片放大后支持滚轮缩放

灯箱（双击图片打开的大图预览）现在支持：

| 操作 | 行为 |
|---|---|
| 滚轮上/下 | 以鼠标位置为中心缩放，范围 **0.25× – 8×** |
| 放大后按住拖动 | 平移图片（未放大时不拦截点击） |
| 双击图片 | 缩放/位置复位到 1× |
| `0` 键 | 同样复位 |
| `Esc` / 点背景 | 关闭 |

实现要点：`transform: translate(...) scale(...)`，滚轮按指针位置换算平移量，缩放时指针下的图像点保持不动；滚动事件 `preventDefault`，不会带动页面滚动；拖拽用 Pointer Events + 指针捕获，拖动超过 4px 时不会误触发"点背景关闭"。

顺手统一了图片预览入口：CM6 里点击图片现在复用客户端的灯箱（原来 bundle 里另有一个简化版 `.gh-md-cm6-image-fullscreen`），只有客户端灯箱不可用时才回退。

## 1.1.4（v1.1.4）：修宽表格看不到「加列」加号

问题：加列的 `+` 条原本贴在**表格右边缘外**（`left: 表格宽度`）。当表格占满内容宽度时，这条 16px 的竖条整个落在内容区之外被裁掉——所以「加行」的 `+` 看得到，「加列」的看不到。

修复：把列 `+` 的定位改为 `left: min(表格宽度, 内容宽度 - 18px)`，永远留在可见区域内；表格不宽时仍在右缘外侧（与 Obsidian 一致），占满宽度时则贴在表格右侧内部（悬停有浅色底 + 边框，避免和单元格内容混淆）。

回归测试补了宽表格场景（`gui-table-add-check.mjs` 现在 13 项）：表格占满宽度时列 `+` 仍在可见区、悬停可见、点击仍然新增一列。

## 1.1.5（v1.1.5）：选中整行/整列，Backspace 删除

按「选中整行或整列再按 Backspace」的思路做成了 Obsidian 同款手势：

| 操作 | 行为 |
|---|---|
| 悬停表格 | 每行左侧出现竖排 grip 手柄、每列上方出现横排 grip 手柄 |
| 点击手柄 | 选中整行 / 整列（单元格浅蓝高亮，手柄高亮） |
| `Backspace` / `Delete` | 删除选中的整行 / 整列 |
| `Esc` | 仅取消选择，不删除 |
| 点表格其它位置 | 取消选择 |

选择用 `tr`/`th` 的实际几何位置计算手柄坐标（表格滚动、窗口尺寸变化时自动重排）。删除仍走统一的三段式编辑通道（源码态 → 改文本 → 渲染态），因此画面即时刷新且不会触发 CM6 高度表错误；只剩 1 列时会拒绝删除，避免产生非法表格。

原来的右键菜单（删除本行 / 删除本列等）保留，作为另一种入口。

## 1.1.6（v1.1.6）：表格多选 + Ctrl+C 复制

行/列选择从"一次一行"升级为"连续多行/多列"，并且可以复制：

| 操作 | 行为 |
|---|---|
| 点手柄 | 选中一行/一列（原有行为） |
| **Shift + 点手柄** | 从上一行/列扩展到当前行/列，整段高亮 |
| `Backspace` / `Delete` | 删除选中的整段行/列（删除后至少保留 1 行/1 列） |
| **`Ctrl+C` / `Cmd+C`** | 把选中的行/列复制为 **TSV**（`\t` 分隔、`\n` 换行），可直接粘进 Excel / Numbers / 飞书表格 |
| `Esc` | 取消选择 |

复制用 `navigator.clipboard.writeText`，不可用时回退到 `document.execCommand("copy")`；行选区按整行复制，列选区按"每行取该列"复制成单列 TSV。

未实现：手柄拖拽排序（Obsidian 有，我们只做单击/Shift 单击选择）。

## 1.1.7（v1.1.7）：拖拽排序 + Markdown 复制

补上了之前欠的两件事：

**1. 手柄拖拽排序**

- 按住行左侧 / 列上方的 grip 手柄拖动，会出现一条 2px 落点线；松手后行/列移动到目标位置，文档同步改写；
- 行的落点限制在表头之下（表头不会被拖走）；列的落点可以到最左；
- 拖动超过 4px 才算拖拽，否则仍按"单击选择"处理（不会误触发排序）；
- 排序同样走"源码态 → 改文本 → 渲染态"通道，画面即时刷新。

**2. `Ctrl+Shift+C` 复制为 Markdown**

- 选中行/列后，`Ctrl+C` 复制 **TSV**（进 Excel），`Ctrl+Shift+C` 复制 **Markdown**（`| 甲 | 1 | 第一行 |`，直接粘回笔记）；
- 列选区复制成单列 Markdown 行。

## 1.1.8（v1.1.8）：表格支持跨格拖拽选择

之前每个单元格是独立的可编辑区域，浏览器原生选区无法跨过单元格，所以"拖过一整行再删除"用不了；`+`/手柄那套入口也容易被忽略。现在补上了类似表格软件的区域选择：

| 操作 | 行为 |
|---|---|
| 在单元格内按下并拖到**其它**单元格 | 选中矩形区域（浅蓝高亮），松手后保持选区 |
| 在**同一个**单元格内拖动 | 仍然是原生文本选择（编辑文本不受影响） |
| 拖满一整行的所有列 → `Backspace` / `Delete` | **删除这几行** |
| 拖满一整列的所有行 → `Backspace` / `Delete` | **删除这几列** |
| 局部矩形（如 2×2）→ `Backspace` / `Delete` | **清空这些单元格的内容**，表格结构不变 |
| `Ctrl+C` / `Ctrl+Shift+C` | 复制选区：TSV / Markdown |
| `Esc` / 单击单元格 | 取消选区（单击仍然进入单元格编辑） |

说明：整行/整列的判定基于"选区是否覆盖所有列 / 所有行"，所以 2 列表格里一次拖满两列再按 Backspace 会被当成"删除整行"，这是有意的（对应你说的"选中整行再删除"）。想清空内容而不是删行时，请用不覆盖全宽的矩形选区。

## 1.1.9（v1.1.9）：修复"选中表格后按 Backspace 没反应"

复现思路：桌面版里，表格选择后焦点可能被 CM6 抢回 `cm-content`，而原来的 Backspace/Delete 监听挂在表格根节点（wrapper）上——按键落在 `cm-content` 时根本不会经过 wrapper，所以高亮还在、按 Backspace 却没有任何反应。真实鼠标拖拽 + 手工把焦点切到 `cm-content` 后按 Backspace 的用例已经复现并修好。

修复内容：

1. 选区激活时把 `Backspace` / `Delete` / `Ctrl+C` / `Esc` 监听提升到 **window 捕获阶段**，焦点在哪里都能删；
2. 只有在**点击表格之外**时才取消选区（原来点到别处也保留选区，容易误触），因此不会误伤聊天输入框等其它输入区域；
3. 参差表格（各行单元格数不一致）按"该行自己的列数"判断整行选中，斜着少一格也能删行；
4. 静态资源 URL 追加 `?v=1.1.9` 构建版本号，避免桌面版/浏览器缓存住旧的 `cm6-live-preview.js`；
5. 表格右侧预留 **18px gutter**：加列 `+` 条落在 gutter 里，不再压住最后一列（窄表格仍贴着表格右缘，宽表格也不会覆盖内容）。

验证：新增 `gui-table-delete-focus-check.mjs`（真实鼠标拖拽 → 把焦点切到 `cm-content` → Backspace），5 项全过；另跑了普通/对齐/空单元格/缩进/参差五种表格的删除矩阵。
