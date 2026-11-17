import { EditorState, EditorSelection, StateField, StateEffect, Prec, Transaction } from '@codemirror/state'
import { EditorView, Decoration, WidgetType, keymap, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { markdown, insertNewlineContinueMarkup, deleteMarkupBackward } from '@codemirror/lang-markdown'

/**
 * Obsidian Live Preview 原型（CM6）：整篇 markdown 文本 + 装饰层。
 * - 非活跃行：隐藏 Markdown 标记（零宽），内容按样式渲染；图片/代码块/表格/任务框/数学渲染成 widget。
 * - 活跃行：标记淡化显示，内容样式保留（Obsidian 语义）。
 */

const STYLE_ID = 'gh-md-cm6-lp-style'
const CSS = `
.gh-md-cm6-lp { font-family: var(--gh-md-read-font, "Literata Variable", "Noto Serif SC", "Source Han Serif SC", Georgia, "SimSun", serif); font-size: var(--gh-md-read-size, 16px); line-height: var(--gh-md-read-line, 1.65); color: var(--dsw-alias-label-primary, #1f2328); background: transparent; }
.gh-md-cm6-lp .cm-content, .cm-content.gh-md-cm6-lp { padding: 4px 18px; }
.gh-md-cm6-lp .cm-line { padding: 0 2px; }
.gh-md-cm6-lp .cm-editor, .gh-md-cm6-lp .cm-content { outline: none !important; }
.gh-md-cm6-lp :focus-visible { outline: none !important; }
.gh-md-cm6-lp .cm-scroller:focus-visible { outline: none !important; }
.gh-md-cm6-lp .cm-editor.cm-focused { outline: none !important; }
.gh-md-cm6-lp .cm-cursor { border-left: 1.5px solid var(--dsw-alias-label-primary, #1f2328); }
.gh-md-cm6-lp .gh-md-lp-syntax { color: var(--dsw-alias-label-tertiary, #8c959f); }
.gh-md-cm6-lp .gh-md-lp-strong { font-weight: 700; }
.gh-md-cm6-lp .gh-md-lp-em { font-style: italic; }
.gh-md-cm6-lp .gh-md-lp-strike { text-decoration: line-through; }
.gh-md-cm6-lp .gh-md-lp-code { background: rgb(175 184 193 / 20%); border-radius: 4px; padding: 0 2px; font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: .92em; }
.gh-md-cm6-lp .gh-md-lp-link { color: var(--dsw-alias-state-info-primary, #0969da); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.gh-md-cm6-lp .gh-md-lp-link[data-href^="http"]::after { content: '↗'; font-size: .82em; margin-left: 1px; text-decoration: none; }
.gh-md-cm6-lp .gh-md-lp-bullet { color: var(--dsw-alias-label-tertiary, #8c959f); }
.gh-md-cm6-lp .gh-md-lp-li { }
.gh-md-cm6-lp .gh-md-lp-bullet-wrap { display: inline-flex; align-items: center; }
.gh-md-cm6-lp .gh-md-lp-ol-wrap { display: inline-flex; align-items: center; }
.gh-md-cm6-lp .gh-md-lp-task-wrap { display: inline-flex; align-items: center; }
.gh-md-cm6-lp .gh-md-cm6-fold-hidden { height: 0; overflow: hidden; }
.gh-md-cm6-lp .gh-md-lp-h1 { font-size: 1.618em; font-weight: 700; line-height: 1.2; padding-top: 16px; }
.gh-md-cm6-lp .gh-md-lp-h2 { font-size: 1.462em; font-weight: 600; line-height: 1.2; padding-top: 16px; }
.gh-md-cm6-lp .gh-md-lp-h3 { font-size: 1.318em; font-weight: 600; line-height: 1.3; padding-top: 16px; }
.gh-md-cm6-lp .gh-md-lp-h4 { font-size: 1.188em; font-weight: 600; line-height: 1.4; padding-top: 16px; }
.gh-md-cm6-lp .gh-md-lp-h5 { font-size: 1.076em; font-weight: 600; line-height: 1.5; padding-top: 16px; }
.gh-md-cm6-lp .gh-md-lp-h6 { font-size: 1em; font-weight: 600; line-height: 1.5; }
.gh-md-cm6-lp .gh-md-lp-bullet { color: var(--dsw-alias-label-secondary, #57606a); font-weight: 700; }
.gh-md-cm6-lp .gh-md-lp-image { display: block; margin: 0; }
.gh-md-cm6-lp .gh-md-lp-image-line { line-height: 0; }
.gh-md-cm6-lp .gh-md-lp-image-line .cm-widgetBuffer { height: 0 !important; width: 0 !important; }
.gh-md-cm6-lp .gh-md-lp-image img { max-width: 100%; max-height: none; border-radius: 4px; vertical-align: middle; cursor: zoom-in; display: block; }
.gh-md-cm6-code { position: relative; margin: 8px 0; border: none; border-radius: 4px; overflow: hidden; background: var(--dsw-alias-bg-layer-1, #f6f8fa); }
.gh-md-cm6-lp .gh-md-cm6-code-head { position: absolute; top: 6px; right: 10px; display: flex; align-items: center; justify-content: flex-end; gap: 6px; padding: 0; font-size: 11px; color: var(--dsw-alias-label-secondary, #57606a); font-family: var(--dsw-font, sans-serif); }
.gh-md-cm6-lp .gh-md-cm6-code-copy { border: none; background: transparent; color: inherit; cursor: pointer; font-size: 11px; padding: 2px 6px; border-radius: 4px; opacity: 0; transition: opacity .12s ease; }
.gh-md-cm6-lp .gh-md-cm6-code:hover .gh-md-cm6-code-copy { opacity: 1; }
.gh-md-cm6-lp .gh-md-cm6-code-copy:hover { background: rgb(175 184 193 / 25%); }
.gh-md-cm6-lp .gh-md-cm6-code pre { margin: 0; padding: 10px 12px; overflow-x: auto; font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 13px; line-height: 1.55; }
.gh-md-cm6-lp .gh-md-cm6-table { position: relative; margin: 0; padding: 0 18px 0 0; overflow: visible; }
.gh-md-cm6-lp .gh-md-cm6-table-scroll { padding: 16px 0; overflow-x: auto; }
.gh-md-cm6-lp .gh-md-cm6-table-scroll { scrollbar-width: thin; scrollbar-color: var(--dsw-alias-border-l2, #d0d7de) transparent; }
.gh-md-cm6-lp .gh-md-cm6-table-scroll::-webkit-scrollbar { height: 8px; }
.gh-md-cm6-lp .gh-md-cm6-table-scroll::-webkit-scrollbar-thumb { background: var(--dsw-alias-border-l2, #d0d7de); border-radius: 4px; }
.gh-md-cm6-lp .gh-md-cm6-table-scroll::-webkit-scrollbar-track { background: transparent; }
.gh-md-cm6-lp .gh-md-cm6-table-add-row, .gh-md-cm6-lp .gh-md-cm6-table-add-col { position: absolute; display: flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-tertiary, #8c959f); opacity: 0; pointer-events: none; transition: opacity .12s ease, color .12s ease; }
.gh-md-cm6-lp .gh-md-cm6-table-add-row { left: calc(min(var(--gh-md-table-w, 100%), 100% - 18px) / 2); width: 64px; transform: translateX(-50%); height: 16px; top: calc(16px + var(--gh-md-table-h, 0px)); cursor: s-resize; }
.gh-md-cm6-lp .gh-md-cm6-table-add-col { top: 50%; height: 64px; transform: translateY(-50%); width: 16px; left: min(var(--gh-md-table-w, 100%), calc(100% - 18px)); cursor: e-resize; z-index: 2; border-radius: 6px; }
.gh-md-cm6-lp .gh-md-cm6-table:hover .gh-md-cm6-table-add-row, .gh-md-cm6-lp .gh-md-cm6-table:hover .gh-md-cm6-table-add-col { opacity: 1; pointer-events: auto; }
.gh-md-cm6-lp .gh-md-cm6-table-row-handle, .gh-md-cm6-lp .gh-md-cm6-table-col-handle { position: absolute; display: flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-tertiary, #8c959f); background: transparent; border-radius: 4px; opacity: 0; pointer-events: none; cursor: pointer; z-index: 2; transition: opacity .12s ease, color .12s ease, background-color .12s ease; }
.gh-md-cm6-lp .gh-md-cm6-table:hover .gh-md-cm6-table-row-handle, .gh-md-cm6-lp .gh-md-cm6-table:hover .gh-md-cm6-table-col-handle { opacity: .85; pointer-events: auto; }
.gh-md-cm6-lp .gh-md-cm6-table-row-handle:hover, .gh-md-cm6-lp .gh-md-cm6-table-col-handle:hover { opacity: 1; color: var(--dsw-alias-label-secondary, #57606a); background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 5%)); }
.gh-md-cm6-lp .gh-md-cm6-table-row-handle.is-selected, .gh-md-cm6-lp .gh-md-cm6-table-col-handle.is-selected { opacity: 1; color: var(--dsw-alias-state-info-primary, #0969da); background: rgb(9 105 218 / 12%); }
.gh-md-cm6-lp .gh-md-cm6-table .gh-md-cm6-table-cell-selected { background: rgb(9 105 218 / 10%) !important; }
.gh-md-cm6-lp .gh-md-cm6-table.is-cell-selecting { user-select: none; }
.gh-md-cm6-lp .gh-md-cm6-table.is-cell-selecting th, .gh-md-cm6-lp .gh-md-cm6-table.is-cell-selecting td { user-select: none; }
.gh-md-cm6-lp .gh-md-cm6-table:focus { outline: none; }
.gh-md-cm6-lp .gh-md-cm6-table-drop-indicator { position: absolute; background: var(--dsw-alias-state-info-primary, #0969da); border-radius: 2px; z-index: 3; pointer-events: none; }
.gh-md-cm6-lp .gh-md-cm6-table-row-handle.is-dragging, .gh-md-cm6-lp .gh-md-cm6-table-col-handle.is-dragging { opacity: 1; color: var(--dsw-alias-state-info-primary, #0969da); background: rgb(9 105 218 / 12%); cursor: grabbing; }
.gh-md-cm6-lp .gh-md-cm6-table-row-handle { cursor: grab; }
.gh-md-cm6-lp .gh-md-cm6-table-col-handle { cursor: grab; }
.gh-md-cm6-lp .gh-md-cm6-table-add-row:hover, .gh-md-cm6-lp .gh-md-cm6-table-add-col:hover { color: var(--dsw-alias-label-secondary, #57606a); background: var(--dsw-alias-bg-layer-1, #f6f8fa); box-shadow: 0 0 0 1px var(--dsw-alias-border-l2, #d0d7de); }
.gh-md-cm6-lp .gh-md-cm6-table table { border-collapse: collapse; font-size: 1em; line-height: 1.3; width: auto; max-width: 100%; margin: 0; table-layout: auto; }
.gh-md-cm6-lp .gh-md-cm6-table th, .gh-md-cm6-lp .gh-md-cm6-table td { border: 1px solid var(--gh-md-table-border, #e4e4e4); padding: 4px 8px; word-break: normal; overflow-wrap: break-word; min-width: 3em; white-space: normal !important; line-height: 1.3 !important; font-size: 16px; }
.gh-md-cm6-lp .gh-md-cm6-table th { background: transparent; font-weight: 600; }
.gh-md-cm6-lp .gh-md-cm6-table th, .gh-md-cm6-lp .gh-md-cm6-table td { text-align: left; }
.gh-md-cm6-lp .gh-md-lp-h1, .gh-md-cm6-lp .gh-md-lp-h2, .gh-md-cm6-lp .gh-md-lp-h3, .gh-md-cm6-lp .gh-md-lp-h4, .gh-md-cm6-lp .gh-md-lp-h5, .gh-md-cm6-lp .gh-md-lp-h6 { text-decoration: none; }
.gh-md-cm6-lp .gh-md-lp-task { margin-right: 6px; cursor: pointer; vertical-align: middle; accent-color: #8b6cef; width: 14px; height: 14px; }
.gh-md-cm6-lp .gh-md-cm6-math { font-size: 1.02em; }
.gh-md-cm6-lp .gh-md-cm6-math-block { display: block; margin: 8px 0; text-align: center; overflow-x: auto; }
.gh-md-cm6-lp .gh-md-cm6-image-fullscreen { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; background: rgb(0 0 0 / 72%); cursor: zoom-out; }
.gh-md-cm6-lp .gh-md-lp-highlight { background: rgb(255 208 0 / 28%); border-radius: 2px; padding: 0 1px; }
.gh-md-cm6-lp .gh-md-lp-list-guide-1 { position: relative; }
.gh-md-cm6-lp .gh-md-lp-list-guide-1::before { content: ''; position: absolute; top: 2px; bottom: 2px; left: 14px; width: 1px; background: var(--dsw-alias-border-l1, #d8dee4); }
.gh-md-cm6-lp .gh-md-lp-list-guide-2::before { content: ''; position: absolute; top: 2px; bottom: 2px; left: 14px; width: 1px; background: var(--dsw-alias-border-l1, #d8dee4); }
.gh-md-cm6-lp .gh-md-lp-list-guide-2::after { content: ''; position: absolute; top: 2px; bottom: 2px; left: 38px; width: 1px; background: var(--dsw-alias-border-l1, #d8dee4); }
.gh-md-cm6-lp .gh-md-lp-quote { position: relative; border-left: 2px solid rgb(139 108 239 / 55%); padding-left: 12px; color: var(--dsw-alias-label-secondary, #57606a); }
.gh-md-cm6-lp .gh-md-lp-quote::before { content: ''; position: absolute; left: 18px; top: 0; bottom: 0; width: 2px; background: rgb(139 108 239 / 55%); display: none; }
.gh-md-cm6-lp .gh-md-lp-quote-depth-2 { padding-left: 28px; }
.gh-md-cm6-lp .gh-md-lp-quote-depth-2::before, .gh-md-cm6-lp .gh-md-lp-quote-depth-3::before { display: block; }
.gh-md-cm6-lp .gh-md-lp-quote-depth-3 { padding-left: 42px; }
.gh-md-cm6-lp .gh-md-lp-task-done { text-decoration: line-through; text-decoration-thickness: 1px; opacity: .75; }
.gh-md-cm6-lp .gh-md-cm6-fnref { font-size: .75em; color: var(--dsw-alias-state-info-primary, #0969da); }
.gh-md-cm6-lp .gh-md-lp-ol { color: var(--dsw-alias-label-secondary, #57606a); }
.gh-md-cm6-lp .gh-md-lp-html kbd { border: 1px solid var(--dsw-alias-border-l2, #d0d7de); border-radius: 4px; padding: 0 4px; font-size: .85em; background: rgb(175 184 193 / 18%); }
.gh-md-cm6-lp .gh-md-lp-html mark { background: rgb(255 208 0 / 40%); color: inherit; border-radius: 2px; padding: 0 1px; }
.gh-md-cm6-lp .gh-md-lp-html sup, .gh-md-cm6-lp .gh-md-lp-html sub { font-size: .75em; }
.gh-md-link-preview { position: fixed; z-index: 9998; max-height: 320px; overflow: auto; padding: 10px 12px; border-radius: 10px; border: .5px solid var(--dsw-alias-border-l2, #d0d7de); background: var(--dsw-alias-bg-layer-2, #fff); box-shadow: 0 8px 24px rgb(0 0 0 / 18%); font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-primary, #1f2328); pointer-events: auto; }
.gh-md-link-preview h1, .gh-md-link-preview h2, .gh-md-link-preview h3 { font-size: 1.05em; margin: 4px 0 6px; }
.gh-md-link-preview pre { margin: 6px 0; padding: 8px; border-radius: 6px; background: rgb(175 184 193 / 12%); overflow-x: auto; }
.gh-md-link-preview img { max-width: 100%; }
.gh-md-cm6-lp .gh-md-lp-wikilink { color: #8b6cef; text-decoration: underline dotted; text-decoration-color: rgb(139 108 239 / 60%); text-underline-offset: 3px; }
.gh-md-cm6-lp .gh-md-lp-tag { color: #8b6cef; background: rgb(139 108 239 / 12%); border-radius: 999px; padding: 1px 7px; font-size: .9em; }
.gh-md-cm6-lp .gh-md-lp-fndef { color: var(--dsw-alias-label-tertiary, #8c959f); }
.gh-md-cm6-lp .gh-md-cm6-hr { border: none; border-top: 1px solid var(--dsw-alias-border-l1, #d8dee4); margin: 16px 0; }
.gh-md-cm6-lp .gh-md-cm6-frontmatter { margin: 6px 0 10px; padding: 8px 12px; border: .5px solid var(--dsw-alias-border-l2, #d0d7de); border-radius: 8px; background: var(--dsw-alias-bg-layer-1, #f6f8fa); font-size: .92em; }
.gh-md-cm6-lp .gh-md-cm6-frontmatter-title { font-size: 11px; color: var(--dsw-alias-label-tertiary, #8c959f); margin-bottom: 4px; }
.gh-md-cm6-lp .gh-md-cm6-frontmatter-row { display: flex; gap: 10px; padding: 1px 0; }
.gh-md-cm6-lp .gh-md-cm6-frontmatter-key { min-width: 96px; color: var(--dsw-alias-label-secondary, #57606a); }
.gh-md-cm6-lp .gh-md-cm6-frontmatter-value { white-space: pre-wrap; display: inline-flex; flex-wrap: wrap; gap: 4px; }
.gh-md-cm6-lp .gh-md-cm6-frontmatter-pill { background: rgb(139 108 239 / 12%); color: #8b6cef; border-radius: 999px; padding: 1px 8px; font-size: .92em; }
.gh-md-cm6-lp .gh-md-cm6-callout { margin: 8px 0; border-left: 3px solid var(--gh-md-callout-accent, #0969da); border-radius: 6px; background: var(--gh-md-callout-bg, rgb(9 105 218 / 6%)); padding: 8px 12px; }
.gh-md-cm6-lp .gh-md-cm6-callout-title { display: flex; align-items: center; gap: 6px; font-weight: 600; color: var(--gh-md-callout-accent, #0969da); }
.gh-md-cm6-lp .gh-md-cm6-callout-icon { display: inline-flex; align-items: center; color: var(--gh-md-callout-accent, #0969da); }
.gh-md-cm6-lp .gh-md-cm6-callout-icon svg { width: 15px; height: 15px; }
.gh-md-cm6-lp .gh-md-cm6-callout-body { margin-top: 4px; color: var(--dsw-alias-label-primary, #1f2328); }
.gh-md-cm6-lp .gh-md-cm6-callout-body p { margin: .35em 0; }
.gh-md-cm6-lp .gh-md-cm6-callout-body ul, .gh-md-cm6-lp .gh-md-cm6-callout-body ol { margin: .35em 0; padding-left: 1.4em; }
.gh-md-cm6-lp .gh-md-cm6-callout-body pre { margin: .5em 0; padding: 8px 10px; border-radius: 6px; background: rgb(175 184 193 / 12%); overflow-x: auto; }
.gh-md-cm6-lp .gh-md-cm6-callout[data-tone="tip"] { --gh-md-callout-accent: #00bfa5; --gh-md-callout-bg: rgb(0 191 165 / 7%); }
.gh-md-cm6-lp .gh-md-cm6-callout[data-tone="note"] { --gh-md-callout-accent: #448aff; --gh-md-callout-bg: rgb(68 138 255 / 7%); }
.gh-md-cm6-lp .gh-md-cm6-callout[data-tone="info"] { --gh-md-callout-accent: #00b0ff; --gh-md-callout-bg: rgb(0 176 255 / 7%); }
.gh-md-cm6-lp .gh-md-cm6-callout[data-tone="question"] { --gh-md-callout-accent: #64dd17; --gh-md-callout-bg: rgb(100 221 23 / 7%); }
.gh-md-cm6-lp .gh-md-cm6-callout[data-tone="failure"] { --gh-md-callout-accent: #ff5252; --gh-md-callout-bg: rgb(255 82 82 / 7%); }
.gh-md-cm6-lp .gh-md-cm6-callout[data-tone="bug"] { --gh-md-callout-accent: #f50057; --gh-md-callout-bg: rgb(245 0 87 / 7%); }
.gh-md-cm6-lp .gh-md-cm6-callout[data-tone="example"] { --gh-md-callout-accent: #7c4dff; --gh-md-callout-bg: rgb(124 77 255 / 7%); }
.gh-md-cm6-lp .gh-md-cm6-callout[data-tone="quote"] { --gh-md-callout-accent: #9e9e9e; --gh-md-callout-bg: rgb(158 158 158 / 7%); }
.gh-md-cm6-lp .gh-md-cm6-callout[data-tone="abstract"], .gh-md-cm6-lp .gh-md-cm6-callout[data-tone="todo"] { --gh-md-callout-accent: #00b0ff; --gh-md-callout-bg: rgb(0 176 255 / 7%); }
.gh-md-cm6-lp .gh-md-cm6-callout[data-tone="success"] { --gh-md-callout-accent: #1a7f37; --gh-md-callout-bg: rgb(26 127 55 / 7%); }
.gh-md-cm6-lp .gh-md-cm6-callout[data-tone="warning"] { --gh-md-callout-accent: #9a6700; --gh-md-callout-bg: rgb(154 103 0 / 8%); }
.gh-md-cm6-lp .gh-md-cm6-callout[data-tone="danger"] { --gh-md-callout-accent: #cf222e; --gh-md-callout-bg: rgb(207 34 46 / 7%); }
.gh-md-cm6-lp .gh-md-cm6-callout[data-tone="failure"] { --gh-md-callout-accent: #cf222e; --gh-md-callout-bg: rgb(207 34 46 / 7%); }
.gh-md-cm6-lp .gh-md-cm6-callout[data-tone="question"] { --gh-md-callout-accent: #8250df; --gh-md-callout-bg: rgb(130 80 223 / 7%); }
.gh-md-cm6-lp .gh-md-cm6-callout[data-tone="quote"] { --gh-md-callout-accent: #6e7781; --gh-md-callout-bg: rgb(110 119 129 / 8%); }
.gh-md-cm6-lp .gh-md-cm6-callout[data-tone="abstract"] { --gh-md-callout-accent: #0969da; --gh-md-callout-bg: rgb(9 105 218 / 6%); }
.gh-md-cm6-lp .gh-md-cm6-callout[data-tone="todo"] { --gh-md-callout-accent: #0969da; --gh-md-callout-bg: rgb(9 105 218 / 6%); }
.gh-md-cm6-lp .gh-md-cm6-callout[data-tone="example"] { --gh-md-callout-accent: #8250df; --gh-md-callout-bg: rgb(130 80 223 / 7%); }
.gh-md-cm6-lp .gh-md-cm6-callout[data-tone="bug"] { --gh-md-callout-accent: #cf222e; --gh-md-callout-bg: rgb(207 34 46 / 7%); }
.gh-md-cm6-lp .gh-md-cm6-image-fullscreen img { max-width: 92vw; max-height: 92vh; border-radius: 8px; }
.gh-md-cm6-lp .gh-md-cm6-embed { margin: 8px 0; padding: 4px 10px; border-left: 3px solid var(--dsw-alias-border-l2, #d0d7de); background: var(--dsw-alias-bg-layer-1, #f6f8fa); border-radius: 6px; }
.gh-md-cm6-lp .gh-md-cm6-embed-placeholder { color: var(--dsw-alias-label-tertiary, #8c959f); font-size: .92em; }
.gh-md-cm6-table-menu { position: fixed; z-index: 10000; display: flex; flex-direction: column; min-width: 132px; padding: 4px; border: .5px solid var(--dsw-alias-border-l2, #d0d7de); border-radius: 8px; background: var(--dsw-alias-bg-layer-2, #ffffff); box-shadow: 0 8px 24px rgb(0 0 0 / 18%); }
.gh-md-cm6-table-menu button { border: none; background: transparent; text-align: left; font-size: 12px; padding: 5px 10px; border-radius: 5px; color: var(--dsw-alias-label-primary, #1f2328); cursor: pointer; }
.gh-md-cm6-table-menu button:hover { background: var(--dsw-alias-bg-layer-1, #f6f8fa); }
.gh-md-cm6-table-menu-group { position: relative; }
.gh-md-cm6-table-menu-label { display: flex; align-items: center; justify-content: space-between; gap: 14px; font-size: 12px; padding: 5px 10px; border-radius: 5px; color: var(--dsw-alias-label-primary, #1f2328); cursor: pointer; user-select: none; }
.gh-md-cm6-table-menu-group:hover > .gh-md-cm6-table-menu-label { background: var(--dsw-alias-bg-layer-1, #f6f8fa); }
.gh-md-cm6-table-menu-arrow { color: var(--dsw-alias-label-tertiary, #8c959f); font-size: 11px; line-height: 1; }
.gh-md-cm6-table-submenu { display: none; position: absolute; left: calc(100% - 2px); top: -5px; min-width: 150px; padding: 4px; border: .5px solid var(--dsw-alias-border-l2, #d0d7de); border-radius: 8px; background: var(--dsw-alias-bg-layer-2, #ffffff); box-shadow: 0 8px 24px rgb(0 0 0 / 18%); flex-direction: column; }
.gh-md-cm6-table-menu-group:hover > .gh-md-cm6-table-submenu { display: flex; }
.gh-md-cm6-table-menu-separator { height: 1px; margin: 4px 6px; background: var(--dsw-alias-border-l1, #eaeef2); }
/* 折叠箭头：圆角描边 chevron；展开 → 旋转 90° 指向下，折叠 → 指向右 */
.gh-md-cm6-lp .gh-md-cm6-fold-chevron {
  display: inline-flex; align-items: center; justify-content: center;
  flex: none; width: var(--gh-md-chevron-size, 16px); height: var(--gh-md-chevron-size, 16px);
  margin-left: -20px; margin-right: 4px;
  color: var(--dsw-alias-label-tertiary, #8c959f);
  cursor: pointer; opacity: 0; border-radius: 50%;
  transition: opacity .12s ease, color .12s ease, background-color .12s ease;
  vertical-align: middle;
  transform: translateY(var(--gh-md-chevron-shift, 0px));
}
.gh-md-cm6-lp .gh-md-cm6-fold-chevron svg {
  display: block; width: 100%; height: 100%;
  transform: rotate(90deg);
  transition: transform .16s cubic-bezier(.2, .7, .3, 1);
}
.gh-md-cm6-lp .gh-md-cm6-fold-chevron.is-folded svg { transform: rotate(0deg); }
.gh-md-cm6-lp .gh-md-cm6-fold-chevron path {
  fill: none; stroke: currentColor; stroke-width: 1.7;
  stroke-linecap: round; stroke-linejoin: round;
}
.gh-md-cm6-lp .cm-line:hover .gh-md-cm6-fold-chevron,
.gh-md-cm6-lp .gh-md-cm6-fold-chevron.is-folded { opacity: 1; }
.gh-md-cm6-lp .cm-line:hover .gh-md-cm6-fold-chevron { color: var(--dsw-alias-label-secondary, #57606a); }
.gh-md-cm6-lp .gh-md-cm6-fold-chevron:hover {
  color: var(--dsw-alias-label-primary, #1f2328);
  background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 4%));
}
.gh-md-cm6-lp .gh-md-lp-bullet-wrap .gh-md-cm6-fold-chevron,
.gh-md-cm6-lp .gh-md-lp-ol-wrap .gh-md-cm6-fold-chevron,
.gh-md-cm6-lp .gh-md-lp-task-wrap .gh-md-cm6-fold-chevron {
  margin: 0 0 0 -18px; --gh-md-chevron-size: 15px; --gh-md-chevron-shift: 0px;
}
.gh-md-cm6-lp .gh-md-lp-bullet-wrap .gh-md-cm6-fold-chevron,
.gh-md-cm6-lp .gh-md-lp-ol-wrap .gh-md-cm6-fold-chevron { --gh-md-chevron-shift: -0.5px; }
.gh-md-cm6-lp .gh-md-lp-task-wrap .gh-md-cm6-fold-chevron { --gh-md-chevron-shift: 1.5px; }
.gh-md-cm6-lp .gh-md-lp-h1 .gh-md-cm6-fold-chevron { --gh-md-chevron-size: 20px; --gh-md-chevron-shift: -4.4px; }
.gh-md-cm6-lp .gh-md-lp-h2 .gh-md-cm6-fold-chevron { --gh-md-chevron-size: 19px; --gh-md-chevron-shift: -3.7px; }
.gh-md-cm6-lp .gh-md-lp-h3 .gh-md-cm6-fold-chevron { --gh-md-chevron-size: 18px; --gh-md-chevron-shift: -3.7px; }
.gh-md-cm6-lp .gh-md-lp-h4 .gh-md-cm6-fold-chevron { --gh-md-chevron-size: 17px; --gh-md-chevron-shift: -3.3px; }
.gh-md-cm6-lp .gh-md-lp-h5 .gh-md-cm6-fold-chevron { --gh-md-chevron-size: 16px; --gh-md-chevron-shift: -3.2px; }
.gh-md-cm6-lp .gh-md-lp-h6 .gh-md-cm6-fold-chevron { --gh-md-chevron-size: 15px; --gh-md-chevron-shift: -2.5px; }
/* callout 标题栏右侧的折叠箭头 */
.gh-md-cm6-lp .gh-md-cm6-callout-chevron {
  margin-left: auto; display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; color: var(--dsw-alias-label-tertiary, #8c959f);
  transition: color .12s ease;
}
.gh-md-cm6-lp .gh-md-cm6-callout-chevron svg {
  display: block; width: 16px; height: 16px;
  transform: rotate(90deg);
  transition: transform .16s cubic-bezier(.2, .7, .3, 1);
}
.gh-md-cm6-lp .gh-md-cm6-callout-chevron.is-folded svg { transform: rotate(0deg); }
.gh-md-cm6-lp .gh-md-cm6-callout-chevron path {
  fill: none; stroke: currentColor; stroke-width: 1.5;
  stroke-linecap: round; stroke-linejoin: round;
}
.gh-md-cm6-lp .gh-md-cm6-callout:hover .gh-md-cm6-callout-chevron { color: var(--dsw-alias-label-secondary, #57606a); }
`

const INLINE_PATTERN = /(<!--[^>]*-->|<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>[^<]*<\/\2>|<br\s*\/?>|!\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)]*\)|`[^`]+`|\$[^$\n]+\$|==[^=\n]+==|\[\[[^\]]+\]\]|\[\^[^\]]+\]|#[\p{L}\p{N}_-]+|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+\]\([^)]*\))/gu

const styleMark = (cls, attrs) => Decoration.mark(attrs === undefined ? { class: cls } : { class: cls, attributes: attrs })

function escapeHtml(value) {
  return String(value).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;')
}

const INLINE_HTML_TAGS = new Set(['kbd', 'sup', 'sub', 'mark', 'u', 's', 'del', 'ins', 'b', 'strong', 'i', 'em', 'span', 'br', 'small', 'abbr', 'cite', 'q', 'code', 'var', 'samp'])

class InlineHtmlWidget extends WidgetType {
  constructor(html) {
    super()
    this.html = html
  }

  eq(other) {
    return other.html === this.html
  }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'gh-md-lp-html'
    span.setAttribute('contenteditable', 'false')
    span.innerHTML = this.html
    return span
  }

  ignoreEvent() {
    return true
  }
}

class ImageWidget extends WidgetType {
  constructor(src, alt, width) {
    super()
    this.src = src
    this.alt = alt
    this.width = typeof width === 'number' && Number.isFinite(width) ? width : undefined
  }

  eq(other) {
    return other.src === this.src && other.alt === this.alt && other.width === this.width
  }

  toDOM() {
    const wrapper = document.createElement('span')
    wrapper.className = 'gh-md-lp-image'
    const image = document.createElement('img')
    image.setAttribute('src', this.src)
    image.setAttribute('alt', this.alt)
    if (this.width !== undefined) image.style.width = this.width + 'px'
    wrapper.appendChild(image)
    return wrapper
  }

  ignoreEvent() {
    return true
  }
}

class BulletWidget extends WidgetType {
  constructor(folded, position) {
    super()
    this.folded = folded
    this.position = position
  }

  eq(other) {
    return other.folded === this.folded && other.position === this.position
  }

  toDOM() {
    const wrap = document.createElement('span')
    wrap.className = 'gh-md-lp-bullet-wrap' + (this.folded ? ' is-folded' : '')
    const chevron = document.createElement('span')
    chevron.className = 'gh-md-cm6-fold-chevron' + (this.folded ? ' is-folded' : '')
    appendChevronIcon(chevron)
    chevron.setAttribute('contenteditable', 'false')
    chevron.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
    })
    chevron.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const view = activeHost === null ? null : activeHost.view
      if (view === null || view === undefined) return
      view.dispatch({ effects: toggleFoldEffect.of(this.position) })
    })
    const dot = document.createElement('span')
    dot.className = 'gh-md-lp-bullet'
    dot.textContent = '•'
    wrap.appendChild(chevron)
    wrap.appendChild(dot)
    return wrap
  }
}

class TaskWidget extends WidgetType {
  constructor(checked, pos, folded, foldPosition) {
    super()
    this.checked = checked
    this.pos = pos
    this.folded = folded === true
    this.foldPosition = typeof foldPosition === 'number' ? foldPosition : -1
  }

  eq(other) {
    return other.checked === this.checked && other.pos === this.pos && other.folded === this.folded && other.foldPosition === this.foldPosition
  }

  toDOM() {
    const wrap = document.createElement('span')
    wrap.className = 'gh-md-lp-task-wrap' + (this.folded ? ' is-folded' : '')
    const chevron = document.createElement('span')
    chevron.className = 'gh-md-cm6-fold-chevron' + (this.folded ? ' is-folded' : '')
    appendChevronIcon(chevron)
    chevron.setAttribute('contenteditable', 'false')
    chevron.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
    })
    chevron.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (this.foldPosition < 0) return
      const view = activeHost === null ? null : activeHost.view
      if (view === null || view === undefined) return
      view.dispatch({ effects: toggleFoldEffect.of(this.foldPosition) })
    })
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.className = 'gh-md-lp-task'
    input.checked = this.checked
    input.dataset.pos = String(this.pos)
    // 直接处理点击：避免 mousedown 先把光标带进任务行、导致 widget 被源码替换。
    input.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
    })
    input.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const view = activeHost === null ? null : activeHost.view
      if (view === null || view === undefined) return
      const pos = this.pos
      if (!Number.isInteger(pos) || pos < 0 || pos >= view.state.doc.length) return
      const current = view.state.doc.sliceString(pos, pos + 1)
      const toggled = current === ' ' ? 'x' : ' '
      view.dispatch({ changes: { from: pos, to: pos + 1, insert: toggled } })
    })
    wrap.appendChild(chevron)
    wrap.appendChild(input)
    return wrap
  }

  ignoreEvent() {
    return true
  }
}

const LANG_LABELS = {
  js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript',
  py: 'Python', python: 'Python', rb: 'Ruby', rs: 'Rust', go: 'Go', java: 'Java',
  c: 'C', cpp: 'C++', cs: 'C#', sh: 'Shell', bash: 'Bash', zsh: 'Shell', ps1: 'PowerShell',
  json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML', md: 'Markdown', markdown: 'Markdown',
  css: 'CSS', scss: 'SCSS', html: 'HTML', xml: 'XML', sql: 'SQL', tex: 'LaTeX', mermaid: 'Mermaid',
}

class CodeBlockWidget extends WidgetType {
  constructor(code, lang, html) {
    super()
    this.code = code
    this.lang = lang
    this.html = typeof html === 'string' ? html : undefined
  }

  eq(other) {
    return other.code === this.code && other.lang === this.lang && other.html === this.html
  }

  toDOM() {
    const card = document.createElement('div')
    card.className = 'gh-md-cm6-code'
    const head = document.createElement('div')
    head.className = 'gh-md-cm6-code-head'
    const label = document.createElement('span')
    label.textContent = this.lang === '' ? 'text' : (LANG_LABELS[this.lang.toLowerCase()] ?? this.lang)
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'gh-md-cm6-code-copy'
    button.textContent = '复制'
    button.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
    })
    button.addEventListener('click', () => {
      const text = this.code
      if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
        void navigator.clipboard.writeText(text)
      }
      button.textContent = '已复制'
      window.setTimeout(() => { button.textContent = '复制' }, 1200)
    })
    head.appendChild(label)
    head.appendChild(button)
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    code.innerHTML = this.html === undefined ? escapeHtml(this.code) : this.html
    pre.appendChild(code)
    card.appendChild(head)
    card.appendChild(pre)
    return card
  }

  ignoreEvent() {
    return false
  }
}

// 按未转义的竖线切分表格行；\| 是单元格内的字面竖线，不参与切分。
function splitTableSegments(raw) {
  const segments = []
  let segStart = 0
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === '\\') { i += 1; continue }
    if (raw[i] === '|') {
      segments.push({ start: segStart, end: i })
      segStart = i + 1
    }
  }
  segments.push({ start: segStart, end: raw.length })
  return segments
}

function parseTableRowsFromDoc(doc, from, to) {
  const rows = []
  const startLine = doc.lineAt(from).number
  const endLine = doc.lineAt(Math.max(from, Math.min(to - 1, doc.length))).number
  for (let n = startLine; n <= endLine; n += 1) {
    const info = doc.line(n)
    if (/^\s*\|?\s*:?-{2,}/u.test(info.text.trim())) continue
    const raw = info.text
    const segments = splitTableSegments(raw)
    let segs = segments
    if (segs.length > 0 && raw.slice(segs[0].start, segs[0].end).trim() === '' && /^\s*\|/u.test(raw)) segs = segs.slice(1)
    if (segs.length > 0 && raw.slice(segs[segs.length - 1].start, segs[segs.length - 1].end).trim() === '' && /\|\s*$/u.test(raw)) segs = segs.slice(0, -1)
    rows.push(segs.map((seg) => ({ text: raw.slice(seg.start, seg.end).trim() })))
  }
  return rows
}

function parseCells(raw) {
  const segments = splitTableSegments(raw)
  let segs = segments
  if (segs.length > 0 && raw.slice(segs[0].start, segs[0].end).trim() === '' && /^\s*\|/u.test(raw)) segs = segs.slice(1)
  if (segs.length > 0 && raw.slice(segs[segs.length - 1].start, segs[segs.length - 1].end).trim() === '' && /\|\s*$/u.test(raw)) segs = segs.slice(0, -1)
  return segs.map((seg) => raw.slice(seg.start, seg.end).trim())
}

function parseAlignmentsFromLines(lines) {
  for (const line of lines) {
    if (!/^\s*\|?\s*:?-{2,}/u.test(line.trim())) continue
    return parseCells(line).map((cell) => {
      const left = cell.startsWith(':')
      const right = cell.endsWith(':')
      if (left && right) return 'center'
      if (right) return 'right'
      // Obsidian 会保留手写的「左对齐但带冒号」写法（:---），复制时也写回 :---。
      if (left) return 'left-colon'
      return 'left'
    })
  }
  return []
}

// 渲染用：left-colon 与 left 的视觉效果相同，只是复制时保留冒号。
function displayAlignment(alignment) {
  if (alignment === 'center') return 'center'
  if (alignment === 'right') return 'right'
  return 'left'
}

function parseTableBlock(doc, from, to) {
  const startLine = doc.lineAt(from).number
  const endLine = doc.lineAt(Math.max(from, Math.min(to - 1, doc.length))).number
  const lines = []
  let separatorIndex = -1
  for (let n = startLine; n <= endLine; n += 1) {
    const info = doc.line(n)
    lines.push({ text: info.text, from: info.from, to: info.to })
    if (/^\s*\|?\s*:?-{2,}/u.test(info.text.trim())) separatorIndex = lines.length - 1
  }
  const rows = []
  for (const line of lines) {
    if (/^\s*\|?\s*:?-{2,}/u.test(line.text.trim())) continue
    rows.push(parseCells(line.text))
  }
  return { lines, rows, separatorIndex }
}

function buildTableText(rows, separatorCells) {
  const out = []
  out.push('| ' + rows[0].join(' | ') + ' |')
  out.push('| ' + separatorCells.join(' | ') + ' |')
  for (const row of rows.slice(1)) out.push('| ' + row.join(' | ') + ' |')
  return out.join('\n')
}

function cellRangeInLine(lineInfo, cellIndex) {
  const raw = lineInfo.text
  const segments = splitTableSegments(raw)
  let segs = segments
  if (segs.length > 0 && raw.slice(segs[0].start, segs[0].end).trim() === '' && /^\s*\|/u.test(raw)) segs = segs.slice(1)
  if (segs.length > 0 && raw.slice(segs[segs.length - 1].start, segs[segs.length - 1].end).trim() === '' && /\|\s*$/u.test(raw)) segs = segs.slice(0, -1)
  const seg = segs[cellIndex]
  if (seg === undefined) return null
  const cellText = raw.slice(seg.start, seg.end)
  const trimmed = cellText.trim()
  const lead = cellText.indexOf(trimmed)
  return { from: lineInfo.from + seg.start + lead, to: lineInfo.from + seg.start + lead + trimmed.length }
}

class TableWidget extends WidgetType {
  constructor(rows, host, tableFrom, tableTo, alignments) {
    super()
    this.rows = rows
    this.host = host
    this.tableFrom = tableFrom
    this.tableTo = tableTo
    this.alignments = Array.isArray(alignments) ? alignments : []
  }

  destroy(dom) {
    try {
      if (dom !== null && typeof dom.__ghMdTableCleanup === 'function') dom.__ghMdTableCleanup()
    } catch {}
  }

  eq() {
    // 表格 DOM 的刷新由 applyEdit 的"源码态→编辑→渲染态"三步保证；
    // 这里保持恒真，避免 CM6 在更新中途替换整块 widget（会破坏高度表）。
    return true
  }

  toDOM() {
    const wrapper = document.createElement('div')
    wrapper.className = 'gh-md-cm6-table'
    const scroll = document.createElement('div')
    scroll.className = 'gh-md-cm6-table-scroll'
    const table = document.createElement('table')
    const thead = document.createElement('thead')
    const headerRow = document.createElement('tr')
    this.rows[0].forEach((cell, cellIndex) => {
      const th = document.createElement('th')
      th.contentEditable = 'plaintext-only'
      th.dataset.row = '0'
      th.dataset.cell = String(cellIndex)
      th.style.textAlign = displayAlignment(this.alignments[cellIndex])
      th.textContent = cell.text
      headerRow.appendChild(th)
    })
    thead.appendChild(headerRow)
    table.appendChild(thead)
    const tbody = document.createElement('tbody')
    this.rows.slice(1).forEach((row, rowIndex) => {
      const tr = document.createElement('tr')
      row.forEach((cell, cellIndex) => {
        const td = document.createElement('td')
        td.contentEditable = 'plaintext-only'
        td.dataset.row = String(rowIndex + 1)
        td.dataset.cell = String(cellIndex)
        td.style.textAlign = displayAlignment(this.alignments[cellIndex])
        td.textContent = cell.text
        tr.appendChild(td)
      })
      tbody.appendChild(tr)
    })
    table.appendChild(tbody)
    scroll.appendChild(table)
    wrapper.appendChild(scroll)

    // 与 Obsidian 一致：表格右边 / 下方悬停出现“+”条，点一下追加一列 / 一行。
    const plusIcon = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 3.6v8.8"/><path d="M3.6 8h8.8"/></svg>'
    const applyEdit = (mutate) => {
      const view = this.host === null || this.host === undefined ? null : this.host.view
      if (view === null || view === undefined) return
      const doc = view.state.doc
      const block = parseTableBlock(doc, this.tableFrom, this.tableTo)
      if (block.rows.length === 0) return
      const cols = block.rows[0].length
      const separatorCells = block.separatorIndex >= 0 ? parseCells(block.lines[block.separatorIndex].text) : new Array(cols).fill('---')
      while (separatorCells.length < cols) separatorCells.push('---')
      const nextRows = block.rows.map((row) => row.slice())
      const nextSeparator = separatorCells.slice()
      if (mutate(nextRows, nextSeparator) === false) return
      const tableText = buildTableText(nextRows, nextSeparator)
      const tableFrom = this.tableFrom
      const tableTo = this.tableTo
      // 表格操作不应该改变用户的滚动位置：记录并在最后恢复。
      const scrollElement = view.scrollDOM
      const savedScrollTop = scrollElement === null || scrollElement === undefined ? null : scrollElement.scrollTop
      const savedScrollLeft = scrollElement === null || scrollElement === undefined ? null : scrollElement.scrollLeft
      // 表格是覆盖整块的 block widget：在它自身范围内改文本会让 CM6 在更新中途替换
      // 高度表（不刷新 / "No tile" 崩溃）。所以先用一个独立事务把该表格切成源码态
      //（widget 先被移除），再改文本，最后恢复渲染态——每一步都是独立的 transaction。
      try {
        tableSourceMode = true
        view.dispatch({ effects: rebuildEffect.of(null) })
      } catch {
        tableSourceMode = false
        return
      }
      window.setTimeout(() => {
        try {
          const current = view.state.doc
          const from = Math.min(tableFrom, current.length)
          const to = Math.min(tableTo, current.length)
          view.dispatch({
            changes: { from, to, insert: tableText },
            annotations: Transaction.addToHistory.of(false),
          })
        } catch {
          // 编辑失败时也要恢复渲染态
        }
        window.setTimeout(() => {
          try {
            tableSourceMode = false
            view.dispatch({ effects: rebuildEffect.of(null) })
            const currentDoc = view.state.doc
            const tableEnd = Math.min(tableFrom + tableText.length, currentDoc.length)
            const afterLine = Math.min(currentDoc.lineAt(tableEnd).number + 1, currentDoc.lines)
            view.dispatch({ selection: { anchor: currentDoc.line(afterLine).from }, scrollIntoView: false })
            view.focus()
            window.setTimeout(() => {
              try {
                if (scrollElement !== null && scrollElement !== undefined) {
                  if (savedScrollTop !== null && Math.abs(scrollElement.scrollTop - savedScrollTop) > 2) scrollElement.scrollTop = savedScrollTop
                  if (savedScrollLeft !== null && Math.abs(scrollElement.scrollLeft - savedScrollLeft) > 2) scrollElement.scrollLeft = savedScrollLeft
                }
                view.requestMeasure()
              } catch {}
            }, 60)
          } catch {}
        }, 24)
      }, 24)
    }
    const addRow = (event) => {
      event.preventDefault()
      event.stopPropagation()
      applyEdit((rows) => {
        rows.push(new Array(rows[0].length).fill(''))
      })
    }
    const addColumn = (event) => {
      event.preventDefault()
      event.stopPropagation()
      applyEdit((rows, separator) => {
        for (const row of rows) row.push('')
        separator.push('---')
      })
    }
    const rowButton = document.createElement('div')
    rowButton.className = 'gh-md-cm6-table-add-row'
    rowButton.setAttribute('role', 'button')
    rowButton.setAttribute('tabindex', '-1')
    rowButton.setAttribute('aria-label', '在下方新增行')
    rowButton.setAttribute('title', '在下方新增行')
    rowButton.innerHTML = plusIcon
    rowButton.addEventListener('mousedown', (event) => { event.preventDefault(); event.stopPropagation() })
    rowButton.addEventListener('click', addRow)
    const colButton = document.createElement('div')
    colButton.className = 'gh-md-cm6-table-add-col'
    colButton.setAttribute('role', 'button')
    colButton.setAttribute('tabindex', '-1')
    colButton.setAttribute('aria-label', '在右侧新增列')
    colButton.setAttribute('title', '在右侧新增列')
    colButton.innerHTML = plusIcon
    colButton.addEventListener('mousedown', (event) => { event.preventDefault(); event.stopPropagation() })
    colButton.addEventListener('click', addColumn)
    wrapper.appendChild(rowButton)
    wrapper.appendChild(colButton)

    // ---- Obsidian 风格的行/列选择手柄：点一下选中整行/整列，再按 Backspace / Delete 删除 ----
    const gripVertical = '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><circle cx="6" cy="4" r="1.1"/><circle cx="10" cy="4" r="1.1"/><circle cx="6" cy="8" r="1.1"/><circle cx="10" cy="8" r="1.1"/><circle cx="6" cy="12" r="1.1"/><circle cx="10" cy="12" r="1.1"/></svg>'
    const gripHorizontal = '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><circle cx="4" cy="6" r="1.1"/><circle cx="4" cy="10" r="1.1"/><circle cx="8" cy="6" r="1.1"/><circle cx="8" cy="10" r="1.1"/><circle cx="12" cy="6" r="1.1"/><circle cx="12" cy="10" r="1.1"/></svg>'
    // 选择状态：{ kind: 'row' | 'col', anchor, focus } 或 { kind: 'cell', anchor: { row, col }, focus: { row, col } }
    let selection = null
    const rowHandles = []
    const colHandles = []
    let cellDrag = null
    let skipCellClick = false
    // 上次单击过的单元格：Shift+点击用它当锚点（Obsidian 也是这样扩展选区）。
    let cellAnchor = null
    let dragState = null
    let skipNextClick = false

    const selectionRange = () => {
      if (selection === null) return null
      if (selection.kind === 'cell') {
        return {
          kind: 'cell',
          rowStart: Math.min(selection.anchor.row, selection.focus.row),
          rowEnd: Math.max(selection.anchor.row, selection.focus.row),
          colStart: Math.min(selection.anchor.col, selection.focus.col),
          colEnd: Math.max(selection.anchor.col, selection.focus.col),
        }
      }
      return { kind: selection.kind, start: Math.min(selection.anchor, selection.focus), end: Math.max(selection.anchor, selection.focus) }
    }

    const paintSelection = () => {
      for (const cell of wrapper.querySelectorAll('th,td')) cell.classList.remove('gh-md-cm6-table-cell-selected')
      for (const handle of rowHandles) handle.classList.remove('is-selected')
      for (const handle of colHandles) handle.classList.remove('is-selected')
      const range = selectionRange()
      if (range === null) return
      for (const cell of wrapper.querySelectorAll('th,td')) {
        const row = Number(cell.dataset.row)
        const col = Number(cell.dataset.cell)
        if (range.kind === 'row' && row >= range.start && row <= range.end) cell.classList.add('gh-md-cm6-table-cell-selected')
        if (range.kind === 'col' && col >= range.start && col <= range.end) cell.classList.add('gh-md-cm6-table-cell-selected')
        if (range.kind === 'cell' && row >= range.rowStart && row <= range.rowEnd && col >= range.colStart && col <= range.colEnd) cell.classList.add('gh-md-cm6-table-cell-selected')
      }
      if (range.kind === 'row') {
        for (const handle of rowHandles) {
          const position = Number(handle.dataset.index)
          if (position >= range.start && position <= range.end) handle.classList.add('is-selected')
        }
      }
      if (range.kind === 'col') {
        for (const handle of colHandles) {
          const position = Number(handle.dataset.index)
          if (position >= range.start && position <= range.end) handle.classList.add('is-selected')
        }
      }
    }

    const clearSelection = () => {
      if (selection === null) return
      selection = null
      wrapper.dataset.mdSelection = ''
      paintSelection()
    }

    const applySelection = (kind, index, extend) => {
      const previous = selectionRange()
      const keepAnchor = extend === true && previous !== null && previous.kind === kind
      const anchor = keepAnchor ? selection.anchor : index
      selection = { kind, anchor, focus: index }
      wrapper.dataset.mdSelection = kind
      paintSelection()
    }

    const applyCellSelection = (anchorRow, anchorCol, focusRow, focusCol) => {
      selection = { kind: 'cell', anchor: { row: anchorRow, col: anchorCol }, focus: { row: focusRow, col: focusCol } }
      wrapper.dataset.mdSelection = 'cell'
      paintSelection()
    }

    const cellNodeAt = (rowIndex, colIndex) => wrapper.querySelector('td[data-row="' + rowIndex + '"][data-cell="' + colIndex + '"], th[data-row="' + rowIndex + '"][data-cell="' + colIndex + '"]')
    const cellBounds = () => {
      const rowCount = Math.max(1, wrapper.querySelectorAll('tr').length)
      const columnCount = Math.max(1, Array.from(wrapper.querySelectorAll('tr')).reduce((max, row) => Math.max(max, row.children.length), 0))
      return { rowCount, columnCount }
    }
    const clampCell = (rowIndex, colIndex) => {
      const bounds = cellBounds()
      return {
        row: Math.max(0, Math.min(bounds.rowCount - 1, rowIndex)),
        col: Math.max(0, Math.min(bounds.columnCount - 1, colIndex)),
      }
    }
    // 把焦点和光标放到指定单元格末尾（键盘导航用）。
    const focusCellAt = (rowIndex, colIndex) => {
      const node = cellNodeAt(rowIndex, colIndex)
      if (node === null) return false
      try { node.focus() } catch {}
      try {
        const range = document.createRange()
        range.selectNodeContents(node)
        range.collapse(false)
        const current = window.getSelection()
        if (current !== null) {
          current.removeAllRanges()
          current.addRange(range)
        }
      } catch {}
      cellAnchor = { row: rowIndex, col: colIndex }
      return true
    }
    // 光标是否在单元格文本末尾（Shift+左右键越界时才扩展选区，和 Obsidian 一致）。
    const caretOffsetInCell = (cellNode) => {
      try {
        const current = window.getSelection()
        if (current === null || current.rangeCount === 0) return null
        const range = current.getRangeAt(0)
        if (!range.collapsed) return null
        const probe = document.createRange()
        probe.selectNodeContents(cellNode)
        probe.setEnd(range.endContainer, range.endOffset)
        return probe.toString().length
      } catch {
        return null
      }
    }
    const ARROW_DELTAS = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1] }

    const startHandleDrag = (kind, index, handle, event) => {
      if (event.button !== 0) return
      dragState = { kind, index, startX: event.clientX, startY: event.clientY, moved: false, indicator: null, target: index }
      skipNextClick = false
      try { handle.setPointerCapture(event.pointerId) } catch {}
    }

    const updateDrag = (event) => {
      if (dragState === null) return
      const distance = Math.abs(event.clientX - dragState.startX) + Math.abs(event.clientY - dragState.startY)
      if (!dragState.moved && distance < 4) return
      if (!dragState.moved) {
        dragState.moved = true
        const indicator = document.createElement('div')
        indicator.className = 'gh-md-cm6-table-drop-indicator'
        wrapper.appendChild(indicator)
        dragState.indicator = indicator
      }
      try {
        const wrapperRect = wrapper.getBoundingClientRect()
        const nodes = dragState.kind === 'row'
          ? Array.from(table.querySelectorAll('tr'))
          : Array.from(table.querySelectorAll('thead tr:first-child th'))
        let target = nodes.length
        for (let position = 0; position < nodes.length; position += 1) {
          const rect = nodes[position].getBoundingClientRect()
          if (dragState.kind === 'row') {
            if (event.clientY < rect.top + rect.height / 2) { target = position; break }
          } else if (event.clientX < rect.left + rect.width / 2) {
            target = position
            break
          }
        }
        dragState.target = target
        if (dragState.indicator !== null) {
          const rect = nodes[Math.min(target, nodes.length - 1)].getBoundingClientRect()
          if (dragState.kind === 'row') {
            const top = target >= nodes.length ? rect.bottom : rect.top
            dragState.indicator.style.top = (top - wrapperRect.top) + 'px'
            dragState.indicator.style.left = (rect.left - wrapperRect.left) + 'px'
            dragState.indicator.style.width = rect.width + 'px'
            dragState.indicator.style.height = '2px'
          } else {
            const left = target >= nodes.length ? rect.right : rect.left
            dragState.indicator.style.left = (left - wrapperRect.left - 1) + 'px'
            dragState.indicator.style.top = (rect.top - wrapperRect.top) + 'px'
            dragState.indicator.style.width = '2px'
            dragState.indicator.style.height = rect.height + 'px'
          }
        }
      } catch {}
    }

    const endHandleDrag = (event, handle) => {
      if (dragState === null) return
      const state = dragState
      dragState = null
      try { handle.releasePointerCapture(event.pointerId) } catch {}
      if (state.indicator !== null) state.indicator.remove()
      for (const node of rowHandles) node.classList.remove('is-dragging')
      for (const node of colHandles) node.classList.remove('is-dragging')
      if (!state.moved) return
      skipNextClick = true
      if (state.kind === 'row') moveRowTo(state.index, state.target)
      else moveColumnTo(state.index, state.target)
    }

    const moveRowTo = (from, insertAt) => {
      if (from < 1) return false
      let target = insertAt
      if (from < target) target -= 1
      if (target < 1) target = 1
      if (target === from) return false
      let applied = false
      applyEdit((rows) => {
        if (from >= rows.length) return false
        const [row] = rows.splice(from, 1)
        const at = Math.min(Math.max(target, 1), rows.length)
        rows.splice(at, 0, row)
        applied = true
        return true
      })
      return applied
    }

    const moveColumnTo = (from, insertAt) => {
      let target = insertAt
      if (from < target) target -= 1
      if (target === from) return false
      let applied = false
      applyEdit((rows, separator) => {
        if (from >= (rows[0] ?? []).length) return false
        for (const row of rows) {
          const [cell] = row.splice(from, 1)
          row.splice(Math.min(target, row.length), 0, cell)
        }
        const [separatorCell] = separator.splice(from, 1)
        separator.splice(Math.min(target, separator.length), 0, separatorCell)
        applied = true
        return true
      })
      return applied
    }

    const layoutHandles = () => {
      try {
        const wrapperRect = wrapper.getBoundingClientRect()
        const tableRect = table.getBoundingClientRect()
        const current = selectionRange()
        const rowNodes = Array.from(table.querySelectorAll('tr'))
        rowHandles.forEach((handle) => handle.remove())
        rowHandles.length = 0
        rowNodes.forEach((row, index) => {
          const rect = row.getBoundingClientRect()
          const handle = document.createElement('div')
          handle.className = 'gh-md-cm6-table-row-handle'
          handle.dataset.index = String(index)
          handle.setAttribute('role', 'button')
          handle.setAttribute('tabindex', '0')
          handle.setAttribute('aria-label', '选择/拖动整行')
          handle.setAttribute('title', '点击选中整行，Shift 点击多选，拖拽排序，Backspace 删除，Ctrl+C 复制')
          handle.innerHTML = gripVertical
          handle.style.top = (rect.top - wrapperRect.top) + 'px'
          handle.style.left = (rect.left - wrapperRect.left - 16) + 'px'
          handle.style.height = rect.height + 'px'
          if (current !== null && current.kind === 'row' && index >= current.start && index <= current.end) handle.classList.add('is-selected')
          handle.addEventListener('mousedown', (event) => { event.preventDefault(); event.stopPropagation() })
          handle.addEventListener('pointerdown', (event) => startHandleDrag('row', index, handle, event))
          handle.addEventListener('pointermove', (event) => {
            if (dragState !== null && dragState.moved) handle.classList.add('is-dragging')
            updateDrag(event)
          })
          handle.addEventListener('pointerup', (event) => endHandleDrag(event, handle))
          handle.addEventListener('pointercancel', (event) => endHandleDrag(event, handle))
          handle.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
            if (skipNextClick) { skipNextClick = false; return }
            applySelection('row', index, event.shiftKey)
            handle.focus()
          })
          wrapper.appendChild(handle)
          rowHandles.push(handle)
        })
        const headerCells = Array.from(table.querySelectorAll('thead tr:first-child th'))
        colHandles.forEach((handle) => handle.remove())
        colHandles.length = 0
        headerCells.forEach((cell, index) => {
          const rect = cell.getBoundingClientRect()
          const handle = document.createElement('div')
          handle.className = 'gh-md-cm6-table-col-handle'
          handle.dataset.index = String(index)
          handle.setAttribute('role', 'button')
          handle.setAttribute('tabindex', '0')
          handle.setAttribute('aria-label', '选择/拖动整列')
          handle.setAttribute('title', '点击选中整列，Shift 点击多选，拖拽排序，Backspace 删除，Ctrl+C 复制')
          handle.innerHTML = gripHorizontal
          handle.style.left = (rect.left - wrapperRect.left) + 'px'
          handle.style.top = (tableRect.top - wrapperRect.top - 16) + 'px'
          handle.style.width = rect.width + 'px'
          if (current !== null && current.kind === 'col' && index >= current.start && index <= current.end) handle.classList.add('is-selected')
          handle.addEventListener('mousedown', (event) => { event.preventDefault(); event.stopPropagation() })
          handle.addEventListener('pointerdown', (event) => startHandleDrag('col', index, handle, event))
          handle.addEventListener('pointermove', (event) => {
            if (dragState !== null && dragState.moved) handle.classList.add('is-dragging')
            updateDrag(event)
          })
          handle.addEventListener('pointerup', (event) => endHandleDrag(event, handle))
          handle.addEventListener('pointercancel', (event) => endHandleDrag(event, handle))
          handle.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
            if (skipNextClick) { skipNextClick = false; return }
            applySelection('col', index, event.shiftKey)
            handle.focus()
          })
          wrapper.appendChild(handle)
          colHandles.push(handle)
        })
      } catch {}
    }

    const cellValuesOf = (row, colStart, colEnd) => {
      const values = []
      if (row === undefined) return values
      for (let index = colStart; index <= colEnd; index += 1) {
        const cell = row[index]
        values.push(cell === undefined ? '' : String(cell.text ?? '').trim())
      }
      return values
    }

    const selectionToText = () => {
      const range = selectionRange()
      if (range === null) return ''
      const lines = []
      if (range.kind === 'cell') {
        for (let rowIndex = range.rowStart; rowIndex <= range.rowEnd; rowIndex += 1) {
          lines.push(cellValuesOf(this.rows[rowIndex], range.colStart, range.colEnd).join('\t'))
        }
        return lines.join('\n')
      }
      for (let index = range.start; index <= range.end; index += 1) {
        const row = range.kind === 'row' ? this.rows[index] : this.rows[index]
        if (row === undefined) continue
        lines.push(cellValuesOf(row, range.kind === 'row' ? 0 : range.start, range.kind === 'row' ? row.length - 1 : range.end).join('\t'))
      }
      return lines.join('\n')
    }

    // 剪贴板里的 HTML 表格 → 字符串矩阵（Obsidian 复制时会同时写 text/html，粘贴时按表格解析）。
    const parseClipboardTableHtml = (html) => {
      if (typeof html !== 'string' || !/<table[\s>]/iu.test(html)) return null
      try {
        const parsed = new DOMParser().parseFromString(html, 'text/html')
        const table = parsed.querySelector('table')
        if (table === null) return null
        const rows = Array.from(table.querySelectorAll('tr')).map((row) => Array.from(row.querySelectorAll('th,td')).map((cell) => (cell.textContent ?? '').trim()))
        const usable = rows.filter((row) => row.length > 0)
        if (usable.length === 0) return null
        const width = usable.reduce((max, row) => Math.max(max, row.length), 0)
        if (width === 0) return null
        return { rows: usable, width }
      } catch {
        return null
      }
    }

    // 把矩阵写入表格：从 startRow/startCol 开始覆盖单元格，行不够就补行（Obsidian 的粘贴行为）。
    const writeMatrixAt = (startRow, startCol, table) => {
      if (table === null || table.rows.length === 0) return false
      const width = table.width
      applyEdit((rows, separator) => {
        const columnCount = Math.max(width + startCol, (rows[0] ?? []).length)
        for (const row of rows) {
          while (row.length < columnCount) row.push('')
        }
        while (separator.length < columnCount) separator.push('---')
        let targetRow = startRow
        for (const sourceRow of table.rows) {
          while (targetRow >= rows.length) rows.push(new Array(columnCount).fill(''))
          for (let offset = 0; offset < width; offset += 1) {
            const value = sourceRow[offset]
            rows[targetRow][startCol + offset] = value === undefined ? '' : value
          }
          targetRow += 1
        }
        return true
      })
      return true
    }

    // 选区矩阵：统一成「行数组 × 列数组」的字符串矩阵，方便复制与序列化。
    const selectionMatrix = () => {
      const range = selectionRange()
      if (range === null) return []
      if (range.kind === 'cell') {
        const matrix = []
        for (let rowIndex = range.rowStart; rowIndex <= range.rowEnd; rowIndex += 1) {
          matrix.push(cellValuesOf(this.rows[rowIndex], range.colStart, range.colEnd))
        }
        return matrix
      }
      if (range.kind === 'row') {
        const matrix = []
        for (let index = range.start; index <= range.end; index += 1) {
          const row = this.rows[index]
          if (row === undefined) continue
          matrix.push(cellValuesOf(row, 0, Math.max(0, row.length - 1)))
        }
        return matrix
      }
      const matrix = []
      for (const row of this.rows) matrix.push(cellValuesOf(row, range.start, range.end))
      return matrix
    }

    // 单元格按列对齐补空格：左对齐补右、居中两侧均分、右对齐补左。
    const padAligned = (value, width, alignment) => {
      const raw = String(value)
      if (raw.length >= width) return raw
      const total = width - raw.length
      if (alignment === 'center') {
        const left = Math.floor(total / 2)
        return ' '.repeat(left) + raw + ' '.repeat(total - left)
      }
      if (alignment === 'right') return ' '.repeat(total) + raw
      return raw + ' '.repeat(total)
    }

    // 分隔行的对齐标记：--- / :--- / :---: / ---:（Obsidian 会区分 :--- 与 ---）
    const formatSeparatorCell = (width, alignment) => {
      if (alignment === 'center') return ':' + '-'.repeat(Math.max(1, width - 2)) + ':'
      if (alignment === 'right') return '-'.repeat(Math.max(1, width - 1)) + ':'
      if (alignment === 'left-colon') return ':' + '-'.repeat(Math.max(1, width - 1))
      return '-'.repeat(width)
    }

    // Obsidian 的表格复制格式：首行当表头 + 一行分隔符，每列按「最宽内容（至少 3）」对齐补空格。
    const serializeMarkdownTable = (matrix, alignments) => {
      if (matrix.length === 0) return ''
      const columnCount = matrix.reduce((max, row) => Math.max(max, row.length), 0)
      if (columnCount === 0) return ''
      const columnAlignments = Array.isArray(alignments) ? alignments : []
      const widths = []
      for (let col = 0; col < columnCount; col += 1) {
        let width = 3
        for (const row of matrix) {
          const value = row[col] === undefined ? '' : String(row[col])
          width = Math.max(width, value.length)
        }
        widths.push(width)
      }
      const alignmentAt = (col) => {
        const value = columnAlignments[col]
        return value === 'center' || value === 'right' || value === 'left-colon' ? value : 'left'
      }
      const formatRow = (cells) => '| ' + widths.map((width, col) => padAligned(cells[col] === undefined ? '' : cells[col], width, alignmentAt(col))).join(' | ') + ' |'
      const lines = [formatRow(matrix[0])]
      lines.push('| ' + widths.map((width, col) => formatSeparatorCell(width, alignmentAt(col))).join(' | ') + ' |')
      for (const row of matrix.slice(1)) lines.push(formatRow(row))
      return lines.join('\n')
    }

    const escapeHtml = (value) => String(value)
      .replace(/&/gu, '&amp;')
      .replace(/</gu, '&lt;')
      .replace(/>/gu, '&gt;')

    // 与 text/plain 配套的 HTML 表格（Obsidian 剪贴板里两种格式都有）。
    const serializeHtmlTable = (matrix, alignments) => {
      if (matrix.length === 0) return ''
      const columnAlignments = Array.isArray(alignments) ? alignments : []
      const styleAt = (col) => {
        const value = columnAlignments[col]
        return value === 'center' || value === 'right' ? ' style="text-align: ' + value + '"' : ''
      }
      const head = '<tr>' + (matrix[0] ?? []).map((cell, col) => '<th' + styleAt(col) + '>' + escapeHtml(cell) + '</th>').join('') + '</tr>'
      const body = matrix.slice(1)
        .map((row) => '<tr>' + row.map((cell, col) => '<td' + styleAt(col) + '>' + escapeHtml(cell) + '</td>').join('') + '</tr>')
        .join('')
      return '<table><thead>' + head + '</thead><tbody>' + body + '</tbody></table>'
    }

    // 选区各列的对齐方式（用于复制时分隔行的 :---: / ---: 与单元格补空格方向）。
    const selectionAlignments = () => {
      const range = selectionRange()
      if (range === null) return []
      const alignments = []
      if (range.kind === 'cell') {
        for (let col = range.colStart; col <= range.colEnd; col += 1) alignments.push(this.alignments[col] ?? 'left')
        return alignments
      }
      if (range.kind === 'row') {
        const width = this.rows.reduce((max, row) => Math.max(max, row.length), 0)
        for (let col = 0; col < width; col += 1) alignments.push(this.alignments[col] ?? 'left')
        return alignments
      }
      for (let col = range.start; col <= range.end; col += 1) alignments.push(this.alignments[col] ?? 'left')
      return alignments
    }

    const selectionToMarkdown = () => serializeMarkdownTable(selectionMatrix(), selectionAlignments())
    const selectionToHtml = () => serializeHtmlTable(selectionMatrix(), selectionAlignments())

    const writePlainText = (value) => {
      const fallback = () => {
        try {
          const area = document.createElement('textarea')
          area.value = value
          area.style.position = 'fixed'
          area.style.opacity = '0'
          document.body.appendChild(area)
          area.select()
          const ok = document.execCommand('copy')
          area.remove()
          return ok
        } catch {
          return false
        }
      }
      try {
        if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(value).catch(() => { fallback() })
          return true
        }
      } catch {}
      return fallback()
    }

    const copySelection = (mode) => {
      const asTsv = mode === 'tsv'
      const value = asTsv ? selectionToText() : selectionToMarkdown()
      if (value === '') return false
      const html = asTsv ? '' : selectionToHtml()
      const fallback = () => {
        try {
          const area = document.createElement('textarea')
          area.value = value
          area.style.position = 'fixed'
          area.style.opacity = '0'
          document.body.appendChild(area)
          area.select()
          const ok = document.execCommand('copy')
          area.remove()
          return ok
        } catch {
          return false
        }
      }
      // 优先写入 text/plain + text/html（和 Obsidian 一致，粘到浏览器/Word 里就是表格）。
      try {
        if (html !== '' && typeof window.ClipboardItem === 'function'
          && navigator.clipboard !== undefined && typeof navigator.clipboard.write === 'function') {
          const item = new window.ClipboardItem({
            'text/plain': new Blob([value], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' }),
          })
          navigator.clipboard.write([item]).catch(() => {
            try { navigator.clipboard.writeText(value).catch(() => { fallback() }) } catch { fallback() }
          })
          return true
        }
      } catch {}
      try {
        if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(value).catch(() => { fallback() })
          return true
        }
      } catch {}
      return fallback()
    }

    // Ctrl+X：和 Obsidian 一样先复制 Markdown 表格，再按选区语义删除。
    const cutSelection = () => {
      if (selectionRange() === null) return false
      const copied = copySelection('markdown')
      const removed = deleteSelection()
      return copied || removed
    }

    const deleteSelection = () => {
      const range = selectionRange()
      if (range === null) return false
      let applied = false
      if (range.kind === 'row') {
        applyEdit((rows) => {
          if (rows.length <= 1) return false
          const count = Math.min(range.end - range.start + 1, rows.length - 1)
          const startRow = Math.min(range.start, rows.length - count)
          rows.splice(startRow, count)
          applied = true
          return true
        })
      } else if (range.kind === 'col') {
        applyEdit((rows, separator) => {
          const columns = (rows[0] ?? []).length
          if (columns <= 1) return false
          const count = Math.min(range.end - range.start + 1, columns - 1)
          const startColumn = Math.min(range.start, columns - count)
          for (const row of rows) row.splice(startColumn, count)
          separator.splice(startColumn, count)
          applied = true
          return true
        })
      } else {
        // 跨格选区：覆盖整行 → 删行；覆盖整列 → 删列；否则清空单元格内容
        const columns = (this.rows[0] ?? []).length
        // 参差表格：只要选区覆盖到"每一行自己的最后一个单元格"，就算整行选中。
        const allColumns = range.colStart === 0 && this.rows
          .slice(range.rowStart, range.rowEnd + 1)
          .every((row) => range.colEnd >= (row === undefined ? 0 : row.length - 1))
        const allRows = range.rowStart === 0 && range.rowEnd === this.rows.length - 1
        if (allColumns && !allRows) {
          applyEdit((rows) => {
            if (rows.length <= 1) return false
            const count = Math.min(range.rowEnd - range.rowStart + 1, rows.length - 1)
            const startRow = Math.min(range.rowStart, rows.length - count)
            rows.splice(startRow, count)
            applied = true
            return true
          })
        } else if (allRows && !allColumns) {
          applyEdit((rows, separator) => {
            const columnCount = (rows[0] ?? []).length
            if (columnCount <= 1) return false
            const count = Math.min(range.colEnd - range.colStart + 1, columnCount - 1)
            const startColumn = Math.min(range.colStart, columnCount - count)
            for (const row of rows) row.splice(startColumn, count)
            separator.splice(startColumn, count)
            applied = true
            return true
          })
        } else {
          applyEdit((rows) => {
            for (let rowIndex = range.rowStart; rowIndex <= range.rowEnd; rowIndex += 1) {
              const row = rows[rowIndex]
              if (row === undefined) continue
              for (let colIndex = range.colStart; colIndex <= range.colEnd; colIndex += 1) {
                if (row[colIndex] !== undefined) row[colIndex] = ''
              }
            }
            applied = true
            return true
          })
        }
      }
      if (applied) clearSelection()
      return applied
    }

    // 跨格拖拽选择：在单元格内按下并拖到其它单元格时，进入矩形选区（单元格内拖拽仍是原生文本选择）。
    wrapper.addEventListener('mousedown', (event) => {
      const target = event.target
      if (target === null || typeof target.closest !== 'function') return
      if (target.closest('.gh-md-cm6-table-row-handle') !== null) return
      if (target.closest('.gh-md-cm6-table-col-handle') !== null) return
      const cell = target.closest('th,td')
      if (cell === null) {
        clearSelection()
        return
      }
      // 右键按下时保留选区，contextmenu 才能弹出「选区菜单」（Obsidian 行为）。
      if (event.button === 2) return
      if (event.button !== 0) {
        clearSelection()
        return
      }
      // Shift+点击：以已有选区（或上次单击过的单元格）为锚点扩展矩形，和 Obsidian 一致。
      if (event.shiftKey === true) {
        const shiftRow = Number(cell.dataset.row)
        const shiftCol = Number(cell.dataset.cell)
        if (selection === null && cellAnchor !== null) {
          applyCellSelection(cellAnchor.row, cellAnchor.col, shiftRow, shiftCol)
          skipCellClick = true
          event.preventDefault()
          return
        }
        if (selection !== null) {
          if (selection.kind === 'cell') {
            applyCellSelection(selection.anchor.row, selection.anchor.col, shiftRow, shiftCol)
          } else if (selection.kind === 'row') {
            applySelection('row', shiftRow, true)
          } else {
            applySelection('col', shiftCol, true)
          }
          skipCellClick = true
          event.preventDefault()
          return
        }
      }
      cellAnchor = { row: Number(cell.dataset.row), col: Number(cell.dataset.cell) }
      cellDrag = { row: Number(cell.dataset.row), col: Number(cell.dataset.cell), startX: event.clientX, startY: event.clientY, active: false }
    })
    // 指针离开表格时，按几何位置钳制到最近的行/列（Obsidian 拖出表格边界也会继续扩展选区）。
    const cellAtPoint = (clientX, clientY) => {
      try {
        const rows = Array.from(table.querySelectorAll('thead tr, tbody tr'))
        if (rows.length === 0) return null
        const rowRects = rows.map((row) => row.getBoundingClientRect())
        let rowIndex = rowRects.length - 1
        if (clientY <= rowRects[0].top) {
          rowIndex = 0
        } else {
          rowIndex = rowRects.length - 1
          for (let index = 0; index < rowRects.length; index += 1) {
            if (clientY >= rowRects[index].top && clientY <= rowRects[index].bottom) { rowIndex = index; break }
            if (clientY < rowRects[index].top) { rowIndex = Math.max(0, index - 1); break }
          }
        }
        const cells = Array.from(rows[rowIndex].children)
        if (cells.length === 0) return null
        const cellRects = cells.map((cell) => cell.getBoundingClientRect())
        let colIndex = cellRects.length - 1
        if (clientX <= cellRects[0].left) {
          colIndex = 0
        } else {
          colIndex = cellRects.length - 1
          for (let index = 0; index < cellRects.length; index += 1) {
            if (clientX >= cellRects[index].left && clientX <= cellRects[index].right) { colIndex = index; break }
            if (clientX < cellRects[index].left) { colIndex = Math.max(0, index - 1); break }
          }
        }
        return { row: rowIndex, col: colIndex }
      } catch {
        return null
      }
    }
    wrapper.addEventListener('mousemove', (event) => {
      if (cellDrag === null) return
      const target = event.target
      const targetCell = target === null || typeof target.closest !== 'function' ? null : target.closest('th,td')
      const hit = targetCell !== null
        ? { row: Number(targetCell.dataset.row), col: Number(targetCell.dataset.cell) }
        : cellAtPoint(event.clientX, event.clientY)
      if (!cellDrag.active) {
        const distance = Math.abs(event.clientX - cellDrag.startX) + Math.abs(event.clientY - cellDrag.startY)
        if (distance < 6 || hit === null) return
        if (hit.row === cellDrag.row && hit.col === cellDrag.col) return
        cellDrag.active = true
        wrapper.classList.add('is-cell-selecting')
        try { window.getSelection()?.removeAllRanges() } catch {}
        wrapper.tabIndex = -1
        try { wrapper.focus({ preventScroll: true }) } catch {}
      }
      if (hit === null) return
      applyCellSelection(cellDrag.row, cellDrag.col, hit.row, hit.col)
    })
    const onDocumentMouseUp = () => {
      if (cellDrag === null) return
      if (cellDrag.active) skipCellClick = true
      cellDrag = null
      wrapper.classList.remove('is-cell-selecting')
    }
    const onDocumentSelectStart = (event) => {
      if (cellDrag !== null && cellDrag.active) event.preventDefault()
    }
    document.addEventListener('mouseup', onDocumentMouseUp)
    document.addEventListener('selectstart', onDocumentSelectStart)
    wrapper.__ghMdTableCleanup = () => {
      document.removeEventListener('mouseup', onDocumentMouseUp)
      document.removeEventListener('selectstart', onDocumentSelectStart)
      window.removeEventListener('keydown', onWindowKeyDown, true)
      document.removeEventListener('mousedown', onDocumentMouseDown, true)
    }
    wrapper.addEventListener('click', (event) => {
      if (skipCellClick) {
        skipCellClick = false
        event.preventDefault()
        event.stopPropagation()
        return
      }
      const target = event.target
      if (target === null || typeof target.closest !== 'function') return
      if (target.closest('th,td') !== null && selection !== null) clearSelection()
    })

    const onWindowKeyDown = (event) => {
      const eventTarget = event.target
      const targetCell = eventTarget === null || typeof eventTarget.closest !== 'function' ? null : eventTarget.closest('td,th')
      const hasNativeSelection = (() => {
        try { return String(window.getSelection() ?? '').length > 0 } catch { return false }
      })()
      // 光标在单元格里、没有文本选区、也没有矩形选区：Obsidian 的 Ctrl+C/Ctrl+X 作用在整格上。
      if (selection === null && targetCell !== null && !hasNativeSelection && (event.ctrlKey || event.metaKey)) {
        const isCopy = (event.key === 'c' || event.key === 'C') && event.shiftKey !== true
        const isCut = event.key === 'x' || event.key === 'X'
        if (isCopy || isCut) {
          const raw = String(targetCell.textContent ?? '')
          event.preventDefault()
          event.stopPropagation()
          if (raw !== '') writePlainText(raw)
          if (isCut && raw !== '') {
            const rowIndex = Number(targetCell.dataset.row)
            const colIndex = Number(targetCell.dataset.cell)
            applyEdit((rows) => {
              const row = rows[rowIndex]
              if (row === undefined) return false
              row[colIndex] = ''
              return true
            })
          }
          return
        }
      }
      if (selection === null) return
      // 有矩形选区时：方向键移动活动单元格，Shift+方向键扩展选区（Obsidian 行为）。
      if (selection.kind === 'cell' && ARROW_DELTAS[event.key] !== undefined) {
        const delta = ARROW_DELTAS[event.key]
        event.preventDefault()
        event.stopPropagation()
        if (event.shiftKey === true) {
          const focus = selection.focus
          const next = clampCell(focus.row + delta[0], focus.col + delta[1])
          applyCellSelection(selection.anchor.row, selection.anchor.col, next.row, next.col)
          return
        }
        const target = clampCell(selection.focus.row + delta[0], selection.focus.col + delta[1])
        clearSelection()
        focusCellAt(target.row, target.col)
        return
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault()
        event.stopPropagation()
        deleteSelection()
        return
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === 'x' || event.key === 'X')) {
        event.preventDefault()
        event.stopPropagation()
        cutSelection()
        return
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === 'c' || event.key === 'C')) {
        event.preventDefault()
        event.stopPropagation()
        copySelection(event.shiftKey === true ? 'tsv' : 'markdown')
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        clearSelection()
      }
    }
    window.addEventListener('keydown', onWindowKeyDown, true)
    // 点到表格以外就取消选择，避免全局 keydown 误伤其它输入框。
    const onDocumentMouseDown = (event) => {
      if (selection === null) return
      const target = event.target
      if (target === null || typeof target.closest !== 'function') return
      if (wrapper.contains(target)) return
      // 点在自己弹出的菜单/子菜单里时不要清空选区，否则「复制」「删除选中的单元格」等菜单项拿不到选区。
      if (target.closest('.gh-md-cm6-table-menu') !== null) return
      clearSelection()
    }
    document.addEventListener('mousedown', onDocumentMouseDown, true)
    let remeasureScheduled = false
    const requestTableRemeasure = () => {
      if (remeasureScheduled) return
      remeasureScheduled = true
      window.requestAnimationFrame(() => {
        remeasureScheduled = false
        try {
          const view = this.host === null || this.host === undefined ? null : this.host.view
          if (view !== null && view !== undefined) view.requestMeasure()
        } catch {}
      })
    }
    const syncTableSize = () => {
      try {
        const rect = table.getBoundingClientRect()
        wrapper.style.setProperty('--gh-md-table-w', Math.round(rect.width) + 'px')
        wrapper.style.setProperty('--gh-md-table-h', Math.round(rect.height) + 'px')
      } catch {}
      layoutHandles()
      // 表格高度/宽度变化（换行、滚动条、字体加载）后通知 CM6 重新测量，
      // 否则高度表会滞后，点击/选区会落到偏下的位置。
      requestTableRemeasure()
    }
    try { scroll.addEventListener('scroll', () => layoutHandles(), { passive: true }) } catch {}
    syncTableSize()
    if (typeof ResizeObserver === 'function') {
      try {
        const observer = new ResizeObserver(() => syncTableSize())
        observer.observe(table)
        window.setTimeout(syncTableSize, 60)
      } catch {}
    }
    // 给长 token（URL、哈希、长路径）插入零宽断点，让单元格能换行；
    // 普通英文单词不加断点，因此不会被从中间切断。
    const addWordBreakHints = (node) => {
      try {
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null)
        const textNodes = []
        while (walker.nextNode()) textNodes.push(walker.currentNode)
        for (const textNode of textNodes) {
          const value = textNode.nodeValue ?? ''
          if (!/[^\s]{13,}/.test(value)) continue
          if (/[\u4e00-\u9fff]/u.test(value)) continue
          const fragment = document.createDocumentFragment()
          const chunkPattern = /(\s+|[^\s]+)/gu
          let match
          while ((match = chunkPattern.exec(value)) !== null) {
            const chunk = match[0]
            if (/^\s+$/u.test(chunk) || chunk.length < 13) {
              fragment.appendChild(document.createTextNode(chunk))
              continue
            }
            let inserted = false
            let buffer = ''
            for (let index = 0; index < chunk.length; index += 1) {
              buffer += chunk[index]
              const isSeparator = '/_\-.,;:'.includes(chunk[index])
              const nextIsSeparator = index + 1 < chunk.length && '/_\-.,;:'.includes(chunk[index + 1])
              const longSegment = buffer.length >= 12
              if (index < chunk.length - 1 && (isSeparator && !nextIsSeparator || longSegment)) {
                fragment.appendChild(document.createTextNode(buffer))
                fragment.appendChild(document.createElement('wbr'))
                buffer = ''
                inserted = true
              }
            }
            if (buffer !== '') fragment.appendChild(document.createTextNode(buffer))
            if (!inserted) {
              // 没有断点也要保证长 token 可换行：回退成纯文本
              fragment.appendChild(document.createTextNode(''))
            }
          }
          textNode.parentNode.replaceChild(fragment, textNode)
        }
      } catch {}
    }
    const renderCell = (node, raw) => {
      if (this.host.renderInline !== undefined && document.activeElement !== node) {
        const html = this.host.renderInline(raw)
        if (typeof html === 'string') {
          node.innerHTML = html
          addWordBreakHints(node)
          return
        }
      }
      node.textContent = raw
      addWordBreakHints(node)
    }
    const cellsForRender = wrapper.querySelectorAll('td,th')
    let renderIndex = 0
    for (const row of this.rows) {
      for (const cell of row) {
        const node = cellsForRender[renderIndex]
        renderIndex += 1
        if (node === undefined) continue
        node.dataset.raw = cell.text
        renderCell(node, cell.text)
      }
    }
    const refreshAllCells = () => {
      const nodes = wrapper.querySelectorAll('td,th')
      for (const node of nodes) {
        if (node.dataset.raw !== undefined) renderCell(node, node.dataset.raw)
      }
    }
    let refreshAttempts = 0
    const refreshLater = () => {
      if (refreshAttempts >= 10) return
      refreshAttempts += 1
      refreshAllCells()
      window.setTimeout(refreshLater, 300)
    }
    window.setTimeout(refreshLater, 300)
    wrapper.addEventListener('focusin', (event) => {
      const target = event.target
      if (target === null || typeof target.closest !== 'function') return
      const cellNode = target.closest('td,th')
      if (cellNode === null) return
      const raw = cellNode.dataset.raw
      if (raw === undefined) return
      if (cellNode.innerHTML !== '') {
        cellNode.textContent = raw
        cellNode.innerHTML = ''
        cellNode.textContent = raw
      }
      const selection = window.getSelection()
      if (selection !== null) {
        const range = document.createRange()
        range.selectNodeContents(cellNode)
        range.collapse(false)
        selection.removeAllRanges()
        selection.addRange(range)
      }
    })
    wrapper.addEventListener('focusout', (event) => {
      const target = event.target
      if (target === null || typeof target.closest !== 'function') return
      const cellNode = target.closest('td,th')
      if (cellNode === null) return
      const raw = cellNode.dataset.raw
      if (raw === undefined) return
      renderCell(cellNode, raw)
    })
    // Ctrl+V：剪贴板里是表格（HTML）时按矩阵粘贴到当前单元格，与 Obsidian 一致；
    // 纯文本仍走浏览器默认（写入当前单元格）。
    wrapper.addEventListener('paste', (event) => {
      const target = event.target
      if (target === null || typeof target.closest !== 'function') return
      const cellNode = target.closest('th,td')
      if (cellNode === null) return
      const data = event.clipboardData
      if (data === null || data === undefined) return
      const table = parseClipboardTableHtml(data.getData('text/html'))
      if (table === null) return
      event.preventDefault()
      event.stopPropagation()
      writeMatrixAt(Number(cellNode.dataset.row), Number(cellNode.dataset.cell), table)
    })
    wrapper.addEventListener('input', (event) => {
      const target = event.target
      if (target === null || typeof target.closest !== 'function') return
      const cellNode = target.closest('td,th')
      if (cellNode === null) return
      const view = this.host.view
      if (view === null) return
      const rowIndex = Number(cellNode.dataset.row)
      const cellIndex = Number(cellNode.dataset.cell)
      const doc = view.state.doc
      const firstLine = doc.lineAt(this.tableFrom).number
      let dataRow = -1
      for (let n = firstLine; n <= doc.lines; n += 1) {
        const info = doc.line(n)
        if (info.from > this.tableTo) break
        if (/^\s*\|?\s*:?-{2,}/u.test(info.text.trim())) continue
        dataRow += 1
        if (dataRow === rowIndex) {
          const range = cellRangeInLine(info, cellIndex)
          if (range === null) return
          const value = cellNode.textContent ?? ''
          cellNode.dataset.raw = value
          view.dispatch({ changes: { from: range.from, to: range.to, insert: value } })
          return
        }
      }
    })
    // 选区各列索引（行/列选择会展开到整行/整列），用于批量格式化与对齐。
    const selectionColumnIndexes = (range) => {
      if (range === null) return []
      if (range.kind === 'cell') {
        const columns = []
        for (let col = range.colStart; col <= range.colEnd; col += 1) columns.push(col)
        return columns
      }
      if (range.kind === 'col') {
        const columns = []
        for (let col = range.start; col <= range.end; col += 1) columns.push(col)
        return columns
      }
      const width = this.rows.reduce((max, row) => Math.max(max, row.length), 0)
      const columns = []
      for (let col = 0; col < width; col += 1) columns.push(col)
      return columns
    }
    const selectionRowIndexes = (range) => {
      if (range === null) return []
      if (range.kind === 'cell') {
        const rows = []
        for (let row = range.rowStart; row <= range.rowEnd; row += 1) rows.push(row)
        return rows
      }
      if (range.kind === 'row') {
        const rows = []
        for (let row = range.start; row <= range.end; row += 1) rows.push(row)
        return rows
      }
      const rows = []
      for (let row = 0; row < this.rows.length; row += 1) rows.push(row)
      return rows
    }
    const stripCellFormatting = (value) => String(value)
      .replace(/^\*\*(.*)\*\*$/su, '$1')
      .replace(/^\*(.*)\*$/su, '$1')
      .replace(/^~~(.*)~~$/su, '$1')
      .replace(/^==(.*)==$/su, '$1')
      .replace(/^`(.*)`$/su, '$1')
      .replace(/^\$(.*)\$$/su, '$1')
      .replace(/^%%(.*)%%$/su, '$1')
    // 文本格式：给选区内每个单元格加/去包装（加粗/倾斜/删除线/高亮/代码/数学/注释/清除格式）
    const applySelectionFormat = (left, right) => {
      const range = selectionRange()
      if (range === null) return
      const columnIndexes = selectionColumnIndexes(range)
      const rowIndexes = selectionRowIndexes(range)
      applyEdit((rows) => {
        for (const rowIndex of rowIndexes) {
          const row = rows[rowIndex]
          if (row === undefined) continue
          for (const colIndex of columnIndexes) {
            const value = row[colIndex] === undefined ? '' : String(row[colIndex])
            row[colIndex] = left === '' && right === '' ? stripCellFormatting(value) : left + value + right
          }
        }
        return true
      })
    }
    const applySelectionAlignment = (style) => {
      const range = selectionRange()
      if (range === null) return
      const columnIndexes = selectionColumnIndexes(range)
      applyEdit((rows, separator) => {
        for (const colIndex of columnIndexes) separator[colIndex] = style
        return true
      })
    }
    const clearSelectionCells = () => {
      const range = selectionRange()
      if (range === null) return false
      const columnIndexes = selectionColumnIndexes(range)
      const rowIndexes = selectionRowIndexes(range)
      let applied = false
      applyEdit((rows) => {
        for (const rowIndex of rowIndexes) {
          const row = rows[rowIndex]
          if (row === undefined) continue
          for (const colIndex of columnIndexes) {
            if (row[colIndex] !== undefined) row[colIndex] = ''
          }
        }
        applied = true
        return true
      })
      return applied
    }
    // 粘贴到选区：剪贴板有 HTML 表格时按矩阵写入，否则把纯文本写进左上角单元格。
    const pasteIntoSelection = async () => {
      const range = selectionRange()
      if (range === null) return
      const startRow = range.kind === 'cell' ? range.rowStart : range.kind === 'row' ? range.start : 0
      const startCol = range.kind === 'cell' ? range.colStart : range.kind === 'row' ? 0 : range.start
      try {
        if (navigator.clipboard !== undefined && typeof navigator.clipboard.read === 'function') {
          const items = await navigator.clipboard.read()
          for (const item of items) {
            if (item.types.includes('text/html')) {
              const html = await (await item.getType('text/html')).text()
              const table = parseClipboardTableHtml(html)
              if (table !== null) {
                writeMatrixAt(startRow, startCol, table)
                return
              }
            }
          }
          const plain = await navigator.clipboard.readText()
          if (plain !== '') {
            applyEdit((rows) => {
              while (startRow >= rows.length) rows.push(new Array((rows[0] ?? []).length).fill(''))
              const row = rows[startRow]
              if (row === undefined) return false
              while (row.length <= startCol) row.push('')
              row[startCol] = plain
              return true
            })
          }
        }
      } catch {}
    }
    const showSelectionMenu = (clientX, clientY) => {
      const menu = document.createElement('div')
      menu.className = 'gh-md-cm6-table-menu'
      menu.style.left = clientX + 'px'
      menu.style.top = clientY + 'px'
      const closeMenu = () => {
        menu.remove()
        document.removeEventListener('mousedown', onOutside, true)
        document.removeEventListener('keydown', onKey, true)
      }
      const makeButton = (label, action) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = label
        button.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          closeMenu()
          action()
        })
        return button
      }
      const appendSubmenu = (label, items) => {
        const group = document.createElement('div')
        group.className = 'gh-md-cm6-table-menu-group'
        const head = document.createElement('div')
        head.className = 'gh-md-cm6-table-menu-label'
        const headText = document.createElement('span')
        headText.className = 'gh-md-cm6-table-menu-label-text'
        headText.textContent = label
        head.appendChild(headText)
        const arrow = document.createElement('span')
        arrow.className = 'gh-md-cm6-table-menu-arrow'
        arrow.textContent = '›'
        head.appendChild(arrow)
        const submenu = document.createElement('div')
        submenu.className = 'gh-md-cm6-table-submenu'
        for (const [itemLabel, action] of items) submenu.appendChild(makeButton(itemLabel, action))
        group.appendChild(head)
        group.appendChild(submenu)
        menu.appendChild(group)
      }
      menu.appendChild(makeButton('剪切', () => cutSelection()))
      menu.appendChild(makeButton('复制', () => copySelection('markdown')))
      menu.appendChild(makeButton('粘贴', () => { pasteIntoSelection() }))
      appendSubmenu('文本格式', [
        ['加粗', () => applySelectionFormat('**', '**')],
        ['倾斜', () => applySelectionFormat('*', '*')],
        ['删除线', () => applySelectionFormat('~~', '~~')],
        ['高亮', () => applySelectionFormat('==', '==')],
        ['代码', () => applySelectionFormat('`', '`')],
        ['数学', () => applySelectionFormat('$', '$')],
        ['注释', () => applySelectionFormat('%%', '%%')],
        ['清除格式', () => applySelectionFormat('', '')],
      ])
      menu.appendChild(makeButton('左对齐', () => applySelectionAlignment('---')))
      menu.appendChild(makeButton('居中对齐', () => applySelectionAlignment(':---:')))
      menu.appendChild(makeButton('右对齐', () => applySelectionAlignment('---:')))
      menu.appendChild(makeButton('清空选中的单元格', () => clearSelectionCells()))
      menu.appendChild(makeButton('删除选中的单元格', () => deleteSelection()))
      const onOutside = (event) => {
        if (!menu.contains(event.target)) closeMenu()
      }
      const onKey = (event) => {
        if (event.key === 'Escape') closeMenu()
      }
      document.addEventListener('mousedown', onOutside, true)
      document.addEventListener('keydown', onKey, true)
      document.body.appendChild(menu)
      try {
        const rect = menu.getBoundingClientRect()
        if (rect.right > window.innerWidth - 8) menu.style.left = Math.max(8, window.innerWidth - rect.width - 8) + 'px'
        if (rect.bottom > window.innerHeight - 8) menu.style.top = Math.max(8, window.innerHeight - rect.height - 8) + 'px'
      } catch {}
    }
    const showMenu = (clientX, clientY, rowIndex, cellIndex) => {
      const view = this.host.view
      if (view === null) return
      const doc = view.state.doc
      const block = parseTableBlock(doc, this.tableFrom, this.tableTo)
      if (block.rows.length === 0) return
      const cols = block.rows[0].length
      const separatorCells = block.separatorIndex >= 0 ? parseCells(block.lines[block.separatorIndex].text) : new Array(cols).fill('---')
      while (separatorCells.length < cols) separatorCells.push('---')
      const apply = (mutate) => applyEdit(mutate)
      // 移动行/列、复制、排序都走 applyEdit，和拖拽排序共用同一套提交路径。
      const moveRow = (index, delta) => apply((rows) => {
        const target = index + delta
        if (index <= 0 || target <= 0 || target >= rows.length) return false
        const moved = rows.splice(index, 1)[0]
        rows.splice(target, 0, moved)
        return true
      })
      const moveColumn = (index, delta) => apply((rows, sep) => {
        const target = index + delta
        if (target < 0 || target >= cols) return false
        for (const row of rows) {
          const moved = row.splice(index, 1)[0]
          row.splice(target, 0, moved === undefined ? '' : moved)
        }
        const movedSeparator = sep.splice(index, 1)[0]
        sep.splice(target, 0, movedSeparator === undefined ? '---' : movedSeparator)
        return true
      })
      // 按列排序：保留表头行，其余行按该列文本升序/降序（数字优先按数值比较）。
      const sortByColumn = (index, descending) => apply((rows) => {
        if (rows.length <= 2) return false
        const header = rows[0]
        const body = rows.slice(1)
        const sorted = body.slice().sort((left, right) => {
          const a = left[index] === undefined ? '' : String(left[index])
          const b = right[index] === undefined ? '' : String(right[index])
          const result = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
          return descending === true ? -result : result
        })
        rows.splice(0, rows.length, header, ...sorted)
        return true
      })
      // 「复制行 / 复制列」复用选区复制通道，复制完把选区恢复原样。
      const copyRowAt = (index) => {
        const previous = selection
        selection = { kind: 'row', anchor: index, focus: index }
        copySelection('markdown')
        selection = previous
        paintSelection()
      }
      const copyColumnAt = (index) => {
        const previous = selection
        selection = { kind: 'col', anchor: index, focus: index }
        copySelection('markdown')
        selection = previous
        paintSelection()
      }
      const rowItems = [
        ['在上方新增行', () => apply((rows) => { rows.splice(Math.max(1, rowIndex), 0, new Array(cols).fill('')) })],
        ['在下方新增行', () => apply((rows) => { rows.splice(Math.min(rows.length, rowIndex + 1), 0, new Array(cols).fill('')) })],
        ['向上移动行', () => moveRow(rowIndex, -1)],
        ['向下移动行', () => moveRow(rowIndex, 1)],
        ['复制行', () => copyRowAt(rowIndex)],
        ['删除行', () => apply((rows) => { if (rows.length <= 1) return false; rows.splice(Math.min(rowIndex, rows.length - 1), 1) })],
      ]
      const columnItems = [
        ['在左侧新增列', () => apply((rows, sep) => { for (const row of rows) row.splice(cellIndex, 0, ''); sep.splice(cellIndex, 0, '---') })],
        ['在右侧新增列', () => apply((rows, sep) => { for (const row of rows) row.splice(cellIndex + 1, 0, ''); sep.splice(cellIndex + 1, 0, '---') })],
        ['向左移动列', () => moveColumn(cellIndex, -1)],
        ['向右移动列', () => moveColumn(cellIndex, 1)],
        ['左对齐', () => apply((rows, sep) => { sep[cellIndex] = '---' })],
        ['居中对齐', () => apply((rows, sep) => { sep[cellIndex] = ':---:' })],
        ['右对齐', () => apply((rows, sep) => { sep[cellIndex] = '---:' })],
        ['复制列', () => copyColumnAt(cellIndex)],
        ['删除列', () => apply((rows, sep) => { if (cols <= 1) return false; for (const row of rows) row.splice(cellIndex, 1); sep.splice(cellIndex, 1) })],
      ]
      const menu = document.createElement('div')
      menu.className = 'gh-md-cm6-table-menu'
      menu.style.left = clientX + 'px'
      menu.style.top = clientY + 'px'
      const closeMenu = () => {
        menu.remove()
        document.removeEventListener('mousedown', onOutside, true)
        document.removeEventListener('keydown', onKey, true)
      }
      const makeButton = (label, action) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = label
        button.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          closeMenu()
          action()
        })
        return button
      }
      const appendSubmenu = (label, items) => {
        const group = document.createElement('div')
        group.className = 'gh-md-cm6-table-menu-group'
        const head = document.createElement('div')
        head.className = 'gh-md-cm6-table-menu-label'
        const headText = document.createElement('span')
        headText.className = 'gh-md-cm6-table-menu-label-text'
        headText.textContent = label
        head.appendChild(headText)
        const arrow = document.createElement('span')
        arrow.className = 'gh-md-cm6-table-menu-arrow'
        arrow.textContent = '›'
        head.appendChild(arrow)
        const submenu = document.createElement('div')
        submenu.className = 'gh-md-cm6-table-submenu'
        for (const [itemLabel, action] of items) submenu.appendChild(makeButton(itemLabel, action))
        group.appendChild(head)
        group.appendChild(submenu)
        menu.appendChild(group)
      }
      appendSubmenu('行', rowItems)
      appendSubmenu('列', columnItems)
      const separatorRow = document.createElement('div')
      separatorRow.className = 'gh-md-cm6-table-menu-separator'
      menu.appendChild(separatorRow)
      menu.appendChild(makeButton('按列升序 (A-Z)', () => sortByColumn(cellIndex, false)))
      menu.appendChild(makeButton('按列降序 (Z-A)', () => sortByColumn(cellIndex, true)))
      const onOutside = (event) => {
        if (!menu.contains(event.target)) closeMenu()
      }
      const onKey = (event) => {
        if (event.key === 'Escape') closeMenu()
      }
      document.addEventListener('mousedown', onOutside, true)
      document.addEventListener('keydown', onKey, true)
      document.body.appendChild(menu)
      // 菜单/子菜单贴到窗口边缘时回退到可视区域内
      try {
        const rect = menu.getBoundingClientRect()
        if (rect.right > window.innerWidth - 8) menu.style.left = Math.max(8, window.innerWidth - rect.width - 8) + 'px'
        if (rect.bottom > window.innerHeight - 8) menu.style.top = Math.max(8, window.innerHeight - rect.height - 8) + 'px'
      } catch {}
    }
    wrapper.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return
      const target = event.target
      if (target === null || typeof target.closest !== 'function') return
      const cell = target.closest('th,td')
      if (cell === null) return
      event.preventDefault()
      event.stopPropagation()
      const cells = Array.from(wrapper.querySelectorAll('th,td'))
      const index = cells.indexOf(cell)
      if (index < 0) return
      const next = cells[index + (event.shiftKey === true ? -1 : 1)]
      if (next === undefined) return
      next.focus()
      const selection = window.getSelection()
      if (selection !== null) {
        const range = document.createRange()
        range.selectNodeContents(next)
        range.collapse(false)
        selection.removeAllRanges()
        selection.addRange(range)
      }
    })
    wrapper.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      const target = event.target
      if (target === null || typeof target.closest !== 'function') return
      const cellNode = target.closest('td,th')
      if (cellNode === null) return
      // 有选区时（单元格矩形/整行/整列）显示 Obsidian 的选区菜单；否则显示行/列/排序菜单。
      if (selection !== null) {
        showSelectionMenu(event.clientX, event.clientY)
        return
      }
      showMenu(event.clientX, event.clientY, Number(cellNode.dataset.row), Number(cellNode.dataset.cell))
    })
    wrapper.addEventListener('keydown', (event) => {
      const target = event.target
      if (target === null || typeof target.closest !== 'function') return
      const cellNode = target.closest('td,th')
      if (cellNode === null) return
      // 单元格内的方向键：Shift+上下跨格扩展；Shift+左右在文本首尾越界扩展（Obsidian 行为）。
      if (event.shiftKey === true && ARROW_DELTAS[event.key] !== undefined) {
        const rowIndex = Number(cellNode.dataset.row)
        const colIndex = Number(cellNode.dataset.cell)
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const delta = ARROW_DELTAS[event.key][0]
          const next = clampCell(rowIndex + delta, colIndex)
          if (next.row !== rowIndex) {
            event.preventDefault()
            event.stopPropagation()
            const anchor = cellAnchor === null ? { row: rowIndex, col: colIndex } : cellAnchor
            applyCellSelection(anchor.row, anchor.col, next.row, next.col)
          }
          return
        }
        const textLength = String(cellNode.textContent ?? '').length
        const offset = caretOffsetInCell(cellNode)
        if (offset === null) return
        const leavingRight = event.key === 'ArrowRight' && offset >= textLength
        const leavingLeft = event.key === 'ArrowLeft' && offset === 0
        if (!leavingRight && !leavingLeft) return
        const delta = ARROW_DELTAS[event.key][1]
        const next = clampCell(rowIndex, colIndex + delta)
        if (next.col !== colIndex) {
          event.preventDefault()
          event.stopPropagation()
          const anchor = cellAnchor === null ? { row: rowIndex, col: colIndex } : cellAnchor
          applyCellSelection(anchor.row, anchor.col, next.row, next.col)
        }
        return
      }
      const allCells = Array.from(wrapper.querySelectorAll('td,th'))
      const index = allCells.indexOf(cellNode)
      if (event.key === 'Tab') {
        event.preventDefault()
        const next = allCells[index + (event.shiftKey ? -1 : 1)]
        if (next !== undefined) {
          next.focus()
          const selection = window.getSelection()
          if (selection !== null) {
            const range = document.createRange()
            range.selectNodeContents(next)
            range.collapse(false)
            selection.removeAllRanges()
            selection.addRange(range)
          }
        }
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const view = this.host.view
        if (view === null) return
        const doc = view.state.doc
        const cols = this.rows[0].length
        const rowIndex = Number(cellNode.dataset.row)
        if (rowIndex + 1 < this.rows.length) {
          const below = wrapper.querySelector('td[data-row="' + (rowIndex + 1) + '"][data-cell="' + cellNode.dataset.cell + '"]')
          if (below !== null) below.focus()
          return
        }
        const insertAt = this.tableTo
        const newRow = '\n|' + '  |'.repeat(cols)
        view.dispatch({ changes: { from: insertAt, insert: newRow } })
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        const view = this.host.view
        if (view === null) return
        const doc = view.state.doc
        const line = doc.lineAt(Math.min(this.tableTo, doc.length))
        view.dispatch({ selection: { anchor: Math.min(line.to + 1, doc.length) } })
        cellNode.blur()
      }
    })
    return wrapper
  }

  updateDOM(dom, view, from, to) {
    this.tableFrom = from
    this.tableTo = to
    this.rows = parseTableRowsFromDoc(view.state.doc, from, to)
    const lines = []
    for (let n = view.state.doc.lineAt(from).number; n <= view.state.doc.lineAt(Math.max(from, Math.min(to - 1, view.state.doc.length))).number; n += 1) lines.push(view.state.doc.line(n).text)
    this.alignments = parseAlignmentsFromLines(lines)
    const cells = dom.querySelectorAll('td,th')
    let index = 0
    for (const row of this.rows) {
      for (const cell of row) {
        const node = cells[index]
        index += 1
        if (node === undefined) continue
        if (document.activeElement !== node) {
          node.dataset.raw = cell.text
          if (this.host.renderInline !== undefined) {
            const html = this.host.renderInline(cell.text)
            if (typeof html === 'string') node.innerHTML = html
            else node.textContent = cell.text
          } else {
            node.textContent = cell.text
          }
        }
        node.style.textAlign = displayAlignment(this.alignments[index % Math.max(1, this.rows[0]?.length ?? 1)])
      }
    }
    return true
  }

  ignoreEvent() {
    return true
  }
}

class FootnoteRefWidget extends WidgetType {
  constructor(label) {
    super()
    this.label = label
  }

  eq(other) {
    return other.label === this.label
  }

  toDOM() {
    const sup = document.createElement('sup')
    sup.className = 'gh-md-cm6-fnref'
    sup.textContent = this.label
    return sup
  }

  ignoreEvent() {
    return true
  }
}

class TagWidget extends WidgetType {
  constructor(tag) {
    super()
    this.tag = tag
  }

  eq(other) {
    return other.tag === this.tag
  }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'gh-md-lp-tag'
    span.textContent = this.tag
    return span
  }

  ignoreEvent() {
    return true
  }
}

class OrderedWidget extends WidgetType {
  constructor(text, folded, position) {
    super()
    this.text = text
    this.folded = folded
    this.position = position
  }

  eq(other) {
    return other.text === this.text && other.folded === this.folded && other.position === this.position
  }

  toDOM() {
    const wrap = document.createElement('span')
    wrap.className = 'gh-md-lp-ol-wrap' + (this.folded ? ' is-folded' : '')
    const chevron = document.createElement('span')
    chevron.className = 'gh-md-cm6-fold-chevron' + (this.folded ? ' is-folded' : '')
    appendChevronIcon(chevron)
    chevron.setAttribute('contenteditable', 'false')
    chevron.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
    })
    chevron.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const view = activeHost === null ? null : activeHost.view
      if (view === null || view === undefined) return
      view.dispatch({ effects: toggleFoldEffect.of(this.position) })
    })
    const label = document.createElement('span')
    label.className = 'gh-md-lp-ol'
    label.textContent = this.text
    wrap.appendChild(chevron)
    wrap.appendChild(label)
    return wrap
  }

  ignoreEvent() {
    return true
  }
}

class HrWidget extends WidgetType {
  eq() {
    return true
  }

  toDOM() {
    const rule = document.createElement('hr')
    rule.className = 'gh-md-cm6-hr'
    return rule
  }

  ignoreEvent() {
    return true
  }
}

class MathWidget extends WidgetType {
  constructor(html, display) {
    super()
    this.html = html
    this.display = display
  }

  eq(other) {
    return other.html === this.html && other.display === this.display
  }

  toDOM() {
    const node = document.createElement(this.display ? 'div' : 'span')
    node.className = this.display ? 'gh-md-cm6-math gh-md-cm6-math-block' : 'gh-md-cm6-math'
    node.innerHTML = this.html
    return node
  }

  ignoreEvent() {
    return false
  }
}


class EmbedWidget extends WidgetType {
  constructor(target, host) {
    super()
    this.target = target
    this.host = host
  }

  eq(other) {
    return other.target === this.target
  }

  toDOM() {
    const box = document.createElement('div')
    box.className = 'gh-md-cm6-embed'
    box.dataset.target = this.target
    const placeholder = document.createElement('div')
    placeholder.className = 'gh-md-cm6-embed-placeholder'
    placeholder.textContent = '嵌入：' + this.target
    box.appendChild(placeholder)
    if (this.host !== null && typeof this.host.resolveEmbed === 'function') {
      try {
        this.host.resolveEmbed(this.target, box)
      } catch {}
    }
    box.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
    })
    box.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const target = this.target
      if (target === '') return
      try {
        if (typeof navigator === 'object' && navigator !== null && navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
          void navigator.clipboard.writeText(target)
        }
      } catch {}
      window.__ghMdOpenLink?.(target, false)
    })
    return box
  }

  ignoreEvent() {
    return true
  }
}

class FrontmatterWidget extends WidgetType {
  constructor(rows, lineNumbers) {
    super()
    this.rows = rows
    this.lineNumbers = Array.isArray(lineNumbers) ? lineNumbers : []
  }

  eq(other) {
    return JSON.stringify(other.rows) === JSON.stringify(this.rows)
  }

  toDOM() {
    const card = document.createElement('div')
    card.className = 'gh-md-cm6-frontmatter'
    const title = document.createElement('div')
    title.className = 'gh-md-cm6-frontmatter-title'
    title.textContent = '属性'
    card.appendChild(title)
    for (let rowIndex = 0; rowIndex < this.rows.length; rowIndex += 1) {
      const row = this.rows[rowIndex]
      const line = document.createElement('div')
      line.className = 'gh-md-cm6-frontmatter-row'
      line.dataset.row = String(rowIndex)
      line.addEventListener('mousedown', (event) => {
        event.preventDefault()
        event.stopPropagation()
      })
      line.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        const view = activeHost === null ? null : activeHost.view
        if (view === null || view === undefined) return
        const lineNumber = this.lineNumbers[rowIndex]
        if (typeof lineNumber !== 'number') return
        const target = Math.min(Math.max(lineNumber, 1), view.state.doc.lines)
        const info = view.state.doc.line(target)
        view.dispatch({ selection: { anchor: info.to } })
        view.focus()
      })
      const key = document.createElement('span')
      key.className = 'gh-md-cm6-frontmatter-key'
      key.textContent = row.key
      const value = document.createElement('span')
      value.className = 'gh-md-cm6-frontmatter-value'
      const isTagsRow = row.key === 'tags' || row.key === 'tag'
      if (isTagsRow) {
        const tags = row.value.replace(/^\[/u, '').replace(/\]$/u, '').split(',').map((item) => item.trim()).filter((item) => item !== '')
        if (tags.length === 0) value.textContent = row.value
        for (const tag of tags) {
          const pill = document.createElement('span')
          pill.className = 'gh-md-cm6-frontmatter-pill'
          pill.textContent = tag
          value.appendChild(pill)
        }
      } else {
        value.textContent = row.value
      }
      line.appendChild(key)
      line.appendChild(value)
      card.appendChild(line)
    }
    return card
  }

  ignoreEvent() {
    return false
  }
}

const CALLOUT_META = {
  note: { icon: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>', tone: 'note' },
  info: { icon: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>', tone: 'info' },
  tip: { icon: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>', tone: 'tip' },
  success: { icon: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>', tone: 'success' },
  question: { icon: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>', tone: 'question' },
  warning: { icon: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>', tone: 'warning' },
  failure: { icon: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>', tone: 'failure' },
  danger: { icon: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>', tone: 'danger' },
  bug: { icon: '<rect x="8" y="6" width="8" height="14" rx="4"/><path d="m19 7-3 2"/><path d="m5 7 3 2"/><path d="m19 16-3-2"/><path d="m5 16 3-2"/><path d="M12 2v4"/>', tone: 'bug' },
  example: { icon: '<path d="M10 2v7.31l-5.5 9.5A2 2 0 0 0 6.18 22h11.64a2 2 0 0 0 1.68-3.19L14 9.31V2"/><path d="M8.5 2h7"/>', tone: 'example' },
  quote: { icon: '<path d="M17 6H3"/><path d="M21 12H8"/><path d="M21 18H8"/>', tone: 'quote' },
  abstract: { icon: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>', tone: 'abstract' },
  todo: { icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m9 12 2 2 4-4"/>', tone: 'todo' },
}

class CalloutWidget extends WidgetType {
  constructor(type, title, body, host, fold) {
    super()
    this.type = type
    this.title = title
    this.body = body
    this.host = host
    this.fold = fold === '-' || fold === '+' ? fold : ''
  }

  eq(other) {
    return other.type === this.type && other.title === this.title && other.body === this.body && other.fold === this.fold
  }

  toDOM() {
    const meta = CALLOUT_META[this.type] ?? CALLOUT_META.note
    const box = document.createElement('div')
    box.className = 'gh-md-cm6-callout'
    box.dataset.tone = meta.tone
    const head = document.createElement('div')
    head.className = 'gh-md-cm6-callout-title'
    const icon = document.createElement('span')
    icon.className = 'gh-md-cm6-callout-icon'
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + meta.icon + '</svg>'
    const title = document.createElement('span')
    title.textContent = this.title === '' ? this.type : this.title
    const chevron = document.createElement('span')
    chevron.className = 'gh-md-cm6-callout-chevron' + (this.fold === '-' ? ' is-folded' : '')
    appendChevronIcon(chevron)
    head.appendChild(icon)
    head.appendChild(title)
    if (this.fold !== '') {
      head.appendChild(chevron)
      head.style.cursor = 'pointer'
    }
    box.appendChild(head)
    if (this.body !== '') {
      const body = document.createElement('div')
      body.className = 'gh-md-cm6-callout-body'
      let attempts = 0
      const renderBody = () => {
        const renderBlocks = this.host === null || this.host === undefined ? undefined : this.host.renderBlocks
        if (typeof renderBlocks === 'function') {
          const html = renderBlocks(this.body)
          if (typeof html === 'string') {
            body.innerHTML = html
            // callout 正文走只读渲染器，图片嵌入会残留成字面量：这里就地替换成 <img>
            const resolveImage = this.host === null || this.host === undefined ? undefined : this.host.resolveImage
            if (typeof resolveImage === 'function') {
              const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
              const textNodes = []
              while (walker.nextNode()) textNodes.push(walker.currentNode)
              for (const node of textNodes) {
                const match = /!\[\[([^\]|]+)(?:\|(\d+))?\]\]/u.exec(node.nodeValue ?? '')
                if (match === null) continue
                const src = resolveImage(match[1].trim())
                if (typeof src !== 'string' || src === '') continue
                const image = document.createElement('img')
                image.setAttribute('src', src)
                image.setAttribute('alt', match[1].trim())
                if (typeof match[2] === 'string') image.style.width = match[2] + 'px'
                // 不要因为点击图片而把 callout 切成源码态，否则第二次点击就点空了
                image.addEventListener('mousedown', (event) => {
                  event.preventDefault()
                  event.stopPropagation()
                })
                image.addEventListener('click', (event) => {
                  event.stopPropagation()
                })
                if (node.parentNode !== null) node.parentNode.replaceChild(image, node)
              }
            }
            return true
          }
          if (attempts < 10) return false
        }
        const renderInline = this.host === null || this.host === undefined ? undefined : this.host.renderInline
        if (typeof renderInline !== 'function') return false
        let pending = false
        const parts = this.body.split('\n').map((line) => {
          const html = renderInline(line)
          if (typeof html !== 'string') {
            pending = true
            return line
          }
          return html
        })
        body.innerHTML = parts.join('<br>')
        return !pending
      }
      const kick = () => {
        if (renderBody()) return
        attempts += 1
        if (attempts <= 10) window.setTimeout(kick, 300)
      }
      kick()
      if (this.fold === '-') body.style.display = 'none'
      if (this.fold !== '') {
        head.addEventListener('mousedown', (event) => {
          event.preventDefault()
          event.stopPropagation()
        })
        head.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          const collapsed = body.style.display === 'none'
          body.style.display = collapsed ? '' : 'none'
          chevron.textContent = collapsed ? '▾' : '▸'
        })
      }
      box.appendChild(body)
    }
    return box
  }

  ignoreEvent() {
    return false
  }
}

function parseTableRows(lines) {
  const rows = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (/^\|?\s*:?-{2,}/u.test(trimmed)) continue
    const cells = trimmed.replace(/^\|/u, '').replace(/\|$/u, '').split('|').map((cell) => cell.trim())
    rows.push(cells)
  }
  return rows
}

function buildDecorations(state, resolveImage, renderMath, host) {
  const startedAt = typeof performance === 'object' && performance !== null ? performance.now() : 0
  const doc = state.doc
  const activeLines = new Set()
  if (editorFocused) {
    for (const range of state.selection.ranges) {
      const from = doc.lineAt(range.from).number
      const to = doc.lineAt(range.to).number
      for (let n = from; n <= to; n += 1) activeLines.add(n)
    }
  }
  const collected = []
  const ranges = {
    on: true,
    push(range) {
      if (this.on) collected.push(range)
    },
  }
  let skippingFence = false
  let orderedCount = 0
  let orderedPrev = false
  let orderedDepthPrev = -1
  let line = 1
  while (line <= doc.lines) {
    const lineInfo = doc.line(line)
    const text = lineInfo.text
    const isActive = activeLines.has(line)
    const inWindow = line >= decorateWindow.fromLine && line <= decorateWindow.toLine
    if (!inWindow) {
      // 窗口外：只维护代码围栏状态，其余行直接跳过，避免大文档每次重建都做全量正则匹配
      if (skippingFence) {
        if (/^\s*(?:```|~~~)/u.test(text)) skippingFence = false
        line += 1
        continue
      }
      if (/^\s*(?:```|~~~)/u.test(text)) {
        skippingFence = true
        line += 1
        continue
      }
      line += 1
      continue
    }
    ranges.on = true

    // frontmatter（文档开头 --- ... ---）
    if (line === 1 && text.trim() === '---') {
      let endLine = 0
      for (let n = 2; n <= doc.lines; n += 1) {
        if (doc.line(n).text.trim() === '---' || doc.line(n).text.trim() === '...') {
          endLine = n
          break
        }
      }
      if (endLine > 0) {
        let blockActive = false
        for (let n = line; n <= endLine; n += 1) if (activeLines.has(n)) { blockActive = true; break }
        if (!blockActive) {
          const rows = []
          const rowLines = []
          for (let n = 2; n < endLine; n += 1) {
            const rawLine = doc.line(n).text
            const keyMatch = /^([\w-]+):\s*(.*)$/u.exec(rawLine)
            rows.push(keyMatch === null ? { key: '', value: rawLine } : { key: keyMatch[1], value: keyMatch[2] })
            rowLines.push(n)
          }
          ranges.push(Decoration.replace({ block: true, widget: new FrontmatterWidget(rows, rowLines) }).range(doc.line(line).from, doc.line(endLine).to))
          line = endLine + 1
          continue
        }
        // 活跃：两端 --- 淡化，中间保持源码
        ranges.push(styleMark('gh-md-lp-syntax').range(lineInfo.from, lineInfo.from + text.length))
        const endInfo = doc.line(endLine)
        ranges.push(styleMark('gh-md-lp-syntax').range(endInfo.from, endInfo.from + endInfo.text.length))
        line = endLine + 1
        continue
      }
    }

    // callout（> [!type] 标题 + 后续 > 行）
    const callout = /^>\s*\[!([\w-]+)\]([+-]?)\s*(.*)$/u.exec(text)
    if (callout !== null) {
      let endLine = line
      while (endLine + 1 <= doc.lines && /^>/u.test(doc.line(endLine + 1).text)) endLine += 1
      let blockActive = false
      for (let n = line; n <= endLine; n += 1) if (activeLines.has(n)) { blockActive = true; break }
      if (!blockActive) {
        const bodyLines = []
        for (let n = line + 1; n <= endLine; n += 1) {
          bodyLines.push(doc.line(n).text.replace(/^>\s?/u, ''))
        }
        ranges.push(Decoration.replace({ block: true, widget: new CalloutWidget(callout[1].toLowerCase(), callout[3], bodyLines.join('\n').trim(), host, callout[2] ?? '') }).range(doc.line(line).from, doc.line(endLine).to))
        line = endLine + 1
        continue
      }
    }

    // 块数学 $$...$$
    if (/^\s*\$\$\s*$/u.test(text)) {
      let endLine = line
      for (let n = line + 1; n <= doc.lines; n += 1) {
        if (/^\s*\$\$\s*$/u.test(doc.line(n).text)) {
          endLine = n
          break
        }
      }
      const texLines = []
      for (let n = line + 1; n < endLine; n += 1) texLines.push(doc.line(n).text)
      let blockActive = false
      for (let n = line; n <= endLine; n += 1) if (activeLines.has(n)) { blockActive = true; break }
      if (!blockActive && endLine > line) {
        const html = typeof renderMath === 'function' ? renderMath(texLines.join('\n'), true) : undefined
        if (typeof html === 'string') {
          ranges.push(Decoration.replace({ block: true, widget: new MathWidget(html, true) }).range(doc.line(line).from, doc.line(endLine).to))
          line = endLine + 1
          continue
        }
      }
      ranges.push(styleMark('gh-md-lp-syntax').range(lineInfo.from, lineInfo.from + text.length))
      if (endLine > line) {
        const endInfo = doc.line(endLine)
        ranges.push(styleMark('gh-md-lp-syntax').range(endInfo.from, endInfo.from + endInfo.text.length))
      }
      line = endLine + 1
      continue
    }

    // 围栏代码块：非活跃整块替换成 widget；活跃时围栏行淡化、内容保持原文
    const fence = /^\s*(```+|~~~+)\s*([\w-]*)/u.exec(text)
    if (fence !== null) {
      let endLine = line
      for (let n = line + 1; n <= doc.lines; n += 1) {
        if (/^\s*(```+|~~~+)\s*$/u.test(doc.line(n).text)) {
          endLine = n
          break
        }
      }
      const blockLines = []
      for (let n = line + 1; n < endLine; n += 1) blockLines.push(doc.line(n).text)
      let blockActive = false
      for (let n = line; n <= endLine; n += 1) if (activeLines.has(n)) { blockActive = true; break }
      if (!blockActive && endLine > line) {
        const codeText = blockLines.join('\n')
        const codeLang = fence[2] ?? ''
        const codeHtml = typeof host.renderCode === 'function' ? host.renderCode(codeText, codeLang) : undefined
        ranges.push(Decoration.replace({ block: true, widget: new CodeBlockWidget(codeText, codeLang, codeHtml) }).range(doc.line(line).from, doc.line(endLine).to))
        line = endLine + 1
        continue
      }
      ranges.push(styleMark('gh-md-lp-syntax').range(lineInfo.from, lineInfo.from + text.length))
      if (endLine > line) {
        const endInfo = doc.line(endLine)
        ranges.push(styleMark('gh-md-lp-syntax').range(endInfo.from, endInfo.from + endInfo.text.length))
      }
      line = endLine + 1
      continue
    }

    // 表格：始终渲染成可编辑表格 widget（Obsidian LP 行为）
    if (/^\s*\|/u.test(text) && line < doc.lines) {
      let endLine = line
      while (endLine + 1 <= doc.lines && /^\s*\|/u.test(doc.line(endLine + 1).text)) endLine += 1
      const tableRows = []
      for (let n = line; n <= endLine; n += 1) {
        const info = doc.line(n)
        if (/^\s*\|?\s*:?-{2,}/u.test(info.text.trim())) continue
        const raw = info.text
        const segments = splitTableSegments(raw)
        let segs = segments
        if (segs.length > 0 && raw.slice(segs[0].start, segs[0].end).trim() === '' && /^\s*\|/u.test(raw)) segs = segs.slice(1)
        if (segs.length > 0 && raw.slice(segs[segs.length - 1].start, segs[segs.length - 1].end).trim() === '' && /\|\s*$/u.test(raw)) segs = segs.slice(0, -1)
        tableRows.push(segs.map((seg) => ({ text: raw.slice(seg.start, seg.end).trim() })))
      }
      if (tableRows.length > 0) {
        const tableFrom = doc.line(line).from
        const tableTo = doc.line(endLine).to
        if (tableSourceMode) {
          // 临时源码态：不生成 block widget，让这次编辑作用在纯文本行上。
          line = endLine + 1
          continue
        }
        const tableLines = []
        for (let n = line; n <= endLine; n += 1) tableLines.push(doc.line(n).text)
        const alignments = parseAlignmentsFromLines(tableLines)
        ranges.push(Decoration.replace({ block: true, widget: new TableWidget(tableRows, host, tableFrom, tableTo, alignments) }).range(tableFrom, tableTo))
        line = endLine + 1
        continue
      }
    }

    // 分隔线
    if (/^\s*(?:[-*_]\s*){3,}$/u.test(text)) {
      if (isActive) ranges.push(styleMark('gh-md-lp-syntax').range(lineInfo.from, lineInfo.from + text.length))
      else ranges.push(Decoration.replace({ block: true, widget: new HrWidget() }).range(lineInfo.from, lineInfo.to))
      line += 1
      continue
    }

    // 脚注定义 [^id]: text —— 渲染态把 [^id]: 换成上标编号（与 Obsidian 一致）
    const fndef = /^(\s*)\[\^([^\]]+)\]:\s*/u.exec(text)
    if (fndef !== null) {
      const markerStart = lineInfo.from + fndef[1].length
      const markerEnd = markerStart + ('[^' + fndef[2] + ']:').length
      ranges.push(styleMark('gh-md-lp-fndef').range(lineInfo.from, lineInfo.to))
      if (isActive) {
        ranges.push(styleMark('gh-md-lp-syntax').range(markerStart, Math.min(markerEnd, lineInfo.to)))
      } else {
        ranges.push(Decoration.replace({ widget: new FootnoteRefWidget(fndef[2]) }).range(markerStart, Math.min(markerEnd, lineInfo.to)))
      }
      line += 1
      continue
    }

    // 链接引用定义 [id]: url —— LP 里不显示
    if (/^\s*\[[^\]]+\]:\s+\S+/u.test(text)) {
      if (isActive) ranges.push(styleMark('gh-md-lp-syntax').range(lineInfo.from, lineInfo.to))
      else ranges.push(Decoration.replace({}).range(lineInfo.from, lineInfo.to))
      line += 1
      continue
    }

    // 引用块（> 前缀）：行类 + 标记隐藏/淡化
    let offset = 0
    const quote = /^(\s*(?:>\s?)+)/u.exec(text)
    if (quote !== null) {
      offset = quote[1].length
      const depth = Math.min(3, (quote[1].match(/>/gu) ?? []).length)
      ranges.push(Decoration.line({ class: 'gh-md-lp-quote gh-md-lp-quote-depth-' + depth }).range(lineInfo.from))
      if (isActive) ranges.push(styleMark('gh-md-lp-syntax').range(lineInfo.from, lineInfo.from + offset))
      else ranges.push(Decoration.replace({}).range(lineInfo.from, lineInfo.from + offset))
    }

    // 标题行
    const heading = offset === 0 ? /^(#{1,6})(\s+)/u.exec(text) : null
    if (heading !== null) {
      const folded = state.field(foldStateField, false) ?? []
      const isFolded = folded.includes(lineInfo.from)
      ranges.push(Decoration.line({ class: 'gh-md-lp-h' + heading[1].length }).range(lineInfo.from))
      ranges.push(Decoration.widget({ widget: new FoldChevronWidget(isFolded, lineInfo.from), side: -1 }).range(lineInfo.from))
      if (isActive) ranges.push(styleMark('gh-md-lp-syntax').range(lineInfo.from, lineInfo.from + heading[0].length))
      else ranges.push(Decoration.replace({}).range(lineInfo.from, lineInfo.from + heading[0].length))
      offset = heading[0].length
      if (isFolded) {
        const level = heading[1].length
        let endLine = line + 1
        while (endLine <= doc.lines) {
          const nextHeading = /^(#{1,6})\s+/u.exec(doc.line(endLine).text)
          if (nextHeading !== null && nextHeading[1].length <= level) break
          endLine += 1
        }
        if (endLine > line + 1) {
          const endPosition = doc.line(endLine - 1).to
          ranges.push(Decoration.replace({ block: true, widget: new FoldHiddenWidget() }).range(lineInfo.to, endPosition))
          line = endLine
          continue
        }
      }
    }

    // 有序列表序号：连续块内递增
    const ordered = /^(\s*)(\d+)([.)])(\s+)/u.exec(text)
    if (ordered !== null) {
      const orderedDepth = ordered[1].length
      orderedCount = orderedPrev && orderedDepthPrev === orderedDepth ? orderedCount + 1 : Number(ordered[2])
      orderedPrev = true
      orderedDepthPrev = orderedDepth
      if (!isActive) {
        const label = String(orderedCount) + ordered[3]
        const start = lineInfo.from + ordered[1].length
        const orderedFolded = (state.field(foldStateField, false) ?? []).includes(lineInfo.from)
        ranges.push(Decoration.replace({ widget: new OrderedWidget(label, orderedFolded, lineInfo.from) }).range(start, start + ordered[2].length + 1))
        if (orderedFolded) {
          const indent = ordered[1].length
          let endLine = line + 1
          while (endLine <= doc.lines) {
            const nextText = doc.line(endLine).text
            if (nextText.trim() === '') {
              endLine += 1
              continue
            }
            const nextIndent = (nextText.match(/^\s*/u)?.[0] ?? '').length
            if (nextIndent <= indent) break
            endLine += 1
          }
          let lastLine = endLine - 1
          while (lastLine > line && doc.line(lastLine).text.trim() === '') lastLine -= 1
          if (lastLine > line) {
            ranges.push(Decoration.replace({ block: true, widget: new FoldHiddenWidget() }).range(lineInfo.to, doc.line(lastLine).to))
            line = endLine
            continue
          }
        }
      }
    } else {
      orderedPrev = false
      orderedCount = 0
      orderedDepthPrev = -1
    }

    // 任务复选框（先判定，任务行不再画 bullet）
    const task = /^(\s*)([-*+]|\d+[.)])\s+\[([ xX])\]/u.exec(text)
    if (task !== null && task[3] !== ' ') {
      ranges.push(Decoration.line({ class: 'gh-md-lp-task-done' }).range(lineInfo.from))
    }

    // 列表符号
    const bullet = /^(\s*)([-*+])(\s+)/u.exec(text)
    const foldedList = state.field(foldStateField, false) ?? []
    if (bullet !== null && !isActive && task === null) {
      const isFolded = foldedList.includes(lineInfo.from)
      const start = lineInfo.from + bullet[1].length
      ranges.push(Decoration.replace({ widget: new BulletWidget(isFolded, lineInfo.from) }).range(start, start + 1))
      if (isFolded) {
        const indent = bullet[1].length
        let endLine = line + 1
        while (endLine <= doc.lines) {
          const nextText = doc.line(endLine).text
          if (nextText.trim() === '') {
            endLine += 1
            continue
          }
          const nextIndent = (nextText.match(/^\s*/u)?.[0] ?? '').length
          if (nextIndent <= indent) break
          endLine += 1
        }
        let lastLine = endLine - 1
        while (lastLine > line && doc.line(lastLine).text.trim() === '') lastLine -= 1
        if (lastLine > line) {
          ranges.push(Decoration.replace({ block: true, widget: new FoldHiddenWidget() }).range(lineInfo.to, doc.line(lastLine).to))
          line = endLine
          continue
        }
      }
    }

    // 列表缩进参考线（每 4 空格一层，最多两层）
    // 整行只有一个图片嵌入时，用块级 widget 替换整行（高度=图片高度，不留行距）
    const imageOnly = /^\s*!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]\s*$/u.exec(text) ?? /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/u.exec(text)
    if (imageOnly !== null && !isActive) {
      const isEmbed = text.trim().startsWith('![[')
      const target = isEmbed ? imageOnly[1] : imageOnly[2]
      const sizeText = isEmbed ? imageOnly[2] : undefined
      const imageSize = typeof sizeText === 'string' && /^\d+$/u.test(sizeText.trim()) ? Number.parseInt(sizeText.trim(), 10) : undefined
      // 只有图片扩展名才走图片块；![[笔记]] 仍然走 EmbedWidget
      const isImageTarget = /\.(png|jpe?g|gif|svg|webp|avif|bmp)$/iu.test(target)
      const imageSrc = isImageTarget && typeof host.resolveImage === 'function' ? host.resolveImage(target) : undefined
      if (typeof imageSrc === 'string') {
        ranges.push(Decoration.replace({ block: true, widget: new ImageWidget(imageSrc, target, imageSize) }).range(lineInfo.from, lineInfo.to))
        line += 1
        continue
      }
    }

    const listMatch = task ?? bullet ?? ordered
    if (listMatch !== null) {
      ranges.push(Decoration.line({ class: 'gh-md-lp-li' }).range(lineInfo.from))
      const indentSpaces = listMatch[1].length
      const guideDepth = Math.min(2, Math.floor(indentSpaces / 4))
      if (guideDepth > 0) ranges.push(Decoration.line({ class: 'gh-md-lp-list-guide-' + guideDepth }).range(lineInfo.from))
    }

    if (task !== null && !isActive) {
      // 任务行隐藏列表符号，只留复选框（与 Obsidian 一致）
      const markerEnd = lineInfo.from + task[0].length - 3
      const markerStart = lineInfo.from + task[1].length
      if (markerEnd > markerStart) ranges.push(Decoration.replace({}).range(markerStart, markerEnd))
      const bracketStart = markerEnd
      const taskFoldedSet = state.field(foldStateField, false) ?? []
      const taskFolded = taskFoldedSet.includes(lineInfo.from)
      ranges.push(Decoration.replace({ widget: new TaskWidget(task[3] !== ' ', bracketStart + 1, taskFolded, lineInfo.from) }).range(bracketStart, bracketStart + 3))
      if (taskFolded) {
        const indent = task[1].length
        let endLine = line + 1
        while (endLine <= doc.lines) {
          const nextText = doc.line(endLine).text
          if (nextText.trim() === '') {
            endLine += 1
            continue
          }
          const nextIndent = (nextText.match(/^\s*/u)?.[0] ?? '').length
          if (nextIndent <= indent) break
          endLine += 1
        }
        let lastLine = endLine - 1
        while (lastLine > line && doc.line(lastLine).text.trim() === '') lastLine -= 1
        if (lastLine > line) {
          ranges.push(Decoration.replace({ block: true, widget: new FoldHiddenWidget() }).range(lineInfo.to, doc.line(lastLine).to))
          line = endLine
          continue
        }
      }
    }

    // 行内
    const rest = text.slice(offset)
    INLINE_PATTERN.lastIndex = 0
    let match
    while ((match = INLINE_PATTERN.exec(rest)) !== null) {
      const start = lineInfo.from + offset + match.index
      const token = match[0]
      const marker = (from, to) => {
        if (to <= from) return
        if (isActive) ranges.push(styleMark('gh-md-lp-syntax').range(from, to))
        else ranges.push(Decoration.replace({}).range(from, to))
      }
      if (token.startsWith('![[')) {
        if (isActive) {
          ranges.push(styleMark('gh-md-lp-syntax').range(start, start + token.length))
          continue
        }
        const innerRaw = token.slice(3, token.length - 2)
        const inner = innerRaw.split('|')[0].trim()
        if (inner === '') {
          ranges.push(Decoration.replace({}).range(start, start + token.length))
          continue
        }
        const imageParts = innerRaw.split('|')
        const imageTarget = imageParts[0].trim()
        const imageSize = /^\d+$/u.test((imageParts[1] ?? '').trim()) ? Number((imageParts[1] ?? '').trim()) : undefined
        const isImageEmbed = /\.(png|jpe?g|gif|svg|webp|avif|bmp)$/iu.test(imageTarget)
        const imageSrc = isImageEmbed && typeof host.resolveImage === 'function' ? host.resolveImage(imageTarget) : undefined
        if (typeof imageSrc === 'string') {
          ranges.push(Decoration.replace({ widget: new ImageWidget(imageSrc, imageTarget, imageSize) }).range(start, start + token.length))
        } else {
          ranges.push(Decoration.replace({ widget: new EmbedWidget(inner, host) }).range(start, start + token.length))
        }
        continue
      }
      if (token.startsWith('<!--')) {
        if (!isActive) ranges.push(styleMark('gh-md-lp-syntax').range(start, start + token.length))
        continue
      }
      if (token.startsWith('<')) {
        const tagMatch = /^<([a-zA-Z][a-zA-Z0-9]*)/u.exec(token)
        const tag = tagMatch === null ? '' : tagMatch[1].toLowerCase()
        if (isActive || !INLINE_HTML_TAGS.has(tag)) continue
        const html = typeof host.renderInlineHtml === 'function' ? host.renderInlineHtml(token) : undefined
        if (typeof html === 'string') ranges.push(Decoration.replace({ widget: new InlineHtmlWidget(html) }).range(start, start + token.length))
        else ranges.push(styleMark('gh-md-lp-syntax').range(start, start + token.length))
        continue
      }
      if (token.startsWith('#')) {
        if (isActive) ranges.push(styleMark('gh-md-lp-syntax').range(start, start + token.length))
        else ranges.push(Decoration.replace({ widget: new TagWidget(token) }).range(start, start + token.length))
        continue
      }
      if (token.startsWith('[^')) {
        const label = token.slice(2, token.length - 1)
        if (isActive) {
          ranges.push(styleMark('gh-md-lp-syntax').range(start, start + token.length))
        } else {
          ranges.push(Decoration.replace({ widget: new FootnoteRefWidget(label) }).range(start, start + token.length))
        }
        continue
      }
      if (token.startsWith('==')) {
        marker(start, start + 2)
        ranges.push(styleMark('gh-md-lp-highlight').range(start + 2, start + token.length - 2))
        marker(start + token.length - 2, start + token.length)
        continue
      }
      if (token.startsWith('[[')) {
        if (isActive) {
          ranges.push(styleMark('gh-md-lp-syntax').range(start, start + token.length))
          continue
        }
        const inner = token.slice(2, token.length - 2)
        const pipeIndex = inner.indexOf('|')
        const target = pipeIndex >= 0 ? inner.slice(0, pipeIndex) : inner
        const label = pipeIndex >= 0 ? inner.slice(pipeIndex + 1) : inner
        const labelStart = start + 2 + (pipeIndex >= 0 ? pipeIndex + 1 : 0)
        ranges.push(Decoration.replace({}).range(start, labelStart))
        ranges.push(styleMark('gh-md-lp-link gh-md-lp-wikilink', { 'data-href': target }).range(labelStart, labelStart + label.length))
        ranges.push(Decoration.replace({}).range(labelStart + label.length, start + token.length))
        continue
      }
      if (token.startsWith('![')) {
        const imageMatch = /^!\[([^\]]*)\]\(([^)]*)\)/u.exec(token)
        const resolved = imageMatch !== null && typeof resolveImage === 'function' ? resolveImage(imageMatch[2]) : undefined
        if (!isActive && typeof resolved === 'string') {
          ranges.push(Decoration.replace({ widget: new ImageWidget(resolved, imageMatch[1]) }).range(start, start + token.length))
        } else {
          marker(start, start + token.length)
        }
        continue
      }
      if (token.startsWith('$') && token.length > 2) {
        const tex = token.slice(1, token.length - 1)
        const html = !isActive && typeof renderMath === 'function' ? renderMath(tex, false) : undefined
        if (typeof html === 'string') {
          ranges.push(Decoration.replace({ widget: new MathWidget(html, false) }).range(start, start + token.length))
        } else {
          marker(start, start + token.length)
        }
        continue
      }
      if (token.startsWith('`')) {
        marker(start, start + 1)
        ranges.push(styleMark('gh-md-lp-code').range(start + 1, start + token.length - 1))
        marker(start + token.length - 1, start + token.length)
      } else if (token.startsWith('**') || token.startsWith('__')) {
        marker(start, start + 2)
        ranges.push(styleMark('gh-md-lp-strong').range(start + 2, start + token.length - 2))
        marker(start + token.length - 2, start + token.length)
      } else if (token.startsWith('~~')) {
        marker(start, start + 2)
        ranges.push(styleMark('gh-md-lp-strike').range(start + 2, start + token.length - 2))
        marker(start + token.length - 2, start + token.length)
      } else if (token.startsWith('*') || token.startsWith('_')) {
        marker(start, start + 1)
        ranges.push(styleMark('gh-md-lp-em').range(start + 1, start + token.length - 1))
        marker(start + token.length - 1, start + token.length)
      } else if (token.startsWith('[')) {
        const close = token.indexOf('](')
        const url = token.slice(close + 2, token.length - 1)
        const label = token.slice(1, close)
        marker(start, start + 1)
        let labelStart = start + 1
        let labelEnd = start + close
        // 链接文字本身是行内代码（[`x`](x)）：隐藏反引号，按链接渲染（与 Obsidian 一致）
        if (label.length > 2 && label.startsWith('`') && label.endsWith('`')) {
          marker(labelStart, labelStart + 1)
          marker(labelEnd - 1, labelEnd)
          labelStart += 1
          labelEnd -= 1
        }
        ranges.push(styleMark('gh-md-lp-link', { 'data-href': url }).range(labelStart, labelEnd))
        marker(start + close, start + token.length)
      }
    }
    line += 1
  }
  if (startedAt !== 0) {
    window.__ghMdPerf = { buildMs: performance.now() - startedAt, lines: doc.lines, windowed: decorateWindow.toLine - decorateWindow.fromLine + 1 }
    window.__ghMdBuildMs = window.__ghMdPerf.buildMs
  }
  return Decoration.set(collected, true)
}

const rebuildEffect = StateEffect.define()
const toggleFoldEffect = StateEffect.define()
const restoreFoldEffect = StateEffect.define()

/** 当前需要构建装饰的行范围（按可见范围扩大，滚动时更新）。 */
let decorateWindow = { fromLine: 1, toLine: Number.MAX_SAFE_INTEGER }
/** 编辑器当前是否聚焦：失焦时所有块都渲染（不再显示源码标记）。 */
let editorFocused = true

function setEditorFocused(value) {
  editorFocused = value === true
}

function updateDecorateWindow(view) {
  try {
    const viewport = view.viewport
    if (viewport === undefined || viewport === null) return false
    const first = view.state.doc.lineAt(viewport.from).number
    const last = view.state.doc.lineAt(viewport.to).number
    const fromLine = Math.max(1, first - 200)
    const toLine = Math.min(view.state.doc.lines, last + 200)
    if (fromLine === decorateWindow.fromLine && toLine === decorateWindow.toLine) return false
    decorateWindow = { fromLine, toLine }
    return true
  } catch {
    return false
  }
}

const foldStateField = StateField.define({
  create() {
    return []
  },
  update(value, transaction) {
    let next = value
    if (transaction.docChanged) {
      next = next.map((position) => transaction.changes.mapPos(position, -1))
    }
    for (const effect of transaction.effects) {
      if (effect.is(restoreFoldEffect)) {
        const lines = Array.isArray(effect.value) ? effect.value : []
        next = lines
          .map((lineNumber) => Math.min(Math.max(Number(lineNumber) || 1, 1), transaction.state.doc.lines))
          .map((lineNumber) => transaction.state.doc.line(lineNumber).from)
        continue
      }
      if (!effect.is(toggleFoldEffect)) continue
      const position = effect.value
      next = next.includes(position) ? next.filter((item) => item !== position) : [...next, position]
    }
    return next
  },
})

class FoldHiddenWidget extends WidgetType {
  eq() {
    return true
  }

  toDOM() {
    const node = document.createElement('div')
    node.className = 'gh-md-cm6-fold-hidden'
    node.setAttribute('aria-hidden', 'true')
    return node
  }

  ignoreEvent() {
    return true
  }
}

class FoldChevronWidget extends WidgetType {
  constructor(folded, position) {
    super()
    this.folded = folded
    this.position = position
  }

  eq(other) {
    return other.folded === this.folded && other.position === this.position
  }

  toDOM() {
    const node = document.createElement('span')
    node.className = 'gh-md-cm6-fold-chevron' + (this.folded ? ' is-folded' : '')
    appendChevronIcon(node)
    node.setAttribute('contenteditable', 'false')
    node.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
    })
    node.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const view = activeHost === null ? null : activeHost.view
      if (view === null || view === undefined) return
      view.dispatch({ effects: toggleFoldEffect.of(this.position) })
    })
    return node
  }

  ignoreEvent() {
    return true
  }
}

