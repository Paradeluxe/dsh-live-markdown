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

## Alignment, selection menu and paste (1.1.17)

gui-table-obsidian-check.mjs is now 45 assertions. New ones, each first measured in Obsidian:

- copying an aligned table reproduces Obsidian byte for byte: `| L        |    C     |        R |` / `| -------- | :------: | -------: |` / rows padded left, centred and right respectively; the narrow 3-character variant matches too (`| --- | :-: | --: |`); copying a single aligned column keeps `:------:`.
- right-clicking with a selection shows Obsidian's selection menu (`剪切, 复制, 粘贴, 文本格式, 左对齐, 居中对齐, 右对齐, 清空选中的单元格, 删除选中的单元格`) with the 文本格式 submenu (`加粗, 倾斜, 删除线, 高亮, 代码, 数学, 注释, 清除格式`); without a selection the row/column/sort menu is shown instead.
- menu 复制 copies Markdown; 加粗 wraps cells in `**`; 清除格式 strips wrappers; 居中对齐 rewrites the separator to `:---:`; 清空选中的单元格 empties the cells; 删除选中的单元格 removes the selected row.
- pasting a copied 2x2 into a cell fills cells from the caret and appends a row, matching Obsidian.

## Keyboard selection (1.1.18)

gui-table-obsidian-check.mjs is now 51 assertions; six new ones cover the keyboard paths, each first measured in Obsidian:

- Shift+ArrowDown inside a cell selects that cell and the one below (values 1 and 2);
- a further Shift+ArrowDown keeps extending the same rectangle (3 cells);
- a plain arrow clears the selection and moves the active cell (active = the cell below);
- Shift+ArrowRight at the end of a cell selects the neighbour (1 and 第一行);
- Shift+ArrowRight inside the text does not create a cell selection (normal text selection stays);
- Shift+ArrowUp selects the row above.

## Cross-application copy comparison (1.1.19)

Nine edge-case tables were copied as a whole inside Obsidian and inside the plugin (same drag selection, same Ctrl+C) and compared byte for byte; all nine matched after the fix below.

Fixtures: mixed CJK/ASCII (`| 名称 | note | 値 |` with `😀 emoji`), inline formatting (`**bold**`, `[example](https://example.com)`, `` `code` ``), ragged rows (a row with fewer cells), empty cells, `a \| b` plus `第一行<br>第二行`, a 26-character word, every alignment combination (`---`, `:---`, `:---:`, `---:`), and CJK headers with check/cross glyphs.

The one real difference found: Obsidian preserves an explicit `:---` left-alignment marker (`:----` in the copied separator), while the plugin normalised it to `-----`. Alignment parsing now distinguishes `---` from `:---`; rendering looks identical and copying writes the original marker. Four of the fixtures are now permanent assertions in gui-table-obsidian-check.mjs (55 assertions total).

## Insert between rows/columns (1.1.20)

gui-table-insert-check.mjs (9 assertions):

- hovering the middle of a row shows neither the + button nor the insert line;
- hovering the boundary between two rows shows the + button (17x17 in the left gutter) and a 2px insert line spanning the table;
- clicking the + inserts an empty row exactly at that boundary (a1 stays above, a2 moves below);
- hovering a column boundary shows the column + and clicking it inserts an empty column between A and B, extending the separator row;
- the right-click 行 ▸ 在上方新增行 path still inserts a row;
- zero page errors.

## Undo / redo for table edits (1.1.21)

gui-undo-check.mjs (12 assertions):

- plain-text typing: Ctrl+Z removes it, Ctrl+Y restores it;
- typing inside a cell: Ctrl+Z restores the original cell text, Ctrl+Y re-applies it;
- the bottom + row pill: Ctrl+Z removes the added row, Ctrl+Y brings it back;
- deleting a row via its grip and Backspace: Ctrl+Z restores the row;
- inserting a row between two rows via the hover +: Ctrl+Z removes it;
- Ctrl+Shift+Z redoes once and then leaves the document unchanged (it must not fall through to undo);
- the table is never duplicated by the history fallback;
- zero page errors.

## Stale stylesheet / stray plus signs (1.1.22)

