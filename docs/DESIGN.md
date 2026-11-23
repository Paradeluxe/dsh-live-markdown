# DESIGN — DSH GitHub Markdown：一等公民 Markdown 文档编辑器

> **状态（v0.16.0，2026-11-13）**：设计已收敛。编辑器只保留**一个**编辑面（Markdown 源码 +
> 语法着色 + 软换行 + Ctrl+S），不再有「实时 / 源码」切换，也没有文件选择器与设置页；
> 入口只保留预览头部的「编辑」，点击后**原地换页**（预览 tab 变成编辑器 tab），「回预览」换回来。
> 下文 §2–§7 的「阅读 / 编写 / 分栏」与内嵌编辑条是历史设计，已由上述实现取代，保留作背景参考。
>
> 目标：把「GitHub 风格 Markdown」从一个寄生在文档预览下拉框里的渲染器，变成右栏里一个**窄屏优先、真正好用**的一等公民编辑器。
> 读者：实现者（Lead）。有冲突时以本文的**非协商项**（§15.1）为准，不要用「差不多」的实现代替。

---

## 0. 本文的地位与已知替换

- 这是 **Operate 模式**的界面（用户在执行任务：读一篇 README、改一段、存盘）。判断标准是「熟悉的工具能否立刻被信任」，不是表达欲。
- 设计语言取自 DSH 自身的 token 与几何（见 §7），**不引入自创色板、自创字体、自创控件词汇**。
- `impeccable context` 报告 `NO_PRODUCT_MD`。本插件此前只有 `.impeccable/critique/` 快照，没有 PRODUCT.md。作为**带着固定 brief 的子代理**，我没有向用户发起 `init` 访谈，改为从 brief + 代码 + 截图 + 平台文档推导，并把假设写进 §1.3。补做 `/impeccable init` 是合理的后续动作，不阻塞本次实现。
- 分数基线：现有 critique 快照 20/40，P0 = 窄栏构图无下限，P1 = 错误反馈过弱、键盘可达性缺失。本文的验收清单（§13）逐条回应这些项。

---

## 1. 产品判断

### 1.1 一句话

**这是一个「读优先的 Markdown 文档编辑器」**：打开就是渲染好的文档，需要改的时候切到编写，改完存盘，再切回预览——始终在右栏里，始终只有**一个**内容面。

### 1.2 三条不会让步的原则

1. **一次只有一个内容面。** 400px 里不同时出现目录 + 源码 + 预览 + 大纲。视图切换是**模式**（阅读 / 编写 / 分栏），文件和章节是**整面浮层**（sheet），不是常驻列。
2. **桌面软件，不是网页。** 控件 28px、行高 28px、圆角 8px、hairline `border-l1`、hover 用 `interactive-bg-hover`。用户不需要学习我们的控件，只应该感到「这就是 DSH 自己的东西」。
3. **状态永远比装饰响。** 保存状态、错误、加载、空态是画面里最清楚的元素；不用彩色小字表达严重性，用位置 + 图标 + 明确的动作。

### 1.3 三个假设（brief 未明说，我按此定稿）

- **A1**：右栏在正常使用中宽度 **320–520px**，全屏时 **≥ 1100px**。「~400px」按 **400px 参考宽**实现，所有尺寸按**容器宽度**（`container-type: inline-size`）响应，不按视口。
- **A2**：Profile 里已存在第三方通用编辑器 `dsh-editor`（`E:/hermes_playground/dsh-plugins/dsh-editor`，其「编辑器」项出现在预览的「打开方式」下拉里）。**我们不与它竞争「通用文本编辑器」**，边界见 §1.4。它已占的名字/入口我们不改。
- **A3**：用户的「太简陋了」指的是**当前这一层壳**（一个编辑条 + 五个 12px 按钮 + 裸 textarea），不是渲染质量。渲染管线（marked + DOMPurify + KaTeX + Shiki + 脚注 + 表格）保留不动，**只重做壳与入口**。

### 1.4 与 `dsh-editor` 的边界（写进 README 承诺，不写进 UI）

| | dsh-editor（通用） | 本插件（本文） |
|---|---|---|
| 对象 | 任意文本文件 | 只 `.md` / `.markdown` / `.mdx` |
| 默认面 | 源码 | **渲染后的文档** |
| 强项 | 行号、换行、重载、保存 | GitHub 保真渲染、结构（大纲）、写作态排版 |
| 心智 | 「打开一个文件」 | 「读一篇文档，顺手改一句」 |

**推论（实现必须遵守）**：本插件**不再**向「打开方式」下拉贡献任何名为「编辑器」的项，**不再**在预览正文里内置编辑条。预览只有一个编辑入口：右栏预览头部的「编辑」动作（§2.2 L2）。

---

## 2. 入口模型（唯一真相）

### 2.1 地基：一个 tab 类型

本插件的编辑器 = 右栏的**一个页类型（page kind）**，不是渲染器选项、不是主区 View、不是浮窗。

```js
// 注册契约（字段名以 @deepseek-ai/dsh-client-ui-sidebar-right 的 ctx.sidebarRightTabs.register 为准）
ctx.sidebarRightTabs.register({
  id: '@local/dsh-github-md/editor',
  kind: 'markdown-editor',
  // 不给 patterns：这是「页」，按 kind 打开，不认领资源地址
  title: () => t('editorTitle'),        // 兜底标题；实际标题见下
  guide: [{
    id: 'markdown-editor',
    icon: EditorGlyph,                  // 见 §8.1
    label: () => t('editorTitle'),
    description: () => t('editorDescription'),
    order: 20,
  }],
  keepMounted: true,                    // 草稿在切 tab / 切会话 / 收起侧栏时不丢
})

// 正文（keyed slot，key = id）
ctx.slots.register({ name: 'sidebar.right.pane.tab', key: '@local/dsh-github-md/editor' }, EditorBody)
// 动态标题（keyed slot，key = id）：把 tab 名换成文件名 + 未保存点
ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: '@local/dsh-github-md/editor' }, EditorTitle)
```

- **不给 `patterns`**、**不给 `multiple`**：每个分栏最多一个编辑器 tab（平台按 kind 去重）。**这就是「内部不再有多标签条」的机制保证**——旧的 `gh-wb-tabs` 必须删掉。
- **标题是文件名，不是产品名**：`EditorTitle` 渲染 `FileTypeIcon(md) + README.md (+ 未保存点)`。理由：它替代的正是那张 `README.md` 预览 tab，名字不变 → 「就地切换」的心智成立。
- **`package.json` 必须新增**：`dsh.client.inject` 加入 `"@deepseek-ai/dsh-client-ui-sidebar-right"`（与 `dsh-client-ui-sidebar-documentpreview` 的做法一致）。缺这条，`ctx.sidebarRightTabs` / `ctx.sidebarRight` 都不存在。

### 2.2 三个入口，按优先级

**L2 · 上下文入口（主路径，占日常 90%）**
席位：`sidebar.right.tab.document.actions`（Session 作用域 list，owner prop `absolutePath`，渲染在预览头部自有控件之后）。
只在 `absolutePath` 后缀为 `.md|.markdown|.mdx` 时渲染一个 28px 动作：图标 16 + 文案「编辑」。

```js
tab.actions.openTab('markdown-editor', {
  replaceTab: true,                      // 就地替换这张预览 tab（位置、栏位不变）
  params: { path: absolutePath },
})
```

预览 tab **原地变成**编辑器 tab —— 一条历史、无位置跳动。退出即反向 `replaceTab` 回预览（§6.7）。

**L1 · 发现入口（全局，永远找得到）**
引导页（guide）卡片。点击 = `openTab('markdown-editor', { replaceTab: true })` + `tab.actions.close()`（平台文档规定的「引导页让位」写法），一次点击直接进编辑器，不经过二次确认页。
卡片几何用宿主自己的规格（宽 380/max 100%、min-height 56、padding 14 20、gap 14、圆角 `--dsw-radius-xl`（20）、图标 26、标题 14/1.4、描述 11/1.4），我们只提供图标与两份文案。**不自定义引导卡**（少一个会漂移的界面）。

**L3 · 空态入口（没有文件时）**
编辑器自己打开时若无可显示文件（引导页进的、或上次文件已不存在），显示 §6.1 的空态：主按钮「打开文件」→ 文件 sheet；最近文件 chips。

**明确不做（并说明原因，免得被"补充"）**

- ❌ 不在 composer footer / 输入框活动位 / 左栏底部加全局按钮：这些席位与文件无关，会变成常驻的哑按钮，违反「入口要贴着对象」。
- ❌ 不注册全局快捷键（本 pass 无 `ctx.commands` 接线）。`⌘/Ctrl+S` 只在编辑器内生效。
- ❌ 不保留「打开方式」里的编辑器项（§1.4）。

### 2.3 入口验收

- 打开 `README.md` 预览 → 头部出现「编辑」→ 点击 → **同一位置**变成编辑器，文件名不变，无新 tab 产生。
- 右栏「+」→ 引导页出现「Markdown 编辑器」卡 → 点击 → 编辑器出现并**替换**引导页（只多一条历史，不是两条）。
- 编辑器开着时再次点预览头「编辑」→ 聚焦已有编辑器 tab（平台去重），不产生第二个。
- 从引导页进、工作区无 `.md` → 空态 + 「打开文件」可用，不报错、不白屏。

---

## 3. 组件层级（唯一编辑器）

```
<EditorRoot .gh-mde>                container-type:inline-size；height:100%；flex column
├─ <DocBar .gh-mde-bar>             role=toolbar  h=40
│  ├─ <FileChip>                    文件名 + ▾，aria-haspopup=dialog
│  ├─ <Spacer>
│  ├─ <ViewSeg>                     role=tablist：阅读 | 编写 (| 分栏，仅 ≥720)
│  ├─ <SaveSlot>                    固定 52×28；clean 时为空
│  └─ <ExitButton>                 ≥520 文案「预览」，<520 图标 28
├─ <Content .gh-mde-content>         flex:1 min-height:0；aria-busy
│  ├─ 阅读：.gh-mde-read > .gh-md-document        （复用现有渲染管线）
│  ├─ 编写：.gh-mde-write > textarea
│  └─ 分栏：.gh-mde-split > source | divider | preview
├─ <StatusStrip .gh-mde-status>     h=26；role=status aria-live=polite
│  └─ 失败时替换为 <ErrorRow .gh-mde-error>  h=32；role=alert
└─ <Sheet .gh-mde-sheet>            文件 / 大纲；role=dialog aria-modal，覆盖整个 body
   ├─ header（标题 + 计数 + 刷新 + 关闭）
   └─ body（树 / 大纲列表）
```

被删除的旧结构（必须从 client.js 移除，含 CSS 与文案）：`.gh-md-editbar*`、`.gh-md-edit-error`、`.gh-md-source`、`WorkbenchBody`、`WorkbenchIcon`、`inactiveLabel`、`WORKBENCH_ID`、`workbenchHeadings` 之外的整套 `.gh-wb*`（`workbenchHeadings` 逻辑本身留给大纲复用）、`window.confirm`、`beforeunload`。

---

## 4. 窄屏布局（参考 400px；320–519 同一套规则）

```
┌─────────────────────────────────────────────────────────┐
│ ▸ 宿主 tab 条： [📄 README.md] [+]  (不归我们画)          │  由平台负责
├─────────────────────────────────────────────────────────┤
│ README.md ▾            [阅读│编写]   [保存]        ⧉     │  40px  DocBar
├─────────────────────────────────────────────────────────┤
│                                                         │
│   J‑Prism: Language Models Think                        │
│   Semantically, with Preferred Languages                │  内容面（一次一层）
│                                                         │
│   J‑Prism (repository `jprism-bilingual`) fits …        │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ ● 未保存                        1,234 字 · 56 行         │  26px  StatusStrip
└─────────────────────────────────────────────────────────┘
```

### 4.1 DocBar 精确规格

| 元素 | 尺寸 | 说明 |
|---|---|---|
| 高度 | **40px** | `padding: 0 8px; gap: 6px; border-bottom: .5px solid border-l1; background: bg-base` |
| FileChip | h 28，`padding: 0 8px`，radius 8，`max-width: 46%`（320px 时退到 34%），`min-width: 0` | 文案 = `basename`，`text-overflow: ellipsis`；右侧 12px `▾`；hover `interactive-bg-hover`；title 属性 = 工作区相对路径 |
| Spacer | `flex: 1; min-width: 0` | 唯一可压缩项 |
| ViewSeg | 轨道 h 28，`padding: 2`，radius 8，bg `bg-layer-2`；按钮 h 24、`padding: 0 10px`、radius 6、`font: 500 12px/1`（12px 中文两个字形 = 24px，加 20 padding = 44 宽） | 选中：`button-ghost-active-fill` + `button-ghost-active-border` 内描边；未选中：透明 + `label-secondary`；hover（未选中）：`interactive-bg-hover` |
| SaveSlot | **固定 52×28**（`flex: none`） | `clean` 时空；`dirty` 时填充主按钮；**空/满都占位，禁止布局跳动**（验收 §13-05） |
| ExitButton | ≥520：h 28 文案「预览」；<520：28×28 图标（眼睛/文档） | title = `打开预览 (Ctrl+Shift+P)`；hover `interactive-bg-hover` |
| 分栏 | 仅容器 ≥720px 时作为 ViewSeg 第三段出现 | <720 完全不存在（不是「禁用可见」，避免永久灰按钮） |

### 4.2 内容面

| 模式 | 规格 |
|---|---|
| 阅读 | `.gh-md-document`，容器查询阶梯见 §9。**不加内部滚动容器**（沿用现有注释的约束：滚动归面板）。 |
| 编写 | textarea：`padding: 16px 16px 64px`（<520）/ `20px 24px 72px`（≥520）；`font: 13px/21px var(--ds-font-family-code)`；`tab-size: 2`；`white-space: pre-wrap`（**默认软换行**，不要 `pre`）；`resize: none`；`spellcheck: false`；`aria-label = 源码`；焦点环见 §11.2 |
| 分栏（≥720） | `display: grid; grid-template-columns: var(--mde-ratio, 46%) 6px 1fr`；divider 6px 命中区、视觉 1px `border-l1`、hover 变 `border-l2`；两栏各自独立滚动；**不做滚动同步**（明确非目标，见 §14） |

### 4.3 StatusStrip

- h 26，`padding: 0 10px`，`font: 12px/1`，左状态右计数，`gap: 8px`。
- 左：`6px` 圆点 + 文本。`已保存`（无点 / `label-tertiary`）、`未保存`（amber-500 点 + `label-secondary` 500 字重）、`保存中…`（点 = `label-tertiary` + 文本）、`保存失败`（红点 + `label-secondary`）。
- 右：`1,234 字 · 56 行`，`11px/1`，`label-tertiary`，`Intl.NumberFormat(locale)` 千分位。**禁止英文 `chars`**。

---

## 5. 宽屏 / 全屏（≥720px，典型 1100–1600px）

```
┌───────────────────────────────────────────────────────────────────────────┐
│ README.md  ·  docs/README.md        [阅读│编写│分栏]     [保存]      [预览] │  40px
├───────────────────────────────────┬───────────────────────────────────────┤
│ ## J-Prism …                      │  J‑Prism: Language Models Think …     │
│                                   │                                       │
│ J‑Prism (repository `jprism-…` )  │  J‑Prism (repository `jprism-biling…`  │
│ 源码（mono 13/21）                 │  预览（16/28，max-width 760 居中）      │
├───────────────────────────────────┴───────────────────────────────────────┤
│ 已保存                                          12,480 字 · 842 行          │
└───────────────────────────────────────────────────────────────────────────┘
```

增量规则（不是另一套界面）：

| 断点（容器宽） | 变化 |
|---|---|
| ≥ 520 | FileChip 显示 16px 文件图标 + 相对路径（`label-tertiary`，12px，截断）；SaveSlot 文案「保存」；Exit 显示文案「预览」 |
| ≥ 720 | ViewSeg 增加「分栏」；分栏可用；阅读列 `padding: 24px 32px 64px` |
| ≥ 900 | 阅读正文 `max-width: 760px; margin-inline: auto`（行长可控）；编写栏 `padding-inline: 40px` |
| 全屏（平台形态） | 不改变任何控件；只是同一套规则拿到更多宽度。面板没有标题行，我们的 DocBar 就是它唯一的上沿。 |

**不做**：≥900 时出现常驻大纲列（那正是被废弃的三栏）。大纲永远是 sheet。

---

## 6. 单文件工作流与状态机

```
        ┌──────── empty ────────┐   （无文件 / 无工作区）
        │                      │
   open ▼                      │ 关闭文件
     loading ──fail──► loadError ─┐
        │ ok                      │
        ▼                         │
      ready(clean) ──edit──► ready(dirty) ──save──► saving ──ok──► ready(clean)
                             ▲                         └──fail──► saveFailed
                             └─────────── retry ─────────────────────┘
```

### 6.1 empty（空态，编辑器最容易被低估的一屏）

垂直居中的 260px 列，`gap: 12px`：

| 元素 | 规格 |
|---|---|
| 图标 | 24px `#` 标记，`label-tertiary`，`margin-bottom: 4px` |
| 标题 | 14px/600 `label-primary`：「还没有打开文件」 |
| 说明 | 12px/18 `label-tertiary`，两行以内：「选一个工作区的 Markdown 文件开始；在预览里点「编辑」也可以直接进来。」 |
| 主按钮 | h 28、`padding: 0 12`、radius 8、`bg: button-primary-fill`、`color: label-primary-foreground`、500 12px：「打开文件」→ 打开文件 sheet |
| 最近 | 若 localStorage 有该会话的最近文件：标题「最近」11px `label-tertiary` + 最多 3 个 ghost chip（h 24、radius 6、hover `interactive-bg-hover`、`max-width: 100%`、省略号） |
| 无工作区变体 | 图标 +「当前会话没有工作区目录」+「先在左侧选择一个工作区」（无按钮）。**必须复用已有的 `workbenchNoWorkspace` 语义**（旧代码定义了却从未使用）。 |

### 6.2 loading
DocBar 立即显示目标文件名（不必等读完成），控件 `disabled`，`aria-busy="true"`。内容区是 **3 条骨架**（`bg-skeleton`，h 12，radius 4，宽 92% / 84% / 61%，间距 14px），**不用 spinner**。读完换内容，`opacity` 200ms 淡入。

### 6.3 open / 切换文件
- 入口：FileChip → 文件 sheet → 点行。
- **换文件不询问、不丢字**：每文件的草稿保存在 `drafts: Map<path, {text, saved}>` 里（旧代码的 per-tab 快照思路，只是没有 tab 条）。切回来文字还在，文件 sheet 行上有 amber 未保存点。
- 打开失败：内容区错误卡（图标 +「读取失败」+ `state-error-primary` 摘要 + 「重试」），DocBar 保留退出。

### 6.4 dirty
- 进入即：SaveSlot 出现主按钮「保存」、标题加 6px amber 点、StatusStrip「未保存」。
- 每次按键不触发重新渲染预览（仅 `编写`/`分栏` 才渲染预览，且在输入停 180ms 后用 `requestIdleCallback`/`setTimeout` 节流）。

### 6.5 saving
- SaveSlot 文案「保存中…」、`disabled`、`aria-busy`；StatusStrip「保存中…」；**保存按钮在 POST 期间不可再点**（旧代码的缺陷之一）。
- 成功：`saved = text`，点消失，StatusStrip「已保存」，`live` 播报「已保存」。

### 6.6 saveFailed
- StatusStrip 换成 **ErrorRow**（h 32）：14px 图标 + `保存失败：<原因>`（1 行截断，`title` 全文）+ 「重试」按钮（h 24）+ 「关闭」(20×20)。
- `role="alert"`，一条播报即可，不重复。
- **草稿绝不丢失**；退出编辑器时若仍有未保存内容，走 §6.8。

### 6.7 退出（回到预览）
`ExitButton` → 构建会话文件地址 `dsh-resource://file/session/<sessionId>/<逐段编码路径>` → `tab.actions.openResource(address, { replaceTab: true })`。
- **必须是会话地址**；`absolute` 地址会被官方 `text` 类型的 `canOpen` 拒掉，`openResource` 直接抛「无人认领」（已在这个 profile 里踩过）。
- 有未保存草稿：先内联确认（不弹窗）——StatusStrip 变成一条 32px 的确认条：「有未保存修改 · [保存并预览] [放弃并预览] [留下]」。三个动作都是真按钮，键盘可达。

### 6.8 关闭 tab
平台 `registerCloseHandler('markdown-editor', handler)`：有草稿则 `throw`（保留 tab）并把焦点移到 SaveSlot 并展开确认条。**不使用 `window.confirm`、不使用 `beforeunload`**（旧代码：常驻的 `beforeunload` 会在用户完全忘了后台编辑器时拦住应用退出）。

### 6.9 外部修改（P2，agent 场景的高价值项）
- 窗口 `focus` / `visibilitychange` 时重读 `stat`（走现有 `read` 的 `mtimeMs`）。
- 磁盘比内存新 且 未编辑 → 静默重载 + StatusStrip「已更新」。
- 磁盘比内存新 且 有草稿 → 内联条：「文件已被外部修改 · [重新载入] [保留我的版本]」（`role="status"`，不打断书写）。

---

## 7. 视觉语言：只用这些 token

全部为 DSH 公共别名 token（取自 `@deepseek-ai/dsh-client-ui-theme`）。括号内为浅/深主题解析，仅供核对，**代码里只写 token 名**。

### 7.1 表面与描边

| 用途 | token |
|---|---|
| 面板底（= 宿主面板底，我们不自成一层卡片） | `--dsw-alias-bg-base` |
| 抬起面（按钮、chip、选中行） | `--dsw-alias-bg-layer-1` |
| 轨道 / hover 行 / 次级面 | `--dsw-alias-bg-layer-2` |
| Sheet 底 | `--dsw-alias-bg-overlay` |
| 骨架 | `--dsw-alias-bg-skeleton` |
| Sheet 遮罩（若要压在内容上） | `--dsw-alias-bg-mask-1` |
| hairline 分隔（.5px） | `--dsw-alias-border-l1` |
| 控件描边 | `--dsw-alias-border-l2` |
| chip / 抬起面描边 | `--dsw-alias-border-l3` |
| Sheet / 浮层阴影 | `--dsw-elevation-panel` |

### 7.2 文字

`--dsw-alias-label-primary`（正文/按钮字）、`-secondary`（次要、状态文本 500 字重）、`-tertiary`（说明、计数、路径）、`-caption`（引用竖线，渲染层用）、`--dsw-alias-link`（链接）、`--dsw-alias-label-error`（仅当需要纯文字错误时）。

### 7.3 交互与状态

| 用途 | token |
|---|---|
| hover 底色 | `--dsw-alias-interactive-bg-hover` |
| 按下 | `--dsw-alias-interactive-bg-active` |
| 分段选中面 / 描边 / hover | `--dsw-alias-button-ghost-active-fill` / `-border` / `-hover` |
| 主按钮底 / hover | `--dsw-alias-button-primary-fill` / `--dsw-alias-button-primary-hover` |
| **主按钮字** | `--dsw-alias-label-primary-foreground` ⚠️ |
| 未保存点（图形，非文字） | `--dsw-alias-state-warn-primary`（amber-500） |
| 警告**文字**（必须） | `--dsw-alias-state-warn-label`（amber-600） |
| 错误 | `--dsw-alias-state-error-primary` |
| 成功 | `--dsw-alias-state-success-primary`（只做点/图标，不做小字） |
| 焦点环 | `--dsw-focus-ring-color`（兜底 `--dsw-alias-state-business-primary`，宽 `--dsw-focus-ring-width`=2px） |

> ⚠️ **两个必须改掉的现有 bug（P0）**
> 1. 旧代码主按钮写死 `color:#fff`。而 `button-primary-fill` = `brand-primary` = 浅色近黑 / **深色近白** → 深色主题下白字压白底，按钮文字消失。改用 `label-primary-foreground`（浅=白 / 深=近黑）。
> 2. 旧代码 `font: 500 12px/1 var(--dsw-font)`。`--dsw-font` 在主题里**未定义**，`font` 简写里出现 `var()` 空值时整条声明会在计算值阶段失效 → 按钮回退到继承字号，七个控件大小不一。必须拆成 `font-family: var(--dsw-font-family); font-size: 12px; font-weight: 500; line-height: 1;`。

### 7.4 圆角与字体

| 用途 | 值 |
|---|---|
| 28px 控件、chip、主按钮 | `--dsw-radius-sm`（8） |
| 分段内按钮（轨道内缩 2） | `calc(var(--dsw-radius-sm) - 2px)`（6） |
| Sheet 顶角 / 大面 | `--dsw-radius-md`（12） |
| 代码卡（渲染层沿用） | `--dsw-radius-lg`（16） |
| 引导卡（宿主规格） | `--dsw-radius-xl`（20） |
| UI 字体 | `--dsw-font-family`（= `--dsh-font-family-text-default`） |
| 正文次级字号 | `--dsh-content-font-size-secondary`（默认 13px，兜底 `13px`） |
| 代码字体 | `--ds-font-family-code`，行高随 `--dsh-code-font-delta` |

**禁止**：新建 `<style>` 之外的自创变量前缀（统一 `--mde-*` 局部别名，值必须引用上面的 token）；`#fff` / `#000` / `rgb(...)` 硬编码（渲染层既有的文学化排版例外——字族与字号保持现状）。

---

## 8. 组件规格