/** 折叠箭头统一为 16×16 的圆角描边 chevron（不再是文字三角）。 */
const CHEVRON_PATH = 'M6.3 4 10.3 8 6.3 12'
const SVG_NS = 'http://www.w3.org/2000/svg'

function appendChevronIcon(host) {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', CHEVRON_PATH)
  svg.appendChild(path)
  host.appendChild(svg)
  return svg
}

function createLivePreviewDecorations(resolveImage, renderMath, composeState, host) {
  return StateField.define({
    create(state) {
      return buildDecorations(state, resolveImage, renderMath, host)
    },
    update(decorations, transaction) {
      // 输入法组合期间不重建装饰（避免打断候选词）；组合结束后由 rebuildEffect 强制重建。
      if (composeState.composing) return decorations.map(transaction.changes)
      if (transaction.effects.some((effect) => effect.is(rebuildEffect) || effect.is(toggleFoldEffect))) {
        return buildDecorations(transaction.state, resolveImage, renderMath, host)
      }
      if (transaction.docChanged || transaction.selection !== undefined) {
        return buildDecorations(transaction.state, resolveImage, renderMath, host)
      }
      return decorations.map(transaction.changes)
    },
    provide: (field) => EditorView.decorations.from(field),
  })
}

function wrapSelectionCommand(view, before, after) {
  const { state } = view
  const changes = state.changeByRange((range) => {
    const selected = state.sliceDoc(range.from, range.to)
    const insert = before + selected + after
    const anchor = range.from + before.length
    const head = selected === '' ? anchor : anchor + selected.length
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(anchor, head),
    }
  })
  view.dispatch(changes)
  return true
}

