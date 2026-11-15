# Obsidian Live Preview 复刻对照表

本文件逐项列出 Obsidian **Live Preview（实时预览）** 的行为，以及本插件（`@local/dsh-github-md`）的实现状态和对应的真实 GUI 回归脚本。

- ✅ 已实现并自动验证
- 🟡 部分实现（说明差异）
- ⛔ 不适用（DSH 宿主限制，非渲染器职责）

回归套件：`node .dsh-scratch/run-gui-suite.mjs`（真实 DSH 实例 + Playwright，34 个脚本 / 159 项断言，全部通过）。

## 一、核心语义

| # | Obsidian 行为 | 状态 | 说明 / 回归脚本 |
|---|---|---|---|
| 1 | 光标所在块显示 Markdown 源码标记，其余块保持渲染 | ✅ | `gui-lp-semantics`、`gui-multiselect` |
| 2 | 编辑器**失焦时所有块都渲染**（无活跃块） | ✅ | `gui-focus-render-check` |
| 3 | 活跃范围 = **整个选区**；跨行选区覆盖的行都显示源码 | ✅ | `gui-multiselect-check` |
| 4 | 块级结构（callout/代码块/表格）被触及时**整块**回到源码 | ✅ | `gui-multiselect-check`、`gui-click-edit-check` |
| 5 | 点击渲染态文字，光标落在点击处（不是行首） | ✅ | `gui-caret-check` |
| 6 | 边打边渲染（输入 `# `、`- `、`> `、`**x**` 立刻生效） | ✅ | `gui-live-format-check` |
| 7 | 中文输入法组合输入（composition）安全 | ✅ | `gui-lp-semantics` |

## 二、折叠

| # | Obsidian 行为 | 状态 | 说明 / 回归脚本 |
|---|---|---|---|
| 8 | 标题左侧折叠箭头（悬停显示），点击折叠到下一个同级/更高级标题 | ✅ | `gui-heading-fold-check` |
| 9 | 无序列表项折叠（悬停箭头，按缩进算范围） | ✅ | `gui-list-fold-check` |
| 10 | 有序列表项折叠 | ✅ | `gui-ordered-fold-check` |
| 11 | 任务列表项折叠 + 渲染态隐藏 `- ` 只留复选框 | ✅ | `gui-task-fold-check` |
| 12 | 折叠状态**按文件记忆**，自动保存/外部刷新重挂载后恢复 | ✅ | `gui-fold-persist-check` |
| 13 | 折叠不修改文档、不移动光标 | ✅ | 上述四个测试均断言 |

## 三、编辑命令

| # | Obsidian 行为 | 状态 | 说明 / 回归脚本 |
|---|---|---|---|
| 14 | `Enter` 标题后新建普通行；列表续写（含嵌套同层）；引用续写 `> ` | ✅ | `gui-enter-keys-check`、`gui-behavior-check`、`gui-embed-quote-check` |
| 15 | 空列表项/空引用行 `Enter` 退出列表/引用 | ✅ | `gui-editing-niceties` |
| 16 | 列表内容开头 `Backspace` 去掉整段标记 | ✅ | `gui-keys-check` |
| 17 | `Tab`/`Shift+Tab` 4 空格缩进（列表与段落）；代码块内也缩进 | ✅ | `gui-keys-check`、`gui-keys-check2` |
| 18 | `Ctrl+B` / `Ctrl+I` 可**切换**加粗/斜体（可取消） | ✅ | `gui-keys-check` |
| 19 | `Ctrl+K` 插入 `[[]]` wikilink | ✅ | `gui-behavior-check2` |
| 20 | `Ctrl+Enter` 勾选/取消任务 | ✅ | `gui-behavior-check2` |
| 21 | `Ctrl+Shift+K` 删除整行 | ✅ | `gui-keys-check2` |
| 22 | `Ctrl+Shift+V` 纯文本粘贴 | ✅ | `gui-keys-check2` |
| 23 | `Ctrl+S` 立即保存 | ✅ | `gui-behavior-check4`、`gui-fast-typing-check` |
| 24 | `Shift+Enter` 硬换行（行尾两空格） | ✅ | `gui-behavior-check2` |
| 25 | 自动配对括号/引号，光标停在中间 | ✅ | `gui-typing-check` |
| 26 | `Alt+点击` 追加光标（多光标同时输入） | ✅ | `gui-alt-multicursor-check` |
| 27 | `Ctrl+Z`/`Ctrl+Y` 撤销重做，**跨自动保存重挂载仍有效** | ✅ | `gui-behavior-check`、`gui-behavior-check3` |
| 28 | 自动保存后光标/焦点保持 | ✅ | `gui-behavior-check` |

## 四、块级元素

