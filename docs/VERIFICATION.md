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

## Wide tables (1.1.4)

A table that spans the full content width used to clip the add-column strip. The check now covers it:

- with a 5-column table filling the panel width, the column plus stays inside the wrapper (`right <= wrapper.right`) and is visible on hover;
- clicking it still appends a column (5 → 6).

## Table row/column deletion (1.1.5)

`gui-table-delete-check.mjs` (10 assertions, part of the GUI suite):

- row handles match the number of rows (header included) and column handles match the columns; both become visible on table hover;
- clicking a row handle highlights exactly the columns of that row; Backspace removes the row from the document and the rendered table, then clears the selection;
- clicking a column handle highlights header + body cells; Delete removes the column (3 → 2);
- Escape clears the selection without changing the table; zero page errors.

## Table multi-selection and copy (1.1.6)

`gui-table-multisel-check.mjs` (8 assertions, part of the GUI suite, real clipboard):

- Shift+click on row handles selects a contiguous range: 2 handles, 6 highlighted cells; Ctrl+C puts `甲\t1\t第一行\n乙\t2\t第二行` on the clipboard; Backspace deletes both rows (3 → 1);
- Shift+click on column handles selects 2 columns (4 highlighted cells); Ctrl+C copies `名称\t数值\n丙\t3`; Delete removes both columns (3 → 1);
- a plain click replaces the previous selection with a single row; zero page errors.

## Drag reordering and Markdown copy (1.1.7)

`gui-table-drag-check.mjs` (7 assertions, part of the GUI suite):

- Ctrl+Shift+C on a two-row selection copies `| 甲 | 1 | 第一行 |\n| 乙 | 2 | 第二行 |`;
- dragging the third row handle above the first row shows a drop indicator and leaves rows as 甲, 丙, 乙 both in the DOM and in the document;
- dragging the last column handle to the left end reorders the header to 备注, 名称, 数值 with cell data following (第一行 | 甲 | 1); zero page errors.

## Cross-cell drag selection (1.1.8)

`gui-table-cellselect-check.mjs` (9 assertions, part of the GUI suite):

- dragging across two cells highlights exactly those two;
- dragging across a whole row highlights all 3 cells and Backspace deletes the row (3 -> 2 body rows);
- dragging down a whole column highlights header + 3 body cells and Backspace deletes the column (3 -> 2 columns);
- dragging a 2x2 rectangle highlights 4 cells and Backspace clears their contents while the table keeps 3 rows and 3 columns;
- Ctrl+C copies the range as TSV; zero page errors.

## Table selection deletion with stolen focus (1.1.9)

`gui-table-delete-focus-check.mjs` (5 assertions, part of the GUI suite):

- a real mouse drag across a row highlights all three cells;
- after moving focus to `.cm-content` (simulating the desktop shell), Backspace still deletes the row (3 -> 2);
- handle-based selection also deletes after the same focus move;
- clicking outside the table clears the selection, so Backspace does not delete anything; zero page errors.

## Column plus gutter (1.1.9)

Measured in the real GUI with a full-width 5-column table:

- table right edge = wrapper right - 18px (gutter reserved),
- add-column plus left edge = table right edge, so its overlay over the table is 0px; the strip is visible on hover inside the gutter,
- narrow tables keep the plus adjacent to the table edge.

## Table edge clicks (1.1.10)

Reproduced: clicking just below a table in the old build hit the full-width add-row strip, added a row and moved the caret below the table.

`gui-table-click-edge-check.mjs` (6 assertions, part of the GUI suite):

- a click below the table but off-centre adds no row and leaves the caret on the blank line below the table;
- a click on the centred plus below the table still adds a row;
- a click just right of the table, away from the centred plus, adds no column; zero page errors.

## Table word wrapping (1.1.11)

Obsidian 1.15.1 was measured first: cells use `word-break: normal; overflow-wrap: normal; white-space: break-spaces`, the table uses `width: auto; max-width: none`, and the table widget scrolls horizontally with `overflow-x: auto`.

`gui-table-wrap-check.mjs` (5 assertions, part of the GUI suite):

- no word in any cell is split across two lines (checked with Range.getClientRects for each word);
- computed `word-break` is `normal` and `overflow-wrap` is `normal`;
- the table either fits the container or becomes horizontally scrollable;
- zero page errors.