function toggleWrapCommand(view, marker) {
  const { state } = view
  const size = marker.length
  const changes = state.changeByRange((range) => {
    const selected = state.sliceDoc(range.from, range.to)
    const beforeText = state.sliceDoc(Math.max(0, range.from - size), range.from)
    const afterText = state.sliceDoc(range.to, Math.min(state.doc.length, range.to + size))
    // 选区自带标记：取消（**xxx** → xxx）
    if (selected.length > size * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
      const inner = selected.slice(size, selected.length - size)
      return {
        changes: { from: range.from, to: range.to, insert: inner },
        range: EditorSelection.range(range.from, range.from + inner.length),
      }
    }
    // 选区外侧已有标记：取消
    if (beforeText === marker && afterText === marker) {
      return {
        changes: [
          { from: range.from - size, to: range.from, insert: '' },
          { from: range.to, to: range.to + size, insert: '' },
        ],
        range: EditorSelection.range(range.from - size, range.to - size),
      }
    }
    // 空选区：插入成对标记，光标居中
    if (selected === '') {
      const anchor = range.from + size
      return {
        changes: { from: range.from, to: range.to, insert: marker + marker },
        range: EditorSelection.range(anchor, anchor),
      }
    }
    const anchor = range.from + size
    return {
      changes: { from: range.from, to: range.to, insert: marker + selected + marker },
      range: EditorSelection.range(anchor, anchor + selected.length),
    }
  })
  view.dispatch(changes)
  return true
}