| # | Obsidian 行为 | 状态 | 说明 / 回归脚本 |
|---|---|---|---|
| 29 | 表格渲染态**单元格可直接编辑**，修改即时进文档并落盘 | ✅ | `gui-behavior-check2`、`gui-behavior-check4` |
| 30 | 表格 `Tab`/`Shift+Tab` 在单元格间移动（末格不跳出） | ✅ | `gui-behavior-check4`、`gui-table-code-keys` |
| 31 | 表格右键菜单：插入/删除行列、左中右对齐 | ✅ | `gui-behavior-check4`、`gui-visual-check` |
| 32 | 代码块：围栏内 `Enter` 不跳出、语言标签常显、复制按钮 | ✅ | `gui-table-code-keys`、`gui-behavior-check2/3`、`gui-visual-check` |
| 33 | callout：类型色调、SVG 图标、标题折叠 `-`/`+`、正文渲染 Markdown | ✅ | `gui-visual-check`、`gui-click-edit-check`、`gui-inline-features` |
| 34 | 完成任务显示删除线、无圆点、复选框勾选态 | ✅ | `gui-visual-check` |
| 35 | 引用块紫色左边线、嵌套多层 | ✅ | `gui-visual-check`、`gui-behavior-check3` |
| 36 | 分隔线、frontmatter 属性卡片、脚注定义渲染为上标 | ✅ | `gui-visual-check`、`gui-click-edit-check2` |

## 五、链接 / 嵌入 / 图片

| # | Obsidian 行为 | 状态 | 说明 / 回归脚本 |
|---|---|---|---|
| 37 | `[[笔记\|别名]]` 只显示别名；`==高亮==`、`<kbd>` 等行内 HTML | ✅ | `gui-inline-features` |
| 38 | `![[笔记]]` **内联渲染**目标笔记内容 | ✅ | `gui-embed-render-check` |
| 39 | 悬停 `[[笔记]]` 显示页面预览浮层 | ✅ | `gui-hover-preview-check` |
| 40 | 图片：`![[img]]`/`![alt](img)`、`\|宽度` 语法、点击全屏预览 | ✅ | `gui-inline-features`、`gui-behavior-check5` |
| 41 | 粘贴/拖入图片 → 落盘到笔记目录并插入 `![[文件名]]` | ✅ | `gui-asset-paste-check` |
| 42 | 点击链接/嵌入：**打开目标笔记** | ⛔ | DSH 的文档预览渲染器没有「打开其它文件」的宿主 API；改为复制目标并提示（`gui-behavior-check5`、`gui-embed-quote-check`） |
| 43 | 悬停外部链接显示 URL 提示条 | ⛔ | 同上，宿主无跳转能力，仅复制 |
| 44 | 图片拖拽缩放 | ⛔ | Obsidian 本身不支持拖拽缩放（用 `\|宽度` 语法），本插件同样只支持语法 |

## 六、属性面板 / 宿主能力

| # | Obsidian 行为 | 状态 | 说明 / 回归脚本 |
|---|---|---|---|
| 45 | Properties 面板（增删属性行、类型切换、tag 胶囊） | 🟡 | 属性卡片：**点击某一行直接定位到该属性的 YAML 行**、tag 显示胶囊（`gui-properties-check`）；仍缺属性类型下拉与「+ 添加属性」交互（宿主未提供对应 UI 能力） |
| 46 | 图谱视图、反向链接、命令面板、插件生态 | ⛔ | 属宿主应用能力，不在 Markdown 渲染器范围内 |
| 47 | Vim/Emacs 键位模式 | ⛔ | 未实现；宿主侧如需可另行接入 CM6 vim 扩展 |

## 七、数据一致性 / 性能

| # | 行为 | 状态 | 说明 / 回归脚本 |
|---|---|---|---|
| 48 | 自动保存；磁盘内容与编辑器内容逐字一致 | ✅ | `gui-fast-typing-check`、`gui-persist-check` |
| 49 | 关闭后重开，编辑内容仍在 | ✅ | `gui-persist-check` |
| 50 | 其它程序改文件 → 预览刷新，且保持焦点/光标 | ✅ | `gui-behavior-check5` |
| 51 | 大文档可用：6600 行/100 KB 单次编辑 < 50 ms | ✅ | `gui-perf-regression` |
| 52 | 长文档**任意滚动位置**都正确渲染（无空白、无残留源码） | ✅ | `gui-longdoc-render-check` |

## 已知与 Obsidian 的视觉差异

- 主题色：紫色系（wikilink/tag/引用/callout 强调色）按 Obsidian 默认浅色取近似值，未针对深色主题单独调色；
- 排版：行高、段落间距按 Obsidian 默认变量的近似值实现，未逐像素对齐；
- 没有 Obsidian 的「行内标题（文件名）」与「更多菜单（⋯）」等宿主级 UI。

## 与原版 Obsidian 的有意差异（按用户偏好）

- **表格宽度**：与 Obsidian 一致——按内容收缩（实测单元格 4px/8px 内边距、1px #e4e4e4 边框、外层 16px 上下留白）。若需要铺满整列可自行加 `width:100%!important`。
- **图片宽度/边距**：与 Obsidian 一致——圆角 4px、无 margin、`max-width:100%`（小图保持原尺寸、宽图铺满正文列），仍支持 `\|宽度` 语法指定尺寸。
- **页边距/宽度**：左右 24px、上 16 / 下 24px；正文列**不设宽度上限**，铺满面板（表格、图片同样铺满）。这是按用户反馈定的（不要定宽居中、下方不要大片空白），与 Obsidian 的「可读行宽约 700px」默认不同。
