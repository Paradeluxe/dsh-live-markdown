# Obsidian Live Preview 复刻规格（SPEC）

> 目标：把 DSH 的 Markdown 预览插件从「点块→整块源码编辑器」升级为真正接近 Obsidian Live Preview 的实时预览编辑。
> 研究日期：2026-11-13。研究材料：
> - `E:\hermes_playground\.dsh-scratch\research\obsidian-live-preview.md`（行为规格，514 行，含来源编号）
> - `E:\hermes_playground\.dsh-scratch\research\obsidian-editing-interactions.md`（编辑交互，757 行）
> - `E:\hermes_playground\.dsh-scratch\research\obsidian-implementation.md`（实现架构，582 行）
>
> 说明：研究时 `web_search` 后端不可用，研究改用 `web_fetch` 直连官方文档源（obsidianmd/obsidian-help 仓库 raw Markdown、obsidian.md/changelog 渲染页、官方论坛 Discourse API）。官方文档页（help.obsidian.md）现 301 到 obsidian.md 且为 JS 渲染，正文以官方仓库 Markdown 源为准。

---

## 0. 结论先行

1. Obsidian Live Preview 的本质是**同一个文本 buffer + 两套 presentation**：非活跃块渲染成 HTML/组件，活跃块显示源码（标记淡化、内容样式保留）。不是「点块换编辑器」。
2. 活跃态由**用户意图**触发（移动光标/输入/点选），打开笔记时**不得**露出语法（1.15.1 官方修复项）。
3. 隐藏的 Markdown 标记仍是**真实字符**：选区、复制、撤销都按源码语义，左右键要跳过隐藏标记，上下键按视觉列映射。
4. **Enter = 单换行（同段落软换行）**；**Shift+Enter = 硬换行（`  \n`）**；空行才分段。我们此前的实现（Enter 分段、Shift+Enter 单换行）与官方语义相反，本 SPEC 已纠正。
5. 表格在 LP 里**永远是渲染态**（光标直接进单元格编辑，右键菜单增删行列/排序/对齐），不会塌回 `|` 源码。
6. 代码块在 LP 里**不用 Prism 高亮**（官方明确），显示语言 badge + copy 按钮（光标不在块内时）。
7. 渲染态链接**单击即跳转**（不是进入编辑），`Ctrl/Cmd+hover` 才是页面预览。
8. 任务复选框在 LP 里**点击即切换**，不进入编辑态。
9. 要真正做到 90%+ 观感，**需要 CodeMirror 6**：CM5 的 `markText({replacedWith})` 只能放 inline 元素，没有块级 widget，表格/块级图片/嵌入做不出来。CM6 路线是 Obsidian 官方同款架构。

---

## 1. 模式模型

| 概念 | 官方定义 | 复刻含义 |
|---|---|---|
| Reading view | 无语法、只读 | 当前插件的「阅读态」（已有） |
| Editing view | 可编辑视图 | 需要支持 |
| Live Preview | 编辑视图的默认模式：就地渲染、光标进入显示语法 | 目标状态 |
| Source mode | 全部语法原样 | 可选（不优先） |

- 默认：新标签进 editing view，editing view 默认 LP。
- `Ctrl+E` 只切 Reading/Editing；LP↔Source 是另一个命令。
- 复刻优先级：**LP 为主，不单独做 Source mode 面板**（与用户「只要一个模式」的要求一致）。

---

## 2. 活跃块模型（核心）

```
activeBlocks = { block | block.sourceRange ∩ selection ≠ ∅ }
```

- 块类型：段落、标题、列表项、引用行、围栏代码块、表格、数学块、图片、嵌入、HTML 块、frontmatter、callout。
- 行内块（段落/标题/列表项/引用行）：光标进入时**整块**展开内联标记（不是只展开光标所在 span）。
- 容器块（代码块/表格/数学块/callout）：进入容器才展开结构标记；容器内普通行仍渲染。
- 块外部分：标记零宽隐藏 + 完整渲染。
- 打开笔记：activeBlocks = ∅，直到真实 pointer/key 事件。
- 失活：光标移出块后，该块在下一帧回到渲染态。

### 2.1 当前行（活跃块内）的样式

- 标记显示（淡化色，`--text-faint` 级别，约 40–55% 不透明度，继承字号与字重，不用代码字体、不加底色）。
- 内容**保留格式**：`**粗体**` 显示星号时文字仍是粗体；标题显示 `#` 时仍是标题字号；行内代码显示反引号时仍是等宽+底色。
- 参考实现：标记与内容是独立 token（`cm-formatting-*` 与内容样式类分离）。

---

## 3. 逐语法行为矩阵（简表）

| 语法 | 非活跃 | 活跃（光标在该块） |
|---|---|---|
| 粗体/斜体/删除线/高亮 | 标记隐藏，样式渲染 | 标记显示（淡化），样式保留 |
| 行内代码 | 反引号隐藏，等宽+底色 | 反引号显示，仍等宽 |
| 链接 `[t](u)` | 只显示 `t`，**单击跳转** | 完整源码 |
| 标题 `# H` | `#` 隐藏，按 h1–h6 渲染 | `#` 显示，仍标题字号 |
| 列表 `-` / `1.` | 渲染 bullet/序号 | 标记显示，缩进/编号仍生效 |
| 任务 `- [ ]` | 渲染可点击 checkbox（点击即切换） | 显示 `- [ ]` 原文 |
| 引用 `> x` | `>` 隐藏，左侧竖线+灰字 | `>` 显示，仍引用样式 |
| 围栏代码块 | 代码块外观 + 语言 badge + copy；无 Prism | 显示围栏行与语言串，正文可编辑等宽 |
| 表格 | 真表格；右键菜单增删行列/排序/对齐 | **仍是表格**，光标进单元格编辑 |
| 行内数学 `$x$` | 渲染公式 | 显示 `$...$` 源码 |
| 块数学 `$$...$$` | 渲染居中公式块 | 显示 `$$` 与 LaTeX 源码 |
| 图片 | 渲染图片（可全屏/缩放） | 显示 `![...]` 源码 |
| 嵌入 | 渲染被嵌入内容 | 显示 `![[...]]` 源码 |
| Callout | callout 盒子（图标/颜色/标题/正文） | 显示 `> [!type]` 与 `>` 前缀 |
| 脚注引用 `[^1]` | 上标（推断） | 源码 |
| 行内脚注 `^[x]` | **LP 不渲染**（按字面文本） | 字面文本 |
| 注释 `%%x%%` | 隐藏 | 显示 |
| 分隔线 `---` | 水平线 | 显示 `---` |

---

## 4. Enter / Shift+Enter（本 SPEC 纠正的重点）

| 输入 | 源码变化 | 渲染结果 |
|---|---|---|
| `Enter`（段落中） | 插入 `\n`（同一 block 内换行） | 同一段落内软换行（视觉折行） |
| `Enter` 两次 | 形成空行 → 新段落 | 新 `<p>` |
| `Shift+Enter` | 插入硬换行（`  \n` 或 `\\\n`） | 段内 `<br>` |
| `Enter`（列表项末尾） | 新 `- ` 项（继承缩进/checkbox） | 新列表项 |
| `Enter`（空列表项） | 退出列表 | 段落 |
| `Enter`（代码块内） | 纯 `\n` | 代码块多一行 |
| `Enter`（表格内） | 官方未描述（uncertain） | 需实测定 |

- 列表内 `Shift+Enter` 不改变有序列表编号。
- Strict line breaks 设置：关闭时单 Enter 是软换行；开启时按 CommonMark（单 Enter 合并、双空格 `<br>`、空行分段）。
- 编辑后光标离开的块要立即回到渲染态，且只重算受影响块（不重排整篇）。

---

## 5. 编辑交互清单（来自 editing-interactions 研究）

| 动作 | 触发 | 行为 |
|---|---|---|
| 列表缩进 | `Tab` / `Shift+Tab` | 缩进/反缩进（单位 tab 或 4 空格，设置可切）；Smart lists 限深 1 级；多行缩进不搬子项 |
| 删除整行 | `Ctrl+Shift+K`（无选区） | 删当前行（**不是**插入代码块） |
| 复制整段 | `Ctrl+C`（无选区） | 复制当前段落 |
| 撤销/重做 | `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` | macOS 重做只有 Cmd+Shift+Z |
| 纯文本粘贴 | `Ctrl+Shift+V` | 不把 HTML 转 Markdown |
| 粘贴图片 | `Ctrl+V` | 落盘附件目录 + 插入 embed（本插件受限于 Host，暂不做） |
| 查找/替换 | `Ctrl+F` / `Ctrl+H` | Find all 选中全部匹配 |
| 链接补全 | `[[` | 选区文本成为链接文本；`[[#`/`[[##`/`[[^^` 补标题/块 |
| 任务勾选 | 阅读/渲染态点击 checkbox | 任意非空字符算完成（`[?]`、`[-]`） |
| 表格 | LP 右键表格 | 增删行列、排序、移动、对齐 |

- 快捷键表：官方 help 未列 `Ctrl+K`、`Ctrl+1..6`、`Ctrl+Shift+7/8/9`、`Ctrl+Enter` 默认值（属命令级，需在设置里查）；`Ctrl+Shift+K` 官方明确是删除行。

---

## 6. 表格（LP 行为）

- 渲染态：真表格（表头/斑马纹/对齐）。
- 光标进入：仍在表格里编辑单元格，分隔行不可见。
- 右键菜单：增删行列、排序、移动行列、对齐。
- `Tab`：下一单元格；最后一格 Tab 追加新行（uncertain，社区通行）。
- `Shift+Tab`：上一单元格（uncertain）。
- `Enter`：官方未描述（uncertain）。
- 单元格内支持行内 Markdown；`|` 需转义。
- 表格里 block id 不支持。

## 7. 代码块（LP 行为）

- 语言 badge：LP 编辑窗口右上显示；Reading view 没有。
- copy 按钮：Reading view 有；LP 光标不在块内时出现（hover）。
- 高亮：LP/Source 不用 PrismJS，与 Reading view 可能不同；mermaid 在 LP 里渲染成图。
- 光标进入：显示围栏行与语言串，正文按行编辑，整体仍是等宽块。

## 8. 链接（LP 行为）

- 渲染态：显示 display text；**单击跳转**（同面板），`Ctrl/Cmd+click` 新面板，`Ctrl/Cmd+hover` 页面预览。
- 源码态（光标在该块）：完整源码，点击定位光标。
- 我们当前环境无法真正打开文件/新面板，计划：单击渲染态链接时复制/显示目标（或调用 Host 能力），至少不进入编辑态。

## 9. 图片/嵌入/Callout/数学/脚注

- 图片：LP 渲染图片，可点开全屏、可缩放；活跃时显示源码。
- 嵌入：渲染被嵌入内容；活跃时显示 `![[...]]`。
- Callout：渲染盒子；右键标题改类型；活跃时显示 `> [!type]`。
- 数学：MathJax（1.14.1+ 4.1.3）；块数学每行一个 `.HyperMD-math`。
- 行内脚注 `^[x]`：LP 不支持，按字面文本。
- 注释 `%%x%%`：编辑视图可见，Reading 隐藏。
- frontmatter：LP 里按 Properties in document 设置（Visible/Hidden/Source）。

## 10. 与 Reading view 的已知差异（验收时允许不同）

1. PrismJS 高亮差异；
2. 行内脚注只在 Reading view 工作；
3. 评论只在编辑视图可见；
4. Markdown 不在 HTML 元素内渲染；
5. HTML 块必须自包含；
6. 块引用不支持链接到具体部分；
7. 列表内 callout 支持不完整；
8. 表格内脚注引用不上标。

---

## 11. 当前实现 vs SPEC（差距表）

| 能力 | SPEC 要求 | 当前状态（0.34.0） | 差距 |
|---|---|---|---|
| 非活跃块渲染 | 完整 HTML/组件 | ✅ 有（渲染态） | 无 |
| 活跃块源码 + 样式保留 | 标记淡化、内容样式保留 | ✅ 本轮已做（当前行） | 非当前行仍隐藏标记（多行块与 Obsidian 略不同） |
| 打开笔记不露语法 | 初始不激活 | ✅ 有（点击才编辑） | 无 |
| Enter/Shift+Enter | Enter 单换行、Shift+Enter 硬换行 | ✅ 本轮已改 | 需真实窗口确认 |
| 表格始终渲染 | 真表格 + 单元格编辑 + 右键菜单 | ⚠️ 有渲染 + 单元格内联输入 | 无右键菜单、无行列操作、表格块边框点击仍会打开源码 |
| 代码块 badge/copy | LP 显示 badge、光标不在块内显示 copy | ⚠️ 渲染态有 badge/copy；编辑态无 copy | 编辑态 copy 未做 |
| 链接单击跳转 | 渲染态单击跳转 | ❌ 点击进入编辑 | Host 能力受限，待设计 |
| 复选框点击切换 | 渲染态点击切换 | ✅ 有 | 无 |
| 隐藏标记的选区/复制语义 | 复制带标记、左右键跳过 | ❌ 渲染态复制是纯文本；编辑态复制带标记 | 架构性差距（HTML 渲染 vs 单 buffer） |
| 方向键跨块 | 无缝 | ✅ 有（块边界切块） | 视觉列映射未做 |
| 图片全屏/缩放 | LP 支持 | ⚠️ 渲染态图片可看；无全屏/缩放 | 待做 |
| 数学 | 渲染 + 源码切换 | ⚠️ 渲染态有 KaTeX；编辑态显示源码 | 基本够用 |
| Callout | 盒子 + 右键改类型 | ⚠️ 渲染态有 callout 样式？ | 待核对 |
| 嵌入 | 渲染嵌入 | ❌ 无 | 依赖 Host 资源解析，暂不做 |
| 属性 frontmatter | 渲染/源码切换 | ⚠️ frontmatter 静态渲染 | 未编辑 |
| 撤销后光标 | 恢复光标 | ⚠️ 只闪烁定位 | 待做 |
| 逐行装饰性能 | 只重算受影响块 | ⚠️ 每次整块重算 | 块小，暂可接受 |

---

## 12. 架构决策（来自 implementation 研究）

- **路线 A（继续 CM5）**：观感上限约 55–65%，因为 CM5 `markText({replacedWith})` 只允许 inline 元素，没有块级 widget → 表格/块级图片/嵌入/代码折叠做不出来。
- **路线 B（CM6 + 自研 LP 扩展）**：Obsidian 官方同款（官方文档：Obsidian uses CodeMirror 6 to power the Markdown editor）。可达 90%+。成本：CM6 基线 567 KB min / 195 KB gzip；需要 esbuild/rollup 打成单文件 `client.js`（DSH 插件产物就是单文件 IIFE，官方 sidebar 插件已内联 pdfjs/exceljs 等大库，可行）。
- **推荐**：短期继续 CM5 修补（本 SPEC 第 11 节），中期迁移到 CM6 路线 B（整篇 `EditorView` + markdown 语言包 + 自研 Live Preview 装饰：隐藏标记、行内 widget、表格/代码块 widget、activeBlock 计算、atomicRanges、IME 冻结）。