### 8.1 图标（两个，不多不少）

1. **`EditorGlyph`（引导卡 / 空态，24–26px）**：Markdown 的 `#` 字标——两条水平线 `M2.8 6.2h10.4` `M2.8 10.4h10.4`，两条竖线略斜 `M6.6 4.2 5.4 12.2` `M10.6 4.2 9.4 12.2`，`stroke: currentColor` `stroke-width: 1.3` `linecap: round`，16 viewBox 放大到 26。**理由**：与「文件编辑」卡的文档图标完全不同（critique 已点名两张卡无法区分），且 `#` 一眼是 Markdown。
2. **`MdFileGlyph`（tab 标题、<520 的退出按钮用「文档」语义）**：直接复用宿主的 `FileTypeIcon`（`.md`），**不要自绘**。

### 8.2 ViewSeg（分段控件）

- 结构：`div[role=tablist][aria-label=视图]` > `button[role=tab][aria-selected]`；对应内容面板 `role=tabpanel` `aria-labelledby`。
- 键盘：Left/Right 移动并**立即激活**（自动激活模式），Home/End 到两端；Tab 离开整组（roving tabindex：选中项 0，其余 -1）。
- 视觉状态矩阵：

| 状态 | 未选中 | 选中 |
|---|---|---|
| default | 透明 + `label-secondary` | `button-ghost-active-fill` + 内描边 `button-ghost-active-border` + `label-primary` 500 |
| hover | `interactive-bg-hover` | `button-ghost-active-hover` |
| active(按下) | `interactive-bg-active` | 同 hover |
| focus-visible | 2px 焦点环（offset 2，画在按钮外沿） | 同 |
| disabled | `opacity: .45`，`cursor: default` | — |

### 8.3 SaveSlot（保存）

| 状态 | 渲染 |
|---|---|
| clean | 空（保留 52×28 位置，`aria-hidden`） |
| dirty | 主按钮「保存」，`button-primary-fill` / `label-primary-foreground`，h 28 |
| saving | 主按钮「保存中…」，`disabled`，`aria-busy=true` |
| failed | 主按钮「重试」（ErrorRow 同时出现） |
| readonly（无 workspace/路径） | 不渲染，`⋯` 无 |

hover：`button-primary-hover`。focus-visible：2px 焦点环（offset 2）。`aria-keyshortcuts="Control+S Meta+S"`。

### 8.4 Sheet（文件 / 大纲）

- 覆盖 `.gh-mde` 整个 body（含 DocBar），`position: absolute; inset: 0; z-index: 8; background: var(--dsw-alias-bg-overlay); box-shadow: var(--dsw-elevation-panel);`
- `role="dialog" aria-modal="true"` + 内容区 `inert` + 焦点陷阱（Tab 循环）+ `Esc` 关闭 + `preventDefault()`（宿主文档要求：自处理 Esc 的渲染器浮层必须 `preventDefault`，否则同时关掉文件导航栏）。
- header：h 36，`padding: 0 8px 0 12px`；标题 13/600 + 计数 11px `label-tertiary`（`文件 · 12` / `大纲 · 8`）；右侧 28px `刷新` + 28px `关闭`。
- 行：h 28（文件）/ 26（大纲），`padding: 0 8px`，radius 6，`font: 12px/1`；hover `bg-layer-2`；当前文件 `bg-layer-2` + 500 字重 + `aria-current="page"`；目录 caret 用 CSS 三角形（12px，`label-tertiary`，`aria-expanded` 在按钮上）；文件行右端 5px amber 点表示该文件有草稿。
- 分组标题：11px `label-tertiary`，`padding: 10px 8px 4px`，不用 uppercase（中文不适用）。
- 空树：「这个目录里没有 Markdown 文件」（**不要**复用「还没有打开文件」——critique 点名的文案错位）。
- 大纲行：缩进 `(level-1) * 10px`；h1–h2 500 字重、h3+ 常规；超长省略 + `title`。点击 = 切到「阅读」并滚到该标题（在「编写」下点击也这样，避免"点了没反应"）。

### 8.5 ErrorRow / 内联确认条（同一容器，同一高度 32）

| 类型 | 左 | 右 | 角色 |
|---|---|---|---|
| 保存失败 | 图标 + `保存失败：<原因>`（1 行） | 重试 / 关闭 | `alert` |
| 未保存拦截 | `有未保存修改` | 保存并预览 / 放弃并预览 / 留下 | `status` |
| 外部修改 | `文件已被外部修改` | 重新载入 / 保留我的版本 | `status` |

三个动作在 320px 宽下依然完整：文案用「保存并预览 / 放弃 / 留下」的短版（<420px 时截断为「保存并走 / 放弃 / 留下」不可接受——改用短标签集见 §12）。

### 8.6 确认对话框（唯一允许的模态）

仅用于**关闭 tab 丢弃草稿**这一种破坏性动作：原生 `<dialog>` + `showModal()`，宽 `min(360px, calc(100vw - 48px))`，radius `--dsw-radius-md`，标题 14/600「放弃未保存的修改？」，正文 12/18 `label-secondary`（含文件名），按钮「取消」(ghost) +「放弃」(危险：`state-error-primary` 底 + `label-primary-foreground` 字)。Esc = 取消，初始焦点在「取消」。

---

## 9. 排版阶梯（容器查询，不要用媒体查询）

`@container` 断点按**面板宽度**：`360 / 420 / 520 / 720 / 900`。

| 元素 | <420 | 420–519 | 520–719 | ≥720 |
|---|---|---|---|---|
| 阅读 padding | 16px 16px 48px | 18px 20px 56px | 20px 24px 56px | 24px 32px 64px |
| 正文 | 15px/26 | 15px/26 | 16px/28 | 16px/28（≥900：`max-width:760px` 居中） |
| h1 | 21/31 | 22/32 | 24/34 | 24/34 |
| h2 | 19/29 | 20/30 | 22/32 | 22/32 |
| h3 | 17/27 | 18/28 | 20/29 | 20/29 |
| 表格 cell | 6px 8px / 13px | 6px 8px / 13px | 8px 10px / 14px | 10px 14px / 14px |
| 代码卡字号 | 12/19 | 12/19 | 13/21 | 13/21 |
| 列表缩进 | 14px | 16px | 18px | 18px |

- 保留现有 `--dsh-code-font-delta` 机制；**不要**把 `font: var(--dsw-font)` 用于正文（注释里写过的坑：面板可能挂等宽字体）。
- 表格：沿用 `.gh-md-table-scroll` 的横向滚动容器（已可聚焦），**窄栏不允许表格撑破面板**；`th/td` 的 `min-width` 在 ≤560 归零（现有规则保留并补 ≤460 一档）。
- 图片：`max-width: 100%`；窄栏下 `border-radius: var(--dsw-radius-md)` 保留。
- 长英文/URL：`overflow-wrap: anywhere`（现有）；`code` 块内允许横向滚动，不裁切。

---

## 10. 动效

| 场景 | 时长/曲线 |
|---|---|
| hover / 选中填充 | 120ms `--ds-ease-in-out` |
| Sheet 进出 | 180ms，`opacity 0→1` + `translateY(6px)→0` |
| 内容加载完成 | 200ms `opacity` |
| 分段切换 | 不位移、不淡入内容（同一容器换子节点即可，避免"页面在动"） |
| `prefers-reduced-motion: reduce` | 全部 `transition: none`；骨架不闪（静态灰度） |

不写页面入场编排、不写脉冲/呼吸、不做滚动联动动画。

---

## 11. 无障碍

### 11.1 键盘映射

| 键 | 作用域 | 行为 |
|---|---|---|
| `Ctrl/Cmd + S` | **编辑器内（焦点在 tab body 内）** | 保存；clean 时无操作 |
| `Ctrl/Cmd + Shift + P` | 编辑器内 | 切回预览（有草稿走内联确认） |
| `←` `→` `Home` `End` | ViewSeg 焦点内 | 切换并激活视图 |
| `Tab` / `Shift+Tab` | 全局 | DocBar → 内容 → StatusStrip；sheet 打开时在 sheet 内循环 |
| `Esc` | sheet 打开 | 关闭 sheet 并 `preventDefault()` |
| `Esc` | dialog 打开 | 取消 |
| `Esc` | 其他 | **无操作**（绝不静默丢弃） |

- ❌ 旧的 `window.addEventListener('keydown')` 全局 `Ctrl+S` 必须删除：它会在用户于输入框打字时保存一个看不见的后台文件（critique 的 Alex 红旗）。改为挂载在 `EditorRoot` 上的捕获监听，并判断 `event.target` 在 root 内。

### 11.2 焦点

- 全部可交互元素 `:focus-visible` → `outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px;`
- **textarea**：`outline-offset: -2px`（环在面内，不裁切、不遮字），且 `outline-style: solid`——显示焦点环，不能只有光标。这是 critique 的 WCAG 2.4.7 硬伤。
- 焦点顺序：FileChip → 视图段 → 保存 → 退出 → 内容 →（sheet 打开时）sheet。
- 打开 sheet：焦点进 sheet 的第一个可操作项，关闭后回到打开它的按钮。
- 保存成功后**不移动焦点**（不要跳到工具栏）。

### 11.3 ARIA / 语义

| 元素 | 语义 |
|---|---|
| 根 | `<section aria-label="Markdown 编辑器">`（不用 `role=application`） |
| DocBar | `role="toolbar" aria-label="编辑器工具栏"` |
| FileChip | `aria-haspopup="dialog"` `aria-expanded` |
| 视图段 | `tablist` / `tab` / `aria-selected` / `tabpanel` |
| 内容 | 加载或保存时 `aria-busy="true"` |
| StatusStrip | `role="status" aria-live="polite" aria-atomic="true"` |
| ErrorRow | `role="alert"` |
| Sheet | `role="dialog" aria-modal="true" aria-labelledby` |
| 文件树行 | `<button>`；文件夹 `aria-expanded`；当前文件 `aria-current="page"` |
| 标题 slot | 图标 `aria-hidden`，文本即名称；不要塞第二个可读的名字造成重复播报 |

### 11.4 目标尺寸与对比

- 所有点击目标 **≥ 28×28**（宿主 iconButton 同规格）；行高 ≥ 26 且整行可点。
- 文本对比：正文/标签用 `label-primary`/`-secondary`（DS 已保证）；**11px 只用于计数、路径、分组标题，且必须 `label-tertiary`**；未保存等状态**不用彩色小字**（amber-500 在浅色上约 2.2:1，不合格），用点 + 常规色文字。
- 深色主题：主按钮字必须 `label-primary-foreground`（见 §7.3 ⚠️2）。
- 不用颜色作为唯一状态通道：未保存 = 点 + 文案 + 标题点；错误 = 图标 + 文案 + role。

---

## 12. 文案（zh / en 全表）

命名空间沿用 `githubMarkdown`（`ctx.locale.register(NS, { zh, en })`）。旧 key 里 `workbench*` 一律退役，新增 `editor*`。

| key | zh | en |
|---|---|---|
| `editorTitle` | Markdown 编辑器 | Markdown Editor |
| `editorDescription` | 读取、编辑并保存工作区的 Markdown 文件 | Read, edit and save workspace Markdown files |
| `editorOpen` | 编辑 | Edit |
| `editorPreview` | 预览 | Preview |
| `editorViewRead` | 阅读 | Read |
| `editorViewWrite` | 编写 | Write |
| `editorViewSplit` | 分栏 | Split |
| `editorSave` | 保存 | Save |
| `editorSaving` | 保存中… | Saving… |
| `editorRetry` | 重试 | Retry |
| `editorSaved` | 已保存 | Saved |
| `editorDirty` | 未保存 | Unsaved |
| `editorSaveFailed` | 保存失败 | Save failed |
| `editorSaveFailedWith` | 保存失败：{reason} | Save failed: {reason} |
| `editorLoadFailed` | 读取失败 | Could not read file |
| `editorLoading` | 读取中… | Reading… |
| `editorEmptyTitle` | 还没有打开文件 | No file open yet |
| `editorEmptyBody` | 选一个工作区的 Markdown 文件开始；在预览里点「编辑」也可以直接进来。 | Pick a Markdown file from the workspace, or use “Edit” in the preview. |
| `editorEmptyAction` | 打开文件 | Open file |
| `editorRecents` | 最近 | Recent |
| `editorNoWorkspace` | 当前会话没有工作区目录 | This session has no workspace directory |
| `editorNoWorkspaceHint` | 先在左侧选择一个工作区 | Choose a workspace on the left first |
| `editorFiles` | 文件 | Files |
| `editorOutline` | 大纲 | Outline |
| `editorNoMarkdownHere` | 这个目录里没有 Markdown 文件 | No Markdown files in this folder |
| `editorRefresh` | 刷新 | Refresh |
| `editorClose` | 关闭 | Close |
| `editorCharsLines` | {chars} 字 · {lines} 行 | {chars} characters · {lines} lines |
| `editorDirtyBlock` | 有未保存修改 | Unsaved changes |
| `editorSaveAndExit` | 保存并预览 | Save & preview |
| `editorDiscardAndExit` | 放弃并预览 | Discard & preview |
| `editorStay` | 留下 | Stay |
| `editorExternalChanged` | 文件已被外部修改 | File changed on disk |
| `editorReload` | 重新载入 | Reload |
| `editorKeepMine` | 保留我的版本 | Keep mine |
| `editorUpdated` | 已更新 | Updated |
| `editorDiscardTitle` | 放弃未保存的修改？ | Discard unsaved changes? |
| `editorDiscardBody` | {file} 的修改还没有保存，关闭后会丢失。 | Changes to {file} have not been saved and will be lost. |
| `editorCancel` | 取消 | Cancel |
| `editorDiscard` | 放弃 | Discard |
| `editorSource` | 源码 | Source |
| `editorSourceLabel`（aria） | Markdown 源码 | Markdown source |
| `editorToolbarLabel`（aria） | 编辑器工具栏 | Editor toolbar |
| `editorViewLabel`（aria） | 视图 | View |
| `editorFileChipTitle` | {path} | {path} |

命名/数字规则：文件名用 `basename`；路径用工作区相对路径（`/` 分隔）；计数用 `Intl.NumberFormat`；**不复用 `chars`**。

---

## 13. 验收清单

> 前 12 条不过 = 不能交付。每条都可测，不要用"看着还行"代替。

**入口与身份**
- [ ] **01** 预览 `.md` 时头部出现「编辑」；点击后**同一个 tab 位置**变成编辑器，文件名不变，tab 数不变。
- [ ] **02** 引导页出现「Markdown 编辑器」卡，图标是 `#` 字标，且与「文件编辑」卡一眼可分；点击后引导页被替换（一条历史）。
- [ ] **03** 编辑器开着时重复点「编辑」→ 聚焦已有 tab，不新建。
- [ ] **04** 「打开方式」下拉里**没有**本插件贡献的「编辑器」项；预览正文里**没有**任何编辑条。

**布局**
- [ ] **05** 400px 下 DocBar 在「干净 → 未保存」之间切换时，视图段的 `getBoundingClientRect().x` **不变**（SaveSlot 占位生效）。
- [ ] **06** 320 / 360 / 400 / 520 / 720 / 1200 各宽度下：`document.querySelectorAll('.gh-mde *')` 中无元素 `scrollWidth > clientWidth + 1`（除表格滚动容器与代码块）。
- [ ] **07** <720px 时视图段只有两项；≥720 出现第三项「分栏」，且分栏两栏可各自独立滚动。
- [ ] **08** 全屏（平台形态）下正文 `max-width` 生效、行长不超 760px。

**状态**
- [ ] **09** 空态：无工作区时显示 `editorNoWorkspace` 文案且无按钮；有工作区时「打开文件」可打开 sheet 并选中文件。
- [ ] **10** 保存中：保存按钮 `disabled`，双击不产生第二次 POST（网络面板只有 1 条）。
- [ ] **11** 保存失败：ErrorRow 出现、`role=alert`、草稿完整保留、点「重试」成功后 ErrorRow 消失且状态变「已保存」。
- [ ] **12** 切换文件不丢草稿：A 改一段 → 切 B → 切回 A，文字仍在，文件 sheet 上 A 行有未保存点。
- [ ] **13** 退出到预览：地址为 `dsh-resource://file/session/...`，`replaceTab` 生效，编辑器 tab 原地变回预览；有草稿时先出现内联确认条。
- [ ] **14** 关闭有草稿的 tab：弹原生 `<dialog>`（不是 `window.confirm`），取消后草稿仍在。
- [ ] **15** 1 万行文件的输入无卡顿（连续输入 50 字，无 >50ms 长帧；「编写」模式不渲染预览）。

**无障碍**
- [ ] **16** 只用键盘可完成：打开编辑器 → 切视图 → 编辑 → 保存 → 退出；每一步焦点可见。
- [ ] **17** textarea 获得焦点时**有可见焦点环**（不是只有光标）。
- [ ] **18** 保存成功/失败各播报一次（NVDA/Narrator 实测，不重复、不遗漏）。
- [ ] **19** 焦点在会话输入框里按 `Ctrl+S` **不会**保存后台编辑器（旧 bug 回归测试）。
- [ ] **20** 所有 icon 按钮 ≥28×28；`Esc` 在无 sheet 时不做任何破坏性动作。

**主题与文案**
- [ ] **21** 深色主题下主按钮文字可见（对照度 ≥4.5:1）。
- [ ] **22** 无英文泄漏（`chars`、`Discard unsaved changes?`、`Files` 等）；zh 全中文、en 全英文。
- [ ] **23** `prefers-reduced-motion` 下无位移动画、骨架不闪。

**卫生**
- [ ] **24** `client.js` 里不再有 `gh-wb*` / `gh-md-editbar` / `WorkbenchBody` / `window.confirm` / `beforeunload` / 全局 keydown `Ctrl+S`。
- [ ] **25** `scripts/render-smoke.mjs` 仍通过（渲染管线未被破坏）；`package.json` 的 `dsh.client.inject` 含 `@deepseek-ai/dsh-client-ui-sidebar-right`。
- [ ] **26** 明暗两套截图各 1 张（400px）与 1 张全屏分栏，作为本轮交付证据。

---

## 14. 边界与已知限制（写清楚，不要假装没有）

1. **不做滚动同步**（源码 ↔ 预览）。同步滚动需要行映射，Markdown 的行映射在表格/代码/脚注下几乎必错；宁可两栏各自滚动。
2. **不重命名、不新建、不删除文件**。只读 + 存盘。文件树的行拒绝对目录/非 md 项给出可解释的禁用（不做静默无反应）。
3. **不订阅文件变更**。外部修改靠 `focus` 重读（P2），不是实时 watch。
4. **无富文本、无工具栏插入语法**。写作工具栏（加粗/标题按钮）会引入第二套编辑模型，本 pass 明确不做。
5. **文件名标题在打开时捕获**，若用户在编辑器内切文件，靠 `EditorTitle` 动态读 store 覆盖（平台支持 keyed title slot；若该 slot 在 0.2.2 不可用，退回静态标题「Markdown 编辑器」，见 §15.3）。
6. **`dsh-editor` 仍会出现在「打开方式」下拉里**。它属于别的插件，我们不隐藏、不改名；README 用一句话说明两者分工。
7. **`keepMounted: true`** 意味着草稿在切 tab 后仍在内存。这是有意的（防丢失），但与旧代码的常驻 `beforeunload` 不同：我们**不**注册 `beforeunload`，退出应用时的保护由关闭 handler + dialog 负责。

---

## 15. 给实现的对接备注

### 15.1 非协商项（≥5 条，违反即返工）

1. **一个编辑器，就是一个 page kind 的 tab。** 不新增渲染器、不新增主区 View、不在预览里内嵌编辑态。
2. **窄屏只有一层内容面。** 文件和草稿结构不得以常驻列/内部 tab 条出现；<720px 不存在分栏。
3. **保存状态必须三通道可见**：SaveSlot（动作）、标题点（对象级）、StatusStrip（文本 + `role=status`）。
4. **token 只用 §7 的清单**；主按钮字用 `label-primary-foreground`；禁止 `font:` 简写里塞可能为空的 `var()`。
5. **键盘**：`Ctrl+S` 作用域限定在编辑器内；删除全局监听与 `beforeunload`；textarea 必须有可见焦点环。
6. **不使用 `window.confirm`**；破坏性动作才用原生 `<dialog>`。
7. **旧 dead code 必须删干净**（`gh-wb*` 全家族 + `WorkbenchBody`），否则下一次改动还会有人把它复活。

### 15.2 `package.json`
- `dsh.client.inject` += `@deepseek-ai/dsh-client-ui-sidebar-right`。
- `meta.title` / `meta.description` 改为「Markdown 编辑器 + GitHub 风格预览」口径（现在只提预览/工作台）。
- `dsh` 里不需要新增 bundle。

### 15.3 必须在真实应用里先验证的平台契约（有 fallback，别猜）
| 契约 | 用途 | 若不可用的 fallback |
|---|---|---|
| `sidebar.right.tab.document.actions`（list，prop `absolutePath`） | L2 入口 | 在 `MarkdownBody` 右上角渲染一个 28px 浮动「编辑」按钮（同一视觉，位置固定右上 8px） |
| `sidebar.right.pane.tab.title`（keyed） | 动态文件名标题 | 静态标题「Markdown 编辑器」+ 文件名进 DocBar |
| `openTab('markdown-editor', { replaceTab: true, params })` 跨 kind 替换文档 tab | 就地切换 | 不用 `replaceTab`，`openTab(kind,{ params })` 新开并 `close()` 原 tab（会多一条历史，需在交付说明里注明） |
| page kind 的 `params` 在运行时透传 | 传 `path` | 用 `localStorage['github-md-editor:last:<sessionId>']` 作为交接（旧代码已有此模式） |

建议验证顺序：注册类型 → 引导卡打开 → 预览动作打开 → `replaceTab` 往返 → 标题 slot。

### 15.4 宿主几何参考（照抄，别自创）
- 宿主 28×28 图标按钮：`border-radius: var(--dsw-radius-sm)`，icon 15px，hover `interactive-bg-hover`。
- 引导卡：宽 380 / max 100%，min-height 56，padding 14 20，gap 14，图标 26（`label-secondary`），标题 14/1.4，描述 11/1.4 `label-tertiary`，`.5px border-l3`，hover `interactive-bg-hover`。
- 面板没有标题行；tab 条即面板上沿。**我们的 DocBar 是内容区第一条，不要试图再画一层"面板标题"。**


---

## 16. v0.17.0：去掉编辑模式，改成「点块就地编辑」

用户要的是 Obsidian Live Preview 的心智：阅读态就是渲染好的文档，点哪一段，哪一段进入源码编辑，
不是另开一个编辑器页面。

### 16.1 为什么不再有第二个编辑器
- v0.16 的「换页进编辑器」仍然意味着两个面：预览 / 编辑。用户的原话是「不需要那么多模式」；
- Obsidian 的默认编辑视图本身就是一个渲染好的文档，当前块显示源码；没有独立「编辑模式」按钮；
- 所以 v0.17 删除了 `markdown-editor` tab 类型、文档头编辑动作、文件选择器与设置页，
  右栏一份 Markdown 始终只有一张 tab。

### 16.2 块编辑怎么实现
- 用 marked 的 `Lexer` 拿顶层 token，再按 token 原文在源文里的区间切块；
- 在 token 流里插 `<!--ghmdb:n-->` 哨兵后再 `parser()`，按哨兵切 HTML：
  整篇语义与一次性 `parse` 完全一致（脚注区、引用式链接定义、列表松紧都不变），
  同时每个顶层块拿到自己的 HTML 与 `[start, end)` 区间；
- 阅读态渲染块；点击时把这一块换成 CodeMirror（value = 该块原文），其余块保持渲染；
- 光标落点：渲染文本基本是原文的子序列，逐字符把「渲染文本下标」对齐回「原文下标」，
  再把光标放到点到的位置；
- 提交：点编辑块之外的任何地方（document 级 mousedown）或 Esc；Ctrl+S 提交并立即保存；
- 保存：提交时写盘，编辑过程中不写（写盘会让官方预览整篇重载，正在编辑的块会被卸载）；
  内容没变就跳过写盘，避免点来点去反复触发 mtime 重载；
- 换行：marked 的 token.raw 是 LF 归一化的，内部统一用 LF 渲染/编辑，保存时按原文件的
  CRLF/LF 风格写回；开头 YAML frontmatter 原样保留、不参与块编辑。

### 16.3 为什么 blur 提交不可靠
点击的默认聚焦动作会把刚挂载的 CodeMirror 立刻 blur 掉（尤其 CM 已缓存、挂载很快时），
表现为「点一下就退出编辑」。改成 document 级 mousedown 提交后稳定；blur 只保留在编辑器
卸载时 flush 草稿。

### 16.4 已知取舍
- 编辑单位是顶层块：列表、表格、整段引用都是一整块；
- 脚注区、引用式链接定义、frontmatter 是静态尾段/前缀，不参与点击编辑；
- 同一文件两个 tab 同时编辑时后保存覆盖先保存，没有冲突提示。

---

## 17. v0.18.0：把换行做成 Obsidian 的行为

用户反馈「想要换行，就没得换」。根因有两层：

1. marked 的 breaks: false（严格 CommonMark）：源码里的单个换行会被合并成空格，所以在块编辑器里按 Enter 敲出来的换行，提交后看不见；
2. CodeMirror 的 Enter 默认只插入一个 \n，而 Obsidian 的 Enter 是「分段」（插入空行），Shift+Enter 才是「段内换行」。