Reproduction: after a plugin hot-update the page keeps the previous <style> element (ensureStyle used to bail out on the id alone), so components added in a newer version have no CSS. The insert-row/insert-column buttons from 1.1.20 rendered as two plain "+" lines below the table.

Verified in the real GUI:

- the stylesheet now contains the insert rules on a fresh load (style id gh-md-cm6-lp-style);
- after deleting every insert-button rule from the live stylesheet, both buttons still compute to display:none (inline) and no visible + node remains;
- gui-table-insert-check 9/9, gui-table-click-edge 6/6, gui-undo-check 12/12 still pass.

## Insert button centring (1.1.23)

Measured in the real GUI with deviceScaleFactor 2 (getBoundingClientRect, two decimals):

- column insert button: centre 861.50 vs column boundary 861.50 (0.00px offset); bottom edge 183.06 vs table top 183.06 (0.00px);
- insert line: centre 861.50, width 2px, spanning the table height;
- SVG plus inside the button: centre equals the button centre;
- row insert button: centreY equals the row boundary (0.00px) and its right edge equals the table left edge (0.00px).

## No duplicated append controls (1.1.24)

gui-table-insert-check.mjs (17 assertions) now also checks:

- hovering the bottom edge of the table does not show the row boundary button (the bottom + pill appends there);
- hovering the right edge does not show the column boundary button (the right + pill appends there);
- the middle row boundary still shows the + button.

Also re-ran: gui-table-click-edge 6/6, gui-undo-check 12/12, gui-table-add 13/13, gui-table-obsidian 55/55.

## Hover affordances stay visible (1.1.25)

Reproduced in the real GUI before the fix: hovering a cell corner (both distances <= 8px) showed nothing; after inserting a row with the mouse unmoved the insert button and both + pills disappeared (pill opacity 0); moving from the + button back onto the table hid the newly shown button 260 ms later (captured via a hide call stack pointing at the scheduled timeout).

After the fix, the same probe shows:

- row boundary hover shows the row button; after clicking it the table grows and the button is still visible without moving the mouse;
- hovering the column boundary right after that shows the column button (was empty before);
- the + pills stay at opacity 1 after the rebuild;
- a cell corner shows one of the two buttons instead of none.

gui-table-insert-check.mjs now has 20 assertions; gui-table-click-edge 6/6, gui-undo-check 12/12, gui-table-obsidian 55/55.

## Insert button vs handle overlap (1.1.26)

Measured in the real GUI (deviceScaleFactor 2) on a 30px-row table:

- hovering a row boundary: the + button is at (715,265) 16x16, the two row grips next to the boundary report opacity 0 and class is-insert-adjacent, and an intersection test against every visible grip returns 0 overlaps;
- hovering a column boundary: the column + at (848,167) 16x16, both adjacent column grips hidden (opacity 0), 0 overlaps;
- before the fix the same probe reported the button covering the lower half of the grip above the boundary in the screenshot.

Also verified the column off-by-one: a two-column table now shows the column + when hovering the boundary between them (previously only the far-left boundary existed).

gui-table-insert-check.mjs now has 24 assertions; gui-table-click-edge 6/6, gui-undo-check 12/12, gui-table-add 13/13, gui-table-obsidian 55/55.

## Insert button placement (1.1.27)

Measured in the real GUI at deviceScaleFactor 2 on a 7-row, 2-column table:

- row boundary hover: + at (930,265) 16x16, i.e. 2px outside the table right edge (946 vs 948); 7/7 row grips still visible, intersection test against them = 0 overlaps;
- column boundary hover: + at (848,375) 16x16, i.e. 2px above the table bottom edge (391 vs 393); column grips visible, 0 overlaps;
- the centred grid line spans the table as before.

Also verified the pill regression this exposed: hovering the bottom + pill used to raise a column affordance (two-column table puts the pill on the middle column boundary) and hide the pill, so clicking it added nothing. After the fix gui-table-click-edge (6/6), gui-undo-check (12/12) and gui-table-add (13/13) pass again; gui-table-insert-check is 25/25 and gui-table-obsidian 55/55.

## Update notice (1.2.0)

Host endpoint verified against the real GitHub API from the verify server: GET /github-md/update/check returned current=1.1.27, latest=1.1.27 (tag v1.1.27), hasUpdate=false, installKind=git, error=null.