function boldCommand(view) {
  return toggleWrapCommand(view, '**')
}

function italicCommand(view) {
  return toggleWrapCommand(view, '*')
}

function smartBackspaceCommand(view) {
  const { state } = view
  const sel = state.selection.main
  if (sel.empty) {
    const line = state.doc.lineAt(sel.head)
    const marker = /^(\s*)(?:[-*+]|\d+[.)])(\s+)/u.exec(line.text)
    if (marker !== null) {
      const markerEnd = line.from + marker[0].length
      if (sel.head === markerEnd || (sel.head > line.from + marker[1].length && sel.head <= markerEnd)) {
        // 光标紧跟列表标记：整段标记连同缩进一起删掉（与 Obsidian 一致）
        view.dispatch({
          changes: { from: line.from + marker[1].length, to: markerEnd, insert: '' },
          selection: { anchor: line.from + marker[1].length },
        })
        return true
      }
    }
  }
  return deleteMarkupBackward(view)
}

function deleteLineCommand(view) {
  const { state } = view
  const line = state.doc.lineAt(state.selection.main.head)
  if (line.from === line.to && line.from >= state.doc.length) return false
  const to = line.to < state.doc.length ? line.to + 1 : line.to
  view.dispatch({ changes: { from: line.from, to }, selection: { anchor: Math.min(line.from, view.state.doc.length) } })
  return true
}