### 17.1 渲染语义：与 Obsidian 默认一致
- Obsidian 设置里「严格换行（Strict line breaks）」默认关闭，单个换行渲染成 <br>；
- 本插件把 marked 改成 breaks: true：单个换行 → <br>，空行 → 新段落；
- 这样块编辑器里敲的换行，提交后立刻能看见。

### 17.2 编辑按键：Enter / Shift+Enter
- Enter：正文里插入两个换行（分段）；列表里续写下一项（有序列表自动 +1）；引用里续写 >；围栏代码块里插入普通换行；
- Shift+Enter：插入一个换行（段内软换行，渲染成 <br>）；
- 围栏判断按光标之前的围栏行数奇偶来算，避免在代码块里误分段。

### 17.3 在文档末尾继续写
- 点最后一块下面的空白处 → 在末尾开一个「虚拟空段落」编辑器（CodeMirror value 为空）；
- 输入内容按位置插入 docTextRef，提交后整篇重新解析，新段落自然出现；
- 什么都没输入就点走 → 恢复原文，不把为插入补的换行写进文件。

### 17.4 保存去重
- 提交会触发一次保存，编辑器卸载/切 tab 还会补一次 keepalive；两处都会先比较 savedTextRef / pendingSaveTextRef，同一份内容只写一次，避免官方预览被重复重载。

### 17.5 仍然与 Obsidian 不同的地方
- Obsidian Live Preview 只把「当前行」显示成源码，同一块里其它行仍是渲染态；本插件目前把「整个顶层块」显示成源码（实现简单、语义安全，但观感更「源码」一些）；
- 点击两块之间的空白不会插入新段落（只有末尾空白支持）；
- 列表缩进 Tab、跨块撤销、块内格式化快捷键（Ctrl+B 等）还没做。

---

## 18. v0.19.0：Enter 实时分段、任意位置插段落、快捷键

v0.18 只解决了「换行渲染不出来」，但按 Enter 之后整个块仍停在源码态，和 Obsidian 里「前一段立刻变回渲染态、光标进入新段落」的手感还差一截。v0.19 补上：

### 18.1 Enter 实时分段
- 在块编辑器里按 Enter（正文语境）：按光标把当前块的 raw 切成 left / right；
- 新文本 = left + 空行 + right，直接 setDocText，整篇重新解析 → 前一段立刻变回渲染态；
- 用一个 pendingEdit 偏移在重渲染之后把编辑器落到「right 所在的块」上，光标在段首；
- right 为空时没有对应的块，就退化成「在 offset 处开一个空段落编辑器」（beginVirtual）；
- 列表 / 引用 / 围栏代码块不走分段，仍由 insertMarkdownNewline 续写或普通换行。

### 18.2 任意空白处插段落
- 点击块外空白：按点击 Y 找到它上面最后一块，插入点 = 该块 raw 末尾（绝对偏移）；
- beginVirtual(offset) 会检查插入点两侧：不是空行边界就补 \n 或 \n\n，保证提交后解析成独立段落；
- 虚拟编辑器按 offset 插进块流里渲染（而不是永远挂在文档末尾）；
- 什么都没输入就点走 → 恢复 originalText，不把补的换行写进文件。

### 18.3 Obsidian 常用快捷键
- Tab / Shift+Tab：插入 / 去掉两个空格；
- Ctrl+B / Ctrl+I（macOS 为 Cmd）：给选区包上 ** / *，空选区时插入一对标记并把光标放到中间。

### 18.4 验证
- 无头端到端（jsdom + 真实 CodeMirror）：在段中按 Enter → 块数 +1、编辑器落到 right 段（值以 right 开头）、输入 NEWPARA 提交后保存内容含 "With t\r\n\r\nNEWPARAhe exact"；
- 点末尾空白输入 APPENDED → 保存内容以 "\r\n\r\nAPPENDED" 结尾；
- Ctrl+B → 值以 **** 开头；Tab → 变成 **  **。

### 18.5 还没做的
- 块首 Backspace 与上一块合并、块尾 Delete 与下一块合并；
- 跨块撤销（提交后 Ctrl+Z）；
- Obsidian 的「只有当前行显示源码、同块其它行渲染」的逐行 Live Preview。

---

## 19. v0.20.0：块合并（Backspace / Delete）

Obsidian 里把光标放到段首按 Backspace，会把这一段并进上一段；段尾 Delete 会把下一段并进来。v0.20 补上：

### 19.1 Backspace 合并上一块
- 块编辑器里 Backspace 且无选区、光标在 index 0、存在上一块时拦截；
- 合并方式：上一块 raw 去掉尾随空白 + 当前块 raw，拼成一个块；
- 新文本 = 文档里「上一块起点 → 当前块终点」替换成合并结果，中间的段落分隔被自然吃掉；
- 重渲染后用 pendingEdit 把编辑器落到合并后的块上，光标在拼接处。

### 19.2 Delete 合并下一块
- 光标在块尾（index === value.length）且存在下一块时拦截；
- 合并方式：当前块 raw 去掉尾随空白 + 下一块 raw；光标留在拼接处。

### 19.3 验证
- 最小文档 "# Head / AAA / BBB / CCC"：点 BBB、光标到 0、Backspace → 编辑器值 "AAABBB"，保存内容 "# Head\n\nAAABBB\n\nCCC\n"；
- 再点合并后的块、光标到末尾、Delete → 编辑器值 "AAABBBCCC\n"，保存内容 "# Head\n\nAAABBBCCC\n"。

### 19.4 还没做的
- 跨块撤销（提交后 Ctrl+Z）；
- Obsidian 的逐行 Live Preview（当前行源码、同块其它行渲染）。

---

## 20. v0.21.0：提交后撤销 / 重做，表格 Enter

### 20.1 整篇文本级 undo / redo
- 每个编辑会话在 beginEdit / beginVirtual 时记下 beforeText；提交（Esc / 点走 / 分段 / 合并）时把 { before, after } 压进 historyRef.past；
- 最多 100 步，新的提交清空 future；
- 撤销 / 重做直接把整篇 docText 换回去并安排一次保存；
- 全局 keydown（capture）监听 Ctrl/Cmd+Z、Ctrl/Cmd+Shift+Z、Ctrl/Cmd+Y：
  - 正在块编辑器里时直接跳过（让 CodeMirror 自己的 undo 生效）；
  - 焦点在 input / textarea / contenteditable 时跳过（不抢聊天输入框的撤销）；
  - 只有焦点在文档根或 body 时才接管；
- 代价：撤销后光标不回到原位置，只回滚文本。

### 20.2 表格块
- 表格块里 Enter：按首行列数补一行 "|   |   |"，光标放到新行第一格（Obsidian 里 Enter 加行）；
- Shift+Enter：插入 <br>，单元格内换行；
- 不再走「分段」逻辑，避免把表格拆成两段。

### 20.3 验证
- 表格块 Enter → 行数 +1、新行 "|   |   |"、块数不变；Shift+Enter → 值里出现 <br>；
- 提交后 Ctrl+Z → 保存内容里的 ZZZ 消失；Ctrl+Shift+Z → ZZZ 回来。

### 20.4 还没做的
- Obsidian 的逐行 Live Preview（当前行源码、同块其它行渲染）；
- 撤销恢复光标位置；
- 表格 Tab 切格 / 列对齐。

---

## 21. v0.22.0：方向键跨块、表格 Tab 切格

Obsidian 的光标可以在整篇笔记里连续移动；之前我们的编辑器是「一块一个 CodeMirror」，方向键到块边界就停住，要换块只能点。v0.22 补上：

### 21.1 方向键跨块
- 在块编辑器里监听 CodeMirror 的 Up / Down / Left / Right（注意 CM5 的键名是 Up/Down/Left/Right，不是 ArrowUp）；
- Down：光标在最后一行时 → 提交当前块、打开下一块，光标在开头；
- Up：光标在第一行时 → 打开上一块，光标在末尾；
- Right / Left：光标在块首/块尾时同理（有选区时不拦截，保留正常选择）；
- 切换用 beginEdit 直接切 index（文本没变，不需要 pending 重解析），编辑器按 key 重新挂载。

### 21.2 表格 Tab
- 表格块里 Tab / Shift+Tab 不再插空格，而是在单元格之间移动：
  - Tab：找光标后的下一个 |，跳过空格落到下一格；行尾 → 下一行第一格；最后一行 → 自动补一行；
  - Shift+Tab：找光标前一个 |，回到上一格；行首 → 上一行最后一格。

### 21.3 验证
- 点第 1 块按 Down → 编辑器换成第 2 块且光标 index 0；再按 Up → 回到第 1 块、值完全一致；
- 表格块里光标在 ch=2 按 Tab → 同一行 ch 变大（进入下一格）；
- 其余用例（实时分段、插段落、合并、撤销/重做、Ctrl+B、Tab 缩进）全部仍然通过。

### 21.4 还没做的
- Obsidian 的逐行 Live Preview（当前行源码、同块其它行渲染）；
- 撤销恢复光标位置；
- 表格列宽/对齐。

---

## 22. v0.23.0：逐行 Live Preview 近似

Obsidian Live Preview 的关键观感：光标所在行显示 Markdown 原文，同一块里其它行已经渲染好。之前我们整个块都是源码。v0.23 用 CodeMirror 的 markText 做近似：

### 22.1 做法
- 编辑器挂载后注册 cursorActivity（立即）和 change（80ms 防抖）→ decorate()；
- decorate 先清掉上一次的 mark 和行 class，再逐行处理：
  - 跳过围栏代码块内部（``` / ~~~ 计数）；
  - 跳过光标所在行（保持原文，和 Obsidian 一致）；
  - 行首 # 标题 → 隐藏标记 + 行 class gh-md-lp-h1..h6（字号/字重）；
  - 行首 > 引用 → 隐藏标记 + 行 class gh-md-lp-quote（左边框）；
  - 行内：反引号代码 / **粗体** / __粗体__ / ~~删除线~~ / *斜体* / _斜体_ / [链接](url)
    → markText 隐藏两侧标记，内容套 gh-md-lp-code / -strong / -strike / -em / -link；
- 最后 refresh() 并重算高度（标题字号会改变行高）。

### 22.2 验证
- 最小文档（标题 + 四行列表）点列表块：初始光标在第 0 行，marks 9 个且全部在 1-3 行，当前行 0 个；
- 光标移到第 1 行后：strong 出现（第 0 行变样式）、em 消失（第 1 行回到原文）、hidden 6 个；
- cm.getValue() 始终是原始 Markdown，未被装饰影响。

### 22.3 局限
- 只是「隐藏标记 + 行内样式」，不是完整渲染：块内图片、表格、代码块、列表符号仍是源码形式；
- 被隐藏的标记在 DOM 里占 0 宽，点击定位可能略有偏移（点到的行会立刻恢复原文）；
- 代码块内部不做逐行渲染。

---

## 23. v0.24.0：非当前行直接预览图片

Obsidian Live Preview 里，光标不在图片那一行时图片是渲染出来的；我们之前只有渲染态才显示图片。v0.24 把图片也接进编辑器：

### 23.1 做法
- decorate 的行内 token 正则最前面加图片：`![alt](src)`；
- 非当前行命中图片且能解析出 URL 时，用 markText 的 replacedWith 塞一个 `<span class="gh-md-lp-image"><img></span>` 小部件，整段 token 被图片替换；
- 解析不了的（相对路径没有文档路径、协议不支持等）就只隐藏原文；
- 图片 load 后 refresh + 重算编辑器高度，避免行高被裁；
- URL 解析规则与渲染态一致：绝对 URL 保留，相对路径按当前文档目录拼成 `api/file?path=...`（BlockEditor 拿不到 createMarkdownRenderer 闭包里的 resolveImage，所以在 MarkdownBody 里复制了一份 resolveImageForEditor）。

### 23.2 验证
- 列表块最后一行 `- ![pic](pic.png)`，光标在第 0 行：getAllMarks 里出现 1 个带 replacedWith 的 mark（范围在第 4 行），其余行的 em/code/link 标记照常；
- 光标移到第 1 行后，strong 出现、em 消失，图片 mark 仍在；
- cm.getValue() 始终是原始 Markdown；其余 e2e 用例与 render-smoke 全部通过。

### 23.3 局限
- jsdom 只验证了 mark 的 replacedWith 存在，真实浏览器里的图片渲染还要等用户刷新确认；
- 表格、代码块、列表符号仍不是完整渲染；
- 图片加载前后行高变化可能让光标位置有轻微跳动。

---

## 24. v0.25.0：阅读态任务列表复选框可点

Obsidian 里阅读/实时预览态点任务列表的复选框就能勾选，不需要进编辑模式。v0.25 补上：

### 24.1 做法
- sanitize 之后的后处理里，把所有 `input[type=checkbox]` 的 `disabled` 去掉并加 `gh-md-task-checkbox` 类（否则浏览器不会派发 click）；
- onDocumentClick 最前面拦截 `.gh-md-task-checkbox`：
  - 从最近的 `[data-gh-md-block]` 拿块下标，从 blocksRef 拿 raw 范围（加 frontmatter 前缀）；
  - 数这个块里复选框的 DOM 序号，对应 raw 里第 n 个 `- [ ]` / `- [x]`（支持 `*` `+` 和有序列表）；
  - 把 `[ ]` ↔ `[x]` 翻转，setDocText + recordHistory + scheduleSave；
  - preventDefault，避免浏览器先改 checked 状态；
- 不进入编辑模式，点完直接保存并重渲染。

### 24.2 验证
- 文档 "# Tasks / - [ ] first / - [x] second"：渲染出 2 个复选框、0 个 disabled；
- 点第一个 → 保存内容变成 "- [x] first"（第二个保持 [x]）；
- 再点第二个 → 保存内容变成 "- [ ] second"；
- 点击后没有打开块编辑器；无异常。

### 24.3 局限
- 复选框序号按 DOM 顺序对应 raw 里的任务行，代码块里恰好有 `- [ ]` 文本时可能错位（罕见）；
- 只处理 `- [ ]` 形式，`[ ]` 在段落里（非列表）不处理。

---

## 25. v0.26.0：代码围栏与列表符号的 Live Preview

### 25.1 代码围栏
- decorate 里遇到 ``` / ~~~ 行：非当前行把整行标记隐藏（display:none），并给该行加 gh-md-lp-fence（淡色）；
- 围栏内的行加 gh-md-lp-codeblock：等宽字体 + 浅背景；当前行也加（Obsidian 里代码块内容即使是当前行也是代码字体）；
- 围栏状态用奇偶翻转，嵌套/未闭合时按最接近的行为处理。

### 25.2 列表符号
- 非当前行的 `-` / `*` / `+` 列表符号用 replacedWith 换成 `•` 小部件（gh-md-lp-bullet）；
- 有序列表的数字标记只上色（gh-md-lp-bullet-number），不替换文字；
- 行内格式（粗体/斜体/行内代码/链接）继续在同一行处理，位置按原始 ch 计算，不受替换影响。

### 25.3 验证
- 列表块（4 个列表项）光标在第 0 行：bullet widgets = 4（非当前行的 4 个符号）；
- 代码块（```js / const x = 1 / ```）光标在围栏行：lineInfo(0..2).wrapClass = [fence, codeblock, fence]，围栏隐藏 mark 1 个（闭合围栏），值未变；
- 其余用例（实时分段、合并、撤销、表格、任务框、图片）全部通过，render-smoke 全过。

### 25.4 局限
- 代码块没有语法高亮（渲染态有 Shiki，编辑器里只有等宽 + 背景）；
- 表格仍是源码形式；
- 围栏行被隐藏后，点击围栏位置的光标映射会有偏移（点到的行会恢复原文）。

---

## 26. v0.27.0：点表格格子定位 + Ctrl+Enter 勾选任务

### 26.1 点渲染态表格的格子
- 之前点表格任何位置都只是「打开整个表格块」，光标靠渲染文本换算，常落在第一行；
- 现在 onDocumentClick 里对 block.type === table 走 tableCellOffsetOfClick：
  - 从点击目标 closest(td, th) 拿单元格，再拿它在 thead/tbody 里的行号与列号；
  - 表头行 → raw 第 0 行；tbody 第 n 行 → raw 第 n+2 行（第 1 行是分隔线）；
  - 在该行里数第 cellIndex 个 |，跳到后面第一个非空格字符；
  - 把行内偏移换算成块内偏移，beginEdit 的光标就落在那个格子开头。

### 26.2 Ctrl+Enter 勾选任务
- 块编辑器里 Ctrl+Enter / Cmd+Enter：当前行匹配 `- [ ]` / `- [x]` 就翻转方括号里的字符；
- 不匹配时返回 false，交给默认行为（不会吞键）。

### 26.3 验证
- 表格 `| A | B | / | --- | --- | / | a1 | b1 |`：点 b1 单元格 → 编辑器值不变、光标 index 31（raw 第 2 行第 7 列，正好是 b1 的 b）；
- 任务列表编辑器里 Ctrl+Enter：第一行 `- [ ] first` → `- [x] first`；第二行 `- [x] second` → `- [ ] second`；
- 其余用例（实时分段、合并、撤销、表格 Enter/Tab、图片、代码块样式）全部通过，render-smoke 全过。

### 26.4 局限
- 表格仍然是源码形式（点格子只是把光标放对位置），没有表格渲染态；
- 单元格里有 `<br>` / 链接时，光标仍落在格子开头而不是具体字符。

---

## 27. v0.28.0：空列表项退出、多行缩进

### 27.1 空列表项 Enter 退出列表
- insertMarkdownNewline 里先匹配 `^\s*([-*+]|\d+[.)])\s*$`（只有标记没有内容）：去掉整行内容、光标回到行首，不再续写下一项；
- 块编辑器 Enter 的 inList 判定改成 `([-*+]|\d+[.)])(\s+|$)`，否则空列表项会被当成正文走 splitBlock，永远进不到 insertMarkdownNewline。

### 27.2 多行 Tab / Shift+Tab
- Tab：选区跨多行时，对每一行行首插两个空格（cm.operation 批量执行）；单行仍是插入两个空格；
- Shift+Tab：选区跨多行时，每行去掉行首 1-2 个空格；单行仍按光标所在行去掉缩进；
- 表格块仍然优先走 moveTableCell。

### 27.3 验证
- 文档 "- item one / - item two / -"：光标在最后一行的 "-" 上按 Enter → 值变成 "- item one\n- item two\n"（标记被去掉）；
- 选中两行按 Tab → 两行都变成两个空格开头；再选中按 Shift+Tab → 回到两个空格；
- 其余用例（实时分段、合并、撤销、表格、任务框、图片、代码块）全部通过，render-smoke 全过。

### 27.4 试过但撤掉的
- 「选区上粘贴 URL 变成 [文字](url)」：jsdom 里 paste 事件的行为和真实浏览器不一致，验证不了就先撤掉，等能在真实窗口里测再加。

---

## 28. v0.29.0：编辑器内 Ctrl+Z 退回整篇撤销

之前 Ctrl+Z 只在「没在编辑」时生效；在块编辑器里按 Ctrl+Z 只能撤本地输入，本地历史用完后就没反应了。v0.29 把两层历史接起来：

### 28.1 做法
- BlockEditor 的 extraKeys 里绑 Ctrl-Z / Cmd-Z：`cm.historySize().undo > 0` 时返回 false（交给 CodeMirror 自己撤销），否则调用父组件的 onUndo；
- Ctrl-Y / Cmd-Shift-Z 同理走 onRedo；
- 父组件把 undoRef / redoRef 包成 onUndo / onRedo 传下去；
- applyHistoryText 在换文本前先清掉 editingRef / editing 状态：否则撤销后旧编辑器还挂着，偏移已经不对，提交会把文本写坏。

### 28.2 验证
- 文档 "# Head / AAA / BBB / CCC"：点 BBB 输入 ZZZ、Esc 提交（保存含 ZZZ）；
- 再点 AAA（新编辑器本地 undo = 0），按 Ctrl+Z → 保存内容里的 ZZZ 消失、编辑器被卸载；
- 在文档上按 Ctrl+Shift+Z → ZZZ 回来；
- 其余用例（实时分段、合并、列表退出、多行缩进、表格、任务框、图片、代码块）全部通过，render-smoke 全过。

### 28.3 局限
- 整篇撤销后光标不回到原位置（只回滚文本）；
- 撤销历史是纯文本快照，块级结构变化（合并/分段）也按整篇文本回滚。

---

## 29. v0.30.0：代码块的简单语法着色

Obsidian 的代码块在实时预览里有语法高亮；我们之前只有等宽字体 + 浅背景。v0.30 用正则做一个轻量着色：

### 29.1 做法
- decorate 里围栏内的行（除了围栏标记行）额外跑一个 token 正则：注释（//、#）、字符串（单/双/反引号）、数字、常见关键字；
- 每个 token 用 markText 套 gh-md-hl-keyword / -string / -comment / -number，颜色沿用 GitHub 风格的深红/深蓝/灰；
- 当前行也着色（Obsidian 里代码内容即使当前行也是高亮字体）；
- 只处理单行 token：跨行注释、多行字符串不识别。

### 29.2 验证
- 代码块 ```js / const x = 1 / ```：进入编辑后 keyword marks = 1（const）、number marks = 1（1）；
- 围栏行仍隐藏标记、内容行仍有 codeblock 行 class；值未变；
- 其余用例全部通过，render-smoke 全过。

### 29.3 局限
- 正则着色不是真语法分析：语言关键字表是通用的，字符串里的 # 会被当注释、嵌套模板字符串不准确；
- 渲染态（非编辑）仍是 Shiki 完整高亮，两边颜色不完全一致。

---

## 30. v0.31.0：输入法组合期暂停装饰重算

逐行 Live Preview 会在 change / cursorActivity 时清掉并重建 markText、调用 refresh() 和 setSize()。中文输入法（IME）在组合候选词期间，这些操作可能打断候选词或把组合中的拼音标成已输入文本。v0.31 加保护：

### 30.1 做法
- 在 CodeMirror 的输入框上监听 compositionstart / compositionend；
- compositionstart 时置 composing = true，decorate() 直接返回（不清 mark、不 refresh、不改尺寸）；
- compositionend 时置 false 并立即 decorate() 一次，把候选词落定后的文本重新装饰；
- 输入法组合期间光标移动也只会累积，不会触发装饰重算。

### 30.2 验证
- 列表块里：光标在第 1 行时 code mark = 1；
- 派发 compositionstart 后把光标移到第 2 行（该行有行内代码）：等 500ms，code mark 仍是 1（装饰没重算）；
- 派发 compositionend 后再等 500ms，code mark 变成 0（第 2 行成为当前行，代码标记被移除）；
- 其余用例全部通过，render-smoke 全过。

### 30.3 局限
- jsdom 只能模拟 composition 事件，真实输入法的候选词行为要在真实窗口里确认；
- 组合期间若发生提交（Esc/点走），装饰会留到下次光标活动再更新，不影响文本内容。

---

## 31. v0.32.0：表格单元格内联编辑

Obsidian 里点表格格子，表格保持渲染态、当前格子变成可编辑；之前我们点格子是打开整块源码编辑器（光标定位到格子开头）。v0.32 改成内联输入框：

### 31.1 做法
- onDocumentClick 最前面（任务框之后）拦截 `td, th`：从最近的块、thead/tbody 行号、行内单元格序号定位到 raw 里的字符区间（tableCellRange 去掉两侧空格）；
- 用 getBoundingClientRect 把格子位置换算成 .gh-md-document 内的绝对坐标，浮出一个 input（.gh-md-cell-input）；
- 输入过程中受控更新；Enter/Tab 提交、Esc 取消、失焦提交；
- 提交时把新文本写回表格 raw（换行转空格、`|` 转义成 `\|`），setDocText + recordHistory + scheduleSave；表格重新渲染；
- 点表格边框/空白（不是格子）仍然走原来的整块源码编辑器，方便加行/加列。

### 31.2 验证
- 表格 `| A | B | / | --- | --- | / | a1 | b1 |`：点 b1 → 浮出 input、值为 b1、没有打开源码编辑器；
- 改成 B1new 按 Enter → 保存内容变成 `| a1 | B1new |`；
- 再点 a1 改成 CANCELLED 按 Esc → 保存内容里没有 CANCELLED；
- 点块本身（不是格子）→ 仍然打开整块源码编辑器；
- 其余用例全部通过，render-smoke 全过。

### 31.3 局限
- 输入框是单行文本：格子里原来的 `**粗体**` 等标记会以原文显示，提交后保持原文（不会丢格式）；
- 换行、多段落写不进格子（会转成空格）；
- 点另一个格子时先失焦提交、再开新格子，快速连点时浮层位置可能有一帧偏差。

---

## 32. v0.33.0：撤销后闪烁定位

Obsidian 撤销会把光标放回改动位置；我们的整篇撤销是纯文本回滚，光标不会回去。v0.33 用一个折中：撤销/重做后滚动到改动位置并闪一下高亮。

### 32.1 做法
- recordHistory 增加第三个参数 offset（提交时记录改动位置：编辑起点、分段点、合并点）；
- applyHistoryText(next, offset) 换完文本后 setTimeout 0：按 offset 找到对应块，scrollIntoView({block:center}) 并加 gh-md-undo-flash 类；800ms 后移除；
- CSS 用 @keyframes gh-md-undo-flash 做背景色淡出。