gui-update-check.mjs (10 assertions, routes mocked so no network is needed):

- a newer release renders the pill with "new version v9.9.9 (current v1.1.27)" and the three buttons;
- clicking Update posts to /github-md/update/apply and switches the text to "updated to v9.9.9, restart DSH to take effect";
- dismissing stores the version in localStorage and the same version is not shown after a reload;
- an up-to-date install renders no pill;
- a copy install shows a Download button instead of Update;
- the real host endpoint reports the installed version;
- no page errors.

## Ctrl+F find (1.3.0)

Verified in the real GUI (gui-find-check.mjs, 18 assertions) on a 250-line document that only renders the viewport:

- Ctrl+F opens the bar with the input focused; a selection prefills the query;
- typing shows the document-wide count (1/128, matching an independent scan of view.state.doc) while 26 visible matches are highlighted (2 of them inside table cells) and exactly one is marked current;
- Enter / Shift+Enter move the count and scroll the editor when the match is outside the viewport (scrollTop 0 -> 2666);
- case sensitivity, whole word and regex produce the same counts as the independent scan; an invalid pattern shows 正则无效 and no page errors; no matches shows 0/0;
- Esc (in the bar and in the document) closes the bar and clears both highlight registries;
- Ctrl+F also works while a table cell has focus.

Regression suites after the change: gui-table-insert 25/25, gui-table-click-edge 6/6, gui-undo 12/12, gui-table-add 13/13, gui-update-check 10/10.

## Refresh + save conflict (1.3.1)

Measured in the real GUI (gui-refresh-check.mjs, 14 assertions):

- auto refresh off + external change -> the preview stays on the old text, clicking the reload tool (`[data-textpreview-tool=reload]`) shows the new text;
- an external change of exactly the same byte length is picked up too;
- auto refresh on -> the external change appears without clicking anything;
- with an unsaved draft, Ctrl+S is rejected by the host (409), the pill reads "changed on disk - reload", the file on disk keeps the external version, and clicking the pill loads the disk version into the editor;
- a normal Ctrl+S without an external change still writes to disk;
- no uncaught page errors (the expected 409 network log is filtered).

Also checked the workspace file panel (`[data-files-reload]`): a newly created file appears both through auto refresh and after clicking reload.

## Image lightbox zoom (1.3.2)

Measured in the real GUI with a 640x360 test image (gui-image-zoom-check.mjs, 14 assertions):

- double-click opens the lightbox fitted at 640x360 exactly at the viewport centre;
- one wheel notch at an off-centre point (640+180, 450-120) zooms to 1.6161 and the point under the cursor drifts by 0 px;
- zooming back out returns to 640x360 at (640, 450) with translate(0,0) - before the fix it ended at (695, 409) with scale 0.7257;
- the minimum zoom is the fit size: four further wheel-down events keep 640x360 (before: shrunk to 0.25x, 160x90);
- twelve wheel-ups stop at scale 8;
- dragging 3000 px keeps the viewport centre inside the image (pan clamp);
- 0 resets, Escape closes, the wheel does not scroll the page behind, and there are no page errors.

## Zoomed image sharpness (1.3.3)

Measured in the real GUI with a 2000x1125 image of 2 px black/white stripes:

- at fit (1229 px wide) the extreme-pixel ratio was 0.566;
- after 3 wheel notches (scale 1.6161, 1986 px wide, i.e. close to the native 2000 px) the ratio was 0.107 with will-change: transform, 0.615 after removing it, and 0.566 with a resize-based variant;
- the regression test now screenshots the zoomed image, computes the ratio in a canvas and requires > 0.3 (the pre-fix build measures 0.107 and fails).

This covers the case where the image is still below its native resolution; beyond that, upscaling is soft by nature.

## Image cache invalidation (1.3.4)

Reproduced in the real GUI: a red 240x120 PNG rendered in the live preview, then overwritten (same path, same size) with blue - the preview stayed red after clicking the reload tool, and only a full page reload showed blue (/api/file answers cache-control: private, max-age=31536000, immutable).

After the fix (gui-image-cache-check.mjs, 7 assertions):

- the rendered image URL carries &v=<mtime>;
- the initial render is red;
- an external replacement is still red before refreshing;
- clicking reload changes v (…1707 -> …8509) and the preview renders blue;
- overwriting again with green and dispatching window focus updates the preview without clicking anything;
- no page errors.