function hardBreakCommand(view) {
  view.dispatch(view.state.replaceSelection('  \n'))
  return true
}

function insertIndentCommand(view) {
  const { state } = view
  const listLine = /^\s*([-*+]|\d+[.)])\s/u.test(state.doc.lineAt(state.selection.main.from).text)
  if (listLine) {
    const line = state.doc.lineAt(state.selection.main.from)
    view.dispatch({ changes: { from: line.from, insert: '    ' } })
    return true
  }
  view.dispatch(state.replaceSelection('    '))
  return true
}

function removeIndentCommand(view) {
  const { state } = view
  const line = state.doc.lineAt(state.selection.main.from)
  const match = /^( {1,4}|\t)/u.exec(line.text)
  if (match === null) return false
  view.dispatch({ changes: { from: line.from, to: line.from + match[0].length } })
  return true
}

function makeHeadingCommand(level) {
  return (view) => {
    const { state } = view
    const line = state.doc.lineAt(state.selection.main.head)
    const text = line.text
    const match = /^(#{1,6})\s+/u.exec(text)
    const same = match !== null && match[1].length === level
    const content = match === null ? text : text.slice(match[0].length)
    const insert = same ? content : '#'.repeat(level) + ' ' + content
    view.dispatch({ changes: { from: line.from, to: line.to, insert } })
    return true
  }
}

function toggleCheckboxCommand(view) {
  const { state } = view
  const line = state.doc.lineAt(state.selection.main.head)
  const text = line.text
  const match = /^(\s*)([-*+]|\d+[.)])\s+\[([ xX])\]/u.exec(text)
  if (match !== null) {
    const pos = line.from + match[0].length - 2
    const current = state.doc.sliceString(pos, pos + 1)
    const toggled = current === ' ' ? 'x' : ' '
    view.dispatch({ changes: { from: pos, to: pos + 1, insert: toggled } })
    return true
  }
  const listMatch = /^(\s*)([-*+]|\d+[.)])\s+/u.exec(text)
  if (listMatch !== null) {
    const pos = line.from + listMatch[0].length
    view.dispatch({ changes: { from: pos, insert: '[ ] ' } })
    return true
  }
  return false
}

