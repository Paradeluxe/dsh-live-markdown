# Word 批注行为 → 实现 → 证据（一页对照）

这张表是这条开发线的总账：每一行是 Word 的一个行为，右边是我们做到哪、在哪实现、哪个脚本验证。

图例：**✅ 已实现** · **🟡 部分实现**（写明缺口） · ⬜ 未做

| # | Word 行为 | 状态 | 实现位置 | 验证（套件 / 断言） |
| --- | --- | --- | --- | --- |
| 1 | 新建批注：选中文字右键/`Ctrl+Alt+M`；未选中时锚在插入点 | ✅ | `src/comments/ui.js`（`createFromSelection`、keymap）、`model.createComment` | `gui-comments-keys-check` 10/10（含光标处批注） |
| 2 | 批注范围随编辑移动；可跨段落/表格单元格；删光后还能找回 | ✅ | `model.anchorAt/resolveStore/reattachComment` | `comments-model-test` 32/32、`comments-reattach-test` 9/9、`gui-comments-lost-check` 9/9、`comments-crossrange-test` 6/6、`comments-table-range-test` 5/5 |
| 3 | 悬停高亮 ↔ 卡片双向联动 | ✅ | `ui.setHovered/previewCard` | `gui-comments-check` 21/21 |
| 4 | 卡片在页边、按锚点对齐、多条堆叠 | ✅ | `ui.layout()`（13px 叠放、展开全部时纵向排布） | `gui-comments-details-check` 8/8、`gui-comments-allopen-check` 7/7 |
| 5 | 卡片内容：头像、作者、时间、被批注原文、正文 | ✅ | `ui.cardHtml`（首字母头像 + 引文块） | `gui-comments-check` 21/21、`gui-comments-keys-check` 10/10 |
| 6 | 回复：缩进挂在根批注下 | ✅ | `model.createReply`、`ui.replyTo` | `gui-comments-check` 21/21 |
| 7 | 解决/重新打开：气泡变灰、加勾 | ✅ | `model.setResolved`、`ui`（灰点 + `data-resolved`） | `gui-comments-check` 21/21 |
| 8 | 编辑：只有作者能改自己的批注正文 | ✅ | `model.canEditComment`、`ui`（「编辑」按钮） | `comments-permissions-test` 7/7、`gui-comments-permissions-check` 8/8 |
| 9 | 删除：删除根批注时线程一起删 | ✅ | `model.deleteComment`（墓碑 + 级联） | `comments-model-test` 32/32 |
| 10 | 审阅窗格：列表、跳转、显示/隐藏气泡 | ✅ | `ui.renderPanel`、`setAllOpen` | `gui-comments-panel-check` 12/12、`gui-comments-allopen-check` 7/7 |
| 11 | 排序与筛选（全部/已解决/我的）、新批注标记 | ✅ | `ui.visibleThreads`（全部/未解决/已解决/我的/丢失）、`model.unreadThreads` | `gui-comments-panel-check` 12/12、`comments-unread-test` 14/14、`gui-comments-unread-check` 9/9 |
| 12 | 打印标记 | ✅ | `ui.buildPrintHtml/printList`（独立可打印页） | `gui-comments-print-check` 8/8 |
| 13 | 复制带批注的文字，粘贴到别处批注跟着走 | 🟡 | `src/comments/clipboard.js` + `ui` 的 copy/paste | `comments-clipboard-test` 13/13、`gui-comments-clipboard-check` 8/8 |
| 14 | 多作者：每人固定头像色、@提及、新批注提示 | ✅ | `model.authorColor/initialsOf/mentionsAuthor/unreadThreads`、`ui.cardHtml` | `gui-comments-merge-check` 7/7、`comments-mentions-test` 10/10、`gui-comments-mentions-check` 5/5 |
| 15 | 云端共编时批注实时出现 | 🟡 | `ui.poll`（2.5s 轮询 + `mergeStores`） | `gui-comments-live-check` 7/7 |
| 16 | 只读文档能看不能改 | ✅ | `client.js` 的只读开关 + `ui` 只读分支 | `gui-comments-readonly-check` 6/6 |

## 两个 🟡 的缺口（写清楚，不含糊）