## Smoke test regression (1.3.5)

1.3.4 broke npm run smoke: the extracted render snippet referenced imageVersionParam, which was defined outside the snippet markers, so resolveImage threw and the "local image is rewritten to /api/file" assertion failed. Moving the pure helpers inside the snippet restores RENDER OK, and run-all-checks.mjs reports ALL CHECKS PASS again.

## CM6 failure and image timing (1.3.6)

Reproduced by aborting the vendor bundle request (Playwright route abort): before the fix the page threw `ReferenceError: cm6GaveUp is not defined` and the slot crashed with nothing rendered; after the fix the same scenario renders the static document (heading/paragraph/image styles compact, all three manuscript figures load, naturalWidth 4640/4640/3548).

Missing-image path: a document referencing figures/__no_such_file__.png shows the dashed placeholder "图片无法加载：figures/__no_such_file__.png" after one retry, and logs `[gh-md-image] failed to load <url>`.

Regression tests after the bundle rebuild: LP semantics 5/5, image cache 7/7, image zoom 15/15, refresh/conflict 14/14.

## Narrow-pane layout and stacked headings (1.3.7)

Visual pass: the whole manuscript walked screen by screen (22 viewport screenshots at 1054x975, sidebar pane 373px) plus a wide pass at 1400x1000, compared against Obsidian 1.x with CDP on the same vault/file.

Measured before -> after (373px pane): text column 273 -> 316px; document padding 32 -> 18.64px; content padding 18 -> 10.06px; h2 line box 44.5 -> 28.5px with `gh-md-lp-h-tight` (Obsidian 29.1px). Wide pane (1400x1000): padding stays 31.4/17.0px, text column 566px, no cap (unchanged).

Regression: GUI WIDTH 7/7, GUI SPACING 6/6, GUI VISUAL 12/12, LP SEMANTICS 5/5, IMAGE CACHE 7/7, IMAGE ZOOM 15/15.

Unchanged after comparison with Obsidian: 24px blank lines (Obsidian shows them too, 26 empty lines on the first screen), 16px/24px body, h1 25.888px+16px, h3 21.088px+16px, proportional image scaling (fig1 4640x7354 -> 316x501, aspect 0.631 both).

## Figure reading (1.3.8)

Inspected the real DSH desktop window with a native screenshot + synthetic mouse events (no CDP access to that window): the manuscript renders headings/paragraphs and all three figures inline; double-click opened the lightbox but the portrait figures stayed ~475px wide (max-height: 92vh fit).

After the change: single click opens the lightbox; a 4640x7354 figure opens 1012px wide in a 1054px window; a synthetic 800x2400 test figure opens 1152px wide at 1200px (scale 4.17) and is pannable. Landscape images unchanged (zoom test still starts at fit size).

Regression: GUI TALL FIGURE 6/6, GUI IMAGE ZOOM 15/15, GUI LIGHTBOX 9/9, GUI IMAGE CACHE 7/7, GUI VISUAL 12/12, GUI SPACING 6/6, GUI WIDTH 7/7.

## Blank-line collapsing (1.3.9)

Measured in the sidebar pane (373px): collapsed line heights 24/0/0/24/0/0; inter-block gaps before the change 48/72/96px, after it a uniform 24px; scrollHeight 15695 -> 14647. The caret line keeps its height (isActive guard).

Obsidian reference for the same file: 24/48/72px (it renders every blank line), so this behaviour is intentionally more compact than Obsidian live preview.

## Desktop protocol and diagnostics (1.3.10)

Built a minimal Electron harness that registers the same `dsh-app` scheme and forwards to a real Host, then loaded an `<img src="dsh-app://app/api/file?...">` page from `dsh-app://app/`: the request carries no Origin header (logged `originHeader=null`), the forward returns 200 image/png and the element reports naturalWidth 4640. The desktop protocol does **not** block images.

Diagnostics endpoint verified end to end: opening the manuscript in the verify profile writes a JSONL record with baseURI, editable, the resolved sourcePath, the three image markdown lines and the current widget/image counts; scrolling adds records with img src + natural sizes.