function insertWikilinkCommand(view) {
  const { state } = view
  const main = state.selection.main
  const selected = state.sliceDoc(main.from, main.to)
  if (selected !== '') {
    view.dispatch({ changes: { from: main.from, to: main.to, insert: '[[' + selected + ']]' }, selection: { anchor: main.from + 2 + selected.length + 2 } })
  } else {
    view.dispatch({ changes: { from: main.from, insert: '[[]]' }, selection: { anchor: main.from + 2 } })
  }
  return true
}

function pastePlainTextCommand(view) {
  const clipboard = typeof navigator === 'object' && navigator !== null ? navigator.clipboard : undefined
  if (clipboard === undefined || typeof clipboard.readText !== 'function') return false
  clipboard.readText().then((text) => {
    if (typeof text === 'string' && text !== '') view.dispatch(view.state.replaceSelection(text))
  }).catch(() => {})
  return true
}

/** 为 true 时所有表格临时以源码态渲染（避免在 block widget 内部改文本）。 */
let tableSourceMode = false

let activeHost = null

function applyHistoryFallback(view, entry) {
  if (entry === null || entry === undefined || typeof entry.text !== 'string') return false
  const anchor = Math.min(Number(entry.head) || 0, entry.text.length)
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: entry.text }, selection: { anchor } })
  return true
}