### 32.2 验证
- 文档 "# Head / AAA / BBB / CCC"：点 BBB 输入 ZZZ、Esc 提交；再点 AAA、Ctrl+Z → 保存内容里 ZZZ 消失；
- 撤销后 200ms 内页面上有 .gh-md-undo-flash（1 个）；1300ms 后为 0；
- 其余用例全部通过，render-smoke 全过。

### 32.3 局限
- 只是视觉定位，不是真的把光标放回去（块编辑器没有打开）；
- offset 落在块边界时取包含该 offset 的块；空文档没有块可闪。

---

## 33. v0.34.0：按 Obsidian 官方文档重做实时预览语义（多 agent 研究）

用户反馈「还是没有做到正确的实时预览编辑」，要求去 obsidian 官网完整学习并记录细节后复刻。本轮用 3 个并行研究 agent 抓取官方文档/仓库/changelog（研究笔记在 `.dsh-scratch/research/`），产出 `SPEC-live-preview.md`，并先落地两处最影响观感的修正：

### 33.1 研究发现（关键）
- LP = 同一文本 buffer + 两套 presentation；活跃块显示源码、非活跃块渲染；打开笔记时不露语法（1.15.1 官方修复）。
- 当前行显示标记时**内容样式保留**：标记是独立 token（`cm-formatting-*`），淡化显示，文字仍是粗体/标题字号。
- **Enter = 单换行（同段落软换行）；Shift+Enter = 硬换行（`  \n`）；空行才分段**——我们此前的 Enter=分段/Shift+Enter=单换行正好相反。
- 表格在 LP 里永远是渲染态（单元格编辑 + 右键菜单）；代码块不用 Prism 高亮；渲染态链接单击即跳转；复选框点击即切换。
- 架构：CM5 的 markText(replacedWith) 只能 inline，无块级 widget → 表格/块级图片/嵌入做不出来；官方用 CM6，推荐中期迁移到 CM6 + 自研 LP 装饰（路线 B，90%+ 观感；路线 A 上限约 55–65%）。

### 33.2 本轮落地
- **当前行样式保留**：decorate 改为「当前行：标记淡化 + 内容样式保留；其它行：标记隐藏 + 内容样式保留」；图片在当前行显示源码、非当前行显示 widget；围栏行同理。
- **Enter/Shift+Enter 语义纠正**：Enter 插 `\n`（软换行），Shift+Enter 插 `  \n`（硬换行），空行才分段；块编辑器 Enter 不再触发 live split（保留 splitBlock 供后续使用）。
- **编辑面去盒子**：`.gh-md-block-editor` 去掉背景/边框/内边距，编辑态外观与渲染态一致（Obsidian 没有编辑框）。

### 33.3 验证
- harness-livepreview：当前行 hidden=0 / syntax=3、`**bold**` 内容 strong=1；光标移到第 1 行后 strong=1、em=1、hidden=6；IME 组合期 line2 hidden 2→2→0。
- harness-e2e：段中 Enter → `With t\nhe exact`；Shift+Enter → `  \n`；保存内容 `With t\nNEWPARA  \nhe exact`。
- 其余用例与 render-smoke 全过（run-all-checks）。

### 33.4 下一步
- P1（CM5）：表格右键菜单（增删行列/对齐）、代码块编辑态 copy、链接点击行为、图片全屏。
- P2（CM6）：esbuild 打包 CM6 + markdown，整篇 EditorView + activeBlock + 标记隐藏/淡化 + 行内 widget；P3 表格/代码块/图片 widget 与选区/IME 对齐。
- 真实 Obsidian 实例上逐条确认 SPEC 中 uncertain 项。

---

## 34. v0.35.0：CM6 原型验证（路线 B 第一步）

按 SPEC 的架构结论，CM5 的 `markText({replacedWith})` 只能放 inline 元素、没有块级 widget，无法做真正的表格/块级图片/嵌入。本轮先把 CM6 路线的最小闭环验证出来：

### 34.1 构建链
- 在 `.dsh-scratch/cm6build` 用 npm 装 esbuild 0.28.2 + @codemirror/{state,view,language,commands,lang-markdown}；
- esbuild 打成单文件 IIFE：`--format=iife --global-name=__ghMdCm6LivePreview --minify`；
- 产物 `vendor/cm6-live-preview.js`（502 KB），Host 的 `/github-md/vendor/*` 路由可直接发，客户端 `loadScriptOnce` 懒加载。

### 34.2 原型行为
- `createLivePreview({ parent, doc, onChange })` 创建整篇 EditorView；
- ViewPlugin 计算选区所在行 = 活跃行：非活跃行用 `Decoration.replace({})` 隐藏 Markdown 标记，活跃行用 `Decoration.mark` 淡化标记；内容始终套样式（strong/em/strike/code/link），标题行加行 class；
- 输入时 onChange 回传整篇文本。

### 34.3 jsdom 验证
- 初始光标第 1 行：文本 `# HeadSome bold and em and code text.`（标题标记可见、其它行标记隐藏）；
- 光标移到第 3 行：文本 `HeadSome **bold** and *em* and `code` text.`（第 1 行 `#` 隐藏、第 3 行标记显示）；
- strong/em/code/h1 类存在；doc round-trip 正确；输入触发 onChange；
- jsdom 缺 `getClientRects` 的报错属测试环境限制（真实浏览器不受影响）。

### 34.4 下一步
- 把 MarkdownBody 切到 EditorView（保留现有渲染管线作为只读 fallback）；
- 补块级 widget：图片、表格（含单元格编辑）、代码块（badge/copy）、任务复选框、链接、数学；
- 保存改 debounce + 跳过自己写入引起的 reload；
- 完成后删除/降级 CM5 块编辑器代码。

---

## 35. v0.36.0：CM6 原型的块级 widget

v0.35 只验证了「整篇 EditorView + 行内标记隐藏/淡化」。这轮把非活跃块真正渲染成组件（Obsidian LP 的视觉主体）：

### 35.1 实现
- 装饰从 ViewPlugin 改成 **StateField**：CM6 明确禁止插件（ViewPlugin）提供 block decoration，块级 widget 必须来自 StateField（`provide: field => EditorView.decorations.from(field)`）。
- 代码块：非活跃时整块（围栏行 + 内容）`Decoration.replace({ block: true, widget: CodeBlockWidget })`，widget 里有语言 badge + 复制按钮 + `<pre><code>`；活跃时围栏行淡化、内容保持原文。
- 表格：连续 `|` 行组成的块，非活跃时替换成 `TableWidget`（thead/tbody + 单元格文本）；活跃时按源码行显示。
- 图片：`![alt](src)` 非活跃时用 `ImageWidget` 替换，src 由 `resolveImage` 回调解析（按文档目录）；活跃时显示源码。
- 任务框：`- [ ]` / `- [x]` 非活跃时把 `[ ]` 替换成 checkbox widget（带 data-pos），点击通过 domEventHandlers 直接改源码 `[ ]` ↔ `[x]`。
- 链接：mark 装饰带 `data-href`，点击走 `window.__ghMdOpenLink`。
- 列表符号：非活跃时 `-`/`*`/`+` 替换成 `•` widget。

### 35.2 jsdom 验证（harness-cm6-prototype.mjs）
- doc round-trip、初始活跃行标记可见、非活跃行标记隐藏；
- 代码块 widget=1（语言 js）、表格 widget=1（单元格 a1）、图片 widget=1（src 由 resolver 解析）、任务框=2、链接 data-href 正确；
- 点击任务框后 doc 变成 `- [x] todo`；
- 光标进入代码块：代码 widget 消失、围栏行显示；光标进入图片行：图片 widget 消失、源码显示；
- 输入触发 onChange。

### 35.3 下一步
- 把 MarkdownBody 切到 EditorView（先用纯文本 + 这些 widget，图片/表格/代码块先按 widget 渲染；frontmatter/数学/embed 暂时保留旧渲染或显示源码）；
- 保存 debounce + 跳过自己写入引起的 reload；
- 表格的「光标在表格内仍渲染成表格 + 单元格编辑」需要 widget 内编辑（Obsidian 行为），留到 P3。

---

## 36. v0.37.0：CM6 Live Preview 正式接入（P2 第一版）

### 36.1 切换条件
- 可写文件（Host 精确读取成功，`exactRef = true`）+ CM6 包加载成功 → MarkdownBody 直接渲染 EditorView；
- 只读文件（工作区外）/ CM6 包加载失败 / `window.__ghMdCm6Disable = true` → 旧渲染管线 + CM5 块编辑器 fallback；
- 旧路径代码全部保留，方便回退和对比。

### 36.2 数据流
- 初始 `doc`：精确原文（LF 归一化）由 `docTextRef.current` 传入；
- `onChange`：更新 `docTextRef`、置 dirty、`scheduleSave()`（200ms debounce → persist 写盘，内容未变则跳过）；
- 外部内容变化（流式 / 保存后官方预览重载）：比较 EditorView 当前文本与 `docText`，不同才 dispatch 全量替换，相同不重置；
- 链接点击：`window.__ghMdOpenLink` 复制 URL 到剪贴板并显示保存提示；
- 任务框：bundle 内 domEventHandlers 直接改源码；
- 卸载：EditorView destroy + 既有 dirty flush（keepalive fetch）。

### 36.3 验证
- `harness-cm6-integration.mjs`：CM6 host/editor 挂载、api 存在、doc 正确；代码块 widget 1、表格 widget 1、任务框 1；dispatch 输入后 1200ms 内保存内容以输入字符开头；
- 旧 harness 全部加 `window.__ghMdCm6Disable = true`，继续验证 CM5 fallback 路径（语法、渲染冒烟、分段、合并、表格、任务框、撤销、IME 等）；
- `run-all-checks`：ALL CHECKS PASS。

### 36.4 已知限制（下一轮）
- 表格在光标进入时显示源码行（Obsidian 保持表格渲染 + 单元格编辑）；
- frontmatter / 数学 / 嵌入 / callout 还没 widget 化（CM6 模式下会显示源码）；
- 图片全屏、链接 Ctrl+Click、撤销选区语义待补；
- 真实浏览器里的观感需要用户 F5 后确认。

---

## 37. v0.38.0：数学 widget、IME 冻结、图片全屏

### 37.1 数学
- `$...$` / `$$...$$` 在非活跃行/块用 KaTeX widget 渲染；活跃时显示源码（`$$` 行淡化）。
- `renderMath` 由客户端注入（读 `vendorRef.current.katex`），KaTeX 未就绪时显示源码；vendor 加载完成后 dispatch 一次 selection 触发装饰重建，数学从源码切换成 widget。

### 37.2 IME
- StateField 装饰计算前检查 `composeState.composing`；组合期只 map 位置不重建，`compositionend` 后 dispatch `rebuildEffect` 强制重建。
- 这是中文输入正确性的关键：组合期重建装饰会打断候选词/光标。

### 37.3 图片
- 渲染态图片点击弹出全屏遮罩（fixed + 点击关闭）。

### 37.4 验证
- `harness-cm6-integration.mjs` 增加行内数学/块级数学断言（1/1）；
- 调试过程中发现两个工具链坑：`String.replace` 的替换串里 `$$` 会被折叠成 `$`（写 patch 脚本时要用函数替换），以及 KaTeX 需要在 vendor 就绪后强制重建装饰；
- `run-all-checks`：ALL CHECKS PASS。

### 37.5 下一步
- frontmatter / callout / 嵌入 widget；
- 表格在光标内保持渲染 + 单元格编辑（Obsidian 行为）；
- 链接 Ctrl+Click、撤销后的选区语义。

---

## 38. v0.39.0：frontmatter / callout / 高亮 / 双链 / 注释

### 38.1 新 widget / 行内规则
- **frontmatter**：文档第 1 行是 `---` 时，找闭合 `---`/`...`；非活跃整块替换成 `FrontmatterWidget`（「属性」卡片，key/value 行）；活跃时显示源码。
- **callout**：`> [!type] 标题` 起，连续 `>` 行成块；非活跃替换成 `CalloutWidget`（图标 + 颜色 + 标题 + 正文文本）；活跃显示源码。支持 note/info/tip/success/warning/danger/failure/question/example/quote/abstract/todo/bug。
- **`==高亮==`**：非活跃隐藏 `==`、内容加 `.gh-md-lp-highlight`（黄色底）；活跃淡化标记、仍高亮。
- **`%%注释%%`**：非活跃整段零宽隐藏；活跃淡化显示。
- **`[[目标|别名]]`**：非活跃隐藏 `[[`、`目标|`、`]]`，别名加链接样式并带 `data-href=目标`；活跃淡化显示源码。

### 38.2 验证
- `harness-cm6-integration.mjs` 新增断言：frontmatter widget 1、callout widget 1、highlight mark 1、注释隐藏、双链 data-href 存在；
- 原有断言（代码块/表格/任务框/行内数学/块级数学/保存）继续通过；
- `run-all-checks`：ALL CHECKS PASS。

### 38.3 下一步
- 表格「光标在表格内仍渲染 + 单元格编辑」；
- 嵌入 `![[...]]` 的渲染（需要 Host 读文件）；
- 链接 Ctrl+Click、撤销后的选区语义、真实浏览器观感确认。

---

## 39. v0.40.0：表格原地编辑

### 39.1 行为
- 表格在 LP 里始终是渲染态（不再因为光标在表格内而回退源码行）。
- 单元格 `contenteditable=plaintext-only`，直接输入即改源码。
- Tab / Shift+Tab 换格；Enter 非末行跳到下一行同列、末行追加新行；Esc 移到表格之后。

### 39.2 实现要点
- `TableWidget` 构造时记录 `tableFrom/tableTo`（装饰 range），输入时按当前 `view.state.doc` 重新解析单元格范围，避免编辑后偏移失效。
- `eq()` 恒 true 让 CM6 复用 DOM；`updateDOM` 用 `view.state.doc` 重新解析并更新未聚焦单元格 → 输入过程中焦点不丢。
- 单元格输入 → dispatch 替换该单元格源码文本 → 文档变化 → 装饰重建 → `updateDOM` 刷新其余单元格。
- 空表格行（无内容）会解析成空单元格，保持可编辑。

### 39.3 验证
- `harness-cm6-integration.mjs`：单元格改成 `edited` + 派发 input → 文档与保存内容都包含 `edited`；
- 其余断言（frontmatter/callout/高亮/双链/数学/代码块/任务框/保存）继续通过；
- `run-all-checks`：ALL CHECKS PASS。

### 39.4 已知限制
- 表格列对齐、增删行列右键菜单还没做；
- 单元格内的行内 Markdown（粗体/链接）目前按纯文本编辑；
- 真实浏览器里的焦点/Tab 行为需要用户确认。

---

## 40. v0.41.0：嵌入 ![[...]]

### 40.1 行为
- `![[笔记]]` / `![[笔记|尺寸]]`：非活跃行渲染成嵌入块（读取目标文件并用现有渲染器渲染），活跃行显示源码。
- 目标相对当前文档目录解析；无扩展名补 `.md`；读取走 Host `workspace/read`（工作区限制）。

### 40.2 实现
- bundle 新增 `EmbedWidget`；`host.resolveEmbed` 由客户端注入。
- 客户端 `resolveEmbed`：vendor 未就绪时 300ms 重试（最多 10 次）；容器 detached 则放弃；`createMarkdownRenderer(...).render(body, absolute)` 注入 `innerHTML`。
- 修了两个 bug：
  1. rebuild 分支的 `buildDecorations` 漏传 `host` → 重建后的嵌入 widget 没有 `resolveEmbed`；
  2. 初始 widget 在 vendor 未就绪时调用一次就放弃，DOM 复用不会重试 → 重试放进客户端回调。

### 40.3 验证
- `harness-cm6-integration.mjs`：`.gh-md-cm6-embed` 存在且渲染内容包含 `Head`；
- 注释断言修正为「减去嵌入内容后再检查 HIDDEN」（嵌入文档里也可能出现 `%%HIDDEN%%` 字面量）；
- `run-all-checks`：ALL CHECKS PASS。

### 40.4 已知限制
- 嵌入块里的任务框/链接点击不转发到主文档（只读渲染）；
- 嵌入递归深度 1（嵌入内容里的 `![[...]]` 不再展开）；
- 图片嵌入 `![[img.png]]` 目前按 Markdown 文本渲染，后续按扩展名分流。

---

## 41. v0.42.0：图片嵌入与表格右键菜单

### 41.1 图片嵌入
- `![[pic.png]]` 等图片扩展名：非活跃行渲染成 `ImageWidget`（`resolveImage` 解析路径），点击全屏；
- 其它扩展名仍走 `EmbedWidget`（笔记渲染）。

### 41.2 表格右键菜单
- 右键单元格 → `.gh-md-cm6-table-menu`：上方插入行 / 下方插入行 / 删除本行 / 左侧插入列 / 右侧插入列 / 删除本列 / 左对齐 / 居中对齐 / 右对齐。
- 动作：解析当前表格块（`parseTableBlock`：行、单元格、分隔行）→ 修改行/分隔数组 → `buildTableText` 重建整张表 → dispatch 替换。
- 菜单 fixed 定位，点击外部或 Esc 关闭；删除行/列时保留至少一行/一列。

### 41.3 验证
- `harness-cm6-integration.mjs`：`.gh-md-lp-image img` 1、右键出现菜单、点击「在上方插入行」后文档包含 `|  |  |`；
- 原有断言（表格单元格编辑、嵌入、frontmatter/callout/高亮/双链/数学/代码块/任务框/保存）继续通过；
- `run-all-checks`：ALL CHECKS PASS。

### 41.4 已知限制
- 菜单没有快捷键；对齐只改当前列分隔符；
- 表格单元格内联 Markdown 仍按纯文本编辑；
- 真实浏览器里右键菜单位置/焦点需要用户确认。

---

## 42. v0.43.0：真实浏览器验证与观感修复

### 42.1 验证链
- 新增 `real-browser-check.mjs`：headless Edge + playwright-core 加载 CM6 包，20 项断言（widget、隐藏标记、对齐、标题下划线、真实键入、onChange、console 错误）。
- 已加入 `run-all-checks`（第 12 个 harness）。

### 42.2 修复
- 移除 `syntaxHighlighting(defaultHighlightStyle)`：它给 Markdown 标题 token 加了下划线，真实浏览器里标题带下划线；我们的内容样式由自己的行/标记装饰负责。
- 表格：`th/td` 默认左对齐；解析分隔行 `:---:`/`---:`/`---` 并 per-column 应用到表头与单元格；右键菜单的对齐动作即时生效。

### 42.3 证据
- `cm6-real-browser-rendered.png` / `cm6-real-browser-active.png`（`.dsh-scratch/`）。
- `run-all-checks`：ALL CHECKS PASS（含 20/20 真实浏览器断言）。

### 42.4 下一步
- 表格单元格内联 Markdown、Ctrl+Click 链接、撤销选区语义；
- 在 DSH 真实 GUI 里再跑一遍（需要 GUI 授权 token，当前 401）。

---

## 43. v0.44.0：编辑命令与表格单元格行内 Markdown

### 43.1 编辑命令
- keymap 顺序：`editingKeymap`（Enter/Shift-Enter/Tab/Shift-Tab/Backspace）→ `defaultKeymap` → `historyKeymap`。
- Enter 用 `@codemirror/lang-markdown` 的 `insertNewlineContinueMarkup`：列表/任务项/引用自动续写，空项退出。
- Shift+Enter 自定义命令插入 `  \n` 硬换行；Tab/Shift-Tab 插入/删除两个空格；Backspace 用 `deleteMarkupBackward` 删标记。

### 43.2 表格单元格行内 Markdown
- `TableWidget` 初始渲染 + `updateDOM` 用 `host.renderInline`（客户端 `marked.parseInline` + `DOMPurify.sanitize`）渲染非聚焦单元格；
- `focusin`：切回源码文本并把光标放到末尾；`focusout`：重新渲染；
- 编辑中 `input` 事件同步 `dataset.raw` 与源码；vendor 未就绪时 300ms 重试最多 10 次。

### 43.3 验证
- jsdom `harness-cm6-integration.mjs`：单元格 `<strong>a1</strong>` / raw `**a1**`，其它断言继续通过；
- 真实浏览器（headless Edge）25 项：新增列表 Enter 续写（`- [ ] todo\n- [ ] `）、新项带内容、Tab 缩进（`  - [ ] item`）、Shift+Enter 硬换行、单元格行内 Markdown；全部 OK。
- 调试记录：测试脚本曾把焦点留在表格单元格里，导致后续键盘断言全跑进单元格；改为 `view.focus()` 后正常。

### 43.4 下一步
- Ctrl+Click 链接、撤销后的选区语义；
- 引用块 `>` 在 LP 下的整体样式（目前只做续写）；
- 真实 DSH GUI 内确认（需授权 token）。

---

## 44. v0.45.0：引用块与分隔线

### 44.1 实现
- 引用块：正则 `/^(\s*(?:>\s?)+)/` 取前缀长度 offset；非活跃行隐藏前缀并加 `.gh-md-lp-quote`（3px 左边线 + 次要色），活跃行淡化；后续行内扫描从 offset 之后开始。
- 分隔线：正则 `/^\s*(?:[-*_]\s*){3,}$/`；非活跃整行 `Decoration.replace({block:true, widget: HrWidget})`；活跃整行淡化。
- 修复：frontmatter 活跃（光标在属性区）时，原本两条 `---` 会落到分隔线分支各生成一条 `<hr>`；现在 frontmatter 分支在活跃时只淡化两端标记并跳过整块。

### 44.2 验证
- jsdom：引用 2 行、`>` 隐藏、`hr` 1 个；
- 真实浏览器 28 项：引用行 `border-left: 3px`、`>` 隐藏、`hr.gh-md-cm6-hr` 1 个、表格单元格内联 Markdown、列表 Enter 续写、Tab 缩进、Shift+Enter 硬换行全部 OK；
- `run-all-checks`：ALL CHECKS PASS。

### 44.3 下一步
- Ctrl+Click 链接、撤销选区语义；
- 有序列表序号渲染样式；
- 真实 DSH GUI 内确认（需要授权 token）。

---

## 45. v0.46.0：编辑快捷键、脚注引用、引用定义隐藏

### 45.1 快捷键（keymap 最前）
- `Mod-b` → 加粗包裹（选中文本包成 `**…**`）；`Mod-i` → 斜体包裹；无选区时插入标记并把光标放中间。
- `Mod-Shift-k` → `deleteLineCommand`：删除当前行（含行尾换行），与 Obsidian 的「删除行」一致。

### 45.2 脚注与引用定义
- `[^label]`：非活跃行 `Decoration.replace` 成 `FootnoteRefWidget`（`sup.gh-md-cm6-fnref`）；活跃行淡化源码。
- `[id]: url` 行：非活跃行 `Decoration.replace({})` 隐藏文本；活跃行淡化。

### 45.3 验证
- jsdom：`footnote ref widget: 1`、`reference definition hidden: true`；
- 真实浏览器：`Ctrl+B wraps selection` → 文档出现 `**Some**`；`Ctrl+Shift+K deletes line` → `Inline math` 行消失；脚注上标/引用定义隐藏断言通过；
- `run-all-checks`：ALL CHECKS PASS。

### 45.4 下一步
- Ctrl+Click 链接行为、有序列表序号样式、撤销选区语义；
- 真实 DSH GUI 内确认（需要授权 token）。

---

## 46. v0.47.0：有序列表重新编号、callout 行内 Markdown、Ctrl+Click

### 46.1 有序列表
- 扫描时维护 `orderedCount`/`orderedPrev`：连续有序行按起始数字递增；非活跃行用 `OrderedWidget` 替换数字标记，活跃行保留源码。

### 46.2 Callout 正文
- `CalloutWidget` 接收 `host`，正文按行 `host.renderInline` 后 `<br>` 拼接；vendor 未就绪时 300ms 重试最多 10 次（与表格单元格/嵌入一致）。

### 46.3 链接修饰键
- click 处理里把 `ctrlKey/metaKey` 作为第二参数传给 `__ghMdOpenLink`；客户端提示区分「普通点击」与「Ctrl+Click：新面板」。

### 46.4 验证
- jsdom：ordered numbering true、callout inline markdown true、ctrl click flag true；
- 真实浏览器：ordered list renumbers `["1. first","2. second","3. third"]`、callout `<strong>bold</strong>`、Ctrl+Click `{href:"Note A",newTab:true}`；
- `run-all-checks`：ALL CHECKS PASS。

### 46.5 下一步
- 撤销后的选区语义、嵌套列表缩进渲染、真实 GUI 验证（需要 token）。

---

## 47. v0.48.0：撤销/重做与外部内容同步保护

### 47.1 撤销/重做
- 显式绑定 `Mod-z` 撤销、`Mod-y` 重做、`Mod-Shift-z` 重做（macOS 习惯）；Windows 与 Obsidian 一致用 Ctrl+Y。
- 调试记录：Windows 上 `Control+Shift+z` 的 `event.key` 是 `Z`，CM6 的 `Mod-Shift-z` 绑定不匹配；Obsidian Windows 本来就用 Ctrl+Y，所以以 Ctrl+Y 为准。

### 47.2 同步保护
- 外部 `docText` 变化：尾部空白差异忽略；编辑器有焦点时挂起（`cm6PendingExternalRef`），`focusout` 后再应用；否则直接替换。
- 避免自动保存 → 官方预览回读 → 编辑器被整篇替换导致光标跳到开头。

