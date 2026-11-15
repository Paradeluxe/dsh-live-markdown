# Changelog

Versions follow [SemVer](https://semver.org). The plugin was developed as `0.70`–`0.114` inside a private workspace and is published from `1.0.0`; the entries below keep that development history.

## 1.0.3

- Root cause of the typing-time flicker: the host preview rebuilds the whole preview component whenever the file changes, so the 200 ms autosave tore the editor down and rebuilt it continuously.
- Autosave now debounces 700 ms (still flushes on file switch, blur, and Ctrl+S), and a DOM snapshot of the previous frame is used as a placeholder during the rebuild. Frame sampling shows 0 blank frames while typing through saves.

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