**#13 复制粘贴**：只认我们自己的 `text/x-ghmd-comments+json`。从 **Word** 复制带批注的文字贴进来还不支持，
而且**实测证明原因不是「RTF 里有私有结构」**：在真实 Word 里复制一段带批注的文字后，RTF（43KB）里 `\\atnid` 出现 **0 次**、
HTML（42KB）里没有批注正文，批注实际走的是 `Embed Source` / `ObjectLink`（OLE 内嵌文档片段）。要支持它得解析那个内嵌片段，
工作量远大于解析 RTF。另外系统剪贴板里自定义 MIME 的真实往返取决于浏览器/OS，自动化测试用合成 `ClipboardEvent` 验证接线。
实测脚本：`.dsh-scratch/probe-word-rtf-clipboard.ps1`、`probe-word-html-clipboard.ps1`。

**#15 协同**：轮询 + 按 id 合并（`mergeStores`）是「准实时」，不是推送、也不是 CRDT。两台机器同时改**同一段**时
最后保存的一方赢（批注不丢，正文位置以保存者为准）。推送与冲突细分留待有服务端时再做。

## 文件格式侧的对照（不在上表）

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| 读 docx 五个批注部件（comments / Extended / Ids / Extensible / people） | ✅ | `comments-test` 27/27（真实文档 22–49 条） |
| 写回 Word 原生批注（页边气泡、回复线程、已解决勾） | ✅ | `comments-export-test` 26/26、`comments-word-check` 6/6（真实 Word COM） |
| 真实稿件往返（Word 对原文件与写回文件报告同样数字） | ✅ | `comments-jspace-roundtrip` 6/6（22 条 / 6 个 Done / 22 个可解析锚点） |
| 0 长度锚点（光标处批注） | ✅ | `comments-point-anchor-test` 9/9（Word 读回 `Scope` 长度 0） |
| 从同名 docx 导入 / 导出到 `<doc>-comments.docx` | ✅ | `comments-import-test` 10/10、`comments-export-sidecar-test` 8/8、两个 GUI 套件 |

## 怎么自己跑

```powershell
cd E:\hermes_playground\dsh-word-comments
node scripts/comments-test.mjs                 # 27/27
node scripts/comments-export-test.mjs          # 26/26
node scripts/comments-model-test.mjs           # 32/32
node scripts/comments-store-test.mjs           # 13/13
node scripts/comments-import-test.mjs          # 10/10
node scripts/comments-export-sidecar-test.mjs  # 8/8
node scripts/comments-point-anchor-test.mjs    # 9/9  （需要 Word）
node scripts/comments-clipboard-test.mjs       # 13/13
node scripts/comments-permissions-test.mjs     # 7/7
node scripts/comments-perf-test.mjs            # 5/5
node scripts/comments-reattach-test.mjs        # 9/9
node scripts/comments-jspace-roundtrip.mjs     # 6/6  （需要 Word）
node scripts/comments-word-check.mjs           # 6/6  （需要 Word）
node scripts/comments-model-word-check.mjs     # 5/5  （需要 Word）
```

应用内套件在 `.dsh-scratch/` 下（`gui-comments-*.mjs`），需要一个指向本仓库的测试 profile：
`start-verify-host.ps1` 启动后把地址写进 `dsh-verify-url.txt`，脚本会读它。

## 版本与提交

| 版本 | 提交 | 主题 |
| --- | --- | --- |
| v1.3.18 | `231e5ff` | 读/写/模型/UI/导入 |
| v1.3.19 | `14dd381` | 导出到 Word + 三处细节 |
| v1.3.20 | `c0ffe10` | 快捷键、引文、光标处批注 |
| v1.3.21 | `7cf8aaa` | 我的筛选、展开全部 |
| v1.3.22 | `a820ed5` | 引文跳转、只读审阅 |
| v1.3.23 | `2f644c5` | 复制粘贴带批注 |
| v1.3.24 | `64f0cd7` | 只有作者能改 |
| v1.3.25 | `bf420d7` | 准实时同步 |
| v1.3.26 | `98710d4` | 打印清单 + 性能实测 |
| v1.3.27 | `e45df60` | 丢失锚点恢复 |
| v1.3.28 | `bedf3e4` | 覆盖层 fixed 修复 |
