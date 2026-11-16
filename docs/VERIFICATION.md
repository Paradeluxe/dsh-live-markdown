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

## What is *not* verified

- Windows/macOS/Linux UI differences, dark-theme colour accuracy, and screen readers.
- The host behaviours the plugin cannot control: preview rebuilds on file change (mitigated with a DOM snapshot, not removed) and the resulting reset of the editor's undo stack after a rebuild.
- Node-only harnesses exist for the rendering pipeline and the editor prototype, but they are jsdom-based and cannot stand in for the browser checks above.
