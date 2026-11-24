/**
 * 性能压测：几百条批注时的核心路径开销（纯函数，不依赖浏览器）
 *   node scripts/comments-perf-test.mjs
 *
 * 覆盖：resolveStore（每次文档变化都会跑）、buildThreads（每次重绘）、
 * serializeStore（每次保存 / 轮询比较）。
 */
import { buildThreads, createComment, createReply, emptyStore, resolveStore, serializeStore } from '../src/comments/model.js'

const results = []
const check = (name, ok, detail) => {
  results.push(ok === true)
  console.log((ok === true ? '[OK] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' — ' + detail))
}

const lines = Array.from({ length: 2000 }, (_, index) => `第 ${index + 1} 行正文，长度大约三十个字符，用来模拟真实论文的规模。`)
const text = lines.join('\n') + '\n'
const store = emptyStore()
const COUNT = 400
for (let index = 0; index < COUNT; index += 1) {
  const position = Math.min(text.length - 2, index * 137 + 5)
  const comment = createComment(store, { author: { name: index % 3 === 0 ? 'Alice Chen' : index % 3 === 1 ? 'Bob Wu' : 'Carol Li' }, body: '第 ' + index + ' 条批注，内容大约几十个字。', start: position, end: position + 12, text })
  if (index % 4 === 1) createReply(store, comment.id, { author: { name: 'Bob Wu' }, body: '回复 ' + index, text })
}

const measure = (label, times, run) => {
  const samples = []
  for (let index = 0; index < times; index += 1) {
    const started = process.hrtime.bigint()
    run()
    samples.push(Number(process.hrtime.bigint() - started) / 1e6)
  }
  samples.sort((left, right) => left - right)
  const median = samples[Math.floor(samples.length / 2)]
  const worst = samples[samples.length - 1]
  console.log('  ' + label + ': median ' + median.toFixed(2) + 'ms, worst ' + worst.toFixed(2) + 'ms')
  return { median, worst }
}

console.log('store: ' + store.comments.length + ' comments (' + buildThreads(store.comments).length + ' threads)')
const resolved = measure('resolveStore', 20, () => resolveStore(store, text))
const threads = measure('buildThreads', 20, () => buildThreads(store.comments))
const serialised = measure('serializeStore', 20, () => serializeStore(store))

check('resolveStore stays under 30ms with 400 comments', resolved.median < 30, resolved.median.toFixed(2) + 'ms')
check('buildThreads stays under 10ms', threads.median < 10, threads.median.toFixed(2) + 'ms')
check('serializeStore stays under 20ms', serialised.median < 20, serialised.median.toFixed(2) + 'ms')
const json = serializeStore(store)
check('the sidecar stays reasonable in size', json.length < 400 * 1024, String(json.length) + ' bytes')

// 保存一次的量级：写盘由 store-io 负责，这里只测字符串化 + 解析
const parsed = measure('parseStore(serialize)', 10, () => {
  const copy = JSON.parse(json)
  void copy
})
check('parse stays close to serialise cost', parsed.median < 40, parsed.median.toFixed(2) + 'ms')

console.log('PERF: ' + results.filter(Boolean).length + '/' + results.length + ' ok')
process.exit(results.every(Boolean) ? 0 : 1)
