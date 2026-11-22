# Changelog

Versions follow [SemVer](https://semver.org). The plugin was developed as `0.70`–`0.114` inside a private workspace and is published from `1.0.0`; the entries below keep that development history.

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