### 12.1 CM6 迁移的关键点

1. 单实例、单 `@codemirror/state`（避免双实例破坏 state field identity）。
2. 用 `syntaxTree` 找 markdown 标记区间，用 `Decoration.mark` 隐藏/淡化，用 `Decoration.replace({widget})` 替换图片/表格/代码块。
3. `atomicRanges` 让左右键跳过隐藏标记；上下键按视觉列映射。
4. IME：`view.composing` 期间冻结装饰重算。
5. 保存：`change` → 300ms debounce 回写（Obsidian 是自动保存；我们仍保留提交时保存以免官方预览重载，但可改为 debounce 保存 + 忽略自己写入导致的 reload）。
6. 体积：按需加载（打开文档时创建 EditorView）。

### 12.2 分阶段计划

- **P0（本轮已完成/进行中）**：当前行样式保留 + Enter/Shift+Enter 语义 + 编辑器外观去盒子。
- **P1**：CM5 下补：表格右键菜单（增删行列/对齐）、代码块编辑态 copy、链接点击行为（复制目标/不进入编辑）、图片全屏。
- **P2**：CM6 原型：esbuild 打包 CM6 + markdown，替换 BlockEditor 为整篇 EditorView；实现 activeBlock + 标记隐藏/淡化 + 行内样式。
- **P3**：CM6 表格/代码块/图片 widget，撤销/IME/选区语义对齐。
- **P4**：按 SPEC 第 10 节差异清单验收。

---

## 13. 验收用例（本轮已跑）

- Enter 单换行：段中 Enter → 源码 `With t\nhe exact`；Shift+Enter → `  \n`；保存内容 `With t\nNEWPARA  \nhe exact`（harness-e2e）。
- 当前行样式：当前行 0 个隐藏 mark、3 个淡化语法 mark、`**bold**` 内容仍加粗；非当前行隐藏 6 个标记（harness-livepreview）。
- 输入法组合期：line2 hidden marks 2→2→0（组合期不重算）。
- 其余回归：实时分段（已改为单换行）、合并、空列表项退出、多行缩进、表格内联编辑、任务框、代码着色、撤销闪烁，全部通过（run-all-checks）。

> 后续验收需在真实 Obsidian 实例上逐条截图确认 SPEC 中标注 uncertain 的项（表格 Tab/Enter、标记淡化色值、callout 正文行为、嵌入块外壳等）。

---

## 14. CM6 原型验证（2026-11-13）

### 14.1 构建

- 工具链：esbuild 0.28.2 + @codemirror/state@6、@codemirror/view@6、@codemirror/language@6、@codemirror/commands@6、@codemirror/lang-markdown@6（安装在 `.dsh-scratch/cm6build`，npm registry 可用）。
- 产物：`vendor/cm6-live-preview.js`（IIFE，`--global-name=__ghMdCm6LivePreview`，minify 后 502 KB）。
- Host 的 `/github-md/vendor/*` 路由可以直接发这个文件，客户端用 `loadScriptOnce` 懒加载即可。

### 14.2 原型实现

`createLivePreview({ parent, doc, onChange })`：
- 整篇文档一个 `EditorView`，扩展：`history` + `drawSelection` + `defaultKeymap/historyKeymap` + `markdown()` + `syntaxHighlighting(defaultHighlightStyle)` + `livePreviewPlugin`。
- `livePreviewPlugin`（ViewPlugin + Decoration）：
  - 计算选区覆盖的行 = active lines；
  - 非活跃行：`Decoration.replace({})` 隐藏 `#` / `**` / `*` / `~~` / 反引号 / 链接括号与 URL；
  - 活跃行：`Decoration.mark({class:'gh-md-lp-syntax'})` 淡化标记；
  - 内容一律 `Decoration.mark` 上 `gh-md-lp-strong/em/strike/code/link` 样式；
  - 标题行 `Decoration.line({class:'gh-md-lp-hN'})`，活跃/非活跃都保留字号；
  - 围栏代码块：非活跃隐藏围栏行、活跃淡化。
- 样式通过注入 `<style id="gh-md-cm6-lp-style">` 提供，字体/字号/行高沿用插件文档样式变量。

### 14.3 jsdom 验证结果

`harness-cm6-prototype.mjs`（v0.36 扩展了 widget）：

| 断言 | 结果 |
|---|---|
| bundle 加载、createLivePreview 可用 | ✅ |
| doc 值 round-trip | ✅ |
| 初始光标第 1 行：`# Head` 显示（活跃行标记可见） | ✅ |
| 非活跃行隐藏标记、内容保留样式 | ✅ strong/em/code 类都在 |
| 光标移动后活跃行标记显示、其它行隐藏 | ✅ |
| 代码块 widget：非活跃整块替换成代码卡（语言 badge + 复制按钮） | ✅ `.gh-md-cm6-code`、语言 `js` |
| 表格 widget：非活跃整块替换成 HTML 表格 | ✅ `.gh-md-cm6-table table`、单元格 `a1` |
| 图片 widget：非活跃行渲染 `<img>`，src 由 resolver 解析 | ✅ src = `http://127.0.0.1/pic.png` |
| 任务复选框 widget：点击切换源码 `[ ]` → `[x]` | ✅ |
| 链接 mark 带 `data-href` | ✅ |
| 光标进入代码块：widget 消失、围栏行显示 | ✅ |
| 光标进入图片行：widget 消失、源码显示 | ✅ |
| 输入触发 onChange | ✅ |

实现注意：块级 widget 必须由 **StateField** 提供（CM6 禁止 ViewPlugin 提供 block decoration），本轮已从 ViewPlugin 改成 StateField + `EditorView.decorations.from(field)`。

jsdom 报 `getClientRects is not a function`：CM6 的测量 API 在 jsdom 里缺失，属测试环境限制，真实浏览器不受影响。
### 14.4 接入状态（v0.37.0 已完成 P2 第一版）

- MarkdownBody 在「可写文件 + CM6 包加载成功」时直接渲染 EditorView（`.gh-md-cm6-document`），旧渲染管线保留为 fallback（只读文件 / 加载失败 / `window.__ghMdCm6Disable = true`）。
- 创建时传入 `doc`（精确原文，LF 归一化）、`onChange`（写 docTextRef + 200ms debounce 保存）、`resolveImage`（按文档目录解析）。
- 外部内容变化（流式 / 官方预览重载）通过比较 EditorView 当前文本与 `docText` 同步，内容相同不重置。
- 渲染态链接点击走 `window.__ghMdOpenLink`：复制到剪贴板并用保存提示条显示（DSH 沙箱里不直接导航）。
- 任务框点击由 bundle 内的 domEventHandlers 直接改源码。
- 验证：`harness-cm6-integration.mjs` —— CM6 host/editor 挂载、doc 正确、代码块/表格/任务框 widget 渲染、输入后 debounce 保存（保存内容以输入字符开头）。

### 14.5 待办

- 表格「光标在表格内仍渲染成表格 + 单元格编辑」需要 widget 内编辑（P3）。
- frontmatter / 数学 / 嵌入 / callout 的 widget 化。
- 图片全屏、链接 Ctrl+Click 新面板（受 DSH 沙箱限制，待设计）。
- 撤销/重做与选区语义按 SPEC 第 4/7 节对齐。

## 15. v0.38.0：数学公式、输入法、图片全屏

### 15.1 数学
- `$...$`：非活跃行用 `MathWidget`（inline，`<span class="gh-md-cm6-math">`）替换；活跃行显示源码。
- `$$...$$`：非活跃整块替换成 `MathWidget`（block，`<div class="gh-md-cm6-math gh-md-cm6-math-block">`）；活跃时 `$$` 行淡化、公式源码保留。
- HTML 由客户端传入的 `renderMath(tex, display)` 生成（KaTeX `renderToString`，`throwOnError:false`）；vendor 未加载时先显示源码，KaTeX 就绪后由 vendor 刷新 effect 强制重建装饰。

### 15.2 输入法（IME）
- `compositionstart` 置 `composing = true`，StateField 在组合期只做 `decorations.map(changes)`，不重建装饰（避免打断候选词）。
- `compositionend` 置回 false 并 dispatch 一个 `rebuildEffect`，强制重建装饰。

### 15.3 图片全屏
- 点击渲染态图片弹出 `.gh-md-cm6-image-fullscreen` 遮罩（fixed、点击任意处关闭）。

### 15.4 验证
- `harness-cm6-integration.mjs`：代码块 widget 1、表格 widget 1、任务框 1、行内数学 1、块级数学 1、输入后 debounce 保存；
- `run-all-checks`：ALL CHECKS PASS。

## 16. v0.39.0：frontmatter / callout / 高亮 / 双链 / 注释

| 语法 | 非活跃 | 活跃（光标在该块/行） |
|---|---|---|
| frontmatter `---`…`---` | 属性卡片 widget（key/value） | 源码 |
| callout `> [!type] 标题` | 带图标/颜色/标题/正文的提示框 widget | 源码行 |
| `==高亮==` | 标记隐藏、黄色高亮 | 标记淡化、仍高亮 |
| `%%注释%%` | 整段隐藏（零宽） | 淡化显示源码 |
| `[[目标\|别名]]` | 别名作为链接（`data-href=目标`），括号隐藏 | 淡化显示源码 |

实现：frontmatter 在文档第 1 行 `---` 时识别；callout 按连续 `>` 行成块；`==`/`%%`/`[[` 走 INLINE_PATTERN 分支。

验证（`harness-cm6-integration.mjs`）：frontmatter widget 1、callout widget 1、highlight mark 1、注释隐藏、双链 `data-href` 存在，数学/代码块/表格/任务框/保存全部通过。

## 17. v0.40.0：表格原地编辑（Obsidian LP 行为）

- 表格在 LP 里**始终渲染成表格**，即使光标/点击在表格内也不回退成源码行。
- `TableWidget` 的单元格是 `contenteditable=plaintext-only`：
  - `input` 事件 → 按当前文档重新解析该单元格范围，dispatch 替换源码文本；
  - `Tab` / `Shift+Tab`：前后单元格；
  - `Enter`：非最后一行 → 跳到下一行同列；最后一行 → 追加新行（`|  |  |`）；
  - `Esc`：光标移到表格之后。
- 编辑后 widget 复用（`eq()` 返回 true），`updateDOM` 用 `view.state.doc` 重新解析表格并更新未聚焦单元格，避免焦点丢失。
- 验证（`harness-cm6-integration.mjs`）：把单元格文本改成 `edited` 并派发 input 事件 → 文档包含 `edited`、debounce 保存内容包含 `edited`。

## 18. v0.41.0：嵌入 ![[...]]

- 行内 `![[目标]]` / `![[目标|尺寸]]`：非活跃行替换成 `EmbedWidget`；活跃行显示源码。
- 客户端注入 `resolveEmbed(target, container)`：
  - 相对当前文档目录解析目标，无扩展名补 `.md`；
  - 通过 Host `workspace/read` 读取内容（工作区限制沿用现有校验）；
  - 用 `createMarkdownRenderer` 渲染成 HTML 注入容器（frontmatter 先剥离）；
  - vendor（marked/KaTeX 等）未就绪时每 300ms 重试，最多 10 次；
  - 容器已脱离 DOM 时放弃注入。
- 验证（`harness-cm6-integration.mjs`）：`![[Note B]]` 渲染出 `.gh-md-cm6-embed` 且内容包含被嵌入文档的 `Head`。

### 18.1 调试记录
- 第一次实现时 rebuild 分支漏传 `host`，导致重建后的 widget 拿不到 `resolveEmbed`；已修复（所有 `buildDecorations` 调用统一带 `host`）。
- 初始 widget 在 vendor 未就绪时调用 `resolveEmbed` 会直接返回，后续 DOM 复用不会重试；因此把重试放进客户端回调。

## 19. v0.42.0：图片嵌入与表格右键菜单

### 19.1 图片嵌入
- `![[pic.png]]`（png/jpg/jpeg/gif/svg/webp/avif/bmp）：非活跃行按扩展名分流成 `ImageWidget`（走 `resolveImage` 解析路径），点击可全屏；其它扩展名仍走 `EmbedWidget`（笔记渲染）。

### 19.2 表格右键菜单
- 右键表格单元格弹出菜单：在上方插入行、在下方插入行、删除本行、在左侧插入列、在右侧插入列、删除本列、左对齐、居中对齐、右对齐。
- 实现：按当前文档解析表格块（行/单元格/分隔行），菜单动作修改行数组后重建整张表并 dispatch 替换；菜单是 fixed 定位的 DOM，点击外部或 Esc 关闭。
- 验证（`harness-cm6-integration.mjs`）：`.gh-md-lp-image img` 1、右键出现 `.gh-md-cm6-table-menu`、点击第一项后文档包含新增空行 `|  |  |`。

## 20. v0.43.0：真实浏览器验证与两处观感修复

### 20.1 验证方式
- 环境：headless Edge（`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`）+ playwright-core 1.56（取自 REA_typora/playwright 依赖）。
- 页面：空白 HTML 注入 `vendor/cm6-live-preview.js`，`createLivePreview` 创建编辑器，`resolveImage`/`renderMath`/`resolveEmbed` 用确定性 stub。
- 断言 20 项：editor 挂载、代码块 widget、表格 widget、单元格 `contenteditable=plaintext-only`、任务框、callout、高亮、行内/块级数学、嵌入渲染、非活跃段落标记隐藏、标题 `#` 隐藏、空闲时 0 个 syntax 装饰、表格列对齐、标题无下划线、表格单元格真实键入、段落真实键入、onChange、无 console 错误。

### 20.2 真实浏览器发现并修复的问题
- **标题下划线**：`@codemirror/language` 的 `defaultHighlightStyle` 给 Markdown 标题 token 加了 `text-decoration: underline`，与我们的行样式冲突。真实浏览器里标题出现下划线；修复：移除 `syntaxHighlighting(defaultHighlightStyle)`（我们自己负责内容样式；Obsidian LP 代码块也不用 Prism 高亮）。
- **表格表头居中**：浏览器默认 `th` 居中，Obsidian 默认左对齐。修复：`th/td { text-align: left }`，并解析分隔行 `:---:`/`---:`/`---` 应用 per-column 对齐（同时表格右键菜单的对齐动作现在会立即反映到渲染）。