function undoWithFallback(view) {
  if (undo(view)) return true
  if (activeHost === null || typeof activeHost.undo !== 'function') return false
  try {
    return applyHistoryFallback(view, activeHost.undo())
  } catch {
    return false
  }
}

function redoWithFallback(view) {
  if (redo(view)) return true
  if (activeHost === null || typeof activeHost.redo !== 'function') return false
  try {
    return applyHistoryFallback(view, activeHost.redo())
  } catch {
    return false
  }
}

function saveNowCommand() {
  if (activeHost === null || typeof activeHost.saveNow !== 'function') return false
  try {
    activeHost.saveNow()
    return true
  } catch {
    return false
  }
}

function smartEnterCommand(view) {
  const state = view.state
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  if (state.selection.main.empty && head === line.to) {
    // 空列表项：`- ` / `1. ` 等 → 直接清空这一行的标记，退出列表
    if (/^\s*(?:[-*+]|\d+[.)])\s+$/u.test(line.text)) {
      view.dispatch({ changes: { from: line.from, to: line.to, insert: '' }, selection: { anchor: line.from } })
      return true
    }
    // 空引用行：`>` / `> ` → 去掉引用标记
    if (/^\s*(?:>\s?)+$/u.test(line.text)) {
      view.dispatch({ changes: { from: line.from, to: line.to, insert: '' }, selection: { anchor: line.from } })
      return true
    }
  }
  return insertNewlineContinueMarkup(view)
}