### 47.3 验证
- 真实浏览器：输入 UNDO → Ctrl+Z 文本消失 → Ctrl+Y 文本恢复 → debounce 保存反映最终内容；
- `run-all-checks`：ALL CHECKS PASS（注意：runner 用「输出行里有没有 false」判断失败，测试输出里不能出现 boolean 字面量）。

### 47.4 下一步
- 嵌套列表缩进渲染、真实 GUI 验证（需要 token）。

---

## 48. v0.49.0：标签胶囊与脚注定义行

### 48.1 标签
- INLINE_PATTERN 增加 `#[\p{L}\p{N}_-]+`；非活跃行替换成 `TagWidget`（`.gh-md-lp-tag`），活跃行淡化源码。

### 48.2 脚注定义
- 行级分支：`^\s*\[[^\]]+\]:\s` 的脚注定义行整行保留文本（跳过行内扫描），避免定义里的 `[^1]` 被渲染成上标；非活跃行次要色。

### 48.3 验证
- jsdom：tag pill 1、footnote definition keeps text true；
- 真实浏览器：40/40 断言（含 tag、fndef、任务框、hr、引用、表格、快捷键、撤销/重做）；
- 测试经验：CM6 只渲染视口内的行；真实浏览器断言要么滚到目标位置，要么把目标行放进文档前部；本轮把任务行移到前部并把 viewport 加高到 1680。

### 48.4 下一步
- 真实 DSH GUI 验证（需要授权 token）；
- 嵌套列表缩进渲染、更多 Obsidian 命令。

---

## 49. v0.50.0：标题快捷键与任务复选框快捷键

### 49.1 命令
- `makeHeadingCommand(level)`：当前行去掉已有 `#` 后设为对应级别；已是同级别则移除标题。
- `toggleCheckboxCommand`：列表项有 `[ ]`/`[x]` 时切换；没有复选框时在标记后补 `[ ] `。

### 49.2 测试经验
- 浏览器会拦截 Ctrl+1（切标签页），真实浏览器断言改用合成 `KeyboardEvent` 派发到 `view.contentDOM`；
- 表格单元格输入改用 Playwright `insertText`，避免 `type` 在 contenteditable 上的焦点/输入法差异。

### 49.3 验证
- 真实浏览器 44/44：新增 Ctrl+1 设置/取消标题、Ctrl+Enter 勾选/取消任务框；
- `run-all-checks`：ALL CHECKS PASS。

### 49.4 下一步
- 真实 DSH GUI 验证（需要授权 token）；
- 更多 Obsidian 命令（列表切换、链接插入等）。

---

## 50. v0.51.0：与真实 Obsidian 1.15.1 对照

### 50.1 参考图
- 本机 Obsidian 1.15.1 正在运行，窗口标题 `README - jspace-repo - Obsidian 1.15.1`；用 Win32 `PrintWindow` 截窗口得到 `obsidian-window.png`。
- headless Edge 用同一份 README 跑我们的 bundle 得到 `our-readme-render.png`。

### 50.2 结论与修复
- 版式整体一致（标题层级、段落间距、表格、行内代码底色、链接色/下划线）。
- Obsidian 顶部「README」是 inline title（文件名），不是 Markdown 内容——DSH 不需要。
- 修复：链接文字是行内代码时（`[\`docs/X.md\`](docs/X.md)`）反引号外露；现在隐藏反引号、按链接渲染，断言 `link-with-code-label plain: true`。

### 50.3 验证
- jsdom 断言通过；`run-all-checks`：ALL CHECKS PASS。

### 50.4 下一步
- 继续用 Obsidian 参考图核对长尾样式（表格表头底色、代码块配色等）；
- 真实 DSH GUI 内确认（需要 token）。

---

## 51. v0.52.0：按真实 Obsidian probe 截图逐项对齐

### 51.1 方法
- 在 vault 里写临时 `_livepreview_probe.md`，用 `obsidian://open?vault=jspace-repo&file=_livepreview_probe` 打开，`PrintWindow` 截图；
- 同一份文件用 headless Edge + 我们的 bundle 渲染；两张图对照；
- 结束后关闭标签页并删除临时文件。

### 51.2 修复项
- 代码块：全名语言标签（`LANG_LABELS`）、Shiki 高亮（客户端 `renderCode` → `__githubMdShiki.highlight`，Shiki 就绪后重建装饰）、复制按钮 hover 显示；
- 任务：已完成加 `.gh-md-lp-task-done` 删除线，复选框 accent-color；任务行不再画 bullet；
- `#tag` 改纯色；引用文字改正文色。

### 51.3 验证
- probe stats：codeHtmlHasSpan true、codeLabel JavaScript、taskDoneLines 1、tags 1、callout body 有 `<strong>`；
- `run-all-checks`：ALL CHECKS PASS。

### 51.4 下一步
- 继续用 probe 对照标题字号/间距、表格表头底色等长尾样式；
- 真实 DSH GUI 内确认（需要 token）。

---

## 52. v0.53.0：标题尺寸与编辑视图可见元素

### 52.1 标题尺寸
- 读取 `obsidian-1.15.1.asar` 内默认主题：h1 1.618em / h2 1.462em / h3 1.318em / h4 1.188em / h5 1.076em / h6 1em；h1 700、其余 600；行高 1.2/1.2/1.3/1.4/1.5/1.5。
- CSS 已替换为这些值。

### 52.2 实测修正
- probe 文件实测：`<!-- HTML 注释 -->`、`%%注释%%`、`^block-id` 在 Live Preview 中都是可见文本；此前的「隐藏」行为已回退。
- 这是本轮的第二次「实测推翻文档假设」：网上/早期笔记说注释隐藏，实际只在 Reading view 隐藏。

### 52.3 验证
- probe stats commentVisible/blockIdVisible true；`run-all-checks` ALL CHECKS PASS；
- probe 文件与 Obsidian 标签页已清理。

---

## 53. v0.54.0：折叠 callout 与图片尺寸

### 53.1 callout
- `> [!type]-` 默认收起、`+`/无标记展开；标题右侧 ▸/▾；点击标题切换。
- 点击事件 `preventDefault + stopPropagation`：否则点击会把光标带进 callout 块，widget 变回源码（真实浏览器里发现的 bug）。

### 53.2 图片尺寸
- `![[pic.png|120]]` → `img.style.width = 120px`。
- 修复：此前先截掉 `|` 后面的内容再解析尺寸；现在保留原始 token 再 split。

### 53.3 验证
- jsdom / 真实浏览器（47/47）都覆盖折叠与尺寸；`run-all-checks` ALL CHECKS PASS。

---

## 54. v0.55.0：callout 块级正文

### 54.1 实测
- Obsidian probe：callout 正文里的段落/列表/代码块都渲染（列表有圆点、代码块有底色）。

### 54.2 实现
- 客户端新增 `renderBlocks(text)`（复用 `createMarkdownRenderer().render`），首次使用时创建并缓存渲染器；Shiki 加载后失效缓存。
- `CalloutWidget` 优先 `host.renderBlocks`，重试 10 次后回退逐行 inline；块级元素间距收紧。
- 折叠箭头只在 `-`/`+` 显式标记时显示。

### 54.3 验证
- jsdom：`callout block content: true`；真实浏览器 48/48；`run-all-checks` ALL CHECKS PASS；
- probe 文件与 Obsidian 标签页已清理。

---

## 55. v0.56.0：缩进单位与 probe2 覆盖

### 55.1 缩进
- Obsidian 默认 `--indent-size: 4`（asar 内 CSS 变量），vault 的 `.obsidian/app.json` 为空对象即用默认值。
- Tab：列表行整行缩进 4 空格（行首插入），非列表行插入 4 空格；Shift+Tab：删除行首 1-4 个空格；
- facet `EditorState.tabSize.of(4)`。

### 55.2 probe2 对照
- 一致：标题内行内代码、~~删除线~~、^sup^/~sub~ 显示原文、嵌套列表/任务、表格三向对齐、Python 代码块高亮。
- 已知差异：嵌套引用 `> >` 目前展平（只有一层引用条），记录待后续。

### 55.3 验证
- 真实浏览器 51/51；`run-all-checks` ALL CHECKS PASS。

---

## 56. v0.57.0：嵌套引用

### 56.1 实现
- `> > text` 按 `>` 数量算深度（1-3），行类 `gh-md-lp-quote-depth-N`；
- depth 2/3 增加左内边距并用 `::before` 画第二根引用条；
- 深度 1 保持原样（单条 + 10px 内边距）。

### 56.2 验证
- 真实浏览器：`nested quote depth rendered — count=1`；52/52；
- jsdom 限制：CM6 块级 widget 在 jsdom 里会把多行合并为一个 `.cm-line`，该用例在 jsdom 不可见；以真实浏览器为准。

---

## 57. v0.58.0：行内 HTML

### 57.1 实测
- Obsidian probe 证明 LP 会渲染行内 HTML：kbd/sup/sub/mark/u/span style/b/i，HTML 注释淡化。

### 57.2 实现
- INLINE_PATTERN 增加注释、成对行内标签、br；白名单集合 `INLINE_HTML_TAGS`；
- 非活跃行 `InlineHtmlWidget`（contenteditable=false）内联渲染；客户端 `renderInlineHtml` 用 DOMPurify 白名单消毒（style/class/title 属性允许）；
- 活跃行显示源码并淡化；注释行淡化。

### 57.3 验证
- jsdom 与真实浏览器（55/55）均覆盖 kbd/sup/mark；`run-all-checks` ALL CHECKS PASS。

---

## 58. v0.59.0：列表参考线与嵌套有序列表编号

### 58.1 参考线
- 列表行 `floor(前导空格/4)` 得层级（≤2），行类 `gh-md-lp-list-guide-N`；
- `::before` 画 14px 处竖线，`::after` 画 38px 处竖线；颜色用 `--dsw-alias-border-l1`。

### 58.2 编号
- buildDecorations 里记录 `orderedDepthPrev`，缩进变化时重置计数，嵌套有序列表从源数字重新开始。

### 58.3 验证
- jsdom `list guide lines: 1`；真实浏览器 56/56（`list indentation guide rendered`）；
- jsdom 视口高度 0 导致靠后行不渲染，相关断言改为信息性输出。

---

## 59. v0.60.0：链接/粘贴快捷键与真实 GUI 现状

### 59.1 快捷键
- `Mod-k`：选区包 `[[...]]`，无选区插入 `[[]]`；
- `Mod-Shift-v`：读剪贴板纯文本插入；
- 冲突：Windows 的 `Ctrl+Shift+K` 产生大写 `K`，`Mod-k` 会先命中；补 `Mod-Shift-K` 绑定并让删除行优先。

### 59.2 真实 GUI
- Web GUI 401（需要 token）；桌面 App 无 remote-debugging 端口；
- 可用 PrintWindow 截桌面窗口，但当前只显示对话页，Markdown 预览面板未打开；
- 真实 GUI 验证仍需要用户手动打开预览面板或提供 token。

### 59.3 验证
- 真实浏览器 59/59；`run-all-checks` ALL CHECKS PASS。

---

## 60. v0.61.0：真实 GUI 自动化验证与光标恢复

### 60.1 自动化验证链路
- 临时 DSH_HOME + `verify` profile（dsh-base + dsh-web-app + 本插件），`dsh plugin install` 链接插件；
- Electron `ELECTRON_RUN_AS_NODE` 跑 asar 里的 `@deepseek-ai/dsh/lib/bin.js --profile verify --port 0 --no-open`，拿到带 token 的 URL；
- Playwright 打开、关弹窗、开右侧边栏、文件面板点 `_gui_verify.md`；断言 CM6 渲染 DOM、vendor 200、无 console error；
- 点击段落 → 标记可见；打字 → 自动保存；读磁盘确认写入。

### 60.2 修复的 bug
- 打字 200-400ms 后自动保存完成，官方预览重挂载 CM6 视图 → 光标回开头、焦点丢失；
- 方案：`onStateChange({head,focused,text})` 记录状态 + 模块级 `cm6EditorMemory`，重挂载后恢复 selection（文本一致时）与焦点；
- 结果：`AFTER TYPE 2.4s head=21 focused=true`。

### 60.3 其它
- CM6 focus-visible outline 去掉；GUI 面板虚线框是 DSH 官方 documentpreview 焦点指示，非插件样式。

---

## 61. v0.62.0：真实 GUI 编辑行为验证与撤销回退

### 61.1 验证
- `gui-behavior-check.mjs` 在真实 GUI 验证 8 项：点击聚焦、Enter 续写列表、Tab 缩进、Shift+Tab、Ctrl+Z、Ctrl+Y、自动保存落盘、保存后光标保持；结果 8/8。

### 61.2 撤销历史丢失（真实 GUI 发现）
- 自动保存后官方预览重挂载编辑器 → CM6 内存历史清空 → Ctrl+Z 失效；
- 修复：bundle `undoWithFallback`/`redoWithFallback` 先走 CM6，false 时用 host 快照；
- client `cm6HistoryMemory` 按路径记录文本快照（600ms 合并），撤销后整体替换文档并恢复 head。

### 61.3 测试经验
- 真实 GUI 里 `page.keyboard.press("Tab")` 会触发浏览器焦点导航，测试改用合成 KeyboardEvent；
- 点击列表中带 bullet widget 的行，textContent 不含 "-"，测试按可见文本查找。

---

## 62. v0.63.0：真实 GUI 扩展行为验证 11/11

- 新增断言：Shift+Enter 硬换行、Ctrl+B、Ctrl+1 开关、Ctrl+Enter 开关任务、Ctrl+K、表格单元格编辑（含落盘）、callout 展开、代码块复制到剪贴板；
- 与第一批 8 项合计 19 项真实 GUI 行为断言，全部通过；
- 经验：单元格输入是前插（断包容错）；剪贴板需授权；组合键用合成事件。

---

## 63. v0.64.0：真实 GUI 第三批验证与复选框点击修复

### 63.1 断言
- Backspace 去列表标记、Ctrl+Shift+K 删行、Ctrl+Shift+V 纯文本粘贴、点击复选框切换、选中替换、两次撤销，6/6。

### 63.2 复选框点击 bug
- TaskWidget 的 mousedown 会被 CM6 抢去移动光标 → 任务行活跃化 → widget 被源码替换 → click 丢失；
- 修复：input 直接处理 mousedown/click（preventDefault + stopPropagation，经 activeHost.view 派发），ignoreEvent(true)。

### 63.3 累计
- 真实 GUI 行为断言：第一批 8 + 第二批 11 + 第三批 6 = 25 项全过。

---

## 64. v0.65.0：点击进入编辑 + GUI 回归套件

### 64.1 点击块编辑
- callout/代码块 widget 之前 ignoreEvent(true)，点击无反应；
- 改为 false：mousedown 让 CM6 把光标放入块 → 活跃 → 源码可编辑；复制按钮单独 stopPropagation；
- 真实 GUI 断言通过（callout 0 widget + 光标在 `>` 行；代码块 0 widget + 光标在 ``` 行）。

### 64.2 回归套件
- `run-gui-suite.mjs` 自启真实 DSH 实例并跑 4 个脚本（8+11+6+2=27 项），输出 `GUI SUITE: 4/4 scripts green`。

### 64.3 稳定性
- 自动保存重挂载导致 Tab/撤销偶发失败：测试等待保存稳定并重试。

---

## 65. v0.66.0：frontmatter / 数学 / 脚注点击编辑

- FrontmatterWidget 与 MathWidget 的 ignoreEvent 改为 false；
- 点击 frontmatter → YAML 源码；点击 $$ 块 → `$$` 行；点击 `$x^2$` → 该行源码；点击 `[^1]` → 该行源码；
- 新增 gui-click-edit-check2.mjs（4 项），GUI 套件 5 个脚本 / 31 项断言全绿。

---

## 66. v0.67.0：表格 Tab 导航、Ctrl+S、纯文本粘贴

- 表格 wrapper keydown：Tab/Shift+Tab 在单元格间移动焦点并置光标于末尾；
- `Mod-s` → `saveNowCommand` → host.saveNow → client persist()；
- 富文本粘贴走 CM6 默认 → 纯文本；
- 真实 GUI 6/6；回归套件 6 脚本 / 37 项断言全绿。

---

## 67. v0.68.0：外部修改 / 链接 / 图片点击

### 67.1 外部修改
- 官方预览在文件变化后重挂载 CM6；聚焦时也会应用新内容，但历史 restoring 需要不依赖文本一致；
- 去掉 `memory.text === docText` 条件，按 offset 恢复 selection 并恢复焦点。

### 67.2 链接 / 图片点击
- click 阶段处理太晚：mousedown 已让行变活跃、节点被替换；改为 mousedown 阶段处理链接；
- 图片 widget 直接挂 mousedown/click 打开 overlay，ignoreEvent 改 true。

### 67.3 验证
- gui-behavior-check5.mjs 7/7；套件 7 脚本 / 44 项真实 GUI 断言全绿。

---

## 68. v0.69.0：标题折叠

### 68.1 状态与装饰
- `foldStateField` 存折叠标题的 from 位置，docChanged 时 mapPos；
- `FoldChevronWidget` 行首 inline widget，直接 mousedown/click 派发 `toggleFoldEffect`；
- 折叠用 `Decoration.replace({block:true, widget: FoldHiddenWidget})` 覆盖标题行尾到折叠结束行尾，并让 buildDecorations 跳过隐藏行；
- 折叠结束行 = 向下第一个 `#{1,6}` 级别 ≤ 当前级别的标题行。

### 68.2 验证
- 真实 GUI 6/6：箭头渲染、H1 折叠、文档不变、光标不动、展开、H2 只折叠子节；
- 套件 8 脚本 / 50 项断言全绿。

### 68.3 已知限制
- 折叠状态不跨重挂载持久化（重挂载后重置）；jsdom 下箭头文本混入行文本，测试放宽。

---

## 69. v0.70.0：折叠状态持久化

- bundle：`restoreFoldEffect` 按行号恢复；`onFoldChange` 上报折叠行号；
- client：`cm6FoldMemory` Map<sourcePath, number[]>，创建时传 `foldedLines`；
- 行号存储可容忍文档小改动；重挂载自动恢复；
- 真实 GUI 3/3；套件 9 脚本 / 53 项断言全绿。

---

## 70. v0.71.0：列表折叠 + Obsidian 对照

### 70.1 列表折叠
- BulletWidget 改为 wrap（chevron + 圆点），箭头位置=列表行 from，复用 foldStateField；
- 折叠范围按缩进判断：向下直到第一个非空且缩进 ≤ 当前项的行；
- 复用折叠记忆，重挂载后恢复。

### 70.2 与真实 Obsidian 对照
- Obsidian LP：HTML 注释可见但变暗、%% 注释与 ^blockid 普通文本、脚注定义可见并带编号；
- 我们一致（HTML 注释非活跃行 dim、%%/^id 普通文本、脚注上标 + 定义可见）。

### 70.3 验证
- 列表折叠真实 GUI 6/6；套件 10 脚本 / 59 项断言全绿。

---

## 71. v0.72.0：嵌入块点击、引用续写

- EmbedWidget 直接 mousedown/click：复制目标 + __ghMdOpenLink 提示；
- 引用/callout 行 Enter 续写由 lang-markdown 的 insertNewlineContinueMarkup 提供；
- 真实 GUI 4/4；套件 11 脚本 / 63 项断言全绿。

---

## 72. v0.73.0：完成态任务 / callout 折叠语义 / 表格菜单

- 完成任务：line class gh-md-lp-task-done + 隐藏 bullet + checkbox checked；
- callout [!tip]- 默认折叠、[!note]+ 默认展开，标题点击切换；
- 表格右键：居中对齐写 `:---:`，删除本列移除该列；
- 真实 GUI 5/5；套件 12 脚本 / 68 项断言全绿。

---

## 73. v0.74.0：有序列表折叠

- OrderedWidget 换成 wrap（chevron + 序号），复用 foldStateField/toggleFoldEffect；
- 折叠范围按缩进判断，与无序列表一致；
- 真实 GUI 6/6；套件 13 脚本 / 74 项断言全绿。

---

## 74. v0.75.0：任务列表折叠与列表符号隐藏

- TaskWidget 换 wrap（chevron + checkbox），foldPosition 复用 foldStateField；
- 折叠范围按缩进；渲染态把 `- ` 标记替换为空，行内只剩复选框；
- 真实 GUI 6/6；套件 14 脚本 / 80 项断言全绿。

---

## 75. v0.76.0：脚注定义渲染（与 Obsidian 对照）

- 全特性探针在真实 Obsidian 1.15.1 与我们的 GUI 各渲染一遍做逐项对照；
- 差异：Obsidian 把 `[^1]: text` 渲染为「上标 1 + text」；
- 修复：渲染态用 FootnoteRefWidget 替换 `[^1]:`，编辑态恢复源码；
- 真实 GUI 81 项断言全绿。

---

## 76. v0.77.0：Obsidian 视觉对照（CDP）

### 76.1 对照方法
- Obsidian 以 `--remote-debugging-port=9333` 启动，Playwright connectOverCDP 截 `.workspace-leaf.mod-active`（避免 PrintWindow 缓存旧帧）；
- 同一份全特性探针两边渲染比较。

### 76.2 修正
- wikilink：`.gh-md-lp-wikilink` 紫色 + 点线；
- tag：紫色胶囊；
- 引用：紫边（含嵌套）+ 次要文字色；
- callout：tip 青色 #00bfa5、标题强调色、补齐 Obsidian 调色板；
- 标题折叠箭头默认隐藏、代码块 head 改绝对定位浮层悬停显示。

### 76.3 验证
- 真实 GUI 样式断言 2 项新增；套件 14 脚本 / 83 项断言全绿；
- 宿主差异（行内标题、属性面板增删）保留 DSH 适配。

---

## 77. v0.78.0：callout SVG 图标

- CALLOUT_META 改为 Lucide 风格 SVG path；调用点 innerHTML 渲染 svg（stroke currentColor）；
- 图标色 = callout 强调色；CSS 15×15 inline-flex；
- 真实 GUI 9/9、套件 14 脚本 / 84 项断言全绿。

---

## 78. v0.79.0：frontmatter 胶囊 / 外链箭头 / 圆点颜色

- FrontmatterWidget 对 tags 行做逗号拆分胶囊；
- 外链 ::after 显示 ↗；圆点用 label-tertiary 色；
- 真实 GUI 12/12；套件 14 脚本 / 87 项断言全绿。

---

## 79. v0.80.0：空列表/空引用退出 + keymap 优先级

### 79.1 关键发现
- lang-markdown 用 `Prec.high` 注册 Enter/Backspace，普通 `keymap.of(editingKeymap)` 被抢占；
- 证据：Enter 命令里埋 `window.__ghMdLastEnter` 打印为 null；改 Prec.highest 后能打印 `{head, lineFrom, lineTo, text:"- "}`。

### 79.2 实现
- `Prec.highest(keymap.of(editingKeymap))`；`smartEnterCommand` 处理空列表项/空引用退出，其余回落 `insertNewlineContinueMarkup`。

### 79.3 套件稳定性
- 脚本间清理探针文件 + 400ms 间隔，消除跨脚本干扰（之前 click-edit-check2 偶发失败）。

### 79.4 验证
- 真实 GUI 3/3；套件 15 脚本 / 90 项断言全绿。

---

## 80. v0.81.0：快捷键复核

### 80.1 复核（keymap 优先级修复后）
- Backspace 残留空格 → smartBackspaceCommand 删除「缩进+标记+空格」；
- Ctrl+B/Ctrl+I 只能加不能减 → toggleWrapCommand（剥离自带标记 / 删除外侧标记 / 包裹）。

### 80.2 测试经验
- 断言要选「内容本身」而不是整行，否则测的是对整行包裹（行为本身正确）；
- 真实 GUI 复核前先确认 keymap 优先级（Prec.highest），否则测到的是 lang-markdown 的行为。

### 80.3 验证
- GUI KEYS 6/6；套件 16 脚本 / 96 项断言全绿。

---

## 81. v0.82.0：快捷键复核第二批

- Ctrl+Enter / Ctrl+Shift+K / Shift+Tab / 代码块 Tab / Ctrl+Shift+V 全部真实 GUI 通过；
- 代码块 Tab 为 4 空格（对齐 Obsidian `--indent-size: 4`），测试期望已修正；
- 套件 17 脚本 / 101 项断言全绿。

---

## 82. v0.83.0：表格与代码块交互

- 表格末单元格 Tab 不越界；单元格输入同步文档；
- 代码块 Enter 保持围栏；
- 套件 18 脚本 / 104 项断言全绿。

---

## 83. v0.84.0：Live Preview 核心语义验证

- 真实 GUI 断言：活跃行显示源码标记、非活跃块保持渲染、中文 IME 组合输入、Enter 续写、单次 Ctrl+Z 撤销；
- 这几项是 LP 的定义性语义，此前只在原型/jsdom 断言过，现在纳入真实 GUI 回归；
- 套件 19 脚本 / 109 项断言全绿。

---

## 84. v0.85.0：光标落点与导航

- 渲染态（零宽 replace 装饰）下点击落点精确：段落 75% 处 → 列 64；列表项中部 → 列 22；
- 方向键在行间移动正常；
- 套件 20 脚本 / 112 项断言全绿。

---

## 85. v0.86.0：嵌入笔记内联渲染

- `resolveEmbed` 读目标文件 → marked 渲染 → 写入嵌入容器；
- 真实 GUI 验证：内联标题/加粗/列表均渲染，占位不残留；
- 套件 21 脚本 / 114 项断言全绿。