### 20.3 证据
- `.dsh-scratch/cm6-real-browser-rendered.png`：非活跃态渲染（frontmatter 属性卡、标题、行内样式、嵌入、callout、代码卡、表格、数学占位、任务框）。
- `.dsh-scratch/cm6-real-browser-active.png`：光标在段落内时的激活态（标记显示）与表格单元格输入结果。

## 21. v0.44.0：编辑命令与表格单元格行内 Markdown

### 21.1 编辑命令（对齐 Obsidian）
- `Enter`：`insertNewlineContinueMarkup`（@codemirror/lang-markdown）——列表自动续写下一项、任务项续写 `- [ ] `、引用续写 `> `；空列表项回车退出列表。
- `Shift+Enter`：插入 `  \n` 硬换行。
- `Tab`：插入两个空格缩进；`Shift+Tab`：删除行尾最多两个空格。
- `Backspace`：`deleteMarkupBackward`——删除列表/引用标记（空项退回段落）。
- 这些命令放在 keymap 最前面，优先于 defaultKeymap。

### 21.2 表格单元格行内 Markdown
- 非聚焦单元格：用客户端注入的 `renderInline(text)`（`marked.parseInline` + `DOMPurify.sanitize`）渲染行内 Markdown；
- 聚焦单元格：切换成源码文本（`contenteditable=plaintext-only`），输入直接改源码；
- 失焦：重新渲染行内 Markdown；vendor 未就绪时 300ms 重试最多 10 次（与嵌入一致）。

### 21.3 验证
- jsdom：`table cell inline markdown: true`（`<strong>a1</strong>` / raw `**a1**`）；
- 真实浏览器（headless Edge）25 项新增：列表 Enter 续写、新项带内容、Tab 缩进、Shift+Enter 硬换行、表格单元格行内 Markdown；全部 OK。

## 22. v0.45.0：引用块与分隔线

### 22.1 行为
- 引用块 `> 文本`：非活跃行隐藏 `>` 前缀（含后续空格），行加 `.gh-md-lp-quote`（3px 左边线 + 次要色）；活跃行淡化 `>` 标记。
- 分隔线 `---` / `***` / `___`：非活跃整行替换成 `HrWidget`（`<hr class="gh-md-cm6-hr">`）；活跃行淡化显示源码。
- frontmatter 活跃时只淡化两端的 `---`，不再被误判成水平线（修了真实 bug：光标在 frontmatter 时，开头/结尾的 `---` 会被渲染成两条水平线）。

### 22.2 验证
- jsdom：`quote lines: 2`、`quote markers hidden: true`、`hr widget: 1`；frontmatter widget 1；
- 真实浏览器（headless Edge）扩到 28 项：引用行 `border-left` 3px、`>` 隐藏、`hr.gh-md-cm6-hr` 1 个；全部 OK；
- 截图：`.dsh-scratch/cm6-real-browser-rendered.png`。

## 23. v0.46.0：编辑快捷键、脚注引用、引用定义隐藏

### 23.1 快捷键
- `Ctrl/Cmd+B`：选中文本包成 `**…**`；无选区时插入 `****` 并把光标放中间。
- `Ctrl/Cmd+I`：同上，包成 `*…*`。
- `Ctrl+Shift+K`：删除当前行（与 Obsidian 一致，不是插入代码块）。

### 23.2 脚注与引用定义
- `[^1]` 脚注引用：非活跃行渲染成上标 widget（`sup.gh-md-cm6-fnref`）；活跃行显示源码。
- `[id]: url` 链接引用定义行：非活跃行隐藏文本；活跃行淡化显示。

### 23.3 验证
- jsdom：`footnote ref widget: 1`、`reference definition hidden: true`；
- 真实浏览器：新增 `Ctrl+B wraps selection`（`**Some**`）、`Ctrl+Shift+K deletes line`、脚注上标、引用定义隐藏；全部 OK。

## 24. v0.47.0：有序列表重新编号、callout 行内 Markdown、Ctrl+Click

### 24.1 有序列表
- 连续有序列表块内按源码起始数字递增：`1. first` / `1. second` / `1. third` 渲染为 `1.` `2.` `3.`（与 Obsidian 一致）。
- 非活跃行把源码里的数字标记替换成 `OrderedWidget`（`span.gh-md-lp-ol`）；活跃行显示源码。

### 24.2 Callout 正文
- callout 正文按行用客户端 `renderInline`（marked.parseInline + DOMPurify）渲染，支持粗体/斜体/链接/行内代码；vendor 未就绪时 300ms 重试。

### 24.3 链接 Ctrl+Click
- 渲染态链接点击带 `ctrlKey/metaKey` 时，`__ghMdOpenLink(href, true)`；客户端提示「链接已复制（Ctrl+Click：新面板）」。

### 24.4 验证
- jsdom：`ordered numbering: true`、`callout inline markdown: true`、`ctrl click flag: true`；
- 真实浏览器：`ordered list renumbers`（1./2./3.）、`callout body inline markdown`、`Ctrl+Click link flagged new-tab`；全部 OK。

## 25. v0.48.0：撤销/重做与外部内容同步保护

### 25.1 撤销/重做
- keymap 显式绑定：`Mod-z` 撤销、`Mod-y` 重做、`Mod-Shift-z`（macOS 习惯）重做；Windows 上与 Obsidian 一致用 `Ctrl+Y` 重做。
- 真实浏览器验证：输入 `UNDO` → `Ctrl+Z` 文本消失 → `Ctrl+Y` 文本恢复；debounce 自动保存反映最终历史。

### 25.2 外部内容同步保护
- 编辑器的 `docText`（流式/官方预览回读）变化时：
  - 若只差尾部空白，忽略；
  - 若编辑器有焦点，记录到 `cm6PendingExternalRef`，失焦后再应用；
  - 否则直接替换文档。
- 目的：自动保存触发官方预览回读时不重置光标/不打断输入。

### 25.3 验证
- 真实浏览器新增：`typing then undo removes text`、`redo restores text`、`autosave reflects undo/redo history`；全部 OK；
- `run-all-checks`：ALL CHECKS PASS。

## 26. v0.49.0：标签胶囊与脚注定义行

### 26.1 标签
- `#tag`（`#[\p{L}\p{N}_-]+`）：非活跃行替换成胶囊 widget（`.gh-md-lp-tag`，圆角背景 + 链接色）；活跃行淡化显示源码。

### 26.2 脚注定义
- `[^1]: text` 行：整行保持文本，不做行内上标转换（否则定义行里的 `[^1]` 也会变成上标）；非活跃行用 `.gh-md-lp-fndef` 次要色，活跃行淡化。

### 26.3 验证
- jsdom：`tag pill: 1`、`footnote definition keeps text: true`；
- 真实浏览器：`tag pill rendered`、`footnote definition keeps raw label`；40/40 断言全部 OK；
- 测试环境注意：CM6 只渲染视口内的行，真实浏览器断言需要把相关行滚入视口/把光标移近；本轮把任务行移到文档前部并加高 viewport 解决。

## 27. v0.50.0：标题快捷键与任务复选框快捷键

- `Ctrl/Cmd+1…6`：把当前行设为对应级别标题；已是同级别时取消标题。
- `Ctrl/Cmd+Enter`：切换当前行任务复选框（`- [ ]` ↔ `- [x]`；列表项没有复选框时补 `[ ] `）。
- 真实浏览器验证：`Ctrl+1 sets heading`、`Ctrl+1 toggles heading off`、`Ctrl+Enter toggles checkbox on/off`；44/44 断言全部 OK。
- 测试经验：浏览器会拦截 Ctrl+1（切标签页），真实浏览器测试改用合成 `KeyboardEvent` 派发到 `contentDOM`；单元格输入改用 `insertText` 以稳定触发 input 事件。

## 28. v0.51.0：与真实 Obsidian 1.15.1 对照

### 28.1 参考图获取
- 本机 Obsidian 1.15.1 正在运行（窗口标题 `README - jspace-repo - Obsidian 1.15.1`，vault 是 `E:\\hermes_playground\\jspace-repo`）。
- 用 PowerShell + Win32 `PrintWindow` 截窗口 → `.dsh-scratch/obsidian-window.png`（1936×1048，深色主题，Live Preview）。
- 用 headless Edge 把同一份 README 交给我们的 CM6 bundle 渲染 → `.dsh-scratch/our-readme-render.png`。

### 28.2 对照结论
- 整体版式（标题层级、段落间距、表格、行内代码底色、链接颜色/下划线）已接近 Obsidian。
- Obsidian 顶部「README」是 inline title（文件名），不属于 Markdown 内容；DSH 文件名在标签页上，不需要复刻。
- 发现差异：链接文字是行内代码时（`[\`docs/PROTOCOL.md\`](docs/PROTOCOL.md)`），我们之前把反引号也当链接文字显示；Obsidian 隐藏反引号、按链接渲染。已修复并加入断言（`link-with-code-label plain: true`）。

## 29. v0.52.0：按真实 Obsidian 截图逐项对齐

### 29.1 新对照方法
- 在 vault 里临时写 `_livepreview_probe.md`（覆盖标题/行内/列表/任务/引用/callout/代码/表格），用 `obsidian://open?vault=jspace-repo&file=_livepreview_probe` 打开并 `PrintWindow` 截图；
- 同一份 probe 用 headless Edge + 我们的 bundle 渲染截图；两张图逐项对照；
- 对照完成后关闭 Obsidian 标签页并删除临时文件。

### 29.2 对照发现并修复
| 项目 | Obsidian 行为 | 我们之前 | 修复 |
|---|---|---|---|
| 代码块语言标签 | 全名（JavaScript） | `js` | `LANG_LABELS` 映射全名 |
| 代码块高亮 | LP 里也有语法高亮 | 纯文本 | 客户端注入 `renderCode`（Shiki `__githubMdShiki.highlight`），Shiki 就绪后重建装饰 |
| 复制按钮 | hover 才出现 | 一直显示 | CSS hover 显示 |
| 已完成任务 | 删除线 + 复选框紫色 | 无 | `.gh-md-lp-task-done` + accent-color |
| 任务行 bullet | 不画 bullet | 多一个 `•` | 任务行跳过 bullet widget |
| `#tag` | 纯色文字 | 胶囊背景 | 纯色 |
| 引用文字 | 正文色 | 次要灰 | 正文色 |

### 29.3 验证
- probe stats：`codeHtmlHasSpan:true`、`codeLabel:"JavaScript"`、`taskDoneLines:1`、`tags:1`、callout body `<strong>bold</strong>`；
- `run-all-checks`：ALL CHECKS PASS。

## 30. v0.53.0：标题尺寸与「编辑视图可见」元素

### 30.1 标题尺寸
- 从 `obsidian-1.15.1.asar` 里读到默认主题变量：`--h1-size:1.618em`、`--h2-size:1.462em`、`--h3-size:1.318em`、`--h4-size:1.188em`、`--h5-size:1.076em`、`--h6-size:1em`；字重 h1 700、其余 600；行高 h1/h2 1.2、h3 1.3、h4 1.4。
- 我们的 CSS 已按这些值对齐（此前 1.7/1.45/1.25 偏大）。

### 30.2 编辑视图可见的元素（实测修正）
- 用 probe 文件在真实 Obsidian 1.15.1 里实测：`<!-- HTML 注释 -->`、`%%注释%%`、块 ID `^id` 在 Live Preview 里**都是可见文本**（只有 Reading view 才隐藏）。
- 我们之前误把它们隐藏，已回退：现在与 Obsidian 编辑视图一致，保持可见。

### 30.3 验证
- probe stats：commentVisible true、blockIdVisible true；
- `run-all-checks`：ALL CHECKS PASS；
- 临时 probe 文件与 Obsidian 标签页已清理。

## 31. v0.54.0：折叠 callout 与图片尺寸

### 31.1 折叠 callout
- `> [!tip]- 标题` 默认收起；`[!tip]+` / 无标记默认展开；
- 标题右侧显示 ▸/▾ 箭头，点击标题切换；
- 点击时 `preventDefault + stopPropagation`，避免光标被带进 callout 源码块（否则 widget 会变回源码）。

### 31.2 图片尺寸
- `![[pic.png|120]]`：解析 `|宽度`，ImageWidget 设置 `img.style.width = 120px`；
- 修复：之前先 `split('|')[0]` 再解析尺寸，导致尺寸永远丢失；现在保留原始 token 再拆分。

### 31.3 验证
- jsdom：`folded callout body hidden: true`、`folded callout expands on click: true`、`image width applied: true`；
- 真实浏览器：47/47（含 `folded callout body hidden`、`image width from embed syntax — 120px`、`callout expands on click`）；
- `run-all-checks`：ALL CHECKS PASS。

## 32. v0.55.0：callout 块级正文

- Obsidian probe 实测：callout 正文里的段落、列表、代码块都会渲染（box 内列表有圆点、代码块有底色）。
- 实现：客户端注入 `renderBlocks(text)`（复用 `createMarkdownRenderer().render`），`CalloutWidget` 优先用它渲染正文；vendor 未就绪时重试，失败才退回逐行 inline。
- 折叠箭头只在 `> [!type]-` / `[!type]+` 时显示（普通 callout 不显示箭头，与 Obsidian 一致）；点击折叠的 inhibit 逻辑保留。
- callout 内块级元素间距收紧（p/ul/ol/pre margin），减少与 Obsidian 的视觉差。
- 验证：jsdom `callout block content: true`；真实浏览器 48/48（`callout body inline markdown`、`callout block content`）。

## 33. v0.56.0：缩进单位与 probe2 覆盖

### 33.1 缩进 4 空格
- 从 `obsidian-1.15.1.asar` 读到默认主题 `--indent-size: 4`（vault 未配置 tab size 时的默认值）。
- Tab：列表行在行首插 4 空格（整行缩进），其它位置插入 4 空格；Shift+Tab：删除行首 1-4 个空格；
- 编辑器 facet `EditorState.tabSize.of(4)`。

### 33.2 probe2 覆盖（真实 Obsidian 对照）
| 语法 | Obsidian LP | 我们 |
|---|---|---|
| 标题里行内代码 | 渲染成 code（无反引号） | 一致 |
| `~~删除~~` | 删除线 | 一致 |
| `^sup^` / `~sub~` | 显示原文（不渲染） | 一致 |
| 嵌套列表（4 空格） | 圆点缩进 | 一致 |
| 嵌套任务 | 子任务缩进 + 勾选 | 一致 |
| 嵌套引用 `> >` | 嵌套引用条 | 展平（差异，记录） |
| 表格 :---/:---:/---: | 左/中/右对齐 | 一致 |
| Python 代码块 | 高亮 + 语言名 | 一致 |

