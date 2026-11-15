#!/usr/bin/env node
// 重建 vendor/cm6-live-preview.js：把 src/cm6-entry.js 打成一个 IIFE bundle（全局名 __ghMdCm6LivePreview）。
import { build } from 'esbuild'

await build({
  entryPoints: ['src/cm6-entry.js'],
  bundle: true,
  format: 'iife',
  globalName: '__ghMdCm6LivePreview',
  minify: true,
  outfile: 'vendor/cm6-live-preview.js',
  logLevel: 'info',
})