Lightbox: single click opens, double click keeps it open (450ms guard) - GUI BEHAVIOR5 8/8, GUI ZOOM STABILITY 4/4, GUI LIGHTBOX 9/9, GUI TALL FIGURE 6/6.

## External-change auto reload (1.3.11)

Real GUI: a probe document opened with FIRST-VERSION, then rewritten on disk to SECOND-VERSION. Without clicking anything the editor showed SECOND-VERSION within ~2 s, no conflict pill appeared (document was clean), and no page errors were logged. Dirty documents are not overwritten - they only get the 已修改 conflict pill.

## Watcher isolation (1.3.12)

run-all-checks reported FAILED: harness-editor-undo.mjs, harness-cm6-integration.mjs ("save after typing: false") after 1.3.11. The watcher now returns early under jsdom; both harnesses pass again and run-all-checks reports ALL CHECKS PASS.

## Typography baseline (1.3.13)

Obsidian 1.15.1 reading view on the same vault: h1 25.888px/700/31.0656, h2 23.392/680/28.0704, h3 21.088/660/27.4144, h4 19.008/640/26.6112, h5 17.216/620/25.824, h6 16/600/24, body 16/400/24. The plugin now matches every one of them (GUI TYPOGRAPHY 8/8); spacing/width/visual suites stay green (6/6, 7/7, 12/12) and render-smoke unchanged.

## Structural parity (1.3.14)

Fixture with a heading, inline code, link, blockquote, table, hr, task list and a 120x80 image, measured in Obsidian reading view and in the plugin: inline code 14px/21px/2px 4px/4px radius, blockquote 2px bar + 24px indent with body colour, hr 32px vertical margins, checkbox 16x16, image 120x80 (natural), table cells 4px 8px + 1px border, links underlined. GUI PARITY 9/9.

## Missing image note (1.3.15)

Opening a document that references figures/does_not_exist.png produces a dashed note reading "图片无法加载：does_not_exist.png" whose title is the resolved absolute path. GUI MISSING IMAGE 4/4.

## Regenerated manuscript (93 KB, 150 long lines)

Re-ran the whole-document pass after the manuscript was regenerated: three figures render (316x500, no placeholder), inter-block gaps 24px, no horizontal overflow; typing 15 ms average (18 ms worst), cursor moves ~16 ms.

## Responsive width sweep

Probe document `_gui_resp.md` (heading + long paragraph + 120x80 image) opened once at 1280 and then resized to 960/1100/1280/1500 (content column 453/377/518/518px): horizontal overflow 0 at every width, the small image stays exactly 120px (never upscaled, never wider than the column), h1 stays 25.888px, paragraph line-height stays 24px, no placeholder. GUI RESPONSIVE 29/29.

## Update notice on the desktop protocol (1.3.16)

`gui-update-pill-check.mjs` stubs `fetch` before page boot and answers `/github-md/update/check` with `{hasUpdate:true, latest:"9.9.9", installKind:"git"}`: the pill appears with 更新/说明/×, clicking 更新 POSTs `/github-md/update/apply` (called once) and the label reads "已更新到 v9.9.9，重启 DSH 后生效". The exposed `acceptsProtocol` accepts `dsh-app:` and `https:` and rejects `dsh-resource:` — 10/10.

`gui-update-protocol-check.mjs` loads a real `dsh-app://app/` page in an Electron harness whose protocol handler forwards to a Host running this plugin, then fetches `/github-md/update/check` from the page: the request is forwarded and returns the JSON payload, which is what the client calls on Desktop now that the protocol gate allows it.

## Table chips share one control (1.3.17)

`gui-table-add-check.mjs` (15/15) measures both append chips while the table is hovered: same width, height, border radius and border width (18 / 18 / 6px / 1px), both `cursor: pointer`, and moving the pointer onto a chip keeps it visible and fills it with `rgb(9, 105, 218)` with a white glyph. `gui-table-insert-check.mjs` stays 25/25 for the between-rows/columns affordance, so the new geometry (18px chip, 9px half-width) did not shift the insert target.

Probe `probe-table-pills.mjs` records the id/after computed styles for the report; `probe-table-insert.mjs` confirms the insert chip has the same 18x18 / 6px / 1px / pointer box as the append chips.

## Word-compatible comments (1.3.18)