---

## 86. v0.87.0：wikilink 悬停预览

### 86.1 实现
- bundle mouseover/mouseout → window 钩子；client effect 读取目标文件并渲染卡片；
- 卡片 fixed 定位 + 边界避让；mousemove 捕获阶段关闭（移出链接即消失）；
- 只对 wikilink 生效。

### 86.2 验证
- 真实 GUI 2/2；套件 22 脚本 / 116 项断言全绿。

---

## 87. v0.88.0：粘贴/拖入图片

### 87.1 链路
- bundle drop/paste → FileReader → host.insertAsset；
- client insertAsset → workbenchRequest("asset") POST base64 → 成功后插 `![[name]]`；
- host `/github-md/workspace/asset`：图片扩展名白名单 + 16MiB 上限 + mkdir -p + 写二进制。

### 87.2 踩坑
- bundle 的 host 是显式白名单对象，新选项必须加到 host 上，否则 `typeof host.insertAsset` 恒 undefined（首次测试两断言全失败的原因）。

### 87.3 验证
- 真实 GUI 2/2；套件 23 脚本 / 118 项断言全绿。

---

## 88. v0.89.0：自动配对与多选区

- closeBrackets() + closeBracketsKeymap + allowMultipleSelections；
- 自动配对只能通过真实按键测（走 inputHandler），dispatch 模拟输入测不到；
- bundle 导出 EditorSelection 便于测试；
- 真实 GUI 4/4；套件 24 脚本 / 122 项断言全绿。

---

## 89. v0.90.0：第三轮视觉对照

- 真实 Obsidian 截图（CDP）对照探针：代码块去边框 + 语言标签常显；表格按内容宽度（宿主全局 table{width:100%} 需 !important 覆盖）；hr 更淡更松；任务复选框固定紫色；
- 教训：宿主应用全局 CSS 会污染插件渲染，关键布局属性要显式覆盖；
- 套件维持 24 脚本 / 122 项断言全绿。

---

## 90. v0.91.0：边打边渲染

- 验证标题/列表/引用/加粗在输入后立即渲染（活跃行显示源码是正确语义）；
- 装饰类名是 gh-md-lp-strong；断言 class + computed font-weight；
- 套件 25 脚本 / 126 项断言全绿。

---

## 91. v0.92.0：行内元素回归

- 别名只显示别名、高亮样式、行内 kbd、%%注释%% 可见、两种图片语法、宽度语法 120px、callout 列表，7/7 全过；
- 本轮无代码改动，纯回归覆盖（前面几轮已实现）；
- 套件 26 脚本 / 133 项断言全绿。

---

## 92. v0.93.0：大文档性能优化

### 92.1 诊断
- 埋点 `window.__ghMdPerf.buildMs` 证明 `buildDecorations` 占单次编辑 74ms 中的 ~70ms；
- 全文档逐行 8+ 正则 + Decoration 创建是瓶颈（不是 DOM 渲染：line 节点只有 29 个）。

### 92.2 优化
- 装饰窗口 = `view.viewport` 对应行 ±200；`ranges` 改为带 `on` 开关的收集器；
- 视口外快速通道：只跟踪代码围栏，其余 `continue`；
- onChange 节流 120ms（saveNow/destroy 前 flush）；
- 滚动重建时焦点在表格单元格内则跳过（否则 DOM 替换导致输入丢失）。

### 92.3 结果与回归
- 6600 行：build 69.8→4.2ms、dispatch 74→9ms；新增 perf 回归脚本守阈值；
- 套件 27 脚本 / 137 项断言全绿；测试侧 getDoc 等待编辑器 + 失败重试一次，消除重挂载竞态。

---

## 93. v0.94.0：长文档滚动与视口重建

### 93.1 用真实长文档（693 行 README）做对照
- 发现三处真实缺陷：滚动后半部分空白（容器不可滚 + CM6 视口不更新）、滚动区域 Markdown 标记未渲染（DOM scroll 时机早于 viewport 更新）、顶层列表折叠箭头被裁剪点不到；
- 另外发现 `.gh-md-cm6-lp .cm-content` 选择器写错（类在元素自身），左内边距一直没生效。

### 93.2 修复
- 编辑器始终内部滚动；viewportChanged 驱动装饰重建；箭头改行内负边距 + 内容左内边距；表格单元格重建后恢复焦点。

### 93.3 回归
- 套件 27 脚本 / 137 项断言全绿；顺带把测试间竞态（重挂载、内容未刷新）处理掉。

---

## 94. v0.95.0：全篇滚动渲染回归

- 900+ 行文档在 8 个滚动位置采样，断言：有渲染 / 无原始 Markdown 残留 / 装饰存在；
- 全部通过，配合性能阈值形成「长文档既快又对」的双保险；
- 测试侧改为每脚本独立探针文件 + 通配清理 + 打开重试，套件 28 脚本 / 140 项断言稳定全绿。

---

## 95. v0.96.0：保存 → 重开 全链路

- 三条断言：自动保存落盘、磁盘与编辑器内容一致、重开后内容仍在；
- 不耦合宿主「关标签是否卸载」，改为数据一致性断言；
- 套件去重（Ctrl+Enter 只保留 behavior-check2 一处），29 脚本 / 143 项断言全绿。

---

## 96. v0.97.0：Alt+点击多光标

- allowMultipleSelections 不足以支持 Alt+点击，CM6 需要 clickAddsSelectionRange facet（实测无效）→ 自己在 mousedown 处理；
- 测试必须用 keyboard.down("Alt") 而非 click 的 modifiers（后者不给 mousedown 设 altKey）；
- 套件每 8 脚本重启验证实例，30 脚本 / 145 项断言稳定全绿。

---

## 97. v0.98.0：失焦即全渲染

### 97.1 差异
- 活跃块之前只依赖 selection，编辑器失焦后仍残留源码行；Obsidian 失焦时全部渲染。

### 97.2 修复
- `editorFocused` 模块状态 + `focusChanged` 重建 + 创建时用 `view.hasFocus` 初始化；
- jsdom harness 需显式 focus 才断言活跃行（已在 harness 里补）。

### 97.3 验证
- 真实 GUI 3/3；套件 31 脚本 / 148 项断言全绿。

---

## 98. v0.99.0：活跃块范围

- 真实 GUI 验证：多行选区覆盖行都显示源码、未覆盖块仍渲染、单光标只亮一行、callout 整块切源码；
- 本轮无代码改动，纯语义回归；套件 32 脚本 / 152 项断言全绿。

---

## 99. v0.100.0：Enter 语义与脚本健壮性

- 标题后 Enter 新建普通行、嵌套列表同层续写，两项纳入真实 GUI 回归；
- 回归脚本引入 `evalWithEditor`（带重试的 evaluate），消除重挂载竞态导致的偶发空指针；
- 套件 33 脚本 / 154 项断言全绿。

---

## 100. v0.101.0：快速输入不丢字

### 100.1 验证
- 36 字符快速输入：编辑器完整、磁盘与编辑器逐字一致；
- 输入后立刻 Ctrl+S / 切文件：flush 生效，最新字符不丢；
- 说明 0.93 引入的 onChange 节流没有引入数据丢失风险。

### 100.2 回归脚本
- 探针文件每脚本独立命名；关键读取加重试；关键阶段 ensureReady() 自动刷新重开；
- 套件 34 脚本 / 159 项断言全绿。

---

## 101. v0.102.0：复刻对照表

- PARITY.md 把 52 项行为、实现状态、对应回归脚本集中成一张表，作为「学习 Obsidian 并复刻」的验收清单；
- 不适用项都写明宿主限制原因，避免把「做不到」伪装成「已实现」。

---

## 102. v0.103.0：属性卡片逐行定位

- widget 记录 rowLines，点击行 → dispatch 到对应文档行；行为对齐 Obsidian「点哪个属性编辑哪个属性」；
- 顺带修正 click-edit-check2 的断言口径；套件 35 脚本 / 163 项断言全绿。

---

## 103. v0.104.0：聚焦黑框（CM6 baseTheme）

- 黑框来源是 CM6 baseTheme 的 `.cm-focused { outline: 1px dotted }`，此前误判为 DSH 面板焦点指示；
- 修复：对 `.cm-editor` 显式 `outline:none !important`（含 focus/focus-visible/cm-focused）；
- 教训：`.gh-md-cm6-lp` 类挂在 `.cm-content` 上，想覆盖 `.cm-editor` 必须用自身选择器。

---

## 104. v0.105.0：版式宽度偏好

- 用户偏好优先于 Obsidian 原版：表格铺满、图片去掉限高、页边距收紧到 8px；
- 差异记录在 PARITY.md「有意差异」小节，避免后续误当 bug 改回去；
- 套件 37 脚本 / 168 项断言。

---

## 105. v0.106.0：页边距与行宽（有依据的留白）

- 8px 页边距被否 → 改为「左右 24px、上 24 / 下 39（黄金比例）、正文列 max-width 72ch 居中」；
- 依据 Butterick《Practical Typography》的 line length（45–90 字符）与 page margins（由行宽反推、下边距略大、黄金比例可作比例）；
- 表格/图片仍铺满正文列（用户偏好），差异记录在 PARITY.md；套件 37 脚本 / 169 项断言。

---

## 106. v0.107.0：高度贴合内容、宽度不设上限

- 底部空白根因是 `min-height:60vh` + 固定 `height`；改为 `height:auto; max-height:calc(100vh-190px)`，短文档收缩到 118px（3 行）；
- 去掉正文列 `max-width:72ch`，铺满面板；页边距 16/24px；
- 长文档仍靠 `max-height` 维持可滚动容器，虚拟渲染与性能回归不变。

---

## 107. v0.108.0：行距与标题间距（实测对齐）

- 用 CDP 读真实 Obsidian 的 `.cm-line` 行盒：正文 1.5、标题 padding-top 16px、列表 1.2px；
- 本插件正文行高 1.65 → 1.5，标题补 16px 上内边距，列表不再额外加 padding（widget 自带高度）；
- 顺带确认折叠箭头与 Obsidian `.collapse-indicator` 同为「默认不可见、悬停显示」。

---

## 108. v0.109.0：表格/图片边距对齐 Obsidian

- 实测 Obsidian：表格外层 16px padding、单元格 4px/8px + 1px #e4e4e4 边框、表格按内容宽度、行高 1.3；图片 4px 圆角、无 margin、小图原尺寸；
- 另外发现宿主全局 `td{min-width:90px;white-space:pre}` 会把表格撑大（215px→119px 修复）；
- 新增 gui-media-check.mjs（7 条断言），width 测试同步改为「表格按内容收缩」。

---

## 109. v0.110.0：单元格行高与图片宽度

- 宿主 `.gh-md-document td{line-height:24px}` 会把单元格撑到 33px；单元格显式 `line-height:1.3!important` 后与 Obsidian 一致（29.8px）；
- 同内容表格宽度 131px = Obsidian 131px；`![[img|300]]` = 300px；`:---:` 对齐一致；
- media 测试 11 条断言，套件 39 脚本 / 189 项。

---

## 110. v0.111.0：图片行盒

- inline widget 的图片行会被「行距 + 两个 widgetBuffer（16px×2）」撑高 48px；
- 改为整行块级 widget 后占位 187.6px ≈ 图片高度（Obsidian 图片行即块级）；
- 只对图片扩展名生效，`![[笔记]]` 保持 `EmbedWidget`。

---

## 111. v0.112.0：只读路径表格顶格

- 顶格来自只读渲染路径的 GitHub 风格 `:first-child` 0 内边距；
- 两条路径（CM6 / 只读）现在共用同一组 Obsidian 实测值：4px 8px 内边距、1px #e4e4e4、16px/1.3、内容宽度、图片 4px 圆角；
- 顺带删掉强制 `min-width:560px` 的容器规则，窄栏改为自动换行。

---

## 112. v0.113.0：图片 lightbox

- Obsidian 的图片放大不是单击：LP 里双击、阅读视图里单击，打开 `.lightbox`（90% 黑底 + 文件名标题栏，无滚轮缩放）；
- 本插件改为双击打开同款灯箱；单击保持图片渲染（`ignoreEvent: true`），否则单击切源码会打断双击序列；
- 新增 8 条真实 GUI 断言。

---

## 113. v0.114.0：图片放大可靠性

- 事件从 widget 级改为 document 级连击检测（widget 会被 CM6 重建，导致 dblclick 丢失）；
- 灯箱 UI 集中到 client.js，两条渲染路径（CM6 / 只读）共用；
- callout 正文补图片嵌入渲染 + 点击隔离（此前只输出字面量 `![[...]]`）。

---

## 114. v1.0.0：公开发布

- 包名改为 `@paradeluxe/dsh-live-markdown`，仓库 https://github.com/Paradeluxe/dsh-live-markdown；
- 插件 id 与渲染器 id 同步改名；内部路由/样式类仍沿用 `github-md`（对外不可见，避免大范围改动引入风险）；
- 开发副本目录改为 `dsh-plugins/dsh-live-markdown`，验证 profile 通过 `link:` 指向它。

---

## 115. v1.0.1：单一真源

- 发布仓库即开发副本：`E:/hermes_playground/dsh-live-markdown`，验证 profile 用 `link:` 指向它；
- SPEC/DESIGN 从开发目录迁入 `docs/`，随仓库一起维护；
- 版本一致性检查（BUILD_STAMP = package.version，README/DESIGN 含同样版本串）继续生效。

---

## 116. v1.0.2：滚动位置记忆

- 每个文件在内存里记住 `scrollDOM.scrollTop`（滚动时 250ms 节流记录，销毁时再记一次），挂载后恢复；
- 目的：宿主重挂载预览或切换文件时不再跳回顶部（这类跳动在打字/保存后尤其明显）；
- 打字闪动的复现尝试：英文逐字、IME 组合输入、长文档内部滚动、小窗口，均未测得光标/滚动位移，留待更多现场信息。

---

## 117. v1.0.3：重挂载闪烁的根因与修法

- 实测（加 `[ghmd] branch/mount/unmount` 日志）：每次保存后宿主都会重建预览组件，`MarkdownBody` 从初始状态重新挂载，编辑器被销毁重建；保存防抖只有 200ms，因此连续打字时反复重建 → 画面闪、跳；
- 只 touch mtime 也会触发重建（与内容无关），确认是宿主的文件观察行为，插件侧无法阻止重建；
- 修法：保存防抖提到 700ms（减少重建频率）+ 卸载时把上一帧 `.cm-editor` DOM 克隆成占位，React ref 回调（paint 前）塞回宿主，新编辑器挂载后再替换；
- 逐帧采样（3 轮打字+保存，共 413 帧）：空白帧 3（初始加载阶段），占位/真实编辑器帧 410，占位残留 0。

### 117.1 补充（同一轮内）

- 占位克隆在重建窗口内可能与真实编辑器并存：挂载后按 `.cm-editor` 去重，只保留 `view.view.dom`；
- 占位克隆 `pointer-events:none`（不可交互），真实编辑器根节点打 `data-ghmd-live="1"` 便于诊断；
- 回归脚本因占位克隆而误把事件派发到死视图（embed/callout 用例），已改为只选 `[data-ghmd-live="1"]`，并给嵌入用例自带 `Note A.md` fixture。

---

## 118. v1.0.4：占位快照按文件隔离 + 撤销栈不再被重建打断

- 实测发现：宿主重建会丢弃 CM6 撤销栈（`two burst undo` 第二次失效），因此把保存防抖从 700ms 提到 **1500ms**，连续打字期间不再重建；实测该用例恢复通过。

- `cm6PlaceholderPath` 记录快照所属文件，ref 回调只在该文件匹配时使用，避免切文件瞬间闪上一篇内容；
- 复核：逐帧采样 413 帧，空白帧 3（仅初始加载）、占位帧 0、真实编辑器 410、残留占位 0；打字采样光标/滚动恒定。

### 118.1 兜底保存

- 防抖 1500ms 意味着关闭窗口可能丢最后 1.5 秒输入；改用 `pagehide` + `navigator.sendBeacon` 把待保存内容 POST 到 `/github-md/workspace/save`（不受导航取消影响），组件卸载时也 flush；
- 实测：把防抖临时改成 60 秒后输入 `BEACON-TAIL`，立即触发 `pagehide`，文件仍然落盘。

---

## 119. v1.0.5：可见期间零写盘 = 零重建 = 零闪烁

- 宿主的预览重建由"文件变化"触发；插件无法让宿主忽略自己的写入（`workspaceFiles` 只有 read/stat/list/changes，没有写接口），所以把写盘挪到看不见的时机；
- `scheduleSave`：可见（`document.hidden === false && document.hasFocus() === true`）时只记 dirty 并每 1.5s 复核，不写；不可见时立刻 `persist()`；
- `window.blur` / `visibilitychange` / 标签页卸载 / `pagehide` 都会 flush；`Ctrl+S` 仍立刻写；
- 可见兜底 30 分钟一次（防崩溃丢内容），jsdom 与测试覆盖模式（`window.__ghMdSaveDelay`）保持旧的"到点即写"行为；
- 实测：可见打字 350 帧，编辑器节点身份变化 0、空白帧 0、滚动位移 0；失焦后 1 秒内落盘。

---

## 120. v1.0.6：折叠箭头重做

- 旧实现：`▸/▾` 文字字形、`font-size: 10px`、14px 宽 + 负边距，基线对齐天然不准（标题实测低 2.5–4.5px）；
- 新实现：`createChevronNode()` 统一产出 `<span><svg viewBox="0 0 16 16"><path d="M6.3 4 10.3 8 6.3 12"/></svg></span>`；
- 尺寸 `--gh-md-chevron-size`（h1 20 → h6 15，列表 15），垂直位置 `--gh-md-chevron-shift`（按层级实测修正）；
- 旋转：展开 `rotate(90deg)`（指向下），`.is-folded` 时 `rotate(0deg)`（指向右），`cubic-bezier(.2,.7,.3,1)` 160ms；
- 交互：行悬停或折叠时 `opacity: 1`，悬停时 4% 圆形底；颜色走 `--dsw-alias-label-tertiary/secondary/primary`；
- callout 标题箭头复用同一套图标；
- 实测：h1–h6、无序、有序、任务全部与文字中心偏差 0–0.5px；点击折叠/展开正常（折叠后可见行 2 行、旋转 0°）。

---

## 121. v1.0.7：首帧样式修复

- 现象：重启 DSH 后第一次打开文档，会先出现一版「错误样式」再变成 Live Preview；
- 根因 1（时序）：ensureDocumentStyle 原在 useEffect，而 CM6 在 useLayoutEffect 创建 → 首帧无文档 CSS；修法：创建前注入 + 样式 effect 改 layout effect；
- 根因 2（回退）：cm6Loaded 初始 false，即使 bundle 已就绪也先渲染静态 Markdown；修法：模块初始化预热 bundle/vendor + cm6Loaded 同步初始化；
- 根因 3（异步可写性）：读取确认可写之前渲染静态排版；修法：新增 editableKnown，确认前渲染与编辑器同容器的空白占位（4s 超时回退静态）；
- 兜底：ResizeObserver 监听编辑器尺寸，变化时 updateDecorateWindow + rebuildEffect（首次测量为 0 或面板展开时自动修正装饰窗口）；
- 实测：打开文档后第一帧即 editor: true、staticBlocks: 0；预热在打开前完成；jsdom 集成测试保持旧行为（用 UA 判定，避免测试环境无 vendor 路由时空白）。

---

## 122. v1.0.8：链接复制的独立反馈

- 现象：点链接后右下角出现「已保存」；
- 根因：__ghMdOpenLink 复用保存状态条（setSaveState('saved') + setSaveMessage(链接已复制…)），而状态条 saved 分支只渲染固定文案「已保存」，saveMessage 只在 error 分支使用；
- 修法：新增 copyHint 状态与 .gh-md-copy-hint 提示条（链接已复制 + 地址，2s 自动消失，位于保存条上方），链接点击不再触碰 saveState；
- 验证：点链接 → 只有复制提示、无保存条、剪贴板正确、磁盘未变；真实保存仍显示 保存中… → 已保存。

---

## 123. v1.0.9：链接跳转

- 旧行为：__ghMdOpenLink 只复制链接（沙箱里没有导航接口时期的权宜之计）；
- 现在：body 注入的 props.useTabInfo() → tab.actions.openResource(address, { replaceTab: true }) 实现同面板跳转；
- 地址：以当前标签的 resourceAddress 为 base，new URL(target, base).href；wiki 链接（无扩展名）补 .md，保留 #锚点；
- 外部链接：window.open(url, "_blank") + opener=null；返回 null 视为被拦截，才退回复制提示；
- Ctrl/Cmd+Click：不传 replaceTab → 同一面板新标签打开；
- 实测：相对链接/ wiki 前后跳转均生效且标签数保持 1；外部链接打开新页面且无复制提示。

---

## 124. v1.0.10：链接打开新标签

- 1.0.9 用 replaceTab 替换当前标签，用户反馈像"覆盖"；改为 actions.openResource(address) 不带 replaceTab；
- 宿主默认行为：同一内容已打开则聚焦已有标签（去重），否则在活动面板新开标签；
- 外部链接仍 window.open 新页面；解析失败才退回复制提示；
- 实测：首次点击标签数 1→2 且原标签保留；切回原标签正常；重复点击同一目标标签数维持 2。

---

## 125. v1.1.0：表格加行/加列

**Obsidian 实测（1.15.1，CDP 读取 DOM/CSS）**：

- `.table-row-btn`：`top:100%; inset-inline-start:0; width:100%; height:16px; cursor:s-resize`，透明背景，`opacity:0`，悬停到按钮条自身时 `opacity:1`；`aria-label` 为「在下方新增行」；图标 lucide plus 16px；
- `.table-col-btn`：`inset-inline-start:100%; top:0; height:100%; width:16px; cursor:e-resize`；`aria-label`「在右侧新增列」；
- 点击后 Obsidian 会向表格追加空行 / 追加一整列（表头、分隔行、所有数据行同步补），并顺手把单元格按列宽补齐空格；
- 另有行/列拖拽手柄（`.table-row-drag-handle` / `.table-col-drag-handle`，grip 图标）与右键菜单，本次未实现拖拽手柄。

**本插件实现**：

- 表格 DOM 结构：`.gh-md-cm6-table`（relative）> `.gh-md-cm6-table-scroll`（padding 16px 0；overflow-x auto）> `.gh-md-cm6-table-box`（inline-block，含 table 与两个 `+` 条）；
- `+` 条用 `--gh-md-table-w/-h`（由 ResizeObserver 写入）精确定位在表格下缘与右缘；`opacity:0; pointer-events:none`，表格悬停时显示；
- 点击后调用共享的 `applyEdit(mutate)`：**事务 1** 打开 `tableSourceMode` 并 `rebuildEffect`（表格切成源码态，block widget 先卸载）→ **事务 2** 修改表格文本（此时范围内没有 widget）→ **事务 3** 关闭 `tableSourceMode` 并重建（新行/列渲染出来），然后把光标放到表格后一行；
- 右键菜单的所有行列操作复用同一个 `applyEdit`，因此也会立即刷新画面；
- `TableWidget.eq()` 保持恒真（CM6 中途替换整块 widget 会破坏高度表），DOM 刷新完全由上述三步保证。

---

## 126. v1.1.1：渲染器显示名

- 下拉框显示名：zh `实时预览 Markdown`、en `Live Preview Markdown`（原为 GitHub 风格 / GitHub-style，插件改名后遗留）；
- 仅改 `documentPreviews.register` 的 `title` 文案，内部 id / 路由前缀 `/github-md/*` / 设置键 `github-md:settings:v1` 保持不变，避免已开标签和用户设置失联。

---

## 127. v1.1.2：显示名统一为纯英文

- `documentPreviews.register` 的 `title` 在 zh / en 两个 locale 下统一为 `Live Preview Markdown`，不再中英混排；
- 内部 id / `/github-md/*` 路由 / `github-md:settings:v1` 设置键保持不变。

---

## 128. v1.1.3：灯箱滚轮缩放

- 灯箱（`.gh-md-lightbox`）内部状态：`scale`（0.25–8）、`offsetX/offsetY`；`transform: translate(...) scale(...)`，`transform-origin: center`；
- 滚轮：`factor = exp(-deltaY * 0.0016)`，按指针到视口中心的距离换算平移，`offset = c - (c - offset) * ratio`，保证指针下的图像点不动；`wheel` 监听 `{ passive: false }` 并 `preventDefault`；
- 平移：放大后 `pointerdown` + 指针捕获，记录移动距离；`click` 阶段若移动 > 4px 则吞掉，避免拖动结束时触发"点背景关闭"；
- 复位：双击图片 / 按 `0` / 窗口 resize；关闭：`Esc` / 点背景（原有逻辑）；
- CM6 图片点击复用客户端灯箱：`window.__ghMdOpenImageLightbox`，bundle 的 `.gh-md-cm6-image-fullscreen` 仅作兜底。

---

## 129. v1.1.4：宽表格的列加号可见性

- 现象：表格占满内容宽度时看不到「加列」的 `+`；
- 根因：`.gh-md-cm6-table-add-col` 的 `left` 等于表格宽度；当表格宽度 = 内容宽度时，16px 竖条整条落在 `.cm-content` 可见区之外（被滚动容器裁掉）；
- 修复：`left: min(var(--gh-md-table-w, 100%), calc(100% - 18px))`，悬停时加 `background` + `box-shadow` 让它在覆盖表格边缘时仍清晰；
- 回归：`gui-table-add-check.mjs` 增加宽表格用例，断言列加号 `right <= wrapper.right`、hover 可见、点击后列数 +1。