const editingKeymap = [
  { key: 'Mod-Shift-z', run: redoWithFallback },
  { key: 'Mod-Shift-Z', run: redoWithFallback },
  { key: 'Mod-y', run: redoWithFallback },
  { key: 'Mod-z', run: undoWithFallback },
  { key: 'Mod-1', run: makeHeadingCommand(1) },
  { key: 'Mod-2', run: makeHeadingCommand(2) },
  { key: 'Mod-3', run: makeHeadingCommand(3) },
  { key: 'Mod-4', run: makeHeadingCommand(4) },
  { key: 'Mod-5', run: makeHeadingCommand(5) },
  { key: 'Mod-6', run: makeHeadingCommand(6) },
  { key: 'Mod-Enter', run: toggleCheckboxCommand },
  { key: 'Mod-Shift-v', run: pastePlainTextCommand },
  { key: 'Mod-b', run: boldCommand },
  { key: 'Mod-i', run: italicCommand },
  { key: 'Mod-s', run: saveNowCommand },
  { key: 'Mod-Shift-k', run: deleteLineCommand },
  { key: 'Mod-Shift-K', run: deleteLineCommand },
  { key: 'Mod-k', run: insertWikilinkCommand },
  { key: 'Enter', run: smartEnterCommand },
  { key: 'Shift-Enter', run: hardBreakCommand },
  { key: 'Tab', run: insertIndentCommand },
  { key: 'Shift-Tab', run: removeIndentCommand },
  { key: 'Backspace', run: smartBackspaceCommand },
]

function ensureStyle() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

/**
 * 创建一个整篇 Live Preview 原型编辑器。
 * @param {{ parent: HTMLElement, doc?: string, onChange?: (value: string) => void, resolveImage?: (src: string) => string | undefined, renderMath?: (tex: string, display: boolean) => string | undefined }} options
 * @returns {{ view: EditorView, destroy: () => void }}
 */
export function createLivePreview(options) {
  ensureStyle()
  const onChange = typeof options.onChange === 'function' ? options.onChange : () => {}
  const composeState = { composing: false }
  let pendingText = null
  let pendingTimer = 0
  const flushChanges = () => {
    if (pendingTimer !== 0) {
      window.clearTimeout(pendingTimer)
      pendingTimer = 0
    }
    if (pendingText === null) return
    const value = pendingText
    pendingText = null
    try {
      onChange(value)
    } catch {}
  }
  const queueChange = (value) => {
    pendingText = value
    if (pendingTimer !== 0) return
    pendingTimer = window.setTimeout(() => {
      pendingTimer = 0
      flushChanges()
    }, 120)
  }
  const host = {
    view: null,
    resolveEmbed: typeof options.resolveEmbed === 'function' ? options.resolveEmbed : undefined,
    resolveImage: typeof options.resolveImage === 'function' ? options.resolveImage : undefined,
    renderInline: typeof options.renderInline === 'function' ? options.renderInline : undefined,
    renderCode: typeof options.renderCode === 'function' ? options.renderCode : undefined,
    renderBlocks: typeof options.renderBlocks === 'function' ? options.renderBlocks : undefined,
    renderInlineHtml: typeof options.renderInlineHtml === 'function' ? options.renderInlineHtml : undefined,
    insertAsset: typeof options.insertAsset === 'function' ? options.insertAsset : undefined,
    saveNow: typeof options.saveNow === 'function'
      ? () => {
          flushChanges()
          try {
            options.saveNow()
          } catch {}
        }
      : undefined,
    undo: typeof options.undoFallback === 'function' ? options.undoFallback : undefined,
    redo: typeof options.redoFallback === 'function' ? options.redoFallback : undefined,
  }
  const view = new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: typeof options.doc === 'string' ? options.doc : '',
      extensions: [
      foldStateField,
      EditorState.tabSize.of(4),
      EditorView.updateListener.of((update) => {
        if (typeof options.onStateChange !== 'function') return
        if (!update.selectionSet && !update.focusChanged && !update.docChanged) return
        try {
          options.onStateChange({ head: update.state.selection.main.head, focused: update.view.hasFocus === true, text: update.state.doc.toString() })
        } catch {}
      }),
      
        history(),
        drawSelection(),
        closeBrackets(),
        EditorState.allowMultipleSelections.of(true),
        // Obsidian：Alt+点击 增加一个光标（CM6 默认不支持，需要显式开启）
        EditorView.clickAddsSelectionRange.of((event) => event.altKey === true),
        Prec.highest(keymap.of(editingKeymap)),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
        markdown(),
        createLivePreviewDecorations(
          typeof options.resolveImage === 'function' ? options.resolveImage : undefined,
          typeof options.renderMath === 'function' ? options.renderMath : undefined,
          composeState,
          host,
        ),
        EditorView.theme({ '&': { outline: 'none' } }),
        EditorView.domEventHandlers({
          compositionstart() {
            composeState.composing = true
            return false
          },
          compositionend(event, currentView) {
            composeState.composing = false
            currentView.dispatch({ effects: rebuildEffect.of(null) })
            return false
          },
          drop(event) {
            const host = activeHost
            if (host === null || host === undefined || typeof host.insertAsset !== 'function') return false
            const transfer = event.dataTransfer
            if (transfer === null || transfer === undefined) return false
            const files = Array.from(transfer.files ?? []).filter((file) => typeof file.type === 'string' && file.type.startsWith('image/'))
            if (files.length === 0) return false
            event.preventDefault()
            for (const file of files) {
              const reader = new window.FileReader()
              reader.onload = () => {
                const result = reader.result
                if (typeof result === 'string') host.insertAsset(file.name, result)
              }
              reader.readAsDataURL(file)
            }
            return true
          },
          paste(event) {
            const host = activeHost
            if (host === null || host === undefined || typeof host.insertAsset !== 'function') return false
            const data = event.clipboardData
            if (data === null || data === undefined) return false
            const files = Array.from(data.files ?? []).filter((file) => typeof file.type === 'string' && file.type.startsWith('image/'))
            if (files.length === 0) return false
            event.preventDefault()
            for (const file of files) {
              const reader = new window.FileReader()
              reader.onload = () => {
                const result = reader.result
                if (typeof result === 'string') host.insertAsset(file.name === '' ? 'pasted.png' : file.name, result)
              }
              reader.readAsDataURL(file)
            }
            return true
          },
          mouseover(event) {
            const target = event.target
            if (target === null || typeof target.closest !== 'function') return false
            const node = target.closest('[data-href]')
            if (node === null) return false
            const href = node.getAttribute('data-href') ?? ''
            if (href === '') return false
            if (node.className.includes('gh-md-lp-wikilink') === false) return false
            const rect = node.getBoundingClientRect()
            window.__ghMdShowLinkPreview?.(href, rect.left, rect.bottom + 6)
            return false
          },
          mouseout(event) {
            const target = event.target
            if (target === null || typeof target.closest !== 'function') return false
            const node = target.closest('[data-href]')
            if (node === null) return false
            window.__ghMdHideLinkPreview?.()
            return false
          },
          mousedown(event, view) {
            // Obsidian：Alt+点击在点击处追加一个光标（CM6 默认不提供）
            if (event.altKey === true && event.button === 0) {
              const position = view.posAtCoords({ x: event.clientX, y: event.clientY })
              if (position !== null) {
                event.preventDefault()
                const ranges = view.state.selection.ranges.map((range) => EditorSelection.range(range.anchor, range.head))
                ranges.push(EditorSelection.cursor(position))
                view.dispatch({ selection: EditorSelection.create(ranges, ranges.length - 1) })
                view.focus()
                return true
              }
            }
            const target = event.target
            if (target === null || typeof target.closest !== 'function') return false
            const hrefNode = target.closest('[data-href]')
            if (hrefNode === null) return false
            const href = hrefNode.getAttribute('data-href') ?? ''
            if (href === '') return false
            event.preventDefault()
            event.stopPropagation()
            try {
              if (typeof navigator === 'object' && navigator !== null && navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
                void navigator.clipboard.writeText(href)
              }
            } catch {}
            window.__ghMdOpenLink?.(href, event.ctrlKey === true || event.metaKey === true)
            return true
          },
          click(event, currentView) {
            const target = event.target
            if (target === null || typeof target.closest !== 'function') return false
            const image = target.closest('.gh-md-lp-image img')
            if (image !== null) {
              const src = image.getAttribute('src') ?? ''
              if (src !== '') {
                // 复用客户端的灯箱：支持滚轮缩放、拖拽平移、Esc 关闭。
                const opener = window.__ghMdOpenImageLightbox
                if (typeof opener === 'function') {
                  opener(src, image.getAttribute('alt') ?? '')
                  return true
                }
                const overlay = document.createElement('div')
                overlay.className = 'gh-md-cm6-image-fullscreen'
                const big = document.createElement('img')
                big.setAttribute('src', src)
                overlay.appendChild(big)
                overlay.addEventListener('click', () => overlay.remove())
                document.body.appendChild(overlay)
              }
              return true
            }
            const hrefNode = target.closest('[data-href]')
            if (hrefNode !== null) {
              const href = hrefNode.getAttribute('data-href') ?? ''
              if (href !== '') {
                event.preventDefault()
                window.__ghMdOpenLink?.(href, event.ctrlKey === true || event.metaKey === true)
              }
              return true
            }
            const checkbox = target.closest('input.gh-md-lp-task')
            if (checkbox !== null) {
              const pos = Number(checkbox.dataset.pos)
              if (Number.isInteger(pos)) {
                const doc = currentView.state.doc
                if (pos >= 0 && pos < doc.length) {
                  const current = doc.sliceString(pos, pos + 1)
                  const toggled = current === ' ' ? 'x' : ' '
                  currentView.dispatch({ changes: { from: pos, to: pos + 1, insert: toggled } })
                }
              }
              return true
            }
            return false
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) queueChange(update.state.doc.toString())
          if (update.focusChanged && typeof update.view === 'object' && update.view !== null) {
            const targetView = update.view
            const focusedNow = targetView.hasFocus === true
            if (focusedNow !== editorFocused) {
              setEditorFocused(focusedNow)
              window.requestAnimationFrame(() => {
                try {
                  targetView.dispatch({ effects: rebuildEffect.of(null) })
                } catch {}
              })
            }
          }
          if (update.viewportChanged && typeof update.view === 'object' && update.view !== null) {
            if (updateDecorateWindow(update.view)) {
              const targetView = update.view
              window.requestAnimationFrame(() => {
                // 重建会替换 widget DOM：若焦点在表格单元格里，先记住位置，重建后恢复
                const active = document.activeElement
                const cell = active !== null && typeof active.closest === 'function' ? active.closest('th,td') : null
                const cellRow = cell === null ? null : cell.dataset.row
                const cellCol = cell === null ? null : cell.dataset.cell
                try {
                  targetView.dispatch({ effects: rebuildEffect.of(null) })
                } catch {}
                if (cellRow !== null && cellCol !== null) {
                  const selector = '.gh-md-cm6-table th[data-row="' + cellRow + '"][data-cell="' + cellCol + '"], .gh-md-cm6-table td[data-row="' + cellRow + '"][data-cell="' + cellCol + '"]'
                  const nextCell = document.querySelector(selector)
                  if (nextCell !== null && typeof nextCell.focus === 'function') {
                    nextCell.focus()
                    const selection = window.getSelection()
                    if (selection !== null) {
                      const range = document.createRange()
                      range.selectNodeContents(nextCell)
                      range.collapse(false)
                      selection.removeAllRanges()
                      selection.addRange(range)
                    }
                  }
                }
              })
            }
          }
          if (typeof options.onFoldChange !== 'function') return
          if (!update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(toggleFoldEffect) || effect.is(restoreFoldEffect)))) return
          try {
            options.onFoldChange(update.state.field(foldStateField).map((position) => update.state.doc.lineAt(position).number))
          } catch {}
        }),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ class: 'gh-md-cm6-lp' }),
      ],
    }),
  })
  host.view = view
  activeHost = host
  updateDecorateWindow(view)
  // 首帧可能量不到真实尺寸（面板还没布局/隐藏）：尺寸变化后重新计算窗口并重建装饰。
  let resizeObserver = null
  let resizeFrame = 0
  try {
    let lastWidth = 0
    let lastHeight = 0
    resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry === undefined) return
      const width = Math.round(entry.contentRect.width)
      const height = Math.round(entry.contentRect.height)
      if (width === lastWidth && height === lastHeight) return
      lastWidth = width
      lastHeight = height
      if (resizeFrame !== 0) return
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = 0
        try {
          updateDecorateWindow(view)
          view.dispatch({ effects: rebuildEffect.of(null) })
        } catch {}
      })
    })
    resizeObserver.observe(view.dom)
  } catch {}
  setEditorFocused(view.hasFocus === true)
  try {
    view.dispatch({ effects: rebuildEffect.of(null) })
  } catch {}
  updateDecorateWindow(view)
  if (Array.isArray(options.foldedLines) && options.foldedLines.length > 0) {
    try {
      view.dispatch({ effects: restoreFoldEffect.of(options.foldedLines) })
    } catch {}
  }
  if (typeof options.onFoldChange === 'function') {
    try {
      options.onFoldChange(view.state.field(foldStateField).map((position) => view.state.doc.lineAt(position).number))
    } catch {}
  }
  return {
    view,
    flushChanges,
    destroy() {
      flushChanges()
      try {
        if (resizeObserver !== null) resizeObserver.disconnect()
        if (resizeFrame !== 0) window.cancelAnimationFrame(resizeFrame)
      } catch {}
      view.destroy()
    },
  }
}

export { EditorView, EditorState, EditorSelection }