### 33.3 验证
- 真实浏览器 51/51（新增 `Tab indents list line by 4 spaces`、`Tab twice indents to 8 spaces`、`Shift+Tab removes list indent`）；
- `run-all-checks`：ALL CHECKS PASS；临时 probe 已清理。

## 34. v0.57.0：嵌套引用

- `> > text`：按 `>` 数量计算深度（上限 3），行类 `gh-md-lp-quote-depth-N`；
- CSS：depth 2 增加 `padding-left: 28px`，depth 3 为 `42px`；depth>=2 用 `::before` 画第二根引用条；
- 真实浏览器：`nested quote depth rendered — count=1`，52/52 断言通过；
- 已知测试环境限制：jsdom 里 CM6 的块级 widget 会把多行合并成一个 `.cm-line`，导致该用例在 jsdom 里不可见；以真实浏览器结果为准。

## 35. v0.58.0：行内 HTML

### 35.1 实测
- Obsidian probe：`<kbd>Ctrl</kbd>` 渲染成按键样式、`<sup>2</sup>`/`<sub>1</sub>` 上下标、`<mark>` 高亮、`<u>` 下划线、`<span style="color:#ff5555">` 红字、`<b>`/`<i>` 生效、`<!-- comment -->` 淡化显示。

### 35.2 实现
- INLINE_PATTERN 增加：HTML 注释、成对行内标签、`<br>`；
- 白名单：kbd/sup/sub/mark/u/s/del/ins/b/strong/i/em/span/br/small/abbr/cite/q/code/var/samp；
- 非活跃行用 `InlineHtmlWidget`（`contenteditable=false`）替换；HTML 由客户端 `renderInlineHtml` 经 DOMPurify 白名单消毒；
- 活跃行显示源码（淡化）；HTML 注释非活跃行淡化显示。

### 35.3 验证
- jsdom：`inline html kbd: 1`、`sup text: 2`、`mark text: mark`；
- 真实浏览器 55/55（新增 `inline html kbd rendered`、`inline html sup rendered`、`inline html mark rendered`）；
- `run-all-checks`：ALL CHECKS PASS；probe 已清理。

## 36. v0.59.0：列表参考线与嵌套有序列表编号

### 36.1 列表参考线
- probe 实测：Obsidian 在嵌套列表处画淡淡的竖向引导线（每个缩进层级一条）。
- 实现：列表行按 `floor(前导空格/4)` 得到层级（最多 2），行类 `gh-md-lp-list-guide-N`，用 `::before`/`::after` 画 1px 竖线（位置 14px / 38px）。

### 36.2 嵌套有序列表编号
- 之前跨层级连续编号（嵌套列表显示 2.）；现在记录上一层缩进，缩进变化时按源数字重新开始（嵌套列表显示 1.）。

### 36.3 验证
- jsdom：`list guide lines: 1`；
- 真实浏览器 56/56（新增 `list indentation guide rendered — count=1`）；
- 截图对照：Obsidian 与我们的嵌套列表都有引导线；`run-all-checks` ALL CHECKS PASS。
- 测试环境记录：jsdom 的 CM6 视口高度为 0，靠后的行不会渲染（quote/hr/ordered 计数改为信息性输出，真实浏览器覆盖）。

## 37. v0.60.0：链接/粘贴快捷键与真实 GUI 现状

### 37.1 快捷键
- `Mod-k`：有选区 → 包成 `[[选区]]`；无选区 → 插入 `[[]]` 且光标在中间；
- `Mod-Shift-v`：`navigator.clipboard.readText()` 读取纯文本后插入（Obsidian 的 Ctrl+Shift+V 纯文本粘贴）；
- 键位冲突修复：Windows 上 `Ctrl+Shift+K` 的 `event.key` 是 `K` 大写，`Mod-k` 会先匹配；除 `Mod-Shift-k` 外再补 `Mod-Shift-K` 绑定，删除行命令优先于 wikilink 插入。

### 37.2 真实 GUI 现状（重要）
- Web GUI `http://127.0.0.1:61290` 仍返回 401，需要授权 token，未做自动化；
- 桌面 App 进程没有远程调试端口（`--remote-debugging-port` 未开启），无法 CDP 注入；
- 可用 Win32 `PrintWindow` 截取桌面窗口（`dsh-gui.png`），当前窗口显示的是对话页，侧边 Markdown 预览面板未打开，无法直接验证插件渲染；
- 结论：真实 GUI 验证需要用户手动打开预览面板，或提供可访问的 GUI 地址/token。

### 37.3 验证
- 真实浏览器 59/59（新增 `Ctrl+K wraps selection as wikilink`、`Ctrl+K inserts empty wikilink`、`Ctrl+Shift+V pastes plain text`；删除行测试改为大写 `K` 合成事件）；
- `run-all-checks`：ALL CHECKS PASS。

## 38. v0.61.0：真实 GUI 自动化验证（不再依赖 token/400 阻塞）

### 38.1 方法
1. 临时 `DSH_HOME=E:\hermes_playground\.dsh-scratch\dsh-verify-home`，新建 `profiles/verify`（`dsh.profile.bundles = [dsh-base, dsh-web-app, @local/dsh-github-md]`），`dsh plugin --profile verify install` 把插件 link 进去；
2. `ELECTRON_RUN_AS_NODE=1 DeepSeek Harness.exe <asar>\...\@deepseek-ai\dsh\lib\bin.js --profile verify --port 0 --no-open`，stdout 打印 `dsh web: http://127.0.0.1:PORT/?token=…`；
3. Playwright 打开该 URL（token 只在脚本内使用，不写入文档），关闭预览版弹窗，`Control+Shift+B` 打开右侧边栏 →「工作区文件」→ 点 `_gui_verify.md`；
4. 断言 DOM：`.gh-md-cm6-document` 1、`.cm-editor` 1、标题装饰 2、bullet 2、table 1、code 1、quote 1、tag 1；全部 vendor 资源 200；无 console error；
5. 点击段落 → 标记显示（`**bold**`）、`head` 在段落行、`focused=true`；输入文本 → 2.4s 后 `head` 不变、仍聚焦、磁盘文件包含输入文本。

### 38.2 发现并修复的 bug
- 现象：在真实 GUI 中打字后约 200-400ms（自动保存完成），CM6 视图被官方预览重挂载，光标跳回文档开头、焦点丢失；
- 修复：bundle 新增 `onStateChange({head, focused, text})`（`EditorView.updateListener`），client 用模块级 `cm6EditorMemory` 按 `sourcePath` 记住光标/焦点；视图重建后如文本一致则恢复 selection，并在之前聚焦的情况下自动 focus；
- 验证：修复后 `AFTER TYPE 2.4s` 状态为 `head=21, focused=true`，标记正常显示。

### 38.3 其它
- 顺手去掉 CM6 编辑器的 focus-visible outline（`.gh-md-cm6-lp :focus-visible{outline:none!important}`）；
- GUI 里文档面板的虚线框来自 DSH 官方 documentpreview 的焦点指示，不是我们样式。

### 38.4 复现脚本
- `.dsh-scratch/make-verify-profile.mjs`、`.dsh-scratch/parse-verify-url2.mjs`、`.dsh-scratch/verify-gui-e2e.mjs`、`.dsh-scratch/verify-gui-cursor3.mjs`、`.dsh-scratch/verify-gui-proof.mjs`。

## 39. v0.62.0：真实 GUI 编辑行为验证 8/8

### 39.1 验证脚本
- `.dsh-scratch/gui-behavior-check.mjs`：启动/复用验证实例 → 打开 `_gui_verify.md` → 逐项断言；
- 断言项：点击聚焦、Enter 续写、Tab/Shift+Tab、Ctrl+Z/Ctrl+Y、自动保存落盘、保存后光标保持。

### 39.2 发现的第二个真实 GUI bug：撤销历史在自动保存后丢失
- 现象：打字 → 约 200-400ms 自动保存 → 官方预览重挂载编辑器 → CM6 内建撤销历史清空，`Ctrl+Z` 失效；
- 修复：bundle 撤销/重做命令先走 CM6 `undo/redo`，返回 false 时调用 host 的 `undoFallback/redoFallback`；
- client 用模块级 `cm6HistoryMemory` 记录文本快照（600ms 合并连续输入），撤销/重做返回 `{text, head}` 并整体替换文档；
- 结果：真实 GUI 里 `typing then Ctrl+Z undoes`、`Ctrl+Y redoes` 均通过。

### 39.3 验证结果
- `GUI BEHAVIOR: 8/8 ok`，无 console error；
- headless 全量检查 `run-all-checks`：ALL CHECKS PASS。

## 40. v0.63.0：真实 GUI 扩展行为验证 11/11

### 40.1 断言项
| 行为 | 结果 |
|---|---|
| Shift+Enter 硬换行（行尾两个空格） | OK |
| Ctrl+B 包裹选中文字为粗体 | OK |
| Ctrl+1 设标题 / 再按取消 | OK |
| Ctrl+Enter 勾选 / 取消任务 | OK |
| Ctrl+K 插入 `[[]]` | OK |
| 表格单元格点击 + 输入更新文档 | OK |
| 表格修改落盘 | OK |
| callout 点击标题展开 | OK |
| 代码块复制按钮写入剪贴板 | OK |

