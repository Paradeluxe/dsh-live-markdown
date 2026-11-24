# Changelog

Versions follow [SemVer](https://semver.org). The plugin was developed as `0.70`–`0.114` inside a private workspace and is published from `1.0.0`; the entries below keep that development history.

## 1.3.33

- Two untested Word behaviours are now covered by Word itself: a comment spanning two paragraphs exports and Word reports one comment whose Scope is 83 characters across 2 paragraphs with a paragraph break inside; a comment on table-cell text exports and Word reports it with InTable = true and Cells = 1, Scope exactly the quoted cell text.
- No code change was needed — anchor ranges are plain text offsets and the exporter splits runs across paragraphs and tables — but the claim is now measured rather than assumed.
- Verification: comments-crossrange-test.mjs 6/6 and comments-table-range-test.mjs 5/5 (both use Word COM). README acceptance table is 36 suites / 370 assertions, re-summed by script.

## 1.3.32

- @mentions became actionable without a notification server: mentionsAuthor(thread, name) matches a full name, the first token, case-insensitively, and CJK names, over the root body and its replies; the panel list tags such rows with "@我", a new "提及我" filter keeps only those threads, and when polling brings in a comment that mentions me the toast reads "有人在批注里 @ 了你（某某）" instead of the generic new-comment message.
- Verification: comments-mentions-test.mjs 10/10 and gui-comments-mentions-check.mjs 5/5. README acceptance table is now 34 suites / 359 assertions, re-summed by script.

## 1.3.31

- New-comment markers, the equivalent of Word's "new comments" styling: the sidecar gains an optional readers map (signature → last-read timestamp), unreadThreads() marks threads whose comments are newer than my pointer and were not written by me, and the UI shows the count on the chip ("批注 N · M 新"), a blue ring on the margin dot and a "新" tag in the panel list. Edits and replies count as new, not just additions.
- The panel header gains "标为已读", which writes the current timestamp into readers and clears the markers; the comment data itself is untouched.
- Old sidecars without a readers field keep working (the field is optional in parseStore/serializeStore).
- Verification: comments-unread-test.mjs 14/14 and gui-comments-unread-check.mjs 9/9. README acceptance table is now 32 suites / 344 assertions, re-summed by script.

## 1.3.30

- Measured, instead of assumed, where Word puts comments when you copy commented text: the Rich Text Format payload is 43,322 characters with 0 occurrences of \atnid, the HTML payload is 42,029 characters with no comment body, and the clipboard format list includes Embed Source / ObjectLink. Word-to-Word comment transfer therefore travels in the native OLE embedded fragment, not in RTF or HTML.
- This corrects the previous written rationale for the partial "paste from Word" item: the missing piece is an OLE fragment parser (our docx reader pointed at the embedded stream), not an RTF parser.
- docs/WORD-COMMENTS.md gains §1.11 with the measurement table and the exact clipboard format list; docs/WORD-MATRIX.md row 13 now states the measured reason.
- No behaviour change: the same partial support, now with evidence instead of a guess.

## 1.3.29

- Feature switch for the whole comment capability: with localStorage['github-md:comments-enabled'] = '0' the extension is not mounted at all (cm6-entry only adds it when commentsPath is non-empty), so there are no highlights, margin dots, chip, shortcut or sidecar reads; setting it back to '1' restores everything on reload.
- docs/WORD-MATRIX.md: a single page mapping all 16 Word behaviours to their implementation file and the suite that proves it, plus the five file-format capabilities, the two partial items with their exact gaps, and the commands to run every suite.
- README documents how this branch merges back to main: no sidecar means no UI, the feature switch, the read-only switch, additive data files only (never overwriting a docx), and that the branch is a fast-forward from main's tip.
- Verification: gui-comments-toggle-check.mjs 10/10 (off: no highlight, no dot, no chip, sidecar untouched; on: everything returns).

## 1.3.28

- Fixed the "panel cannot be clicked in short documents" issue: every overlay node (comment cards, margin dots, the count chip, the panel, the lost-anchor notice and the toast) now lives on document.body with position: fixed and viewport coordinates from coordsAtPos(), so the scroller's overflow can no longer clip them.
- The overlays carry explicit z-index values above the app's panes (900–930); the chip previously had none and was painted underneath the document's heading line.
- destroy() removes the chip, panel and toast too, so remounting the editor no longer leaves stale "批注 N" chips behind.
- Verification with real mouse input: gui-comments-lost-check.mjs now clicks the notice and the panel row with actual coordinates and asserts elementFromPoint hits the row itself — 9/9. Regressions re-run against the fixed overlay: main flow 21/21, panel 12/12, expand-all 7/7, details 8/8, shortcuts 10/10, quote jump 6/6, read-only 6/6.

## 1.3.27

- Lost anchors are now recoverable: when the commented text is deleted, the "N 条批注的原文已被删除" notice is a button that opens the panel filtered to "丢失"; selecting new text and clicking the lost comment re-attaches it (model: reattachComment()), and its replies follow the root onto the same range. Anchors, highlights, the thread and saving all come back.
- The sidecar keeps the comment while the anchor is null (nothing is silently dropped), which is what makes recovery possible at all.
- Verification: comments-reattach-test.mjs 9/9 and gui-comments-lost-check.mjs 8/8.
- Known issue recorded in DESIGN §183: on very short documents the scroller is only ~170px tall, the panel is partially clipped by its overflow, and synthetic mouse coordinates can land outside it; the GUI harness therefore clicks panel rows programmatically. The recovery logic itself is verified end to end.

## 1.3.26

- "打印" in the panel header opens a printable HTML page (blob URL) listing every comment with its index, author, time, state, the quoted text, the body and its replies; each card uses page-break-inside: avoid, so Ctrl+P or "save as PDF" produces a clean review sheet. This is the equivalent of Word's "print markup".
- Performance measured rather than assumed: with 400 threads / 500 comments on a 2000-line document, resolveStore takes 0.05ms median, buildThreads 0.09ms, serializeStore 1.71ms and parseStore 0.67ms; the sidecar itself is 305KB.
- Verification: comments-perf-test.mjs 5/5 and gui-comments-print-check.mjs 8/8 (popup page, title with the count, body, quote and state present, no page errors). README acceptance table now covers 27 suites / 293 assertions.

## 1.3.25

- Near-real-time sync: while a document is open the client polls the sidecar every 2.5s; when another author's save bumps the mtime it merges with mergeStores(remote, local), re-renders and toasts "检测到新的批注（作者）" without a page reload. Merging never writes back (a local save is the only writer) and polling pauses while document.hidden.
- Verification: gui-comments-live-check.mjs 7/7 — with the page open, the sidecar is written behind its back as "Carol Li"; the dot, the highlight, the toast naming the author and the card body all appear within 2.5s with no reload.
- README now carries one acceptance table covering all 25 suites / 280 assertions with their counts.

## 1.3.24

- Editing your own comment: the card shows an "编辑" action only when the comment's author matches the current signature, which opens the composer prefilled with the body and saves through editComment().
- Permission rule lives in the model: canEditComment(comment, authorName) — a deleted comment cannot be edited, an empty signature edits nothing, and replies follow the same rule as their root.
- Switching the signature re-renders the cards (not just the panel), so the edit action appears/disappears immediately; replies stay available to everyone, matching Word.
- Verification: comments-permissions-test.mjs 7/7 (author can, others cannot, empty signature cannot, deleted cannot, replies follow the root, independent of anchor position) and gui-comments-permissions-check.mjs 8/8 (edit visible as the author, gone as Bob Wu with reply still there, back after switching, prefilled body, saved edit).

## 1.3.23

- Copying text that contains comments now also puts a `text/x-ghmd-comments+json` payload on the clipboard (text, authors, timestamps, resolved flags, reply parents, anchors relative to the copied text) next to the normal `text/plain`, so other applications still paste plain text.
- Pasting that payload inserts the text and recreates the comments at the new offsets: ids are reassigned, replies re-point at the new roots, and a toast reports how many comments came along.
- The copy handler is registered in the capture phase so CodeMirror's own paste handling cannot swallow the payload; read-only mode is respected on both sides.
- Boundary: only our own payload is understood. Comments copied in Word itself carry their markup in RTF/HTML clipboard formats, which is not parsed yet.
- Verification: comments-clipboard-test.mjs 13/13 (whole and partial copies, relative anchors, empty selection, shifted paste, reply re-parenting, id reassignment, pasting twice) and gui-comments-clipboard-check.mjs 8/8 (both clipboard types after a synthetic copy, text inserted on paste, comment rebuilt at the pasted offsets 8 → 30).

## 1.3.22

- The quoted text at the top of a card is now clickable: it scrolls the anchor into view and flashes the highlighted range, the same way Word takes you to the commented text.
- Read-only review: with `localStorage['github-md:comments-readonly'] = '1'` the document still shows highlights, margin dots, cards and quote text, but the reply/resolve/delete actions and the floating "+" button disappear, so a reviewer can read threads without changing them.
- The card body is built from an `actions` fragment that is empty in read-only mode, and `bindCard` returns after wiring hover when editing is off.
- Verification: gui-comments-quote-check.mjs 6/6 (clickable quote, flash on the anchor, scrollTop 13 → 1172) and gui-comments-readonly-check.mjs 6/6 (comment visible, no action buttons, no "+" button, no page errors).

## 1.3.21

- "我的" filter in the comment panel: matches the current signature, so switching the signature in the footer moves newly written comments into "mine".
- "展开" / "收起" in the panel header spreads out every comment card at once (the equivalent of Word's "show markup" balloons): cards are laid out in anchor order, pushed down when they would overlap, and the button flips to "收起".
- Verification: gui-comments-allopen-check.mjs 7/7 (mine filter keeps one comment, expand opens both cards with tops 126px apart, the label flips, collapse closes them, no page errors).

## 1.3.20

- Ctrl+Alt+M inserts a comment, matching Word's default shortcut: on a selection it anchors to the range, on an empty selection it anchors to the caret.
- Caret comments (zero-length anchors) are supported end to end: the sidecar stores `start === end`, the body shows a small clickable marker at that position, and the card says "（插入点批注，没有选中文字）".
- The card now shows the commented text at the top (the equivalent of Word's balloon quote), truncated with a title on hover.
- The exporter writes a zero-length anchor as `commentRangeStart` + `commentRangeEnd` + `commentReference` at the same offset (Word's own order); verified in real Word: 1 comment, Scope length 0.
- Verification: comments-point-anchor-test.mjs 9/9 (model, re-anchoring after edits, exported XML shape, Word COM) and gui-comments-keys-check.mjs 10/10 (shortcut, quoted text, caret comment stored/rendered/explained, Escape).

## 1.3.19 (unreleased)

- "导出到 Word" in the comment panel: writes the sidecar comments into the sibling `.docx` template and saves the result as `<doc>-comments.docx` (the original file is never overwritten).
- Reverse anchor mapping (markdown → docx): exact quote first, whitespace-insensitive second, paragraph plain-text fallback third; unmapped comments are reported as "锚点不精确" instead of silently landing at offset 0.
- The exported document carries native Word comments (margin bubbles, reply threads, resolved flags); comments already present in the template are replaced by the sidecar set, since the sidecar is the source of truth.
- Without a sibling `.docx` the panel reports that a template is required and writes nothing.
- Comments anchored on the same line now stack their margin dots 13px apart instead of drawing one on top of the other (Word stacks the balloons the same way).
- @mentions inside a comment body render as a chip (Latin names with up to three tokens such as "@Bob Wu", and CJK names); the stored and exported body stays plain text, which is what Word does on disk too.
- The panel header gained a "复制" action that puts the whole comment list on the clipboard as a Markdown table (# / quote / author / comment / state), the lightweight counterpart of Word's "print markup".
- Verification: gui-comments-details-check.mjs 8/8 for the three details above; comments-export-sidecar-test.mjs 8/8 (the real manuscript's 22 comments survive export and re-parse as 22 comments / 11 threads / 3 resolved) and gui-comments-export-check.mjs 7/7 (file created, contents correct, template comments replaced, toast names the file).

## 1.3.18

Word-compatible comments, developed on the `word-comments` branch forked from v1.3.17.

- New sidecar model: `<doc>.comments.json` beside the markdown, with Web-Annotation style anchors (offset + quote + 32-char prefix/suffix), tombstones for deletes, id-based merge and strictly increasing `modifiedAt`.
- Reader for the five OOXML comment parts (comments, commentsExtended, commentsIds, commentsExtensible, people) with no dependencies: threads via `w15:paraId`/`paraIdParent`, resolved via `w15:done`, authors, dates and durable ids.
- Writer that puts comments back into a .docx as native Word comments (anchors, `commentsExtended` threading, `commentsIds`, `people`, compatibility mode 15); verified in real Word over COM.
- Editor UI: yellow highlights on commented ranges, a margin dot per thread (grey when resolved), a floating Word-style card with avatar/author/time/body/replies and reply/resolve/delete, a floating + button on any selection (mouse or keyboard), Ctrl+Enter submit, Esc cancel.
- Comment panel behind a "批注 N" chip: filters 全部 / 未解决 / 已解决, prev/next navigation, jump-to-anchor, and a signature field (localStorage) so each comment records its author; new comments that arrive from someone else's save merge in with a toast naming them.
- "从 Word 导入" button: reads the sibling `.docx` (`paper.md` ↔ `paper.docx`), maps anchors onto the markdown text (exact quote first, paragraph fallback), merges into the sidecar and is idempotent on re-import.
- Host routes `GET /github-md/comments/load`, `POST /github-md/comments/save`, `POST /github-md/comments/import`, all scoped to the session workspace; saves merge with a newer file on disk instead of overwriting it.
- Verification: comments read 27/27, export 26/26 + Word COM 6/6, model 32/32 + Word COM 5/5, store 13/13, import 10/10, UI 21/21, panel 12/12, import button 11/11, multi-user merge 7/7.

## 1.3.17

- Table affordances now share one control: the append-row and append-column targets were 64x16 and 16x64 transparent strips (radius 0 and 6px, cursors `s-resize` / `e-resize`) while the between-rows insert button was a 16x16 bordered chip. All three are now 18x18, radius 6px, 1px hairline, raised surface, `pointer` cursor, and the same 12px plus icon.
- Hover on any of the three fills it with the accent blue and turns the glyph white; a small press state darkens it.
- Removed the resize cursors, which read as "drag to resize" for a click-to-insert control and changed shape as the pointer crossed the table edge.
- gui-table-add-check.mjs is now 15 assertions (identical geometry/radius/border, both cursors pointer, hover accent fill); gui-table-insert-check.mjs still 25/25.

## 1.3.16

- The update notice never ran in the Desktop app: it was gated on `window.location.protocol` being http/https, while the Desktop page is `dsh-app:`. The check now also accepts `dsh-app:` (other custom schemes stay excluded) and exposes `window.__ghMdUpdate.acceptsProtocol` for tests.
- Why other plugins show a native "更新" button and this one does not: DSH offers it only for bundles installed from an npm registry or a Git commit (it needs an install target to compare); this bundle is installed from a local link.
- New gui-update-pill-check.mjs (10 assertions, stubbed release) and gui-update-protocol-check.mjs (4 assertions, real dsh-app page forwarding /github-md/update/check to the Host).

## 1.3.15

- A failed image now names the file instead of the alt text ("图片无法加载：fig1_merged_grid_xlast.png") and puts the absolute path in the element title, so a wrong/renamed path is identifiable without DevTools.
- Measured the regenerated 93 KB manuscript in the live preview: three figures still render (316x500, no placeholder), 24px paragraph gaps, no horizontal overflow; typing latency averages 15 ms (worst 18 ms) and cursor moves ~16 ms, so long lines do not slow editing.
- New gui-missing-image-check.mjs (4 assertions).

## 1.3.14

- Structural parity with Obsidian reading view, measured on the same fixture: inline code 14px/21px with 2px 4px padding (was .92em/0 2px), blockquote indent 24px (was 12px, nested +16px per level) with body text colour instead of muted, hr vertical margins 32px (was 16px), task checkbox 16x16 (was 14x14). Static renderer blockquote padding 14 -> 24px too.
- Confirmed a small (120x80) image is rendered at its natural size, not stretched: the rule is max-width: 100%, matching Obsidian.
- New gui-parity-check.mjs (9 assertions) covers inline code, blockquote bar/indent/colour, hr margins, checkbox size, natural image size, table cell padding/border and link underline.

## 1.3.13

- Heading weights now match Obsidian exactly: h2 680, h3 660, h4 640, h5 620 (h1 700 and h6 600 already matched), sizes stay at 1.618/1.462/1.318/1.188/1.076/1em with line-heights 1.2/1.2/1.3/1.4/1.5/1.5. Applied to both the static renderer and the CM6 live preview; bold is 600 to match calc(400 + 200).
- New gui-typography-check.mjs (8 assertions) pins h1-h6 and body size/weight/line-height against the Obsidian baseline.

## 1.3.12

- The 1.3.11 external-change watcher is skipped in jsdom: the integration harnesses stub the read API, so the poll treated the stub as a disk update and overwrote typed text (harness-cm6-integration "save after typing", harness-editor-undo). Real browsers are unaffected.

## 1.3.11

- External changes now reload the open preview by themselves: every 2.5 s the component re-reads the file (read-only) and, when there are no unsaved edits, replaces the document in place (text, images, collapsed blank lines); with unsaved edits it only raises the existing "外部已修改 · 重新载入" pill instead of clobbering the draft.
- This fixes the most common "images disappeared" case: a tab opened before the manuscript (and its figures) were regenerated kept showing the old text, whose image paths no longer resolved.
- New gui-auto-reload-check.mjs (4 assertions) registered in the GUI suite.

## 1.3.10 — reading the manuscript end to end on the real desktop window

Visual pass over `manuscript/results_Nov18.md` in the DSH Desktop window (native screenshots + synthetic mouse), with Obsidian opened on the same vault as the reference. Fixes found by looking:

- **1.3.7 narrow panes**: the document kept a hard-coded 32px horizontal padding plus 18px on the editor content, leaving only 273px of text in a 373px sidebar pane. Both are fluid now (`min(32px, 5%)` / `min(18px, 3%)`): text column 273 -> 316px, wide panes unchanged. Stacked headings follow Obsidian: a heading preceded by one blank line that follows another heading drops its 16px top padding (h2 box 44.5 -> 28.5px, Obsidian 29.1).
- **1.3.8 figures**: a single click on a block image now opens the lightbox (previously only a fast double click), and tall figures open at 96vw instead of being squeezed by `max-height: 92vh` (475 -> 1012px in a 1054px window).
- **1.3.9 blank lines**: runs of blank lines collapse the reading-view way - the first keeps its 24px paragraph gap, the rest fold to zero height; the caret line is never collapsed. Inter-block gaps 48/72/96 -> 24px, document 6.7% shorter. (Obsidian live preview shows every blank line; this deviates on purpose.)
- **1.3.10 diagnostics**: the client now posts structural facts (baseURI, editor/editable state, resolved sourcePath, image markdown lines, widget count, img src + natural size, placeholder text) to `POST /github-md/workspace/diagnose`, which the host appends to `<plugin>/diagnostics.log`. Needed to diagnose desktop-only "images missing" reports.
- 1.3.10 also keeps the lightbox open when the opening gesture is a double click (the second click lands on the overlay; clicks within 450ms of opening are ignored).

## 1.0.3

- Root cause of the typing-time flicker: the host preview rebuilds the whole preview component whenever the file changes, so the 200 ms autosave tore the editor down and rebuilt it continuously.
- Autosave debounce was raised (700 ms at the time; 1500 ms in 1.0.4) while `Ctrl+S` still saves immediately, and a DOM snapshot of the previous frame is used as a placeholder during the rebuild. Frame sampling shows 0 blank frames while typing through saves.

## 1.0.2

- Per-file scroll position memory: switching files or a preview remount no longer jumps back to the top.
- Investigated typing-time flicker/jumps: scripted typing (Latin keys, IME composition, long documents with internal scrolling, small windows) did not reproduce caret or scroll displacement, so the confirmed fix this release targets the remount-to-top path.

## 1.0.0

First public release.

- Obsidian-style Live Preview for Markdown files in the DSH document panel: blocks render in place, the active block or selection shows source.
- Edited keymap (Enter/Backspace/Tab/Ctrl+B/I/K/Enter/Shift+K/Shift+V/S), auto-paired brackets, multi-cursor.
- Folding for headings, unordered, ordered and task lists with per-file remembered state.
- Tables edit in place with `Tab` navigation and a right-click menu; code fences with language label and copy; callouts with fold semantics.
- Inline `![[note]]` embeds, wikilink hover preview card, KaTeX math, frontmatter properties card, footnote superscripts, `==highlight==`.
- Images: `![[image]]` renders as a block widget sized to the image, `|width` syntax, paste/drop saves the file next to the note, double-click opens a lightbox.
- Layout matched to measurements from Obsidian 1.15.1: body line-height 1.5, 16px heading padding, 26/27px list rows, 29.8px table cells with `4px 8px` padding and `1px #e4e4e4` borders, content-width tables, 4px image radius.
- Long documents stay responsive (viewport-scoped decorations) and never lose keystrokes (throttling flushed before save, file switch and unmount).
- `PARITY.md` documents 52 Obsidian behaviours with their status and limitations.

## 0.70.0 – 0.99.0 (development)

- Built the whole-note CodeMirror 6 live-preview editor and the Host workspace API.
- Fold chevrons for headings and all list kinds, persisted per file.
- Rich block widgets: tables, callouts, code, math, frontmatter, embeds, footnotes, quotes, task lists, horizontal rules.
- Hover preview cards for wikilinks; external-link affordance; image paste/drop into the note directory.
- Alt+click multi-cursor, per-file selection/undo/fold memory, save → reopen integrity.
- Unfocused editor renders every block; the active range covers the whole selection.
- Viewport-scoped decoration building: a 6 600-line note went from 74 ms to ~10 ms per edit.
- `PARITY.md` introduced as the behaviour/status matrix.

## 0.100.0 – 0.114.0 (development)

- Enter semantics: headings start a plain line, nested list items continue at the same depth.
- Verified no keystrokes are lost under fast typing, `Ctrl+S`, and file switching.
- Properties card: clicking a row puts the caret on that property's YAML line.
- Removed CodeMirror's default dotted focus outline on the editor (it read as a black frame).
- Layout passes driven by measurement: content height hugs short notes, no width cap, 1.5 line-height with 16px heading spacing, page margins at 16/24px.
- Table and image box metrics measured from Obsidian and applied to both render paths (live preview and the read-only renderer used inside callouts and embeds); no more flush first column in static tables.
- Full-line images became block widgets, removing the 48 px phantom line box below every image.
- Images: double-click opens an Obsidian-style lightbox; a document-level click-burst detector keeps it reliable when the editor re-renders widgets; images inside callouts now render and zoom.
