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

## What is *not* verified

- Windows/macOS/Linux UI differences, dark-theme colour accuracy, and screen readers.
- The host behaviours the plugin cannot control: preview rebuilds on file change (mitigated with a DOM snapshot, not removed) and the resulting reset of the editor's undo stack after a rebuild.
- Node-only harnesses exist for the rendering pipeline and the editor prototype, but they are jsdom-based and cannot stand in for the browser checks above.