### 40.2 测试经验
- 表格单元格点击后光标在单元格开头，输入会前插（`ZZa1`），断言按包含处理；
- 剪贴板断言需要 `context.grantPermissions([clipboard-read, clipboard-write])`；
- 真实 GUI 里 Shift+Enter / Ctrl+[组合键用合成 KeyboardEvent 更稳定。

### 40.3 复现脚本
- `.dsh-scratch/gui-behavior-check2.mjs`（第一批为 `gui-behavior-check.mjs`）。

## 41. v0.64.0：真实 GUI 第三批行为验证 6/6 + 复选框点击修复

### 41.1 断言项
| 行为 | 结果 |
|---|---|
| Backspace 去掉列表标记 | OK |
| Ctrl+Shift+K 删除行 | OK |
| Ctrl+Shift+V 纯文本粘贴 | OK |
| 鼠标点击任务复选框切换 | OK（修复后） |
| 选中后输入替换 | OK |
| 两次输入两段撤销 | OK |

### 41.2 发现的第三个真实 GUI bug：点击复选框不生效
- 现象：真实 GUI 里鼠标点任务复选框，勾选状态不变；
- 原因：`TaskWidget.ignoreEvent()` 返回 false，mousedown 先被 CM6 用来移动光标 → 任务行变活跃 → widget 被源码替换，click 事件落到已移除的 DOM；
- 修复：TaskWidget 的 input 直接挂 `mousedown`（preventDefault + stopPropagation）与 `click`（切换 `[ ]`/`[x]` 并通过 `activeHost.view` 派发变更），`ignoreEvent` 改为 true；
- 验证：真实 GUI `clicking task checkbox toggles doc` 通过。

### 41.3 复现脚本
- `.dsh-scratch/gui-behavior-check3.mjs`。

## 42. v0.65.0：点击进入编辑 + GUI 回归套件

### 42.1 点击块进入源码编辑
- 实测：之前点 callout 正文 / 代码块没有反应（widget ignoreEvent=true，点击不进入源码）；
- 修复：`CalloutWidget`、`CodeBlockWidget` 的 `ignoreEvent` 改为 false → mousedown 让 CM6 把光标放进块内 → 块变活跃 → 源码显示，可编辑；
- 复制按钮单独 `mousedown` preventDefault/stopPropagation，避免点复制时把光标带进代码块；
- callout 标题仍只负责折叠（标题 mousedown/click 已 stopPropagation）。
- 真实 GUI 断言：`click callout body enters source edit`、`click code block enters source edit` 均通过。

### 42.2 GUI 回归套件
- `.dsh-scratch/run-gui-suite.mjs`：自启真实 DSH 验证实例 → 依次跑 `gui-behavior-check.mjs`(8)、`gui-behavior-check2.mjs`(11)、`gui-behavior-check3.mjs`(6)、`gui-click-edit-check.mjs`(2) → 关服务并清理；
- 结果：`GUI SUITE: 4/4 scripts green`，共 27 项真实 GUI 断言。

### 42.3 测试稳定性
- 自动保存会重挂载编辑器，测试里 Tab/撤销等操作改为等待保存稳定 + 重试，避免偶发失败；
- 复跑 `run-gui-suite.mjs` 稳定 4/4。

## 43. v0.66.0：frontmatter / 数学 / 脚注点击编辑

### 43.1 修复
- `FrontmatterWidget.ignoreEvent`、`MathWidget.ignoreEvent` 改为 false → 点击后 CM6 把光标放进对应块/行，块变活跃、源码显示；
- 行间公式点击后光标落在 `$$` 行；行内公式点击后该行显示 `$x^2$`；脚注引用点击后显示 `[^1]` 源码。

### 43.2 验证
- 新增 `gui-click-edit-check2.mjs`：frontmatter / block math / inline math / footnote ref 点击进入源码，4/4；
- GUI 回归套件扩到 5 个脚本：`GUI SUITE: 5/5 scripts green`，共 31 项真实 GUI 断言。

### 43.3 测试经验
- 行内公式用 locator 精确点击 widget 本身（坐标点击容易落到相邻行）；
- 断言「行变活跃、显示源码」比断言 widget 数量更准确（块公式 widget 与行内公式共享 class）。

## 44. v0.67.0：表格 Tab 导航、右键插入行、纯文本粘贴、Ctrl+S

### 44.1 新增行为
- 表格 widget 的 wrapper 增加 keydown：`Tab`/`Shift+Tab` 在 `th,td` 间移动焦点，并把光标放到单元格末尾；
- `Mod-s` 绑定 `saveNowCommand`：调用 host.saveNow → client `persist()` 立即写盘；
- 富文本粘贴由 CM6 默认行为插入纯文本（实测 `RICH-TEXT` 不夹带 `<b>`）。

### 44.2 验证（真实 GUI，6/6）
| 行为 | 结果 |
|---|---|
| Tab 跳到下一个单元格（row1/cell0 → row1/cell1） | OK |
| Shift+Tab 回到上一个单元格 | OK |
| 右键菜单「在下方插入行」使表格行数 +1 | OK |
| 富文本粘贴为纯文本 | OK |
| Ctrl+S 立即保存到磁盘 | OK |
| Ctrl+S 不触发下载 | OK |

### 44.3 回归套件
- 新增 `gui-behavior-check4.mjs`；套件扩到 6 个脚本：`GUI SUITE: 6/6 scripts green`，共 37 项真实 GUI 断言。

## 45. v0.68.0：外部修改刷新、链接点击、图片预览

### 45.1 外部修改
- 实测：文件被外部修改后，官方预览重挂载编辑器；未聚焦时直接刷新，聚焦时也会应用新内容；
- 修复：`cm6EditorMemory` 恢复不再要求文本完全一致（按 offset 恢复光标），并恢复焦点，避免外部刷新后光标丢失；
- 真实 GUI：`external change refreshes unfocused editor`、`external change applies while focused`、`external change keeps focus/cursor` 均通过。

### 45.2 链接点击
- 原实现只在 click 阶段处理：点击后行变活跃、链接节点被替换，click 目标丢失 → 剪贴板为空；
- 修复：`domEventHandlers.mousedown` 阶段处理 `[data-href]`（preventDefault/stopPropagation + 复制 + __ghMdOpenLink）；
- 真实 GUI：`click wikilink copies target` = "Note A"。

### 45.3 图片预览
- 原实现 click 阶段打开全屏，但 mousedown 已把 widget 替换成源码，overlay 不出现；
- 修复：ImageWidget 直接挂 mousedown（阻止默认）+ click（打开 overlay），ignoreEvent 改 true；
- 真实 GUI：图片渲染、点击打开全屏、点击遮罩关闭，3 项通过。

### 45.4 回归套件
- 新增 `gui-behavior-check5.mjs`（7 项）；套件 7 个脚本：`GUI SUITE: 7/7 scripts green`，共 44 项真实 GUI 断言。

## 46. v0.69.0：标题折叠

### 46.1 实现
- 新增 `toggleFoldEffect` + `foldStateField`（位置随文档变化 mapPos）；
- 标题行行首插入 `FoldChevronWidget`（▾/▸，悬停显现，折叠时常显），mousedown/click 阻止冒泡并派发折叠 effect；
- 折叠时计算结束行：向下找到第一个级别 ≤ 当前标题的标题；用 block replacement（`FoldHiddenWidget`，高度 0）隐藏中间内容；
- `buildDecorations` 在折叠 effect 时重建，并跳过被隐藏行；
- CSS：`.gh-md-cm6-fold-chevron`、`.gh-md-cm6-fold-hidden { height: 0; overflow: hidden; }`。

### 46.2 真实 GUI 验证（6/6）
| 检查 | 结果 |
|---|---|
| 标题左侧箭头渲染（4 个标题） | OK |
| 折叠 H1 隐藏整节（到下一个 H1） | OK |
| 折叠不修改文档 | OK |
| 折叠不移动光标 | OK |
| 再点展开恢复内容 | OK |
| 折叠 H2 只隐藏其子节 | OK |

### 46.3 说明
- 折叠状态保存在编辑器视图内，外部修改/自动保存导致重挂载后会重置（后续可做按文件的折叠状态持久化）；
- jsdom 下折叠箭头会出现在行文本里，原型测试相应放宽断言；同时补了 getClientRects/Range mock。

### 46.4 回归套件
- 新增 `gui-heading-fold-check.mjs`；套件 8 个脚本：`GUI SUITE: 8/8 scripts green`，共 50 项真实 GUI 断言。

## 47. v0.70.0：折叠状态持久化

### 47.1 实现
- bundle 新增 `restoreFoldEffect`（按行号恢复折叠）与 `options.onFoldChange`（上报折叠行号）；
- client 新增 `cm6FoldMemory`（按 sourcePath 存折叠行号数组），创建编辑器时传 `foldedLines`，折叠变化时更新；
- 行号而非偏移：文档小改动后仍能对齐；
- 重挂载（自动保存/外部刷新）后自动恢复折叠。

### 47.2 真实 GUI 验证（3/3）
| 检查 | 结果 |
|---|---|
| 折叠 Beta 隐藏子节 | OK |
| 打字触发自动保存/重挂载后折叠保持 | OK |
| 重挂载后再点展开正常 | OK |

### 47.3 回归套件
- 新增 `gui-fold-persist-check.mjs`；套件 9 个脚本：`GUI SUITE: 9/9 scripts green`，共 53 项真实 GUI 断言。

## 48. v0.71.0：列表折叠 + 与真实 Obsidian 的注释/块 ID 对照

### 48.1 列表折叠
- `BulletWidget` 变为 wrap（折叠箭头 + 圆点），箭头 mousedown/click 阻止冒泡并派发 `toggleFoldEffect`（位置=列表行 from）；
- 折叠范围：向下到第一个非空且缩进 ≤ 当前项缩进的行；用零高度 block replacement 隐藏；
- 复用 `foldStateField` 与折叠记忆，自动保存重挂载后恢复；
- CSS：`.gh-md-lp-bullet-wrap` relative，箭头绝对定位在左侧 16px，悬停/折叠时显现。

### 48.2 真实 GUI 验证（6/6）
| 检查 | 结果 |
|---|---|
| 列表箭头渲染 | OK |
| 折叠父项隐藏子项、保留同级 | OK |
| 折叠不修改文档 | OK |
| 折叠不移动光标 | OK |
| 自动保存重挂载后折叠保持 | OK |
| 展开恢复子项 | OK |

### 48.3 与真实 Obsidian（1.15.1）对照：注释 / 块 ID / 脚注定义
- Obsidian Live Preview 中 `<!-- -->` 注释**可见但变暗**；`%%...%%` 注释与 `^blockid` 以普通文本可见；脚注定义行可见并渲染编号；
- 我们的实现：非活跃行的 HTML 注释用 `gh-md-lp-syntax` 变暗；`%%` 与 `^id` 保持普通文本；脚注引用上标、定义行可见 —— 与 Obsidian 一致（截图见 `.dsh-scratch/obsidian-window.png`）。

### 48.4 回归套件
- 新增 `gui-list-fold-check.mjs`；套件 10 个脚本：`GUI SUITE: 10/10 scripts green`，共 59 项真实 GUI 断言。

## 49. v0.72.0：嵌入块点击、引用/callout 行内 Enter 续写

### 49.1 新增
- `EmbedWidget` 增加 mousedown/click（preventDefault/stopPropagation）：复制 `![[目标]]` 的目标并调用 `__ghMdOpenLink` 显示提示；
- `lang-markdown` 的 `insertNewlineContinueMarkup` 已覆盖 `>` 续写：引用行与 callout 正文行按 Enter 都续 `> `。

### 49.2 真实 GUI 验证（4/4）
| 检查 | 结果 |
|---|---|
| 引用行 Enter 续写 `> ` | OK |
| callout 正文 Enter 续写 `> ` | OK |
| 嵌入块渲染 | OK |
| 点击嵌入块复制目标（"Note A"） | OK |

### 49.3 回归套件
- 新增 `gui-embed-quote-check.mjs`；套件 11 个脚本：`GUI SUITE: 11/11 scripts green`，共 63 项真实 GUI 断言。

## 50. v0.73.0：完成态任务 / callout 默认折叠 / 表格菜单操作

### 50.1 真实 GUI 验证（5/5）
| 检查 | 结果 |
|---|---|
| 完成任务显示删除线、无圆点、复选框勾选 | OK |
| `[!tip]-` 默认折叠（body display:none） | OK |
| `[!note]+` 默认展开 | OK |
| 右键「居中对齐」→ 分隔行 `:---:` | OK |
| 右键「删除本列」→ 列被移除 | OK |

### 50.2 回归套件
- 新增 `gui-visual-check.mjs`；套件 12 个脚本：`GUI SUITE: 12/12 scripts green`，共 68 项真实 GUI 断言。

## 51. v0.74.0：有序列表折叠

### 51.1 实现
- `OrderedWidget` 增加 folded/position 与折叠箭头（wrap：箭头 + 序号），直接 mousedown/click 派发 `toggleFoldEffect`；
- 有序列表分支按缩进计算折叠范围（与无序列表一致的规则），零高度 block replacement 隐藏；
- 复用折叠记忆与恢复。

### 51.2 真实 GUI 验证（6/6）
| 检查 | 结果 |
|---|---|
| 有序列表箭头渲染（4 个） | OK |
| 折叠父项隐藏子项、保留同级 | OK |
| 折叠不修改文档 | OK |
| 折叠不移动光标 | OK |
| 自动保存重挂载后折叠保持 | OK |
| 展开恢复子项 | OK |

### 51.3 回归套件
- 新增 `gui-ordered-fold-check.mjs`；套件 13 个脚本：`GUI SUITE: 13/13 scripts green`，共 74 项真实 GUI 断言。

## 52. v0.75.0：任务列表折叠 + 隐藏列表符号

### 52.1 实现
- `TaskWidget` 增加 folded/foldPosition 与折叠箭头（wrap：箭头 + 复选框），复用 `toggleFoldEffect`；
- 任务行折叠范围按缩进计算（与无序/有序列表一致），零高度 block replacement 隐藏；
- 渲染态任务行把 `- ` 列表标记替换为空（之前会残留 `- ` 文本），与 Obsidian 只显示复选框一致。

### 52.2 真实 GUI 验证（6/6）
| 检查 | 结果 |
|---|---|
| 任务行折叠箭头渲染（4 个） | OK |
| 折叠父任务隐藏子任务、保留同级 | OK |
| 折叠不修改文档 | OK |
| 折叠不移动光标 | OK |
| 复选框点击仍能切换 | OK |
| 展开恢复子任务 | OK |

### 52.3 视觉对照
- 折叠后行文本为 `▸ parent task`（无 `- `），与 Obsidian 渲染态一致。

### 52.4 回归套件
- 新增 `gui-task-fold-check.mjs`；套件 14 个脚本：`GUI SUITE: 14/14 scripts green`，共 80 项真实 GUI 断言。

## 53. v0.76.0：脚注定义渲染与 Obsidian 对照

### 53.1 对照发现
- 用安装的 Obsidian 1.15.1 渲染同一份全特性探针（标题/样式/引用/callout/列表/任务/表格/公式/代码/hr/脚注），逐项对照；
- 发现差异：Obsidian 渲染态脚注定义 `[^1]: definition text` 显示为「上标 1 + 文本」，我们之前保留原始 `[^1]:` 文本。

### 53.2 修复
- 脚注定义行：渲染态把 `[^1]:`（含前导空白）替换为 `FootnoteRefWidget`（上标编号），保留随后文本与 `gh-md-lp-fndef` 颜色；编辑该行时恢复源码；
- 行内/定义共用 `gh-md-cm6-fnref` 样式。

### 53.3 验证
- 真实 GUI：`footnote definition marker rendered as superscript` 通过（文本 `1 definition text`）；
- 真实 GUI 点击脚注引用进入源码编辑仍通过；
- 真实浏览器 59 项、headless 全部检查通过（相应断言更新为「定义标记渲染为上标」）。

### 53.4 回归套件
- 套件 14 个脚本：`GUI SUITE: 14/14 scripts green`，共 81 项真实 GUI 断言。

## 54. v0.77.0：视觉细节对照 Obsidian（CDP 截图）

### 54.1 对照方式
- 重启 Obsidian 带 `--remote-debugging-port=9333`，用 Playwright `connectOverCDP` 截取真实渲染，避免 PrintWindow 缓存问题；
- 同一份全特性探针两边各渲染一遍比较。

### 54.2 差异与修复
| 差异 | 修复 |
|---|---|
| wikilink 是蓝色普通链接 | 新增 `.gh-md-lp-wikilink`：紫色 #8b6cef + 点线下划线 |
| `#tag` 是普通彩色文本 | 改为紫色胶囊（圆角背景 + padding） |
| 引用块灰边 + 正常文字 | 紫色左边线（含嵌套第二条）、正文次要色 |
| callout tip 是绿色 | tip 改 Obsidian 青色 #00bfa5，标题用强调色；补齐其它色调 |
| 标题折叠箭头默认可见 | 默认 opacity 0，悬停/折叠时显示 |
| 代码块语言 + 复制常驻占高度 | 改为绝对定位浮层，悬停显示 |

### 54.3 验证
- 真实 GUI 新增 2 项样式断言：wikilink 计算色 `rgb(139,108,239)`、tag 有背景与圆角；
- `GUI SUITE: 14/14 scripts green`，共 83 项真实 GUI 断言；headless 全部通过。

### 54.4 仍需注意
- DSH 单栏宿主没有 Obsidian 的「行内标题（文件名）」与属性面板的增删交互，这两处保持 DSH 适配形态；
- 主题色变量不同（浅/深色），颜色按 Obsidian 默认值写死为近似值。

## 55. v0.78.0：callout SVG 图标

### 55.1 实现
- `CALLOUT_META` 的 icon 从 emoji 换成 Lucide 风格 SVG path；
- `CalloutWidget` 用 `<svg viewBox="0 0 24 24" stroke="currentColor">` 渲染，图标颜色 = callout 强调色；
- CSS：`.gh-md-cm6-callout-icon` inline-flex + accent 色，svg 15×15。

### 55.2 验证
- 真实 GUI 新增断言：`callout icon rendered as svg`（2 个 callout 图标均为 svg）；
- `GUI VISUAL: 9/9 ok`；套件 `GUI SUITE: 14/14 scripts green`，共 84 项真实 GUI 断言；headless 全部通过。

## 56. v0.79.0：frontmatter 标签胶囊 / 外链箭头 / 圆点颜色

### 56.1 实现
- `FrontmatterWidget`：key 为 tags/tag 时按逗号拆分为 `.gh-md-cm6-frontmatter-pill` 胶囊；
- `.gh-md-lp-link[data-href^="http"]::after` 显示 `↗`；
- `.gh-md-lp-bullet` 使用 label-tertiary 色。

### 56.2 真实 GUI 验证（12/12）
| 检查 | 结果 |
|---|---|
| frontmatter tags 胶囊（背景 rgba(139,108,239,0.12)） | OK |
| 外部链接显示 ↗ | OK |
| 列表圆点使用次要色（rgb(97,102,107)） | OK |

### 56.3 回归套件
- gui-visual-check 扩到 12 项；套件 `GUI SUITE: 14/14 scripts green`，共 87 项真实 GUI 断言；headless 全部通过。

## 57. v0.80.0：空列表/空引用退出 + 快捷键优先级修复

### 57.1 根因
- `@codemirror/lang-markdown` 用 `Prec.high(keymap.of(markdownKeymap))` 注册 Enter/Backspace；
- 我们的 `keymap.of(editingKeymap)` 是普通优先级，被它抢占 → 自定义 Enter 命令从未执行（调试证据：`window.__ghMdLastEnter` 为 null，改为 Prec.highest 后能拿到 `{head, lineFrom, lineTo, text}`）。

### 57.2 修复
- `Prec.highest(keymap.of(editingKeymap))` 单独注册，`defaultKeymap/historyKeymap` 保持普通优先级；
- 新增 `smartEnterCommand`：空列表项（`- `/`1. ` 等）与空引用行（`>`/`> `）行尾按 Enter 清空该行标记（退出列表/引用），其它情况仍走 `insertNewlineContinueMarkup`。

### 57.3 真实 GUI 验证（3/3）
| 检查 | 结果 |
|---|---|
| 空无序列表项 Enter 去掉标记 | OK |
| 空有序列表项 Enter 去掉标记 | OK |
| 空引用行 Enter 退出引用 | OK |

### 57.4 套件
- 新增 `gui-editing-niceties.mjs`；套件加进程间隔离（每个脚本前清理探针文件），`GUI SUITE: 15/15 scripts green`，共 90 项真实 GUI 断言。

## 58. v0.81.0：快捷键复核（加粗/斜体可切换、Backspace 去标记）

### 58.1 复核发现（keymap 优先级修复后重新验证）
| 行为 | 修复前 | 修复后 |
|---|---|---|
| 列表内容开头 Backspace | 残留 2 空格 | 整段标记删除，文字回到行首 |
| Ctrl+B 选中已加粗文字 | 再包一层（`****x**...**`） | 取消加粗；再按恢复 |
| Ctrl+I 选中已斜体文字 | 再包一层 | 取消斜体 |
| Tab 段落行缩进 | 正常 | 正常（保持） |

### 58.2 实现
- `smartBackspaceCommand`：光标紧跟列表标记时，删除「缩进 + 标记 + 空格」，否则回落 `deleteMarkupBackward`；
- `toggleWrapCommand`：支持三种情况——选区自带标记则剥离、选区外侧有标记则删除外侧、否则包裹；Ctrl+B/Ctrl+I 复用它。

### 58.3 验证
- 真实 GUI `GUI KEYS: 6/6 ok`；套件 `GUI SUITE: 16/16 scripts green`，共 96 项真实 GUI 断言；headless 全部通过。

## 59. v0.82.0：快捷键复核第二批（5/5）

| 检查 | 结果 |
|---|---|
| `Ctrl+Enter` 勾选任务 | OK |
| `Ctrl+Shift+K` 删除行 | OK |
| `Shift+Tab` 段落去 4 空格 | OK |
| `Tab` 代码块内缩进 4 空格（Obsidian indent-size 默认 4） | OK |
| `Ctrl+Shift+V` 纯文本粘贴（富文本剪贴板） | OK |

### 59.1 说明
- 代码块 Tab 插入 4 空格而非 2：与 Obsidian 的 `--indent-size: 4` 默认值一致，测试期望同步修正；
- 套件 `GUI SUITE: 17/17 scripts green`，共 101 项真实 GUI 断言；headless 全部通过。

## 60. v0.83.0：表格与代码块交互（3/3）

| 检查 | 结果 |
|---|---|
| 表格最后单元格按 Tab 不跳出 | OK |
| 表格单元格输入同步文档（并落盘） | OK |
| 代码块内 Enter 保持围栏、插入新行 | OK |

### 60.1 套件
- 新增 `gui-table-code-keys.mjs`；`GUI SUITE: 18/18 scripts green`，共 104 项真实 GUI 断言；headless 全部通过。

## 61. v0.84.0：Live Preview 核心语义验证（5/5）

| 检查 | 结果 |
|---|---|
| 活跃标题行显示 `#` 源码标记 | OK |
| 非活跃段落保持渲染（无 `**` 标记） | OK |
| 中文 IME 组合输入写入并重渲染 | OK |
| 列表内 Enter 续写新项 | OK |
| 结构编辑后单次 Ctrl+Z 撤销 | OK |

### 61.1 说明
- 前三项是「实时预览」本身的定义性语义，此前只在 jsdom/浏览器原型里断言，现在在真实 DSH GUI 中直接断言；
- IME 测试用 `CompositionEvent` + dispatch 模拟中文输入，验证组合期间装饰重建不会丢文本；
- 套件 `GUI SUITE: 19/19 scripts green`，共 109 项真实 GUI 断言；headless 全部通过。

## 62. v0.85.0：光标落点与导航（3/3）

| 检查 | 结果 |
|---|---|
| 点击段落 75% 处，光标列 = 64（不是行首） | OK |
| 点击列表项中部，光标列 = 22（标记之后） | OK |
| 方向键下移到下一行 | OK |

### 62.1 说明
- 这是渲染态装饰（零宽 replace）下最容易出错的地方：装饰不能破坏 CM6 的位置映射；实测映射正确；
- `ArrowDown` 落在空行属标准编辑器行为（与 Obsidian 一致），断言按「下一行」而非「下一块」；
- 套件 `GUI SUITE: 20/20 scripts green`，共 112 项真实 GUI 断言。

## 63. v0.86.0：嵌入笔记内联渲染（2/2）

| 检查 | 结果 |
|---|---|
| `![[_embed_target]]` 内联渲染目标笔记（含标题） | OK |
| 内联内容保留格式与列表（strong/ul） | OK |

### 63.1 说明
- 实现方式是已有 `resolveEmbed`：读取目标文件 → 用 marked 渲染器渲染 → 写入嵌入容器；本轮在真实 GUI 中验证其生效（此前只验证了点击复制）；
- 目标不存在时保留「嵌入：xxx」占位，不阻塞渲染；
- 套件 `GUI SUITE: 21/21 scripts green`，共 114 项真实 GUI 断言。

## 64. v0.87.0：wikilink 悬停预览（2/2）

| 检查 | 结果 |
|---|---|
| 悬停 `[[笔记]]` 弹出预览卡片（渲染目标标题与正文） | OK |
| 鼠标移开卡片消失 | OK |

### 64.1 实现
- bundle：`domEventHandlers.mouseover/mouseout` 命中 `.gh-md-lp-wikilink[data-href]` 时调用 `window.__ghMdShowLinkPreview/__ghMdHideLinkPreview`；
- client：effect 内实现卡片（读取目标文件 → marked 渲染），`position: fixed` 自动避让窗口边界，`mousemove` 捕获阶段在移出链接后关闭；
- 仅对 wikilink 生效，普通外链不弹卡片（与 Obsidian 行为一致）。

### 64.2 套件
- 新增 `gui-hover-preview-check.mjs`；`GUI SUITE: 22/22 scripts green`，共 116 项真实 GUI 断言。

## 65. v0.88.0：粘贴/拖入图片落盘并插入（2/2）

| 检查 | 结果 |
|---|---|
| 粘贴剪贴板图片 → 光标处插入 `![[pasted-xxx.png]]` | OK |
| 图片文件已写入笔记目录 | OK |

### 65.1 实现（三端配合）
- Host `index.js`：新增 `POST /github-md/workspace/asset`，校验图片扩展名与 16 MiB 上限，`mkdir -p` 后写二进制；
- Client：`workbenchRequest` 支持 asset（POST + JSON）；新增 `insertAsset(fileName, dataUrl)`，保存成功后在校光标处插入 `![[名字]]` 并聚焦；
- Bundle：`domEventHandlers.drop/paste` 拦截图片文件，`FileReader.readAsDataURL` 后交给 `host.insertAsset`；host 白名单补上 `insertAsset`（否则选项传不到 host）。

### 65.2 套件
- 新增 `gui-asset-paste-check.mjs`；`GUI SUITE: 23/23 scripts green`，共 118 项真实 GUI 断言。

## 66. v0.89.0：自动配对与多选区（4/4）

| 检查 | 结果 |
|---|---|
| 输入 `(` 自动补全为 `()` | OK |
| 光标停在括号中间 | OK |
| 输入 `[` 自动补全为 `[]` | OK |
| 允许 2 个选区（多光标） | OK |

### 66.1 实现
- 引入 `@codemirror/autocomplete` 的 `closeBrackets()` + `closeBracketsKeymap`；
- `EditorState.allowMultipleSelections.of(true)`；
- bundle 额外导出 `EditorSelection` 便于测试构造多选区。

### 66.2 测试经验
- 自动配对走的是 `EditorView.inputHandler`，用 `view.dispatch(replaceSelection)` 模拟输入**不会**触发；必须用真实按键（`page.keyboard.type`）才能测到。

### 66.3 套件
- 新增 `gui-typing-check.mjs`；`GUI SUITE: 24/24 scripts green`，共 122 项真实 GUI 断言。

## 67. v0.90.0：第三轮视觉对照（真实 Obsidian 截图）

### 67.1 对照方法
- Obsidian 以 `--remote-debugging-port=9333` 启动，Playwright `connectOverCDP` 截取 `.workspace-leaf.mod-active .markdown-preview-view`；
- 同一份探针（行内代码/加粗/斜体/高亮/删除线、hr、嵌套引用、三级列表、有序列表、任务、三列对齐表、Python 代码块、脚注）两边各渲染一遍比对。

### 67.2 修正
| 差异 | 修复 |
|---|---|
| 代码块有边框、语言标签仅悬停显示 | 去边框、语言标签常显（复制按钮仍悬停显示） |
| 表格被拉满整宽、表头有底色 | `width:auto !important; max-width:100%`、表头透明 + 加粗 |
| hr 偏重、间距小 | 1px 更淡线 + 16px 间距 |
| 复选框强调色跟随宿主 | 固定 Obsidian 紫 #8b6cef |

### 67.3 结果
- 修正后与 Obsidian 版式基本一致（表格宽度、代码块外观、hr、任务项）；
- 套件保持 `GUI SUITE: 24/24 scripts green`，共 122 项真实 GUI 断言；headless 全部通过。

## 68. v0.91.0：边打边渲染（4/4）

| 检查 | 结果 |
|---|---|
| 行首输入 `# ` 立刻变标题（class=gh-md-lp-h1，字号 25.9px） | OK |
| 输入 `- ` 后移开光标出现列表圆点 | OK |
| 输入 `> ` 立刻应用引用样式（gh-md-lp-quote） | OK |
| 输入 `**文字**` 移开后渲染为加粗（font-weight 700、标记消失） | OK |

### 68.1 测试经验
- 活跃行本来就显示源码（Obsidian 语义），因此「输入后需要移开光标」再断言渲染结果，否则测的是源码态；
- 加粗的装饰类名是 `gh-md-lp-strong`，不是 `gh-md-lp-bold`；断言按 class + computed font-weight 双向校验。

### 68.2 套件
- 新增 `gui-live-format-check.mjs`；`GUI SUITE: 25/25 scripts green`，共 126 项真实 GUI 断言。

## 69. v0.92.0：行内元素回归（7/7）

| 检查 | 结果 |
|---|---|
| `[[笔记\|别名]]` 只显示别名 | OK |
| `==高亮==` 渲染样式（gh-md-lp-highlight） | OK |
| 行内 `<kbd>` 渲染 | OK |
| `%%注释%%` 保持可见 | OK |
| 两种图片语法都渲染（2 张） | OK |
| `![[图片\|120]]` 宽度 120px | OK |
| callout 正文列表渲染（2 项） | OK |

### 69.1 说明
- 全部通过，本轮无代码改动，只把既有能力纳入真实 GUI 回归；
- 套件 `GUI SUITE: 26/26 scripts green`，共 133 项真实 GUI 断言。

## 70. v0.93.0：大文档性能优化

### 70.1 问题（真实测量）
- 6600 行 / 100 KB 文档：`buildDecorations` 70 ms、单次编辑 74 ms —— 逐键卡顿；
- 原因：每次 state 变化都对**全文档**逐行跑 8+ 个正则并创建 Decoration。

### 70.2 修复
| 措施 | 效果 |
|---|---|
| 装饰按可见视口（±200 行）构建，滚动时重建 | 视口外不做正则/装饰 |
| 视口外只维护代码围栏状态，其余直接 continue | 跳过 90% 行 |
| `onChange` 节流 120 ms，saveNow/destroy 前 flush | 避免逐键 React 重渲染 |
| 滚动重建时焦点在表格单元格则跳过 | 修复重建导致输入丢失 |

### 70.3 结果
- 6600 行文档：装饰重建 69.8 → **4.2~6.6 ms**，单次编辑 74 → **8.6~16.9 ms**；
- 首次渲染 312 ms，DOM 仅 29 个 line 节点（虚拟化生效）；
- 新增 `gui-perf-regression.mjs` 守住阈值（build < 30 ms、dispatch < 50 ms）；
- 套件 `GUI SUITE: 27/27 scripts green`，共 137 项真实 GUI 断言。

### 70.4 测试稳定性
- 自动保存会让编辑器短暂重挂载 → 测试的 `getDoc` 改为「等编辑器出现再读」，必要时整脚本重试一次；
- 保存链路线程（throttle 120ms + debounce 200ms）改变了时序，相关断言等待时间同步放宽。

## 71. v0.94.0：长文档滚动 / 视口重建 / 折叠箭头可点击

### 71.1 发现（用 693 行 README 做真实长文档对照）
| 问题 | 现象 | 修复 |
|---|---|---|
| 长文滚到中后段大片空白 | scroller 不可滚（`overflow:visible`），CM6 只渲染视口内行，页面滚动时视口不变 | 编辑器始终内部滚动（`height: calc(100vh - 210px)` + `overflow:auto`） |
| 滚动后局部行显示原始 Markdown | DOM scroll 事件触发重建时 `view.viewport` 尚未更新，窗口算旧了 | 改用 `updateListener.viewportChanged` 驱动重建 |
| 顶层列表折叠箭头点不到 | 内部滚动裁剪了 `left:-15px` 的绝对定位箭头 | 箭头改为行内负边距 + `.cm-content` 左内边距 22px |
| 点击表格单元格后输入丢失 | 重建替换 widget DOM，焦点丢失 | 重建后按 `data-row/data-cell` 重新聚焦 |

### 71.2 附带修正
- CSS 选择器 `.gh-md-cm6-lp .cm-content` 不生效（`gh-md-cm6-lp` 就加在 `.cm-content` 自身），改为合并选择器；
- 测试侧：脚本间等待 1200ms、`getDoc` 等编辑器出现、表格断言重试，消除宿主重挂载竞态。

### 71.3 结果
- 693 行 README 顶部/中部/底部滚动渲染均正确（列表圆点、加粗、表格、代码块都在）；
- `GUI SUITE: 27/27 scripts green`，共 137 项真实 GUI 断言；headless 全部通过。

## 72. v0.95.0：全篇滚动渲染回归

### 72.1 新增 `gui-longdoc-render-check.mjs`
- 生成 900+ 行文档（标题/段落/列表/引用/代码块混合），在 8 个滚动位置采样（0%, 15%, 30%, 45%, 60%, 75%, 90%, 100%）；
- 每个位置断言：渲染行数 > 0、无原始 Markdown 残留、装饰（圆点/引用条/代码块）存在。

### 72.2 结果
- 全部通过：渲染行 31~62，原始标记残留 0，各位置装饰 8~24 个；
- `GUI SUITE: 28/28 scripts green`，共 140 项真实 GUI 断言；headless 全部通过。

### 72.3 测试稳定性收尾
- 每个脚本使用独立探针文件名，避免命中宿主缓存的旧内容；
- 套件清理改为通配 `_gui*` / `pasted-*`；
- 打开文件失败时自动重试（刷新 + 重开），并在读取前确认内容就绪。

## 73. v0.96.0：保存 → 重开 全链路（3/3）

| 检查 | 结果 |
|---|---|
| 输入后自动保存写盘 | OK |
| 磁盘内容与编辑器内容一致（去行尾空白比较） | OK |
| 关闭标签页后重新打开，编辑仍在 | OK |

### 73.1 说明
- 关标签页本身是宿主行为（DSH 有时保留 preview 挂载），所以断言改为「数据一致性 + 重开内容正确」，不耦合宿主实现；
- 套件 `GUI SUITE: 29/29 scripts green`，共 143 项真实 GUI 断言；headless 全部通过。

### 73.2 套件去重
- `gui-keys-check2` 的 Ctrl+Enter 勾选与 `gui-behavior-check2` 重复（后者覆盖勾选 + 取消），已去重以免同一行为两处竞态。

## 74. v0.97.0：Alt+点击多光标

| 检查 | 结果 |
|---|---|
| `Alt+点击` 追加第二个光标 | OK |
| 多光标同时输入（两行都插入字符） | OK |

### 74.1 实现
- `EditorState.allowMultipleSelections` 之外，CM6 默认**不会**用 Alt+点击追加光标；
- 在 `domEventHandlers.mousedown` 里：`altKey && button === 0` → `view.posAtCoords` → 追加 `EditorSelection.cursor` 并 `preventDefault`；
- 直接尝试 `EditorView.clickAddsSelectionRange` facet 无效（实测未生效），改为自行处理。

### 74.2 测试要点
- Playwright 的 `mouse.click({modifiers:["Alt"]})` **不会**给 `mousedown` 设置 `altKey`，必须 `keyboard.down("Alt")` → 点击 → `keyboard.up("Alt")`；
- 套件改为**每 8 个脚本重启一次验证实例**，消除长时间运行后宿主会话状态累积导致的偶发失败。

### 74.3 结果
- `GUI SUITE: 30/30 scripts green`，共 145 项真实 GUI 断言；headless 全部通过。

## 75. v0.98.0：失焦即全渲染（Obsidian 语义）

### 75.1 差异与修复
- 之前活跃块只看 `state.selection`，编辑器失焦后光标所在行仍然显示源码；Obsidian 失焦时全部块渲染；
- 修复：模块内维护 `editorFocused`，`updateListener.focusChanged` 同步并重建装饰；`buildDecorations` 仅在聚焦时计算活跃行；创建编辑器时用 `view.hasFocus` 初始化。

### 75.2 真实 GUI 验证（3/3）
| 检查 | 结果 |
|---|---|
| 失焦时全部块渲染（无 `**`、无 `#`，加粗仍是加粗） | OK |
| 聚焦到加粗段落，该行显示源码 `**` | OK |
| 再次失焦，恢复渲染 | OK |

### 75.3 套件
- 新增 `gui-focus-render-check.mjs`；`GUI SUITE: 31/31 scripts green`，共 148 项真实 GUI 断言；
- jsdom 原型 harness 需要显式 `view.focus()` 才能断言活跃行（失焦即渲染是正确行为），已同步修正。

## 76. v0.99.0：活跃块范围（选区 / callout）

| 检查 | 结果 |
|---|---|
| 多行选区：覆盖行都显示源码（`**`、`` ` ``） | OK |
| 未覆盖的块保持渲染（callout widget 仍在） | OK |
| 单光标：只有所在行显示源码 | OK |
| 光标在 callout 正文：整个 callout 变源码（标题行显示 `[!tip]`） | OK |

### 76.1 说明
- 这四项是「实时预览」的活跃范围语义，实现上由 `activeLines` 覆盖选区行 + 块级 widget 的 `isActive` 判断共同决定；
- 用真实 GUI 断言后确认与 Obsidian 一致，本轮无代码改动；
- 套件 `GUI SUITE: 32/32 scripts green`，共 152 项真实 GUI 断言；headless 全部通过。

## 77. v0.100.0：Enter 语义与回归脚本健壮性

| 检查 | 结果 |
|---|---|
| 标题行末 Enter → 普通空行（无 `## `） | OK |
| 嵌套列表项 Enter → 同层级续写（`  - `） | OK |

### 77.1 说明
- 两者都由 `@codemirror/lang-markdown` 的 `insertNewlineContinueMarkup` 提供，本轮在真实 GUI 固定为回归项；
- 回归脚本新增 `evalWithEditor`：自动保存导致编辑器短暂卸载时自动重试，解决 `gui-keys-check` 偶发空指针。

### 77.2 套件
- 新增 `gui-enter-keys-check.mjs`；`GUI SUITE: 33/33 scripts green`，共 154 项真实 GUI 断言。

## 78. v0.101.0：快速输入不丢字（5/5）

| 检查 | 结果 |
|---|---|
| 快速连续输入 36 字符，编辑器内容完整 | OK |
| 磁盘内容与编辑器逐字一致 | OK |
| 输入后立刻 `Ctrl+S`，最新按键已落盘 | OK |
| 输入后立刻切文件，切走前已 flush | OK |
| 切回后内容仍在 | OK |

### 78.1 为什么专门测
- 0.93.0 给 `onChange` 加了 120ms 节流，理论上存在「最后一个字符还没传播就保存」的风险；
- 实测 `saveNow`（Ctrl+S）与 `destroy`（切换文件）都会先 flush，快速输入 36 字符无丢失。

### 78.2 回归脚本健壮性
- 探针文件改为每脚本独立命名（`_gui_keys.md` 等），避免命中宿主旧内容缓存；
- 关键读取（编辑器文本、行定位）统一加「带重试」包装；关键阶段前 `ensureReady()` 自动刷新并重开文件；
- 套件 `GUI SUITE: 34/34 scripts green`，共 159 项真实 GUI 断言。

## 79. v0.102.0：Obsidian LP 复刻对照表（PARITY.md）

### 79.1 产出
- 新增 `PARITY.md`：按「核心语义 / 折叠 / 编辑命令 / 块级元素 / 链接嵌入图片 / 属性面板与宿主能力 / 数据一致性与性能」七类，逐条列出 52 项 Obsidian Live Preview 行为的实现状态，并标注覆盖它的真实 GUI 回归脚本；
- 状态分三档：✅ 已实现并自动验证、🟡 部分实现（写明差异）、⛔ 不适用（写明宿主限制）；
- README 顶部加入指向该表的说明。

### 79.2 已知差异（如实记录）
| 项 | 差异 |
|---|---|
| 链接/嵌入点击跳转 | DSH 文档预览渲染器没有打开其它文件的宿主 API，改为复制目标 + 提示 |
| 外部链接悬停提示条 | 同上 |
| 属性（Properties）面板 | 渲染为卡片 + 点击进 YAML 源码；缺少类型下拉与「+ 添加属性」 |
| 图谱/反向链接/命令面板 | 宿主能力，不在渲染器范围 |
| Vim/Emacs 键位 | 未实现 |
| 图片拖拽缩放 | Obsidian 本身不支持（用 `\|宽度` 语法），本插件一致 |
| 深色主题 | 强调色按浅色主题近似，未单独调深色 |

### 79.3 回归
- `GUI SUITE: 34/34 scripts green`，共 159 项真实 GUI 断言；headless 全部通过。

## 80. v0.103.0：属性卡片逐行定位

### 80.1 改动
- `FrontmatterWidget` 记录每个属性行对应的文档行号，行上挂 `mousedown`（阻止冒泡）+ `click`（把光标放到该行行尾并聚焦）；
- 点击任意属性行后，frontmatter 整块切到源码态（沿用活跃块语义）。

### 80.2 真实 GUI 验证（4/4）
| 检查 | 结果 |
|---|---|
| 属性卡片列出全部属性（3 行） | OK |
| `tags` 渲染为胶囊（2 个） | OK |
| 点击第 3 行 → 光标落在第 4 行 `author: someone` | OK |
| 点击后 frontmatter 切到源码态 | OK |

### 80.3 连带修正
- `gui-click-edit-check2` 的 frontmatter 断言更新为「卡片消失且光标在 frontmatter 范围内」（行为从「进源码块首行」变为「进所点属性行」）；
- 套件 `GUI SUITE: 35/35 scripts green`，共 163 项真实 GUI 断言。

## 81. v0.104.0：聚焦黑框的真正原因与修复

### 81.1 现象
- 点进文档（编辑器获得焦点）后，预览面板外围出现一圈深灰点状虚线框；失焦则消失。

### 81.2 定位过程（真实实例 + Playwright）
- 扫描所有元素的计算样式，找 `outline/border` 为 dashed/dotted 且宽度 > 0 的节点：失焦时无命中，聚焦后命中 `.cm-editor.cm-focused`，`outline: rgb(33,33,33) dotted 1px`；
- 再遍历 `document.styleSheets` 中提及 dashed/dotted 的规则，定位来源为 `.ͼ1.cm-focused { outline: rgb(33,33,33) dotted 1px; }` —— CodeMirror 6 基础主题（baseTheme）自带的聚焦指示。

> 更正：此前曾判断这是「DSH 文档预览面板的焦点指示」，本次用样式规则反查证明是 CM6 基础主题，与 DSH 无关。

### 81.3 修复
- 原有 `.gh-md-cm6-lp :focus-visible { outline: none !important }` 等规则指向的是 `.cm-content`（该类就加在它身上）的后代，匹配不到 `.cm-editor` 自身；
- 新增显式规则覆盖 `.cm-editor` 的 `:focus` / `:focus-visible` / `.cm-focused` 三种状态。

### 81.4 回归
- 新增 `gui-outline-check.mjs`：聚焦后断言 `.cm-editor` 的 `outline-style === none`；
- 套件扩到 36 个脚本 / 165 项真实 GUI 断言。

## 82. v0.105.0：正文宽度与留白收紧

### 82.1 反馈
- 「表格和图片没有左右上下达到页面宽度，留白太过分了」。

### 82.2 改动
| 项 | 之前 | 现在 |
|---|---|---|
| 页边距（`.gh-md-document`） | `padding: 20px 28px` | `padding: 8px 8px` |
| 折叠沟槽（`.cm-content` 左内边距） | 22px | 18px |
| 表格 | `width:auto`（按内容收缩，Obsidian 行为） | `width:100%` + `table-layout:fixed` + 单元格 `word-break` |
| 图片 | `max-width:100%; max-height:320px` | 去掉高度上限，块级铺满整列 |

### 82.3 实测（真实 GUI，面板可用宽 629px）
- 页边距 8px；正文列 595px；表格 595px（完全对齐）；图片 591px；
- `![[图片|120]]` 的显式宽度仍生效（内联样式优先于 CSS）。

### 82.4 说明
- 这是**有意偏离 Obsidian**：原版表格按内容收缩、阅读区左右留白更宽；按用户偏好改为铺满。已在 `PARITY.md` 单独记录。

### 82.5 回归
- 新增 `gui-width-check.mjs`：断言表格/图片宽度与正文列一致、页边距 ≤ 10px；
- 套件扩到 37 个脚本 / 168 项真实 GUI 断言。

## 83. v0.106.0：按排版惯例重做页边距与行宽

### 83.1 背景
- 0.105.0 把页边距从 `20px 28px` 压到 `8px 8px`，被指出「矫枉过正」：需要的是有依据的留白，而不是一味收窄。

### 83.2 查到的依据（Butterick's Practical Typography）
| 来源 | 要点 |
|---|---|
| [Line length](https://practicaltypography.com/line-length.html) | 每行 **45–90 字符**（"2–3 alphabets"）最舒适；行宽应通过页边距来设定 |
| [Page margins](https://practicaltypography.com/page-margins.html) | 页边距由目标行宽反推；留白大不是问题（"Don't panic"）；想视觉居中时下边距比上边距大约 0.25 英寸；提到黄金比例 1.618 可作为版式比例 |

### 83.3 落地取值
| 项 | 取值 | 理由 |
|---|---|---|
| 左右页边距 | 24px | 629px 侧栏下正文列 563px ≈ 68–72 字符，落在 45–90 区间中部 |
| 上边距 / 下边距 | 24px / 39px（1.625） | 下边距 ≈ 上边距 × 黄金比例，接近 Butterick 的「下边距略大以视觉居中」 |
| 正文列上限 | `max-width:72ch` 居中 | 面板变宽时行宽不发散；窄面板时自动铺满不失宽度 |
| 表格 / 图片 | 铺满正文列 | 用户明确要求「达到页面宽度」，表格 `width:100%`、图片去掉限高 |

### 83.4 实测（真实 GUI，面板可用宽 629px）
- 左右 24px、上 24px、下 39px；正文列 563px；表格 563px；图片 559px；
- `gui-width-check.mjs` 断言：表格/图片与正文列一致、左右边距 20–36px、下/上边距比 ≈1.618。

### 83.5 回归
- 套件 37 个脚本 / 169 项真实 GUI 断言（本项 4 条）。

## 84. v0.107.0：高度贴合内容 + 取消宽度上限

### 84.1 反馈
- 0.106.0 之后仍有两点不满：**下方留白太多**、**页宽似乎有上限**。

### 84.2 根因
| 现象 | 根因 |
|---|---|
| 下方大块空白 | `.gh-md-cm6-document{min-height:60vh}` 强制撑高 + `.cm-editor{height:calc(100vh - 210px)}` 固定高度 → 短文档下方必然空一大片 |
| 宽度被封顶 | 0.106.0 给 `.cm-content` 加了 `max-width:72ch; margin:auto` |

### 84.3 改动
| 项 | 之前 | 现在 |
|---|---|---|
| 文档容器最小高 | `min-height:60vh` | `min-height:0` |
| 编辑器高度 | `height:calc(100vh - 210px)` | `height:auto; max-height:calc(100vh - 190px)`（scroller 同样 `max-height`） |
| 正文列 | `max-width:72ch; margin:auto` | 无上限，铺满可用宽度 |
| 页边距 | `24px 24px 39px` | `16px 24px 24px` |

### 84.4 实测
- 窄面板（可用宽 629px）：正文列 581px（=629−48），表格 563px、图片 559px（=正文列减去折叠沟槽）；
- **3 行短文档**：编辑器高度 118px，最后一行到边框仅 4px（不再有 60vh 空白）；
- 长文档仍 `max-height` 内滚动，虚拟渲染保持不变（由 `gui-perf-regression`、`gui-longdoc-render-check` 守）。

### 84.5 回归
- `gui-width-check.mjs` 扩到 7 条断言：新增「短文档高度贴合内容（≤260px、末尾间隙 ≤60px）」与「正文列不被上限卡住」；
- 套件保持 37 个脚本 / 172 项真实 GUI 断言。

## 85. v0.108.0：行距/标题间距按真实 Obsidian 实测对齐

### 85.1 实测数据（Obsidian 1.15.1，CDP 读 `.cm-line` 行盒）
| 元素 | font-size | line-height | padding-top | 行盒高 |
|---|---|---|---|---|
| 正文 | 16px | 24px (1.5) | 0 | 24 |
| H1 | 25.888px | 31.07 | 16px | 48 |
| H2 | 23.392px | 28.07 | 16px | 45 |
| H3 | 21.088px | 27.41 | 16px | 43 |
| 列表 | 16px | 24px | 1.2px | 26 |

Obsidian 变量：`--line-height-normal: 1.5`、`--p-spacing: 1rem`、`--h1-size: 1.618em` / `--h2-size: 1.462em` / `--h3-size: 1.318em`、`--h1-line-height: 1.2`。

### 85.2 修正
| 项 | 之前 | 现在 |
|---|---|---|
| 正文行高（`readLine` 默认） | 1.65 | **1.5** |
| 标题上内边距 | 0 | **16px**（h1–h5） |
| 列表行内边距 | 0 | 0（bullet widget 已带 ~3px，实测 27px） |

### 85.3 折叠箭头说明（回答「小三角是 Obsidian 的吗」）
- 小三角是**本插件的折叠箭头**，不是 Obsidian 的元素；
- Obsidian 的对应实现是 `.collapse-indicator`：实测 `opacity: 0`、宽 15px、悬停行才显示；
- 本插件同样是「默认 `opacity:0` → 悬停该行 `0.9` → 折叠后常显」，已用断言固定（见 85.4）。

### 85.4 验证
- 新增 `gui-spacing-check.mjs`：正文 24px、H1 含 16px 上内边距且行盒 46–50、H2 43–47、列表 25–28、**箭头未悬停时 opacity 全为 0**、悬停后 >0.5；
- 套件扩到 38 个脚本 / 178 项真实 GUI 断言。

## 86. v0.109.0：表格与图片边距对齐 Obsidian（实测参数）

### 86.1 实测方法
- 生成探针 `_lp_media_probe.md`（前后段落 + 2×2 表格 + 宽图 1200×400 + 小图 200×120 + Markdown 图片）；
- Obsidian 以 `--remote-debugging-port=9333` 启动，Playwright `connectOverCDP` 读取 `.cm-table-widget` / `table` / `th` / `td` / `.table-cell-wrapper` / `img` / `.internal-embed` 的计算样式与盒模型；
- 再在 DSH 验证实例里对同一份探针做同样的测量，逐项比对。

### 86.2 Obsidian 实测参数
| 元素 | 值 |
|---|---|
| `.cm-table-widget` | `margin: 0 -16px; padding: 16px; display: block` |
| `table` | `border-collapse: collapse; margin:0; padding:0; font-size:16px; line-height:20.8px; width:内容宽(131px)` |
| `th` / `td` | `padding: 0`（内层 `.table-cell-wrapper` 才是 `padding: 4px 8px`）、`border: 1px solid rgb(228,228,228)`、`th font-weight:600` |
| 单元格行高 | `td` 高 29.8px = 20.8 行高 + 8 上下内边距 + 1 边框 |
| `img` | `border-radius: 4px; margin: 0; max-width: 100%; max-height: none; display: block`；宽图 700px（列宽）、小图 200px（原尺寸） |
| `.image-wrapper` / `.internal-embed` | `display: inline-flex; margin: 0` |

### 86.3 本插件改动
| 项 | 之前 | 现在 |
|---|---|---|
| 表格外层 | `margin:6px 0; overflow-x:auto` | `margin:0; padding:16px 0; overflow-x:auto` |
| 表格本体 | `width:100%!important; table-layout:fixed; font-size:.95em` | `width:auto; table-layout:auto; font-size:1em; line-height:1.3` |
| 单元格 | `.5px` 边框、`padding:6px 12px` | `1px solid #e4e4e4`、`padding:4px 8px` |
| 单元格 min-width | 受宿主全局规则影响（`min-width:90px`、`white-space:pre`），导致表格虚胖 | 显式 `min-width:0!important; white-space:normal!important`（表宽 215px→119px） |
| 图片 | `margin:8px 0; border-radius:6px` | `margin:0; border-radius:4px` |

### 86.4 验证（真实 GUI，7/7）
| 检查 | 结果 |
|---|---|
| 表格外层 16px 上下留白 | OK |
| 单元格 `padding: 4px 8px` | OK |
| 单元格边框 `1px solid rgb(228,228,228)` | OK |
| 表格按内容收缩（119px < 列宽 563px） | OK |
| 图片圆角 4px | OK |
| 小图保持原始尺寸（200px） | OK |
| 宽图铺满正文列（559px ≈ 563px） | OK |

### 86.5 套件
- 新增 `gui-media-check.mjs`；同步把 `gui-width-check.mjs` 的表格断言改为「按内容收缩」；
- 套件扩到 39 个脚本 / 185 项真实 GUI 断言。

## 87. v0.110.0：表格单元格行高/对齐、图片宽度语法对齐 Obsidian

### 87.1 补充实测（Obsidian 1.15.1）
| 项 | 实测值 |
|---|---|
| `.cm-table-widget` | `margin:0 -16px; padding:16px; overflow-x:auto` |
| 单元格行高 | 29.8px（`line-height:20.8px` + `padding:4px 8px` + collapse 后 1px 边框） |
| 对齐 | `th`/`td` 上 `text-align: start \| center \| end`（由分隔行 `:---:` 决定） |
| 同内容表格宽度 | 131px（内容宽，非列宽） |
| `![[img\|300]]` | `<img width="300">`，计算宽 300px、圆角 4px、margin 0 |
| Markdown 图片（无宽度） | 宽 700px = 列宽，`max-width:100%` |

### 87.2 本插件修正
| 项 | 之前 | 现在 |
|---|---|---|
| 单元格行高 | 33px（宿主 `.gh-md-document td{line-height:24px}` 覆盖了继承的 1.3） | **29.8px**（单元格显式 `line-height:1.3!important`、`font-size:16px`） |
| 表格宽度 | 180–215px（受 `min-width:90px`/`white-space:pre` 影响） | **131px**，与 Obsidian 完全一致 |
| 对齐 | 已支持（内联 `text-align`） | 保持 |
| 图片宽度语法 | 已支持（内联 width） | 保持（实测 300px） |

### 87.3 验证（真实 GUI，11/11）
| 检查 | 结果 |
|---|---|
| 表格外层 16px 上下留白 | OK |
| 单元格 `padding:4px 8px` | OK |
| 单元格边框 `1px solid rgb(228,228,228)` | OK |
| 表格按内容收缩（131px） | OK |
| 外层 `overflow-x:auto` | OK |
| 单元格行高 29.8px（±1.2） | OK（29.8） |
| `:---:` → left/center/right | OK |
| 图片圆角 4px | OK |
| 小图保持原尺寸（200px） | OK |
| 宽图铺满正文列（559px≈563px） | OK |
| `![[img\|300]]` → 300px | OK |

### 87.4 套件
- `gui-media-check.mjs` 扩到 11 条断言；套件 39 个脚本 / 189 项真实 GUI 断言。

## 88. v0.111.0：整行图片改为块级 widget（消除行盒空白）

### 88.1 现象与根因
- 现象：图片下面留白明显偏大（用户截图）；
- 根因：整行图片是 **inline widget**，行盒高度 = 图片高 + 行距（24px）+ 两个 `img.cm-widgetBuffer`（各 16px）；实测 186.3px 的图片占掉 234.3px。

### 88.2 迭代过程（真实 GUI 实测）
| 方案 | 行盒高度 |
|---|---|
| 原始（inline widget） | 234.3px（图片 186.3 + 48） |
| 给该行加 `line-height:0` | 218.3px |
| 再把 `.cm-widgetBuffer` 压成 0 高 | 198.3px |
| **整行图片改用 `Decoration.replace({block:true})`** | **187.6px**（≈图片高度） |

### 88.3 改动
- `buildDecorations`：整行只匹配到 `![[xxx.png]]` / `![alt](xxx.png)` 且 !isActive 时，用块级 `ImageWidget` 替换整行；
- **只对图片扩展名生效**（png/jpg/jpeg/gif/svg/webp/avif/bmp），`![[笔记]]` 仍走 `EmbedWidget`（首次实现漏了这个判断，导致嵌入笔记渲染回归，已修）；
- 光标进入该行（isActive）时仍显示原始 `![[...]]` 源码，符合 LP 语义。

### 88.4 验证
- 新增 `gui-fig-spacing-check.mjs`：两张图片各占「图片高度 ±4px」、图片两侧无空行间隙、首次打开即挂载 LP 编辑器；
- 套件 40 个脚本；`GUI SUITE: 40/40 scripts green`。

## 89. v0.112.0：只读渲染路径的表格顶格修复

### 89.1 现象
- 用户反馈「表格首列顶格（文字贴住左边框）」；
- CM6 路径实测首列内边距是 `4px 8px`（文字距边框 8.5px），没有问题；
- 问题在**只读渲染路径**（callout 正文、`![[笔记]]` 嵌入正文、静态预览）——那套 CSS 里有 `th:first-child,td:first-child{padding-left:0}` 与 `td:last-child{padding-right:0}`（GitHub 风格），首列文字直接贴边。

### 89.2 修正（两条路径统一到 Obsidian 实测值）
| 项 | 之前（只读路径） | 现在 |
|---|---|---|
| 单元格内边距 | `10px 14px`，首列 `padding-left:0`、末列 `padding-right:0` | `4px 8px`（无首末列特例） |
| 边框 | `.5px` 仅上下边 | `1px solid #e4e4e4` 四边 |
| 字号 / 行高 | `14px` / `24px` | `16px` / `1.3` |
| 表格宽度 | `width:100%` + `min-width:560px`（强制横向滚动） | `width:auto; max-width:100%`，窄栏自动换行 |
| 表头 | `white-space:nowrap`、`min-width:90px` | 正常换行、无最小列宽 |
| 图片圆角 | `var(--dsw-radius-md)` | `4px` |

### 89.3 验证（真实 GUI，13/13）
- 新增两条断言：**callout 内表格首列内边距 = `4px 8px`**（实测 4px 8px、字号 16px、左边框 1px）、**callout 内表格按内容宽度**（99px < 列宽 563px）；
- `gui-media-check.mjs` 13 条断言全过；套件 40 个脚本 / 200 项真实 GUI 断言。

## 90. v0.113.0：图片双击 lightbox（对齐 Obsidian）

### 90.1 Obsidian 实测（1.15.1，CDP）
| 项 | 实测 |
|---|---|
| 悬停光标 | `zoom-in` |
| 单击（LP） | 不放大、不显示源码 |
| 双击（LP） | 打开 `.lightbox` |
| 阅读视图单击 | 打开 `.lightbox` |
| 结构 | `.lightbox` / `.lightbox-bg`（`rgb(0,0,0)` + inline `opacity:.9`）/ `.lightbox-content` / `.lightbox-titlebar`（只有文件名文字，无按钮） |
| 尺寸 | 1200×500 的图渲染成 1216×516（按视口等比适配） |
| 滚轮 | 无缩放（宽度/transform 不变） |
| 关闭 | 点背景关闭（实测 true）、Esc 关闭 |

### 90.2 实现
- `ImageWidget`：移除「单击开全屏」；新增 `dblclick` → `openImageLightbox(src, title)`；
- lightbox：`position:fixed; inset:0`，`.gh-md-lightbox-bg` `rgb(0 0 0 / 90%)`，图片 `max-width:96vw; max-height:92vh`，顶部文件名标题；点背景/内容空白或 Esc 关闭；
- 单击保持 `ignoreEvent() === true`（不进入源码），这样双击序列不会被「单击→切源码」打断——与 Obsidian 的单击语义一致；
- 若要编辑图片语法：用方向键把光标移到该行（活跃行仍显示 `![[...]]`）。

### 90.3 验证（真实 GUI，8/8）
| 检查 | 结果 |
|---|---|
| 悬停 `zoom-in` | OK |
| 单击不开灯箱、不显示源码、图片仍渲染 | OK |
| 双击打开灯箱（fixed、1 个实例） | OK |
| 背景 `rgba(0,0,0,0.9)` | OK |
| 标题显示文件名 `_probe_lb.png` | OK |
| 图片按视口适配（1200×500） | OK |
| Esc 关闭 | OK |

### 90.4 套件
- 新增 `gui-image-lightbox-check.mjs`；`behavior-check5` 的图片断言同步改为「单击保持图片 / 双击开灯箱 / Esc 关闭」；套件 41 个脚本。

## 91. v0.114.0：图片放大可靠性（连击检测 + callout 图片）

### 91.1 用户反馈
- 「很多时候单击没有得双击，有的时候又没反应，有的时候单击又行了」。

### 91.2 三个根因
| 根因 | 细节 |
|---|---|
| widget 级 `dblclick` 不可靠 | CM6 每次重建装饰会创建新的图片 widget DOM；如果第一次点击触发了重建，第二次点击落在新节点上，浏览器不会补发 `dblclick` |
| 单击切源码 | 早先版本单击会让该行进入活跃态（显示 `![[...]]`），图片消失，第二次点击自然落空 |
| callout 内图片没渲染 | callout 正文由只读渲染器生成，`![[图片]]` 只输出字面量文本（实测 innerHTML 为 `<p>![[_probe_z.png]]</p>`），连 `<img>` 都没有 |

### 91.3 修法
- **document 级连击检测**（`installImageLightbox`）：capture 阶段监听 `click`，匹配 `.gh-md-document` 内的 `img`，同 `src` + 500ms 内 + 坐标差 < 14px 即开灯箱；不依赖 widget 存活；
- 灯箱 UI 移到 `client.js`（两条渲染路径共用），bundle 只保留 `ignoreEvent`，不再自建灯箱；
- callout 正文里把 `![[图片]]` 文本节点替换成 `<img>`（支持 `|宽度`），并对图片的 mousedown/click 做隔离，避免点击把 callout 切成源码态。

### 91.4 验证（真实 GUI，4/4）
| 检查 | 结果 |
|---|---|
| 连续 3 次「两次快速单击」都打开灯箱 | OK 3/3 |
| 单击不打开灯箱 | OK |
| callout 内图片可渲染并双击放大 | OK（innerHTML 为真实 `<img>`） |
| 连续 5 次重复双击都打开 | OK 5/5 |

### 91.5 套件
- 新增 `gui-zoom-stability-check.mjs`；`gui-image-lightbox-check.mjs` 的 dblclick 场景继续覆盖；套件 42 个脚本。