Measured against real Word, not against the schema.

**Reading.** `comments-test.mjs` (27/27) opens four real manuscripts from `docx-testbed` and checks the parsed model: `test_nested.docx` 48 comments in 24 threads, `test_with_comments.docx` 46, `test_overlap.docx` 49, `JSpace_Liu_Oct09_2026.docx` 22 with 3 resolved threads. `tests/..`/fixtures contain no synthetic XML: every assertion is over bytes Word produced. The reader finds the same `done` flags Word reports through COM for the JSpace file (6 comment paragraphs with `w15:done="1"` = 3 threads).

**Writing.** `comments-export-test.mjs` (26/26) covers the serializer; `comments-word-check.mjs` (6/6) then opens the exported file in **Word 2019 over COM** and reads the comments back: same count, same authors, same thread parents, same resolved flags, anchors resolving to the expected text. `comments-model-word-check.mjs` (5/5) does the same through the sidecar model (`toDocxComments` → `exportDocxComments` → Word).

Four export traps were found by measurement, not documentation, and are recorded in `docs/WORD-COMMENTS.md` §1.8: paraId/durableId must stay below `0x80000000`; each comment paragraph needs its own paraId with `commentEx` pointing at the last one; comment paragraphs need `w:rsidR`/`w:rsidRDefault`; `compatibilityMode` must be 15.

**Real manuscript round trip.** `comments-jspace-roundtrip.mjs` (6/6) takes the actual submitted manuscript `JSpace_Liu_Oct09_2026.docx` (22 comments in 11 threads, 3 resolved), parses it, writes the comments back into a copy through the exporter, and then has **Word read both files over COM**. Word reports identical numbers for the original and the round-tripped copy: 22 comments, 6 comment paragraphs with `Done` (3 resolved threads), and 22 anchors that resolve to real text. The parsed model agrees: 11 roots, 11 replies, 3 resolved roots. This is the end-to-end proof that the writer produces what Word itself produced, on a real document rather than a fixture.

**Export back to Word.** `comments-export-sidecar-test.mjs` (8/8) takes the sidecar built from the real manuscript and writes it back into a docx through the reverse mapper: all 22 anchors map exactly on identical text, the re-parsed file still holds 22 comments in 11 threads with 3 resolved, the authors are unchanged, and a markdown body with headings/bold/links still maps every anchor. The mapper reports `mapped`/`approx`/`lost` separately and never drops a comment silently. `gui-comments-export-check.mjs` (7/7) clicks the panel's "导出到 Word" inside the running app: `<doc>-comments.docx` is created next to the template, the local comment is inside it, the template's own old comment is replaced (the sidecar is the source of truth), and the toast names the produced file.

**Details.** `gui-comments-details-check.mjs` (8/8) covers three behaviours measured in the real app: two comments anchored on the same line get margin dots 13px apart (169.06 vs 182.06 in the run), an `@Bob Wu` in a comment body renders as a chip while the stored body stays the plain text `请 @Bob Wu 看一下这条。`, and the panel's "复制" action leaves a Markdown table on the clipboard with both comments and a toast reporting the count.

**Caret comments and shortcuts.** `comments-point-anchor-test.mjs` (9/9) checks the zero-length anchor in the model (empty quote, prefix kept, survives an edit before it), the exported XML (`commentRangeStart` immediately followed by `commentRangeEnd` and the reference run, no text in between) and then has **Word open the produced file**: 1 comment, `Scope.Text.Length === 0` — the same shape Word itself creates when you comment at the caret. `gui-comments-keys-check.mjs` (10/10) drives the running app: `Ctrl+Alt+M` opens the composer on a selection, the card shows the quoted text, the same shortcut on an empty selection stores `start === end` with an empty quote, the body renders the small marker, clicking it opens a card that says "（插入点批注，没有选中文字）", and Escape closes the card.

**Author filter and expand-all.** `gui-comments-allopen-check.mjs` (7/7): with one comment by "我" and one by "Bob Wu", the panel's "我的" filter leaves exactly one; "展开" opens both cards, their tops come out 126px apart (162.06 / 288.06) so they do not overlap, the button label flips to "收起", and collapsing closes both.

