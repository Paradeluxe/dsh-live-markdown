# How this plugin is verified

Every claim in the README that sounds like a number was measured, not guessed. This page records how, so a reviewer can judge the evidence instead of trusting prose.

## Environment

- DSH **0.2.2-rc.3** (Desktop build, `DeepSeek Harness.exe` running the packaged CLI), booted against a **throwaway profile** so the real profile is untouched.
- The plugin is linked into that profile with `link:` and exercised in a real browser page through **Playwright** (Chromium/Edge), not in a DOM stub.
- Obsidian **1.15.1** is used as the reference implementation: layout numbers come from reading its Live Preview DOM through the DevTools protocol, not from screenshots by eye.

## Automated GUI suite

42 scripts, each driving the real page: open a workspace note, then act and assert. Areas covered:

| Area | What the scripts check |
|---|---|
| Editing core | click-to-place caret, active line shows source, other blocks render, typing re-renders live |
| Keymap | Enter (lists/quotes/callouts/headings), Backspace (list markers), Tab/Shift+Tab, Ctrl+B/I, Ctrl+K, Ctrl+Enter, Ctrl+Shift+K, Ctrl+Shift+V, Ctrl+S, auto-pairs |
| Folding | heading, unordered, ordered and task folding; state remembered per file and after a remount |
| Tables | cell editing, Tab navigation, right-click insert/delete/alignment |
| Blocks | code fences, callouts (types, fold, markdown body), quotes, task lists, math, frontmatter card, footnotes |
| Links & media | wikilink aliases, `![[note]]` embeds, hover preview card, images (`![[image\|300]]`), image lightbox, image paste |
| Layout | table cell height, cell padding, borders, content-width tables, image radius, line-height, heading padding, page margins |
| Data integrity | fast typing survives throttling, save → reopen integrity, scroll restoration, `pagehide` flush |
| Long documents | 6 600-line note: decoration build and keystroke latency, correct rendering at any scroll position |
| Focus semantics | unfocused preview renders everything; active range = whole selection |

Known-flaky spots are handled by re-running a script once against a fresh page and by waiting for the save indicator to settle before interacting, because the host rebuilds the preview when the file changes.

## Measurements behind the "Obsidian-matched" claims

| Claim | Measurement |
|---|---|
| Body line-height 1.5, heading padding-top 16px | Obsidian `.cm-line` heights: 24 px body, 44–48 px headings |
| Table cells 29.8 px, `4px 8px`, `1px #e4e4e4` | Obsidian `td` height/padding/border (`border-collapse` counted once) |
| Tables sized to content | Obsidian table width 131 px for four short cells; the plugin also renders 131 px for the same table |
| Image radius 4 px, no margin | Obsidian `img` computed style in the embed wrapper |
| Lightbox: 90 % black backdrop, filename titlebar | Obsidian `.lightbox` / `.lightbox-bg` / `.lightbox-titlebar` structure and opacity |
| Preview-rebuild flicker | Frame sampling with `requestAnimationFrame`: 413 frames while typing through saves → 3 blank frames (initial load only), 0 stale placeholders |
| No lost keystrokes | Type then trigger `pagehide` with the autosave debounce temporarily raised to 60 s: the file still receives the final characters |

## Flicker (1.0.5)

The preview rebuild is triggered by any file change, and the plugin cannot make the host ignore its own writes. 1.0.5 therefore never writes while the window is visible:

- Frame sampling while typing in a visible window: **350 frames, 0 editor identity changes, 0 blank frames, 0 scroll shifts**.
- The first save lands within ~1 s of the window losing focus (blur), on Ctrl+S, on preview-tab close, and on pagehide.
- Fallback: one write after 30 minutes of continuous visible typing, as crash protection.

## Save latency (measured)

The editor has no save button; it saves automatically. Measured by typing, then polling the file on disk from the test script:

| Trigger | Observed delay |
|---|---|
| Idle autosave after typing | ~1.65 s (1500 ms debounce + one round trip) |
| Ctrl+S inside the editor | 0 ms (immediate) |
| Window close / page hide | immediate (`pagehide` + `sendBeacon`) |
| Closing the preview tab | not immediate, but the pending timer still runs: the file contains the edits within ~1.5 s |

