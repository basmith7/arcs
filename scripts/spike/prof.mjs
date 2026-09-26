// Inclusive/self shares from a V8 .cpuprofile of a dist-spike bundle, mapped back to source files.
//   node scripts/spike/prof.mjs <file.cpuprofile> <bundle.mjs>
import { readFileSync } from 'node:fs'
import { SourceMap } from 'node:module'

const [file, bundle] = process.argv.slice(2)
const prof = JSON.parse(readFileSync(file, 'utf8'))
const sm = new SourceMap(JSON.parse(readFileSync(bundle + '.map', 'utf8')))
const byId = new Map(prof.nodes.map((n) => [n.id, n]))
const parent = new Map()
for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id)

const where = new Map()
function loc(n) {
  if (where.has(n.id)) return where.get(n.id)
  const cf = n.callFrame
  let src = cf.url ? cf.url.replace(/.*\//, '') : ''
  let name = cf.functionName || '(anon)'
  if (cf.url && cf.url.endsWith('.mjs') && cf.lineNumber >= 0) {
    const e = sm.findEntry(cf.lineNumber, cf.columnNumber)
    if (e && e.originalSource) {
      src = e.originalSource.replace(/.*packages\/engine\/src\//, '')
      if (e.name) name = e.name
    }
  }
  name = name.replace(/\d+$/, (m) => (/[a-zA-Z]\d+$/.test(name) ? '' : m))
  const r = { src, name, key: `${src}:${cf.functionName || '(anon)'}` }
  where.set(n.id, r)
  return r
}

// Sample durations.
const dt = new Map()
const times = prof.timeDeltas
for (let i = 0; i < prof.samples.length; i++) {
  const d = times[i + 1] ?? 0
  dt.set(prof.samples[i], (dt.get(prof.samples[i]) ?? 0) + d)
}
let total = 0
for (const v of dt.values()) total += v

// Category matchers on (src, functionName of the bundle frame).
const cats = {
  'advance (dispatch.ts)': (l, fn) => l.src === 'dispatch.ts' && /^advance\d*$/.test(fn),
  'perform (dispatch.ts)': (l, fn) => l.src === 'dispatch.ts' && /^perform\d*$/.test(fn),
  'rules/* (any frame)': (l) => l.src.startsWith('rules/'),
  'observe': (l, fn) => l.src === 'observe.ts' && /^observe\d*$/.test(fn),
  'featuresOf (cached entry)': (l, fn) => l.src === 'ai/value.ts' && /^featuresOf\d*$/.test(fn),
  'featuresOfUncached': (l, fn) => l.src === 'ai/value.ts' && /^featuresOfUncached\d*$/.test(fn),
  'positionalUncached': (l, fn) => l.src === 'ai/value.ts' && /^positionalUncached\d*$/.test(fn),
  'valueOf': (l, fn) => l.src === 'ai/value.ts' && /^valueOf\d*$/.test(fn),
  'tracker.ts (any)': (l) => l.src === 'tracker.ts',
  'figure-index.ts (any)': (l) => l.src === 'figure-index.ts',
  'search: explore': (l, fn) => l.src === 'ai/search.ts' && /^explore\d*$/.test(fn),
  'search: settle (play.ts)': (l, fn) => l.src === 'ai/play.ts' && /^settle\d*$/.test(fn),
  'search: foresee': (l, fn) => /^foresee\d*$/.test(fn),
  'search.ts (any)': (l) => l.src === 'ai/search.ts',
  'play.ts stepBot': (l, fn) => l.src === 'ai/play.ts' && /^stepBot\d*$/.test(fn),
  'ambitions metric': (l, fn) => /^metric\d*$/.test(fn),
  'control.ts (any)': (l) => l.src === 'control.ts',
  'ids.ts (any)': (l) => l.src === 'ids.ts',
  '(garbage collector)': (l, fn) => fn === '(garbage collector)',
  '(program)': (l, fn) => fn === '(program)',
  '(idle)': (l, fn) => fn === '(idle)',
}
const incl = Object.fromEntries(Object.keys(cats).map((k) => [k, 0]))
const selfBySrc = new Map()
const selfByFn = new Map()
const incl2 = {}
const cCaller = new Map()
for (const [id, d] of dt) {
  const hit = new Set()
  let cur = id
  const leaf = byId.get(id)
  const ll = loc(leaf)
  selfBySrc.set(ll.src, (selfBySrc.get(ll.src) ?? 0) + d)
  const fk = `${ll.src}:${leaf.callFrame.functionName}`
  selfByFn.set(fk, (selfByFn.get(fk) ?? 0) + d)
  while (cur !== undefined) {
    const n = byId.get(cur)
    const l = loc(n)
    for (const [k, f] of Object.entries(cats)) if (!hit.has(k) && f(l, n.callFrame.functionName)) hit.add(k)
    cur = parent.get(cur)
  }
  for (const k of hit) incl[k] += d
  const combo = (a, b, name) => { if (hit.has(a) && hit.has(b)) incl2[name] = (incl2[name] ?? 0) + d }
  combo('tracker.ts (any)', 'advance (dispatch.ts)', 'tracker under advance')
  combo('tracker.ts (any)', 'featuresOf (cached entry)', 'tracker under featuresOf')
  combo('rules/* (any frame)', 'featuresOf (cached entry)', 'rules/* under featuresOf (metric etc.)')
  combo('(garbage collector)', 'advance (dispatch.ts)', 'GC under advance')
  combo('(garbage collector)', 'featuresOf (cached entry)', 'GC under featuresOf')
  if (hit.has('advance (dispatch.ts)') && !hit.has('featuresOf (cached entry)')) incl2['advance, not under featuresOf'] = (incl2['advance, not under featuresOf'] ?? 0) + d
  if (hit.has('featuresOf (cached entry)') && !hit.has('advance (dispatch.ts)')) incl2['featuresOf, not under advance'] = (incl2['featuresOf, not under advance'] ?? 0) + d
  if (leaf.callFrame.functionName.startsWith('contentsOf')) {
    const pn = byId.get(parent.get(id)); const pl = loc(pn)
    const k = `${pl.src}:${pn.callFrame.functionName}`
    cCaller.set(k, (cCaller.get(k) ?? 0) + d)
  }
}
console.log('Combinations:')
for (const [k, v] of Object.entries(incl2)) console.log(`  ${((100 * v) / total).toFixed(1).padStart(5)}%  ${k}`)
console.log('contentsOf self time by caller (top 10):')
for (const [k, v] of [...cCaller].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${((100 * v) / total).toFixed(1).padStart(5)}%  ${k}`)
const pc = (v) => ((100 * v) / total).toFixed(1).padStart(5) + '%'
console.log(`total sampled ${(total / 1e6).toFixed(1)} s`)
console.log('\nInclusive:')
for (const [k, v] of Object.entries(incl)) console.log(`  ${pc(v)}  ${k}`)
console.log('\nSelf by source file (top 15):')
for (const [k, v] of [...selfBySrc].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${pc(v)}  ${k || '(native/vm)'}`)
console.log('\nSelf by function (top 25):')
for (const [k, v] of [...selfByFn].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${pc(v)}  ${k}`)