At a 760px viewport the same table renders "configuration", "checkpointing", "dim_batch=2", "wikitext_n1000_L128.jsonl" intact and wraps only at spaces (hyphenated tokens break after the hyphen, standard typography).

## Page side padding (1.1.12)

Measured in the running GUI: `.gh-md-document` computes to `padding: 16px 32px 24px`; `.cm-content` computes to `padding: 4px 18px`; a `.cm-line` sits 50px from the document left edge and 50px from its right edge (was 42 / 24).

`gui-width-check` now asserts page margins of at least 28px and equal left/right; `gui-spacing-check` still passes its fold-chevron hover assertions.

## Scroll stability during table edits (1.1.13)

`gui-scroll-preserve-check.mjs` (8 assertions, part of the GUI suite), with the table in the middle of a long document:

- after scrolling so the table sits around 250px from the top, dragging the second row handle to the bottom keeps scrollTop at 795 while the rows really reorder;
- clicking the centred add-row plus keeps scrollTop at 891 while the row count goes 3 -> 4;
- selecting a row via its handle and pressing Backspace keeps scrollTop at 891 while the row count goes 4 -> 3;
- zero page errors.

## Cell wrapping in 1.1.14

After 1.1.11 long unbroken tokens could not wrap. The renderer now inserts <wbr> hints inside long tokens and the wrap check grew to 7 assertions:

- no plain word spans two lines (Range.getClientRects per word, long tokens excluded);
- word-break is normal and overflow-wrap is break-word;
- the https URL wraps over multiple lines (8 lines in a 1100px window);
- the table fits its container (301px table in a 301px scroller);
- the first column keeps a readable width (65px), so CJK headers are not one character per line;
- zero page errors.

## Obsidian table selection parity (1.1.15)

`gui-table-obsidian-check.mjs` (18 assertions, part of the GUI suite). Obsidian itself was measured over CDP first; the copy strings below are character-identical to what Obsidian produced for the same table.

- row selection + Ctrl+C -> `| 甲   | 1   | 第一行 |` + `| --- | --- | --- |`;
- 2x2 rectangle + Ctrl+C -> `| 甲   | 1   |` / `| --- | --- |` / `| 乙   | 2   |`;
- whole column (via the column grip) + Ctrl+C -> `| 名称  |` / `| --- |` / three data rows;
- Ctrl+Shift+C still yields `甲\t1\t第一行`;
- clipboard carries both text/plain and text/html;
- Shift+Click on the last clicked cell selects a 2x3 rectangle (6 cells);
- context menu exposes 行/列 groups with Obsidian's exact submenu labels plus the two sort entries;
- sort descending -> 丙/乙/甲, ascending -> 甲/乙/丙, header untouched;
- move row up -> 乙/甲/丙; menu copy row -> `| 乙   | 2   | 第二行 |` + separator;
- Ctrl+X -> same Markdown and the row disappears (乙/丙 remain);
- Delete on a 1x2 rectangle clears those two cells and keeps the row;
- zero page errors.

## Table selection edge cases (1.1.16)

gui-table-obsidian-check.mjs is now 33 assertions; the new ones below were first measured in Obsidian over CDP and then reproduced character-for-character:

- mixed CJK/ASCII table copies as `| 中   | ab   |` / `| --- | ---- |` / `| 中文  | abcd |` / `| a   | 中文字  |`;
- a cell containing `<br>` copies verbatim (`| 第一行<br>第二行 |`) with the column sized by the raw text;
- a cell containing an escaped pipe keeps two columns in the DOM and copies `a \| b`;
- Ctrl+C with a caret in a cell copies the whole cell (`1`), Ctrl+X does the same and clears the cell;
- dragging below the table selects the remaining rows down to the last one, dragging above clamps to the header row (8 cells);
- numeric sort ascending yields 1, 2, 10.

## What is *not* verified

- Windows/macOS/Linux UI differences, dark-theme colour accuracy, and screen readers.
- The host behaviours the plugin cannot control: preview rebuilds on file change (mitigated with a DOM snapshot, not removed) and the resulting reset of the editor's undo stack after a rebuild.
- Node-only harnesses exist for the rendering pipeline and the editor prototype, but they are jsdom-based and cannot stand in for the browser checks above.