---

## 130. v1.1.5：行/列选择与删除

- 手柄：`.gh-md-cm6-table-row-handle`（每行左侧 16px，竖排 grip）与 `.gh-md-cm6-table-col-handle`（每列上方 16px，横排 grip），按 `tr`/`th` 的真实 `getBoundingClientRect()` 相对表格定位；ResizeObserver + scroll 时重排；
- 悬停表格时手柄 `opacity: .85`，选中时高亮（info 色 + 12% 底色），对应单元格加 `.gh-md-cm6-table-cell-selected`（10% info 底色）；
- 交互：点手柄选中（手柄 `tabindex=0` 并 focus，保证按键落在 wrapper 内）；wrapper 的 keydown 捕获 `Backspace`/`Delete` 删除、`Esc` 取消；点表格其它位置取消；
- 删除：复用 `applyEdit`（源码态 → 文本变更 → 渲染态）；只剩 1 列时拒绝；删除后清除选择；
- 注意：手柄仅用于单击选择，未实现 Obsidian 的拖拽排序。

---

## 131. v1.1.6：表格多选与复制

- 选择状态从 `{kind,index}` 改为 `{kind, anchor, focus}`，`selectionRange()` 得到连续区间；
- Shift+点击手柄时保留 anchor、更新 focus；普通点击重置 anchor；高亮同时作用于单元格（`.gh-md-cm6-table-cell-selected`）与手柄（`.is-selected`）；
- 删除：行/列按区间 splice，并限制 `count <= 行数-1 / 列数-1`，保证表格始终合法；
- 复制：`selectionToText()` 生成 TSV（行选区取整行，列选区每行取区间内单元格），`Ctrl/Cmd+C` 在 wrapper keydown 中拦截；优先 `navigator.clipboard.writeText`，失败回退 `execCommand('copy')`；
- 未实现手柄拖拽排序。

---

## 132. v1.1.7：手柄拖拽排序 + Markdown 复制

- 手柄 `pointerdown` 记录起点并 `setPointerCapture`；移动超过 4px 才进入拖拽态，并在 wrapper 里插入 `.gh-md-cm6-table-drop-indicator`（行：2px 横线；列：2px 竖线）；
- 落点：行按 `tr` 中线、列按 `th` 中线计算插入下标（0..n）；行下标夹到 >= 1（表头固定）；松手后 `moveRowTo` / `moveColumnTo` 用同一套 `applyEdit` 改写文本；
- 拖拽结束后用 `skipNextClick` 吞掉随后的 click，避免"拖完又触发选择"；
- `Ctrl+Shift+C` 走 `selectionToMarkdown()`（`| a | b |`），`Ctrl+C` 仍走 `selectionToText()`（TSV）。

---

## 133. v1.1.8：跨格拖拽选择

- 原因：每个单元格是独立 contenteditable（Chromium 下是独立 editing host），原生选区无法跨单元格，所以"拖一整行再删除"不可用；
- 交互：mousedown 记录锚点单元格，mousemove 移动到其它单元格且位移 > 6px 时进入区域选择（is-cell-selecting + user-select: none，清空原生选区，focus 到 wrapper）；同一单元格内拖动不进入，保留原生文本选择；
- 状态：selection = { kind: cell, anchor: { row, col }, focus: { row, col } }，paintSelection() 统一给单元格加 .gh-md-cm6-table-cell-selected；
- 删除语义：选区覆盖所有列 → 删行；覆盖所有行 → 删列；否则清空矩形内单元格内容（applyEdit 里的 rows 是字符串数组，直接赋空字符串）；
- 复制：selectionToText / selectionToMarkdown 支持 cell 矩形；
- 生命周期：document 级 mouseup / selectstart 监听在 TableWidget.destroy(dom) 里移除（wrapper.__ghMdTableCleanup）；destroy 不得重置 tableSourceMode，否则会破坏"源码态 → 改文本 → 渲染态"的三段式编辑。

---

## 134. v1.1.9：表格选择的删除可靠性

- 现象：桌面版里选中整行/整列后按 Backspace 无反应；
- 根因：选区 keydown 监听绑在表格 wrapper 上，桌面版焦点被 CM6 收回到 `cm-content` 时事件不经过 wrapper；同时原实现点击表格外不会取消选区；
- 修复：选区存在时在 **window 捕获阶段**处理 Backspace/Delete/Ctrl+C/Esc；点击表格外（document mousedown）取消选区；
- 参差表格：整行判定改为逐行比较 `range.colEnd >= row.length - 1`；
- 资源缓存：`loadScriptOnce` / `loadStyleOnce` 统一走 `withBuildVersion()`，给 URL 加 `?v=<BUILD_STAMP>`；
- 加列按钮：wrapper 预留 `padding-right: 18px`，`.gh-md-cm6-table-scroll` 占内容宽度，加号条用 `left: min(表格宽度, 100% - 18px)` 落在 gutter，不再覆盖最后一列；行加号条宽度同样 clamp；
- 回归：`gui-table-delete-focus-check.mjs` 用真实鼠标拖拽 + 手动 focus 到 `cm-content` 复现并验证修复。

---

## 135. v1.1.10：表格边缘点击

- 现象：表格正下方点一下想写字，结果多出一行、光标跳到表格之后（"点哪里却跳到偏下"）；
- 根因：`.gh-md-cm6-table-add-row` 是整行宽、`.gh-md-cm6-table-add-col` 是整列高，且表格下方/右侧 16px 属于 widget，点击命中加号条；
- 修复：加行条改为 `left: calc(min(表格宽度, 100% - 18px) / 2); width: 64px; translateX(-50%)`；加列条改为 `top: 50%; height: 64px; translateY(-50%)`；条外区域点击穿透到表格 widget 的空白区，光标落到表格后的空行；
- 高度表：`syncTableSize()` 里 `requestTableRemeasure()`（rAF 合流）主动 `view.requestMeasure()`，覆盖单元格换行/滚动条/字体加载导致的尺寸变化；
- 回归：`gui-table-click-edge-check.mjs`（6 项）验证偏心点击不加行、居中 + 加行、右缘外侧不加列、无报错。

---

## 136. v1.1.11：表格换行不再断词

**Obsidian 1.15.1 实测（CDP）**：`.table-cell-wrapper` / `td` 计算样式为 `word-break: normal`、`overflow-wrap: normal`、`white-space: break-spaces`；`table` 为 `width: auto; max-width: none; table-layout: auto`；`.cm-embed-block.cm-table-widget` 是 `overflow-x: auto`（表格超宽时控件自身横向滚动）。

**本插件**：单元格改为 `word-break: normal; overflow-wrap: normal`（只在空格换行，绝不切断单词）；表格 `max-width: none`（按内容撑开）；`.gh-md-cm6-table-scroll` 保持 `overflow-x: auto` 并加细滚动条样式。

验证脚本用 Range.getClientRects 检查每个单词是否跨行：`gui-table-wrap-check.mjs` 断言无单词跨行，且 760px 窄面板下 `configuration`/`checkpointing`/`dim_batch=2` 都完整显示。

---

## 137. v1.1.12：页面左右留白

- `.gh-md-document` 左右内边距由 24px 调到 32px（上下保持 16 / 24，`gui-width-check` 的 bottom margin 断言仍满足）；
- `.gh-md-cm6-lp .cm-content` 由 `padding: 4px 0 4px 18px` 改为 `padding: 4px 18px`：左侧 18px 是折叠箭头预留空间（不能归零，否则箭头被裁掉、四组折叠检查全挂），右侧补同样的 18px 让正文左右对称；最终正文距页面边缘 50 / 50；
- 折叠箭头留在 `.cm-content` 左侧的 18px 空间，悬停仍可见可点（回归 heading/list/ordered/task 折叠检查全过）；
- `gui-width-check` 断言改为 `padLeft >= 28 && padLeft <= 36 && padRight === padLeft`，锁定左右对称的页边距。

---

## 138. v1.1.13：表格操作保持滚动位置

- 现象：在长文档里拖动行/列（或加行删行）后页面跳到别处，疑似"跳到底部"；
- 根因：`applyEdit` 最后一步把光标放到表格后一行并 `view.dispatch({ selection })`，CM6 默认 `scrollIntoView: true`，会滚动到光标；表格操作是"源码态 → 改文本 → 渲染态"三段式，重排后光标位置与实际布局可能差得较远，于是看起来像跳页；
- 修复：最后一步传 `scrollIntoView: false`；同时在 `applyEdit` 开始时记录 `view.scrollDOM.scrollTop/scrollLeft`，在重建 + `requestMeasure()` 之后（60ms）若滚动位置变化超过 2px 就恢复；
- 回归：`gui-scroll-preserve-check.mjs`（8 项）在长文档中间验证行拖拽、加行、删行前后 `scrollTop` 不变。

---

## 139. v1.1.14：单元格换行与长 token 断点

- 背景：1.1.11 采用 Obsidian 的 `word-break: normal; overflow-wrap: normal` 后，普通单词不再被切断，但长 URL/哈希/路径无法换行，表格被撑宽并横向滚动；
- 方案：`renderCell` 渲染完单元格后调用 `addWordBreakHints(node)`：遍历文本节点，跳过含 CJK 的文本；对长度 ≥ 13 的非空白 token，在 `/ _ - . , ; :` 之后插入 `<wbr>`，或每 12 个字符插入一个 `<wbr>`；普通单词（短于 13 或没有分隔符的单词）不加断点；
- CSS：单元格 `word-break: normal; overflow-wrap: break-word;`，`min-width: 3em`（防止 CJK 列被压成一字一行）；表格 `max-width: 100%` 重新适配面板；
- 编辑兼容：`focusin` 时 `textContent = raw` 会清掉 wbr，失焦后 `renderCell` 重新插入；输入/读取仍用 `textContent`，不影响文档文本；
- 回归：`gui-table-wrap-check.mjs`（7 项）验证无普通单词跨行、URL 多行、表格适配、首列可读宽度。

---

## 140. v1.1.15：表格选中/复制对齐 Obsidian

Obsidian（CDP 实测）的表格选区模型：

- 单元格上挂 `is-selected` / `start` / `end` / `top` / `bottom` / `mod-dragging` 类，行/列手柄上有 `mod-active-row-handle` / `mod-active-col-handle`；
- 复制格式 = 首行当表头 + `| --- |` 分隔行 + 其余行；**列宽 = max(3, 该列最宽内容)**，单元格右补空格；分隔行破折号数等于列宽；
- 剪贴板同时写 `text/plain`（Markdown）与 `text/html`（`<table>`）；
- 整行选区 `Ctrl+X`/`Delete` 删行，整列选区删列，局部矩形只清空单元格；
- 右键菜单为 `行 ▸`、`列 ▸` 两个子菜单，行子菜单 6 项、列子菜单 9 项（含对齐），另有 `按列升序 (A-Z)` / `按列降序 (Z-A)`。

实现要点：

- `serializeMarkdownTable(matrix)`：列宽 `max(3, maxLen)`，行格式 `| ` + `padEnd(宽)` + ` |`，分隔行 `| ` + `-`×宽 + ` |`；`serializeHtmlTable(matrix)` 生成配套 HTML；
- `copySelection(mode)`：`mode === 'tsv'` 走 TSV，否则 Markdown + HTML，用 `ClipboardItem` 同时写两种 MIME；
- `cutSelection()`：复制后复用 `deleteSelection()`，删除语义与 Delete 完全一致；
- `cellAnchor`：记录最后一次单击的单元格，`Shift+点击` 用它当锚点（Obsidian 在 `Esc` 之后仍保留锚点），选区存在时则直接扩展；
- 菜单：`行`/`列` 用 `:hover` 展开的 `.gh-md-cm6-table-submenu`；移动行/列、排序全部走 `applyEdit`，与拖拽排序共用同一条提交路径；排序保留 `rows[0]` 表头，`localeCompare(numeric: true)` 让「2」排在「10」前面。

---

## 141. v1.1.16：表格边角行为（Obsidian 实测）

- **列宽按字符数**：Obsidian 的表格序列化用 `String.length` 补空格（中文 1 格），不是显示宽度；`serializeMarkdownTable` 本来就按字符数，本轮用中英混排表格验证了逐字符一致。
- **`<br>` 原样保留**：单元格原始文本里的 `<br>` 不转换，列宽按原始字符串长度；复制时与 Obsidian 相同。
- **转义竖线 `\|`**：新增 `splitTableSegments(raw)`——遇到 `\` 跳过一个字符，`\|` 不再当列分隔符；`parseTableRowsFromDoc`、`parseCells`、`cellRangeInLine` 与装饰器里的表格解析统一走它，因此渲染、复制、编辑都保留 `\|`。
- **整格复制/剪切**：`onWindowKeyDown` 在「无矩形选区 + 焦点在 td/th + 没有原生文本选区」时拦截 `Ctrl+C`/`Ctrl+X`：`writePlainText(单元格文本)`，剪切时再走 `applyEdit` 把该格清空（Obsidian 行为）。
- **拖出表格的钳制**：`cellAtPoint(clientX, clientY)` 按行/列矩形把指针钳制到最近单元格；`mousemove` 在指针不在单元格上时用它继续扩展选区，与 Obsidian 的越界拖拽一致（向下→最后一行、向上→表头、向右→最后一列）。
- **数字排序**：`localeCompare(..., { numeric: true })`，1 < 2 < 10。

---

## 142. v1.1.17：选区菜单、对齐复制、表格粘贴

- **对齐复制**：`selectionAlignments()` 取选区各列的 `this.alignments`；`serializeMarkdownTable(matrix, alignments)` 用 `padAligned()`（左：padEnd；居中：左 `floor(剩余/2)`；右：padStart），分隔行用 `formatSeparatorCell()` 生成 `---` / `:---:` / `---:`；HTML 序列化同步写 `style="text-align: …"`。实测 Obsidian：宽度 8 时居中列 `    C     `、分隔行 `:------:`。
- **选区菜单**：`contextmenu` 时若 `selection !== null` 走 `showSelectionMenu()`，否则走原来的 `showMenu()`（行/列/排序）。菜单项与 Obsidian 一致：剪切（`cutSelection`）、复制（`copySelection('markdown')`）、粘贴（`pasteIntoSelection`）、`文本格式 ▸` 8 项、左/中/右对齐（改写分隔行）、清空选中的单元格、删除选中的单元格（复用 `deleteSelection` 语义）。
- **右键不清选区**：`mousedown` 在 `event.button === 2` 时提前返回，让 `contextmenu` 能看到选区。
- **点菜单不清选区**：`document` 的 mousedown 清理逻辑跳过 `.gh-md-cm6-table-menu` 内部，否则菜单动作拿不到选区。
- **粘贴矩阵**：`parseClipboardTableHtml()` 用 `DOMParser` 解析剪贴板 HTML 的 `<table>`；`writeMatrixAt(startRow, startCol, table)` 从目标格开始覆盖、列不够补列、行不够补行；单元格上的 `paste` 监听只在剪贴板含 HTML 表格时接管，纯文本仍走浏览器默认。

---

## 143. v1.1.18：键盘扩展选区

Obsidian（CDP 实测）的键盘行为：单元格内 `Shift+↓/↑` 跨格扩展；已有矩形选区时 `Shift+方向键` 以锚点扩展、普通方向键清空选区并移动活动单元格；`Shift+→` 在文本末尾才越界到下一格，文本中间只是普通文本选区。

实现：

- `cellNodeAt(row,col)` / `clampCell()` / `cellBounds()`：行列取单元格与边界钳制；
- `focusCellAt(row,col)`：聚焦并把光标放到单元格末尾，同时更新 `cellAnchor`（之后 Shift+方向键以它当锚点）；
- `caretOffsetInCell(cell)`：用 Range 计算光标字符偏移，只有 `offset >= 文本长度`（→）或 `offset === 0`（←）时才越界扩展，否则不阻止默认行为，保留原生文本选区；
- 窗口级 `onWindowKeyDown` 处理「有选区」的方向键；单元格 `keydown` 处理「焦点在单元格内」的 Shift+方向键；
- 所有方向键路径都 `preventDefault + stopPropagation`（只在真正扩展/移动时），不影响表格外的输入。

---

## 144. v1.1.19：跨应用复制对照测试与 `:---` 标记

**对照方法**：9 张边角表格分别写入 Obsidian vault 与工作区；Obsidian 侧用 CDP 打开、拖选整表、Ctrl+C 读剪贴板；插件侧用 Playwright 打开、同样的拖选与 Ctrl+C；两边字符串逐字符比对（先统一 `\r\n`）。夹具覆盖：中英混排、emoji、行内加粗/链接/代码、参差行、空单元格、转义竖线、`<br>`、26 字符长单词、`---`/`:---`/`:---:`/`---:` 四种对齐、勾叉符号。结果 **9/9 一致**。

**修掉的差异**：Obsidian 把 `:---` 视为「左对齐 + 显式冒号」，复制时写回 `:---`（冒号 + `width-1` 个破折号）；插件原先把它归一化成 `---`。

实现：`parseAlignmentsFromLines()` 返回 `left` / `left-colon` / `center` / `right`；新增 `displayAlignment()` 把 `left-colon` 映射成视觉 `left`（`th/td` 渲染、`updateDOM` 都用它）；`formatSeparatorCell()` 增加 `left-colon → 冒号 + width-1 个破折号`；`padAligned()` 的 `left-colon` 走左对齐填充；HTML 序列化的 `styleAt` 只对 center/right 写 style。

---

## 145. v1.1.20：行/列边界插入

需求：表格下方/右侧的 `+` 只能追加，中间插入要开右键菜单，不好发现。

实现：

- `insertButtonRow` / `insertButtonCol` / `insertLine` 三个绝对定位元素挂在 table wrapper 上；
- **wrapper 级** `mousemove`（不能用 document 捕获阶段：那会干扰 CM6 对 widget 内点击的忽略判断，实测点击表格下方会把光标错误地放进表格）`onInsertHoverMove()`：指针进入「表格 + 左侧 26px + 上方 26px」的区域后，计算最近的行边界（`tr` 的 top，最后一行取 bottom）与列边界（表头 `th` 的 left，最后一列取 right）；距离 ≤ 8px 才显示；
- `hideInsertAffordance()` 在「本来就没显示」时直接返回、不写 DOM：mousemove 里做无谓的 `classList.remove` 会制造样式失效，同样会让 CM6 误判点击归属；
- 按钮在 wrapper 盒子之外，所以用 260ms 的延时隐藏 + 按钮 `mouseenter` 取消，保证「从表格移过去点 +」不会被提前隐藏；
- 左侧留白优先插入行、上方留白优先插入列（避免角落处两个按钮打架）；
- 行按钮放在左侧 16px 留白（`tableRect.left - wrapperRect.left - 17`），列按钮放在上方 16px 留白（`tableRect.top - wrapperRect.top - 17`）；指示线为 2px 蓝色，行方向横跨表格宽度、列方向纵跨表格高度；
- 点击走 `insertRowAt(index)`（`index ≥ 1`，插到该行之前；`index === 行数` 即末尾）与 `insertColumnAt(index)`（`0..列数`），都通过 `applyEdit` 提交，和菜单/拖拽共用同一条编辑路径；
- `__ghMdTableCleanup` 里移除 document 监听，避免 widget 重建后残留。

不干扰原有交互：行中间/列中部不显示按钮；拖拽中（`dragState`/`cellDrag`）不显示；指针离开区域即隐藏。

---

## 146. v1.1.21：表格编辑的撤销 / 重做

问题：`applyEdit()` 里改文本的事务带 `Transaction.addToHistory.of(false)`（当初是为了绕开 block widget 内部改文本的崩溃），于是表格操作不进历史；`undoWithFallback()` 在 CM6 历史为空时会调用宿主应用的 `undo()` 并用 `applyHistoryFallback()` 把**整篇文档**替换成宿主快照——表格编辑后按 Ctrl+Z 就会看到文档被换成旧内容（表格重复、`RangeError: Invalid position`）。

实现：

- 改文本的事务改成 `[Transaction.addToHistory.of(true), isolateHistory.of('full')]`；`isolateHistory` 必须从 `@codemirror/commands` 导入（`Transaction.isolateHistory` 不存在，写错会抛异常被 catch 吞掉、编辑静默失效）。
- `withTableSourceMode(view, run)`：撤销/重做时若有表格 widget，先 `tableSourceMode = true` + 重建装饰（widget 换成源码文本），再执行 undo/redo，最后恢复渲染态并还原滚动位置；三步在同一个 JS 任务内完成，不会绘制中间态。结束后 `view.focus()`，保证可以连续 Ctrl+Z。
- 宿主历史回退加守卫 `hostHistoryAvailable()`：只有 `undoDepth === 0 && redoDepth === 0` 时才回退，避免在编辑器历史非空时整篇替换。
- 撤销/重做改为 `Prec.highest(EditorView.domEventHandlers({ keydown }))`：CM6 的 keymap 对字母键忽略 Shift，`Mod-z` 会匹配 Ctrl+Shift+Z；没有可重做内容时会掉到 undo 上。DOM 处理器先拦截并 `preventDefault`，`undoWithFallback`/`redoWithFallback` 始终返回 true，阻止继续匹配。
- 单元格（contenteditable）的 `keydown` 里转发 Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z 给编辑器，避免浏览器只撤销格子 DOM 文本。

---

## 147. v1.1.22：样式表热更新与「神秘加号」

现象：表格下方出现两个竖排 `+`。排查：DOM 里这两个节点是 `.gh-md-cm6-table-insert-btn`（1.1.20 加的插入按钮），但 `position` 是 `static`、`display` 是 `block` —— 说明样式表里没有对应规则。

根因：`ensureStyle()` 用固定 `STYLE_ID` 判重，`document.getElementById(STYLE_ID) !== null` 就直接 return。插件是热更新的（client.js 变了会重新注入），页面不刷新，于是样式表停留在旧版本；新组件只有 DOM 没有 CSS，`div` 按默认流式布局渲染成两行 `+`。

修复：

- `ensureStyle()`：已存在但 `textContent !== CSS` 时替换内容；
- 插入按钮与指示线创建时写内联 `display: none`，`showInsertAffordance`/`hideInsertAffordance` 同步写内联 `display`。这样即使样式表再次过期，按钮也不会以纯文本形式出现（最坏情况只是 hover 时位置不对）。

验证：删掉样式表里的插入按钮规则后，两个按钮仍是 `display: none`（内联），页面上没有任何可见的 `+` 节点。

---

## 148. v1.1.23：插入按钮与边界线的像素级对齐

问题：插入按钮看起来没有居中在蓝色指示线上。原因是 `width: 15px` 用的是 content-box，再加 1px 边框后实际 17px，而定位按 15px 的一半算，中心偏右 1px；同时 `+` 是文字，字体基线和字面宽度会让它在按钮里看起来偏一点。

修复：

- `.gh-md-cm6-table-insert-btn` 改为 `box-sizing: border-box; width/height: 16px; border: 1px`，几何中心可精确计算；
- 按钮内容改成 10×10 的 SVG 加号（`viewBox="0 0 10 10"`，两条 1.4 宽的圆头线），不再受字体影响；
- 列按钮：`left = 边界 - 8`、`top = 表格顶 - 16` → 中心 = 边界，底边贴表格顶；行按钮：`top = 边界 - 8`、`left = 表格左 - 16` → 中心 = 边界，右边贴表格左。

验证（deviceScaleFactor: 2 的真 GUI 测量）：列按钮中心 − 边界 = 0.00px，行按钮中心 − 行边界 = 0.00px，按钮底边 − 表格顶 = 0.00px，SVG 中心与按钮中心一致。

---

## 149. v1.1.24：底部/右侧不再重复提供插入按钮

问题：表格最后一条行边界（底部）同时有边界插入 `+` 和底部 `+` 胶囊，右侧同理，两套按钮都做「在末尾追加」。

修复：`onInsertHoverMove()` 收集边界时**不再包含最后一条**——行边界只取 `index 1 .. rowNodes.length - 1`（表头与第一行之间到最后两行之间），列边界只取 `index 0 .. headerCells.length - 2`（最左侧到倒数第二列之间）。末尾追加交给 Obsidian 风格的胶囊（`.gh-md-cm6-table-add-row` / `-add-col`）。边界数组为空时直接隐藏，避免单行/单列表格出错。

---

## 150. v1.1.25：hover 加号时有时无的三个原因

**角落互斥**：`rowDistance <= 8 && (preferRow || colDistance > 8)` 与列方向同样的条件，在单元格角落（两个距离都 ≤ 8）互相否决，结果 `hideInsertAffordance()`。改为先算 `nearRow` / `nearCol`，两者都近时按距离更近的轴二选一（左侧留白优先行、上方留白优先列，距离相同取行），并在该方向没有边界时回退到另一个。

**重建后 hover 不重算**：`applyEdit` 会重建整个 widget，新 DOM 上 `:hover` 要等下一次鼠标移动才生效，插入按钮也要等 mousemove。现在模块级记录 `lastPointerX/Y`（document `pointermove`，只写两个数字、不做 DOM 写入，避免之前那种干扰 CM6 点击判定的问题），`toDOM()` 末尾用 `requestAnimationFrame(syncHoverFromPointer)` 补一次：若指针仍在表格区域，给 wrapper 加 `.is-hover` 并调用一次 `onInsertHoverMove`。CSS 里胶囊与行/列手柄的显示条件都加上 `.is-hover` 版本。

**按钮 mouseleave 抢跑**：按钮在 wrapper 盒子之外，从按钮移回表格会触发按钮的 `mouseleave` → `scheduleInsertHide()` 260ms 后隐藏。若这期间另一个方向的按钮被显示出来，就会被这次定时器吞掉。现在 `showInsertAffordance()` 开头 `cancelInsertHide()`。

---

## 151. v1.1.26：插入按钮与手柄的重叠、列边界 off-by-one

**重叠**：行手柄的高度 = 整行高度（`height: rect.height`，图标居中），插入按钮 16px 居中在边界上。行高 30px 时手柄占据边界两侧各 9px，按钮占据两侧各 8px，二者必然重叠。做法：`showInsertAffordance()` 里调用 `markAdjacentHandles(kind, index)` 给「边界两侧的两个手柄」加 `.is-insert-adjacent`（CSS `opacity: 0 !important; pointer-events: none !important`），`hideInsertAffordance()` 里 `clearAdjacentHandles()`。行列同理。

**列边界 off-by-one**：边界 `index` 表示「插到第 index 列之前」，合法范围 `0 .. cols-1`（`cols` 是表格右侧的追加位，1.1.24 已交给胶囊）。1.1.24 写成了 `index < headerCells.length - 1`，把 `cols-1`（最后两列之间）也排除了；两列表格因此只剩最左侧一条边界。改为 `index < headerCells.length`。

---

## 152. v1.1.27：插入按钮移到表格外侧右侧/下方

反馈：边界插入 `+` 在左侧留白里，正好压住行手柄，鼠标移到那里就选不中行（列边界同理，压住上方列手柄）。

实现：`showInsertAffordance()` 不再把按钮放在 `tableRect.left - 16` / `tableRect.top - 16`，改成：

- 行边界：`left = min(tableRect.right + 2, innerWidth - 20)`，`top = boundary - 8`；
- 列边界：`top = min(tableRect.bottom + 2, innerHeight - 20)`，`left = boundary - 8`。

即按钮贴着表格右边/底边外侧，视口不够时夹在视口内。左侧与上方留白完全交还手柄；1.1.26 的 `.is-insert-adjacent` 隐藏逻辑随之删除（不再需要，也不该让手柄消失）。

悬停判定区域相应放宽到表格四边 ±26px（按钮在表格外），并且**指针落在追加胶囊矩形（外扩 6px）内时直接隐藏插入指示**——否则两列表格底部居中的胶囊恰好落在列边界上，会弹出列插入按钮并把胶囊 `pointer-events: none` 掉，点不了。追加胶囊也改成「只有和按钮真正重叠时才藏」（`overlapsPill` 判断）。

---

## 153. v1.2.0：版本更新提示与一键更新

**为什么放在 Host 半边**：浏览器里 fetch GitHub API 会受 CORS/网络环境影响，而 Host 进程直接 `node:https` 请求 `https://api.github.com/repos/Paradeluxe/dsh-live-markdown/releases/latest`，并用 `package.json` 的版本做比较——插件目录就是 `import.meta.url` 所在目录，宿主自己知道版本。

