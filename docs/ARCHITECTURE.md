# Architecture

The plugin is a DSH bundle with two halves plus vendored browser assets.

```
package.json          bundle manifest: dsh.bundle.patch + dsh.client
cordis.patch.yml      inserts the plugin row into the profile
index.js              Host plugin: document-preview renderer + workspace API
client.js             Web plugin: preview panel, live-preview editor, CSS
src/cm6-entry.js      CodeMirror 6 live-preview implementation (bundled)
vendor/               CodeMirror, marked, KaTeX, DOMPurify, Shiki, Literata
locale/{en,zh}.json   title/description shown in Plugins
PARITY.md             Obsidian behaviour matrix with status and coverage
```

## Host half (`index.js`)

`apply(ctx, config)` registers resources with `ctx.effect`/`ctx.on`. It contributes a document-preview renderer and exposes a small HTTP API on the desktop app's local server:

| Route | Purpose |
|---|---|
| `GET  /github-md/workspace/list` | workspace roots and entries |
| `GET  /github-md/workspace/tree` | directory tree for the sidebar |
| `GET  /github-md/workspace/read` | read a note |
| `POST /github-md/workspace/save` | write a note |
| `POST /github-md/workspace/asset` | store a pasted image next to the note (extension whitelist, 16 MiB cap) |

All paths are normalised and confined to the workspace root; the API never executes plugin or user code.

## Web half (`client.js`)

The client registers a document-preview renderer and takes over the panel when the open file is Markdown. It renders one `EditorView` for the whole note and keeps, per file, in module-scope maps:

- selection and scroll position,
- undo/redo history (with save coalescing),
- folded heading/list ranges,
- the last saved document text and save timer.

`onChange` is throttled (~120 ms) and flushed before `saveNow`, before switching files, and on unmount, so a fast typist never loses characters to the throttle.

## Editor (`src/cm6-entry.js`)

A single `StateField` builds decorations for the lines currently in the viewport, plus the fence state needed to know whether a line is inside a code block. Per line it decides between "active" (show source) and "rendered" (replace the markup with decorations or block widgets). Block widgets are used for tables, code fences, callouts, frontmatter, math blocks, embeds and full-line images; inline widgets handle bullets, task checkboxes, fold chevrons, inline code and formulas.

Theming is plain CSS emitted from the same module, so the editor has no stylesheet dependency beyond the vendored CodeMirror base styles.

## Why measurement matters

Box metrics (line heights, cell padding, table width, image radius, lightbox backdrop) were read from a real Obsidian 1.15.1 window through the DevTools protocol and applied to both render paths. `PARITY.md` records each behaviour with its measured value, so future changes can be checked against the same numbers instead of impressions.