## Fold chevron (1.0.6)

The chevron is an inline-flex box whose vertical position is corrected per context with `--gh-md-chevron-shift`; centre offsets are measured against the text run rect in a real page:

| Context | Offset (px) |
|---|---|
| h1 | 0.1 |
| h2–h6 | 0.0 |
| bullet / ordered | 0.0 |
| task | 0.5 |

Before the rewrite the glyph was 2.5–4.5 px below the text centre on headings. Screenshots: [`chevron.png`](screenshots/chevron.png), [`chevron-list.png`](screenshots/chevron-list.png).

## First paint (1.0.7)

Per-frame sampling of a document being opened in a real page:

- Before: the first frames showed the static Markdown layout ([data-gh-md-block] present, no .cm-editor), then the CM6 preview replaced it; the document CSS could be missing on the very first frame because it was injected after paint.
- After: the first frame that contains the document is already the CM6 editor (editor: true, staticBlocks: 0); window.__ghMdCm6LivePreview and the bundle script exist before any document is opened, because the plugin warms them at load time.

## Link click feedback (1.0.8)

Clicking a rendered link is asserted in a real page (with clipboard permissions granted):

- a `.gh-md-copy-hint` appears with the copied target and auto-dismisses after ~2 s;
- no `.gh-md-save-pill` appears and the file on disk is unchanged;
- a real save still shows 保存中… then 已保存.

## Link navigation (1.0.10)

Replaces the 1.0.9 replace-tab behaviour; asserted in a real page:

| Action | Observed |
|---|---|
| click a relative Markdown link | tab count 1 → 2, the target becomes active, the source tab stays open |
| click back to the source tab | source document shown again, tab count 2 |
| click a [[wikilink]] to an already-open target | tab count stays 2 (existing tab focused, no duplicate) |
| click the same target again | tab count stays 2 |
| external https link | opens a browser page, no copy hint |

## Link navigation (1.0.9)

Asserted in a real page by clicking rendered anchors:

| Action | Observed |
|---|---|
| relative Markdown link | pane switches to the target document, document tab count stays 1 |
| [[wikilink]] without extension | resolves to the target .md and switches |
| wikilink inside the target back to the source | switches back |
| external https link | opens a browser page at the target URL and shows no copy hint |

## Table add controls (1.1.0)

Obsidian 1.15.1 was measured first (CDP): a full-width 16px plus strip below the table with `cursor: s-resize`, a 16px plus strip at the right edge with `cursor: e-resize`, lucide-plus glyphs, hidden until hover; clicking appends an empty row / a complete new column. The plugin reproduces those values.

`gui-table-add-check.mjs` (run in the GUI suite, 11 assertions):

- both plus strips exist and become visible on hover;
- the row strip sits at the table’s bottom edge with >= table width, the column strip at its right edge with >= table height;
- cursors are `s-resize` and `e-resize`;
- clicking adds one rendered row / one rendered column and the document text matches;
- the context menu still deletes a column and the rendered table updates;
- after undo the editor still accepts input, with zero CM6 runtime errors.

## Image zoom (1.1.3)

`gui-image-zoom-check.mjs` (in the GUI suite, 9 assertions) drives the real page:

- double-clicking an image opens `.gh-md-lightbox` with an identity transform;
- wheel up scales to 1.90x and then 3.60x, the cursor becomes grab;
- wheel down returns to 1x;
- dragging a zoomed image changes the translate to (60, 40) and does not close the overlay;
- Escape closes it, with zero page errors.

## What is *not* verified

- Windows/macOS/Linux UI differences, dark-theme colour accuracy, and screen readers.
- The host behaviours the plugin cannot control: preview rebuilds on file change (mitigated with a DOM snapshot, not removed) and the resulting reset of the editor's undo stack after a rebuild.
- Node-only harnesses exist for the rendering pipeline and the editor prototype, but they are jsdom-based and cannot stand in for the browser checks above.