**接口**：

- `GET /github-md/update/check[?force=1]` → `{ current, latest, hasUpdate, url, notes, publishedAt, installKind, checkedAt, error }`；有 10 分钟内存缓存（GitHub 未认证 60 次/小时）；
- `POST /github-md/update/apply` → git 安装执行 `git fetch --tags --prune` + `git pull --ff-only`（`windowsHide: true`，不弹窗口），返回 `{ ok, from, to, restartRequired, output }`；非 git 安装返回 `{ ok:false, reason:"manual", url }`；
- 安装形态用 `<plugin>/.git` 是否存在判断。

**前端**：`client.js` 末尾一个独立 IIFE（不依赖 React）：加载 1.5s 后 `fetch("/github-md/update/check")`，`hasUpdate` 且未被 `localStorage["github-md:update-skipped"]` 记录时，在左下角渲染 `#gh-md-update-pill`（圆点 + 文案 + 更新/说明/×）。更新按钮 POST apply：成功后文案改成「已更新到 vX，重启 DSH 后生效」；失败保留「重试」并把 stderr 放进 title；非 git 安装点按钮直接打开发布页。每 4 小时复查一次。`window.__ghMdUpdate` 暴露 check/dismiss 供测试使用。

---

## 154. v1.3.0：Ctrl+F 查找

**为什么不用 @codemirror/search**：预览是「整篇 markdown + 装饰层」，表格/图片/代码/数学都换成了 widget，CM6 的 search 装饰只作用在源码文本上，落在 widget 里的匹配根本看不见，而且自带面板的样式也不好和 Obsidian/VSCode 对齐。因此自己实现：计数按文档文本，高亮按渲染后的 DOM。

**计数**：`view.state.doc.toString()` 上按选项扫描（大小写、全字、正则），最多 20000 条；正则非法返回 null，输入框标红提示「正则无效」。

**高亮**：CSS Custom Highlight API（`CSS.highlights` + `::highlight()`），完全不改 DOM：

- 遍历 `view.contentDOM` 的文本节点（跳过按钮/手柄/折叠箭头等 UI 文本），按当前选项找匹配并建 Range；
- `gh-md-find` 画全部、`gh-md-find-current` 画当前——当前匹配按 `view.posAtDOM()` 映射；落在 widget 里无法逐字映射时，用 `view.domAtPos()` 找到所在 widget，把这个 widget 内的匹配都算当前；
- 渲染层会自己重建 DOM（表格 remeasure、widget 重渲染），所以用 `MutationObserver` + `scroll` + `viewportChanged` 触发重画（重画本身不改 DOM，不会回环）。

**交互**：`Mod-f` 走 keymap；另外在 document 上挂捕获阶段的 keydown（焦点在编辑器或其单元格里时接管，`preventDefault` + `stopPropagation`，避免应用层/浏览器查找抢走）；`Esc` 在正文里也能关。跳转用 `EditorView.scrollIntoView(pos, { y: "center" })`，下一帧再补画一次（widget 渲染完成后再画）。

踩过的坑：模块里已经有 `const CSS = \`…\`` 这个样式字符串，直接把全局 `CSS` 对象遮住了——`CSS.highlights` 永远是 undefined，高亮一直画不出来；统一改成 `globalThis.CSS`。

---

## 155. v1.3.1：刷新链路核对 + 保存冲突保护

**刷新链路**：预览头的「重新读取文件」= 官方文档预览的 `reload()` → `reloadPages()` 重新读文件并把新的 `content` 交给渲染器；自动刷新默认开启，靠文件元数据变化触发同一套 reload。实测四条路径都能拿到最新内容（含同长度、同一秒的改动）。

**真正的问题**：`MarkdownBody` 在 `dirtyRef.current === true`（有未落盘草稿）时，精确读取 effect 直接 return（不覆盖草稿），所以外部改动看不到；更糟的是 `persist()` 不校验磁盘版本，一次保存会把别人的改动静默覆盖。

**修复**：

- Host `saveWorkspaceFile(root, relative, content, base)`：`base` 是客户端上次读到的文本（LF 归一化后比较），不一致 → `code: "conflict"` → 路由映射成 **409**；
- 客户端新增 `lastDiskTextRef`（精确读取时写入，成功保存后更新），**所有** save 请求（persist / flushDraft / 卸载兜底 / sendBeacon）都带 `base`；
- `persist()` 收到 409 → `saveState = "conflict"`、提示条文案「外部已修改 · 重新载入」，不重试、不覆盖；点提示条调 `reloadFromDisk()`（重新 `read` → 重置编辑器 / docText / 基线 / dirty 标记）；
- 精确读取 / 外部内容同步两处：草稿存在时不再静默顶掉，改为标记 conflict；
- 提示条复用 `.gh-md-save-pill`，新增 `[data-tone=conflict]` 配色。

---

## 156. v1.3.2：图片灯箱缩放的三个问题

灯箱（`openImageLightbox`）用 `translate(tx,ty) scale(s)`，`transform-origin: center center`，滚轮按 `factor = exp(-deltaY * 0.0016)` 缩放，并以光标为锚点换算 `offset`：

```
offsetX' = (cx - Vx) - ((cx - Vx) - offsetX) * ratio
```

**问题一：缩回来不居中**。归中条件写的是 `scale <= MIN_SCALE + 0.0001`（MIN=0.25），所以从 8x 缩回 1x 时 offset 一直保留着「朝鼠标方向」的平移，实测中心偏 (+55, -41)px。改为 `scale <= 1.0001` 归中。

**问题二：最小 0.25x 没意义**。适配尺寸（1x）已经把整张图放进视口，比它还小只会让图缩成一小块、还带着偏移。`MIN_SCALE = 1`。

**问题三：拖拽能把图拖出视口**。新增 `clampOffset()`：缩放后宽度 `W = offsetWidth * scale`，限制 `|offsetX| <= W/2`、`|offsetY| <= H/2`，即视口中心始终落在图片上；`applyTransform()` 每次都会 clamp，拖拽结束（`endDrag` 里已有 `applyTransform()`）也会自动弹回。

---

## 157. v1.3.3：放大变糊的根因（will-change 的合成层纹理）

img 元素带 will-change: transform 时，Chromium 会为该元素建独立合成层：栅格化发生在层创建/尺寸变化时，transform 的缩放不会触发重新栅格化，于是拿「适配尺寸」的低分辨率纹理去放大 —— 显示尺寸还没到 naturalWidth 就已经糊。

量化方法：2000×1125 的 2px 黑白竖条纹图，适配尺寸 1229 宽（max-width 96vw），滚轮放大 3 档到 1986 宽（≈原始像素），截取图片区域后统计「极值像素（亮度<30 或 >225）占比」：

| 方案 | extremeRatio |
| --- | --- |
| 修复前 | 0.107 |
| 去掉 will-change | 0.615 |
| 改为按尺寸放大（width/height 直接设成缩放后像素，transform 只留 translate） | 0.566 |

结论：去掉 will-change: transform 即可（Chromium 会按当前 transform 倍率重新栅格化）；保留 transform 缩放/平移。

回归断言写进 gui-image-zoom-check.mjs：放大后截图 → canvas 统计 extremeRatio，要求 > 0.3（修复前 0.107 会失败）。

---

## 158. v1.3.4：图片缓存不更新的根因与修复

**根因**：图片 URL 是宿主文件路由 /api/file?path=…，响应头 `cache-control: private, max-age=31536000, immutable`。文件名不变时 URL 不变，浏览器按 immutable 直接复用缓存，所以外部替换同名图片后预览不会更新（点「重新读取文件」也没用，因为 markdown 文本没变、图片 URL 也没变）。

**修复**：

1. Host 新增 `GET /github-md/workspace/stat`：接受 sessionId + JSON 数组 paths，逐个 resolveInside 校验后 stat，返回 { files: { [path]: { mtimeMs, size } } }（最多 400 个）。
2. 客户端 `imageVersionCache`（绝对路径小写 → mtimeMs）；`imageVersionParam()` 生成 `&v=<round(mtimeMs)>`，静态渲染器与 CM6 widget 的图片 URL 都拼上它。
3. `refreshPreviewImageVersions(root, sessionId)`：扫描 root 下所有 `/api/file` 图片，批量 stat，mtime 变化就 `src` 换新 URL（只换变了的）。
4. 触发点：预览异步挂载（轮询直到 root 里出现 img）、`docText` 变化（重载）、`window` focus（切回 DSH 时）。注意 CM6 分支没有 rootRef，要用 cm6HostRef 兜底。

---

## 159. v1.3.5：render-smoke 片段边界

`scripts/render-smoke.mjs` 的做法是：从 `client.js` 里截出 `/* github-md:render:start */ … /* github-md:render:end */` 之间的代码，塞进 `new Function` 单独跑（用来在 Node + jsdom 里测纯渲染函数）。

1.3.4 在 `resolveImage()` 里调用了 `imageVersionParam()`，但把它定义在片段之外 → 单独执行时 ReferenceError，`rewriteImages` 失败，冒烟断言「本地图片应改写成 /api/file」挂掉。

修复：把 `imageVersionCache` / `imageVersionKey` / `imageVersionParam` 这三个纯函数移进片段内（与 `resolveImage` 同作用域）；`fetchImageVersions` / `refreshPreviewImageVersions` 依赖网络与 DOM，仍留在片段外。

教训：凡是渲染片段里会调用的东西，必须定义在片段标记之间。

---

## 160. v1.3.6：CM6 失败路径与图片解析的时序

**崩溃**：`cm6WaitingForReady` 里 `cm6GaveUp` 只在 `cm6Loaded === false` 分支被求值，所以它未定义这件事在正常启动时被短路掩盖；bundle 失败时立刻 `ReferenceError`，槽位崩溃（既无编辑器也无静态回退）。修复：真正的 React state + 加载失败/12s 超时置位，之后走静态渲染。

**时序**：`resolveImageForEditor` 原来闭包捕获 `sourcePath`，而 CM6 视图只创建一次 → 恢复标签页/资源后到时图片永远解析成 undefined。修复：读 `sourcePathRef.current`；并在 `sourcePath` 首次可用的 effect 里调用 `createLivePreview().refresh()`（dispatch rebuildEffect）重建装饰。

**可见性**：`ImageWidget` 加载失败重试一次，仍失败显示 `图片无法加载：<alt>` 占位 + 控制台 warning，避免「图看不见」时无从判断。

---

## 161. v1.3.7：窄面板水平内边距与堆叠标题间距

**测量方法**：用 CDP 连上真实的 Obsidian（同一 vault、同一文件），读 `getComputedStyle` / `getBoundingClientRect`，再和插件在同一窄面板宽度下的数值逐项比对。

| 项目 | Obsidian | 修复前 | 修复后 |
| --- | --- | --- | --- |
| 文档外层左右内边距（373px 面板） | 32（scroller） | 32 + 18（内容） | min(32, 5%)=18.6 + min(18, 3%)=10.1 |
| 文本列宽度（373px 面板） | ~309 | 273 | 316 |
| 堆叠标题（上一行是空行、再上一行是标题）`padding-top` | 0 | 16 | 0 |
| h2 行盒高度 | 29.1 | 44.5 | 28.5 |

**实现**：`.gh-md-document` 与 `.cm-content` 的水平内边距改成百分比封顶（`min()`），宽面板行为不变；`buildDecorations` 在标题行判断「上方最多隔一行空行的上一行是否也是标题」，是则加 `gh-md-lp-h-tight`，CSS 里 `padding-top: 0 !important`。

**没改的部分**：连续空行按原样逐行显示（Obsidian 同样如此，实测空行 24px、首屏 26 个空行），因此稿件里 2~4 个空行造成的块间距两边一致。

---

## 162. v1.3.8：图片放大入口与高瘦图适配

**问题来源**：用 Windows 窗口截图 + 鼠标事件直接操作 DSH 桌面窗口，逐屏检查 `manuscript/results_Nov18.md`。图片行内只有列宽（窄侧栏 316px），而放大入口是「500ms 内、14px 内的两次点击」，单击无反应；即便打开了灯箱，`max-height: 92vh` 的适配把 4640×7354 的插图压到约 475px 宽——和行内一样看不清。

**修复**：

1. `ImageWidget` 加单击 → `window.__ghMdOpenImageLightbox(src, alt)`；`mousedown` 阻止编辑器把点击当成进入该行源码。
2. `openImageLightbox()` 增加 `fitWidthForTallImage()`：图片加载后若 `naturalWidth/naturalHeight < 视口宽高比 × 0.85`（明显更高瘦），把 `scale` 提到 `0.96 * innerWidth / offsetWidth`（不超过 8），即铺满窗口宽度；`scale = 1` 仍是「适配尺寸」，所以滚轮缩小、`0` 复位、拖拽 clamp 语义不变，横向图不受影响（不会触发）。

**验证**：`gui-tall-figure-check.mjs` 6/6；`gui-image-zoom-check.mjs` 15/15（横向图仍从适配尺寸开始）；`gui-image-lightbox-check.mjs` 9/9（单击打开 + Esc 后双击仍可）。

---

## 163. v1.3.9：连续空行折叠

**背景**：`manuscript/results_Nov18.md` 有 2~4 个连续空行；Live Preview 逐行显示 → 块间距 48~96px。Obsidian（实测）同样逐行显示（24/48/72px），但用户明确要求紧凑。

**实现**：`buildDecorations` 在每行开头判断：`!isActive && text.trim() === '' && 上一行也是空行` → 给该行加 `Decoration.line({ class: 'gh-md-lp-blank-collapsed' })`；CSS `height/min-height/padding/line-height: 0; overflow: hidden`，并隐藏 `<br>`。带光标的空行因 `isActive` 保留原高度，编辑时自动展开。

**效果**：块间距 48/72/96 → 24px；滚动高度 15695 → 14647（-6.7%）。

---

## 164. v1.3.10：桌面端诊断上报与灯箱双击

**诊断链路**：`client.js` 在预览渲染后 4s、以及滚动时（节流 2.5s）收集 `baseURI / hasEditor / hasBundle / editable / sourcePath / docLength / imageLines / widgets / images(src + naturalWidth/Height) / placeholder`，POST 到 `/github-md/workspace/diagnose`；`index.js` 用 `appendFile` 追加到 `<plugin>/diagnostics.log`（JSONL）。这是排查「只有桌面端图片不显示」的唯一低成本手段（桌面窗口没有 CDP）。

**已用同构 Electron 复现验证过**：从 `dsh-app://app/` 页面请求 `dsh-app://app/api/file?...` 时，`<img>` 请求不带 Origin 头（`request.headers.get("origin")` 为 null），DSH 桌面端 `forwardWebRequest` 的 origin 校验会放行，图片能正常拿到 200 + `naturalWidth`。所以「桌面协议拦图片」这个假设被排除。

**灯箱双击**：单击打开灯箱后，双击的第二次点击落在遮罩上会被当成「点遮罩关闭」。`openImageLightbox` 记录 `openedAt`，450ms 内的遮罩点击直接忽略，保证双击仍停在放大态。

---

## 165. v1.3.11：外部改动自动跟进

**问题**：用户标签页里的文档是打开那一刻的内容；稿子被脚本重新生成后（图片同名替换、正文重排），旧正文里的图片路径可能已经失效——表现就是「图不显示」，但其实文件是好的。

**实现**：`MarkdownBody` 里每 2.5s `workbenchRequest('read')` 一次（`document.hidden` 时跳过，`inFlight` 去重），与 `lastDiskTextRef` 比较：

- 相同 → 什么都不做；
- 不同且 `dirtyRef.current === false` → 更新 `lastDiskTextRef / savedTextRef / docTextRef / eol`、`setDocText`、并 dispatch 替换 CM6 文档（图片/折叠装饰随新文档重建）；
- 不同且是脏状态 → 只设置 `conflictRef` + conflict 提示条（不丢用户改动）。

**代价**：每 2.5s 一次本地文件读取（几十 KB 级），页面隐藏时跳过。

---

## 166. v1.3.12：轮询与测试环境的隔离

`harness-*.mjs` 用 jsdom + 桩 `workbenchRequest`：轮询读回的桩内容与编辑器内容不一致，于是被当成「磁盘改了」把用户输入覆盖掉。判断 `navigator.userAgent` 含 `jsdom` 时直接不启动轮询；这也和 `cm6FirstOpenGuard` 用的是同一套环境判定。

---

## 167. v1.3.13：排版基线逐项对齐 Obsidian

**基线来源**：Obsidian 1.15.1 阅读视图 `getComputedStyle(document.body)` 的 CSS 变量——`--h1-weight: 700 / --h2: 680 / --h3: 660 / --h4: 640 / --h5: 620 / --h6: 600`，`--h1-size: 1.618em … --h6-size: 1em`，`--h1-line-height: 1.2 / --h2: 1.2 / --h3: 1.3 / --h4: 1.4 / --h5: 1.5 / --h6: 1.5`，`--font-text-size: 16px`，`--line-height-normal: 1.5`，`--bold-weight: calc(400 + 200)`。

**差距**：字号和行高本来就一致（之前已经按 em 写），字重则全部写成 600。

**修复**：`src/cm6-entry.js` 的 `.gh-md-lp-h2…h5` 与 `client.js` 的 `.gh-md-document h2…h5` 改成 680/660/640/620；`.gh-md-lp-strong` 700 → 600。静态渲染同时从固定 px（24/22/20）改为 em 比例。

**回归**：`gui-typography-check.mjs` 逐项断言 h1–h6 + 正文的字号（±0.05px）、字重（精确）、行高（±0.1px）。

---

## 168. v1.3.14：结构元素与 Obsidian 逐项对齐

**基线**（Obsidian 1.15.1 阅读视图，同一份 fixture 实测）：行内代码 14px/21px、`padding 2.1px 4.2px`、圆角 4px、底色 #fafafa；引用块 `border-left: 2px` 强调色 + `padding-left: 24px`、文字颜色与正文一致；`hr` 上下边距 32px；任务复选框 16×16；表格单元 `padding 4px 8px`、边框 1px #e4e4e4；图片按自然尺寸（`max-width: 100%` 不放大）。

**改动**：`src/cm6-entry.js` 的 `.gh-md-lp-code`（`.92em` → `14px`，内边距 `0 2px` → `2px 4px`）、`.gh-md-lp-quote`（`padding-left: 12px` → `24px`，去掉 `color: label-secondary`，depth-2/3 改为 40/56px）、`.gh-md-cm6-hr`（`margin: 16px 0` → `32px 0`）、`.gh-md-lp-task`（14px → 16px）；`client.js` 静态渲染的 blockquote `padding-left: 14px` → `24px`、`margin: 16px 0 0` → `16px 0`。

**注意**：行内代码底色保留半透明灰（`rgb(175 184 193 / 20%)`）而不是 Obsidian 的 #fafafa，这样深色主题下也成立；这是唯一刻意不一致的一项。

---

## 169. v1.3.15：缺图说明的可诊断性

`ImageWidget.toDOM()` 的 error 处理先重试一次（加 `retry=` 时间戳绕过缓存），两次都失败才落占位。占位文字从 `alt` 改为从图片 URL 的 `path` 参数里取**文件名**，并把完整绝对路径写进 `title`：

```js
const filePath = new URL(this.src, 'http://localhost/').searchParams.get('path')
note.textContent = '图片无法加载：' + basename(filePath)
note.title = filePath
```

**为什么**：稿子里的 alt 通常是「Figure 1」，用户报「图不显示」时无法判断是路径错、改名还是文件缺失；带上文件名和绝对路径就能自己判断。

---

## 170. 面板宽度扫描（1.3.15 之后补的回归测试）

**动机**：用户在 373px 的右侧栏里看图，但面板可以随时拉宽；排版必须对宽度不敏感。

**测量**（自建根目录探针 `_gui_resp.md`：标题 + 长段落 + 120×80 小图；视口 960 / 1100 / 1280 / 1500，对应内容列 453 / 377 / 518 / 518px）：

- 横向溢出全部为 0（`scroller.scrollWidth - clientWidth`）；
- 120×80 的小图始终按自然尺寸 120px 显示（不放大、不溢出列宽）；
- `h1` 字号恒为 25.888px（不随宽度变化），正文行高恒为 24px；
- 没有任何 `gh-md-lp-image-missing` 占位。

**测试**：`gui-responsive-check.mjs` 用「先宽窗口打开文档、再 `setViewportSize` 逐个宽度测量」的方式对每个宽度断言 7 项（共 29 项）。早先版本是在每个宽度下重新走「工作区文件 → manuscript → 文件」的打开流程，窄视口下文件面板按钮不可见、且重复点文件夹会折叠，改为单页 resize 后稳定。

---

## 171. v1.3.16：桌面端更新检查的协议门

**DSH 原生「更新」按钮的条件**（`dsh-client-ui-plugin-manager/PluginManagerPage.tsx` 的 `updateAvailable()`）：

```ts
const target = pkg.installTarget
if (!pkg.installed || !pkg.removable || pkg.availability === "installation" || target === undefined) return false
return pkg.version !== target.version || ((target.spec.startsWith("link:") || pkg.source?.startsWith("link:")) && pkg.source !== target.spec)
```

只有 **registry**（`listVersions` 读 npm）或 **git spec（钉住完整 commit）**安装的 bundle 才有 `installTarget`；我们的 profile 依赖是 `@local/dsh-github-md@link:E:\...`，没有安装目标 → 按钮不出现。这是 DSH 的结构，不是我们的 bug。

**我们的更新提示**：`client.js` 的 `checkForUpdate()` 请求 Host 的 `/github-md/update/check`（Host 用 GitHub Releases API 取 latest，和本地 `package.json` 版本比较），有更新就渲染 `#gh-md-update-pill`：`更新`（git 安装走 `/github-md/update/apply` → `git pull --ff-only`）/`说明`（打开发布页）/`×`（把版本记进 localStorage 不再提示）。

**Bug**：启动检查的条件写成 `if (/^https?:$/.test(window.location.protocol))`，桌面端页面协议是 `dsh-app:`，检查从不启动。改为 `UPDATE_PROTOCOLS = /^(?:https?|dsh-app):$/`，并把判断暴露成 `window.__ghMdUpdate.acceptsProtocol` 便于回归测试。

**link 安���的固有限制**：安装目录就是开发仓库，`package.json` 版本永远等于刚发布的那版，所以「有更新」在开发机上几乎不会出现；换 npm/git 安装源才有 DSH 原生按钮。