**Quote jump and read-only review.** `gui-comments-quote-check.mjs` (6/6): the quote at the top of a card is clickable, clicking it adds `.is-flash` to the anchored range and scrolls the scroller from 13 to 1172 so the anchor really moves into view. `gui-comments-readonly-check.mjs` (6/6): with the read-only flag set, a document that already has a sidecar shows one margin dot, the card renders the comment text, and neither the reply/resolve/delete buttons nor the floating "+" button exist while selecting text.

**Copy/paste with comments.** `comments-clipboard-test.mjs` (13/13) covers the payload: a whole-document copy carries all three comments with their reply parent intact, a partial copy carries only the comment inside it with an anchor relative to the copied text, an empty selection produces no payload, pasting recreates every comment with anchors shifted by the insert position (8 / 8 / 21), authors and resolved state survive, ids are reassigned rather than reused, the store still serialises, and pasting twice does not collide. `gui-comments-clipboard-check.mjs` (8/8) drives the running app with synthetic ClipboardEvents: after a copy the transfer object holds both `text/plain` and `text/x-ghmd-comments+json`, pasting inserts the text at the caret and rebuilds the comment at the pasted offset (anchors 8 and 30). The OS-level round trip of a custom MIME type is outside this harness; the limitation is recorded in DESIGN §179.

**Who may edit a comment.** `comments-permissions-test.mjs` (7/7) pins `canEditComment`: the author can edit, another author cannot, an empty signature can edit nothing, a deleted comment cannot be edited, a reply follows the same rule as its root, and the rule does not depend on anchor position. `gui-comments-permissions-check.mjs` (8/8) shows it in the app: the "编辑" action appears for the author, disappears after switching the signature to "Bob Wu" while the reply action stays, comes back after switching back, the composer is prefilled, and the edited body reaches the sidecar. Scope: this is a client-side rule; the host routes do not verify authorship (recorded in DESIGN §180).

**Near-real-time sync.** `gui-comments-live-check.mjs` (7/7): with the document open and no comments, the sidecar is written directly on disk as if another machine had saved it (author "Carol Li"); within the 2.5s poll the margin dot appears without a reload, the range is highlighted, the toast reads "检测到新的批注（Carol Li）", and the card shows the remote body. Merging never writes back, so the local save remains the only writer; the limitation (last writer wins for the same range, no CRDT) is recorded in DESIGN §181.

**Print list and performance.** `gui-comments-print-check.mjs` (8/8): clicking "打印" opens a popup whose title says "批注清单（1 条）" and whose HTML contains the comment body, the quoted text and the state; no page errors. `comments-perf-test.mjs` (5/5) measures the hot paths on a 2000-line document with 400 threads / 500 comments: resolveStore 0.05ms median (0.45 worst), buildThreads 0.09ms (0.38), serializeStore 1.71ms (3.35), parseStore 0.67ms (1.24), sidecar 305KB — so re-resolving anchors on every edit is cheap at this scale.

**Recovering a lost anchor.** `comments-reattach-test.mjs` (9/9) covers the model: deleting the commented text nulls the anchor while the comment survives, reattachComment() rebuilds it at the new range, replies follow their root, an empty selection cannot reattach and an unknown id returns null. `gui-comments-lost-check.mjs` (8/8) drives it in the app: after deleting the text the notice reads "点这里重新挂载", clicking it opens the panel filtered to lost comments, programmatically clicking the row re-anchors the comment at the newly selected text, the notice disappears and the sidecar now holds `quote: "第二段留下来"` with a visible highlight. The panel-row click is programmatic because of the hit-testing limitation documented in DESIGN §183 (short documents clip the panel inside the scroller).

**Overlay hit-testing.** After moving every overlay to document.body with position: fixed and explicit z-index values, `gui-comments-lost-check.mjs` (9/9) drives the recovery flow with real mouse coordinates and asserts that `document.elementFromPoint()` at the centre of a panel row returns that row (`gh-md-comments-item-main`); previously the same point resolved to the document wrapper, which is why the earlier round had to click programmatically. The same run also confirms the notice, the row metadata and the saved anchor. Seven other in-app suites were re-run against the new overlay: main 21/21, panel 12/12, expand-all 7/7, details 8/8, shortcuts 10/10, quote 6/6, read-only 6/6.

**Feature switch.** `gui-comments-toggle-check.mjs` (10/10): with a sidecar already on disk, setting `github-md:comments-enabled = '0'` and reloading yields zero highlights, zero margin dots and no visible chip, and the sidecar file is byte-identical afterwards; turning it back to '1' restores the highlight and dot. Implementation: client passes an empty commentsPath, so cm6-entry never adds the extension.

**Where Word keeps comments on the clipboard.** Measured with Word COM: open the manuscript read-only, select the first comment's scope, `Selection.Copy()`, then enumerate clipboard formats. The set is `Object Descriptor, Rich Text Format, HTML Format, System.String, UnicodeText, Text, EnhancedMetafile, MetaFilePict, Embed Source, Link Source, Link Source Descriptor, ObjectLink, Hyperlink`. The RTF payload is 43,322 characters with `\\atnid` occurring zero times and no comment body; the HTML payload is 42,029 characters, also without the body. Comments therefore travel in `Embed Source`, so the "paste from Word" gap is an OLE-fragment problem, not an RTF one. Probes: `probe-word-rtf-clipboard.ps1`, `probe-word-html-clipboard.ps1`.

**New-comment markers.** `comments-unread-test.mjs` (14/14) pins the rule: nothing is unread before a read pointer exists, comments newer than the pointer and not written by me are new, my own comments never are, another signature sees its own state, marking read clears everything, a later comment becomes new again, a new reply marks its thread new, an empty signature cannot mark read, readers survive a serialise/parse round trip, a store without readers still parses, an invalid timestamp is ignored rather than marking the whole store new, and deleted comments are never new. `gui-comments-unread-check.mjs` (9/9) shows it in the app: chip "批注 1 · 1 新", a blue ring on the margin dot, a "新" tag in the panel row, then "标为已读" clears all three, writes `readers['我']` into the sidecar and leaves the comment itself untouched.

**@mentions.** `comments-mentions-test.mjs` (10/10) pins the matching: a full-name mention, the first token alone and case-insensitive variants all match, a different name does not, a comment without mentions never matches, CJK names work, a mention inside a reply counts, the mention survives a serialise/parse round trip, and null threads or empty signatures are handled. `gui-comments-mentions-check.mjs` (5/5) shows it in the app: the mentioned row carries an "@我" tag, the "提及我" filter leaves exactly that row, and a comment pushed into the sidecar behind the page's back raises the specific toast "有人在批注里 @ 了你（Dave）" instead of the generic new-comment message.

**Sidecar.** `comments-store-test.mjs` (13/13): path mapping, missing and broken files, atomic write with no leftover temp file, and the stale-save case (a file changed on disk after the client loaded it) merging instead of overwriting.

**Import.** `comments-import-test.mjs` (10/10): a real 46-comment docx imports completely, 23 threads, 42 anchors mapped exactly and 4 empty quotes reported as lost, authors preserved, local comments kept when merging, and a second import of the same file does not duplicate anything (ids derive from the durableId).

**UI, in the running app.** `gui-comments-check.mjs` (21/21): opening a document calls `/comments/load`; selecting text shows the + button; the composer writes a comment whose sidecar entry carries the exact quote and author; the body shows a highlight; the reply lands under the root; resolve sets the flag; after a reload the margin dot is still there; hovering the highlight previews the card, leaving closes it, clicking the dot reopens it. `gui-comments-panel-check.mjs` (12/12): chip count, panel list, three filters, next navigation cycles, the signature persists and a new comment uses the new author. `gui-comments-import-check.mjs` (11/11): the panel button pulls a resolved root plus its reply from the sibling docx into the sidecar next to a local comment, keeping authors, the resolved flag and the highlights. `gui-comments-merge-check.mjs` (7/7): a comment written to the sidecar by someone else after the page loaded merges in on the next save, all three comments survive, the toast names the other author, and the merged comment gets its own margin dot.

## What is *not* verified

- Windows/macOS/Linux UI differences, dark-theme colour accuracy, and screen readers.
- The host behaviours the plugin cannot control: preview rebuilds on file change (mitigated with a DOM snapshot, not removed) and the resulting reset of the editor's undo stack after a rebuild.
- Node-only harnesses exist for the rendering pipeline and the editor prototype, but they are jsdom-based and cannot stand in for the browser checks above.
