/**
 * The lab page: B2's progress and every idea's measured outcome, on one auto-refreshing page.
 *
 *   npm run lab:ui                 # scripts/lab-ui-serve.ts — http://<tailnet-ip>:4870 (LAB_UI_HOST / LAB_UI_PORT override)
 *
 * Read-only by construction: it reads result files under runs/ and `pgrep`s the runner, and does
 * nothing else — it cannot start, stop or change an experiment.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'

import { b2FromDisk, gateOf } from './lab-data.js'
import type { B2Stats, IdeaRow } from './lab-data.js'
import type { GateResult } from '@arcs/engine'

const HOST = process.env['LAB_UI_HOST'] ?? '100.103.146.22'
const PORT = Number(process.env['LAB_UI_PORT'] ?? 4870)

const chunks = (name: string, n: number): string[] => [...Array(n).keys()].map((k) => `runs/gate-${name}-${k}.jsonl`)

/** Every idea measured so far — the §23/§24 record, with live numbers where the files exist. */
function ideas(): IdeaRow[] {
  return [
    { id: 'C1a', idea: 'Ships move toward what the ambition needs', against: 'old hard', probe: 'Move share 28.2% vs 28.6%', gate: gateOf(chunks('c1a', 2)), verdict: 'pass', note: 'shipped in v0.8.0' },
    { id: 'C4a', idea: 'Seize the initiative when it buys a declaration', against: 'old hard', probe: 'seizes 19% of chances', gate: gateOf(chunks('c4a', 4)), verdict: 'pass', note: 'shipped in v0.8.0' },
    { id: 'Asm', idea: 'C1a + C4a together', against: 'C1a alone', probe: '—', gate: gateOf(chunks('asm14', 4)), verdict: 'shipped, no pass', note: 'not worse; +0.9 power' },
    { id: 'C2', idea: 'Value court cards by their text', against: 'old hard', probe: 'changed 1.1% of court choices (needs 5%)', verdict: 'probe failed' },
    { id: 'C5', idea: 'Choose where to battle and hit the leader', against: 'C1a', probe: 'Battle share 63.9% vs 64.2%', gate: gateOf(chunks('c5', 2)), verdict: 'not detected', note: 'stopped for futility at half' },
    { id: 'C6', idea: 'Keep a garrison home', against: 'hard', probe: '0 reversals', gate: gateOf(['runs/lab/c6-2p.jsonl']), verdict: 'worse', note: '2p pre-screen' },
    { id: 'C8a', idea: 'Use guild abilities', against: 'hard', probe: 'uses 12% vs 5%', gate: gateOf(['runs/lab/c8a-2p.jsonl']), verdict: 'not detected', note: '2p pre-screen' },
    { id: 'C7', idea: 'Break pip-menu ties toward Move', against: 'hard', probe: 'Move share +14 pts (allowed ±3)', verdict: 'probe failed' },
  ]
}

function runner(): { alive: boolean; last: string; perDecision?: number } {
  let alive = false
  try {
    execFileSync('pgrep', ['-f', 'b2-supervise.sh'])
    alive = true
  } catch {
    alive = false
  }
  const log = existsSync('runs/b2-runner.log') ? readFileSync('runs/b2-runner.log', 'utf8').trim().split('\n') : []
  const secs = log.slice(-12).map((l) => /(\d+)s$/.exec(l)?.[1]).filter((x): x is string => x !== undefined).map(Number)
  return {
    alive,
    last: log.at(-1) ?? '—',
    ...(secs.length === 0 ? {} : { perDecision: secs.reduce((a, b) => a + b, 0) / secs.length }),
  }
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const pct = (x: number, d = 1): string => `${x >= 0 ? '+' : ''}${(100 * x).toFixed(d)}`

const VERDICT: Record<IdeaRow['verdict'], { cls: string; icon: string }> = {
  pass: { cls: 'good', icon: '✓' },
  'not detected': { cls: 'muted', icon: '–' },
  worse: { cls: 'critical', icon: '✕' },
  'probe failed': { cls: 'muted', icon: '⊘' },
  running: { cls: 'warning', icon: '…' },
  pending: { cls: 'muted', icon: '·' },
  'shipped, no pass': { cls: 'muted', icon: '↑' },
}

function gateCell(g: GateResult | undefined): string {
  if (g === undefined) return '<td class="num muted" data-label="win">—</td><td class="num muted" data-label="z">—</td><td class="num muted" data-label="power">—</td>'
  return (
    `<td class="num" data-label="win">${pct(g.winDiff)} <span class="muted">± ${(100 * g.winSe).toFixed(1)}</span></td>` +
    `<td class="num" data-label="z">${g.winZ.toFixed(1)}</td>` +
    `<td class="num" data-label="power">${g.powerDiff >= 0 ? '+' : ''}${g.powerDiff.toFixed(2)}</td>`
  )
}

/** Cumulative B2 gain with a 95% band; hover targets carry the exact values. */
function chart(b2: B2Stats): string {
  const pts = b2.trajectory.filter((p) => p.n >= 5)
  if (b2.evaluated < 3 || pts.length < 2) {
    return '<p class="muted">The gain chart appears once a few overrules have been checked — that phase starts after all 150 decisions are tested.</p>'
  }
  const W = 640, H = 220, L = 48, R = 12, T = 12, B = 28
  const lo = Math.min(-0.05, ...pts.map((p) => p.mean - 1.96 * p.se))
  const hi = Math.max(0.05, ...pts.map((p) => p.mean + 1.96 * p.se))
  const x = (n: number): number => L + ((n - pts[0]!.n) / Math.max(1, pts.at(-1)!.n - pts[0]!.n)) * (W - L - R)
  const y = (v: number): number => T + ((hi - v) / (hi - lo)) * (H - T - B)
  const band =
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.n).toFixed(1)},${y(p.mean + 1.96 * p.se).toFixed(1)}`).join('') +
    [...pts].reverse().map((p) => `L${x(p.n).toFixed(1)},${y(p.mean - 1.96 * p.se).toFixed(1)}`).join('') + 'Z'
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.n).toFixed(1)},${y(p.mean).toFixed(1)}`).join('')
  const ticks = [lo, 0, hi].map((v) => `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="tick">${pct(v, 0)}%</text>`).join('')
  const hover = pts
    .map((p) => `<circle cx="${x(p.n)}" cy="${y(p.mean)}" r="9" class="hit"><title>${p.n} decisions scored: ${pct(p.mean, 2)}% ± ${(196 * p.se).toFixed(2)} (95%)</title></circle>`)
    .join('')
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative held-out win-share gain per decision, with 95% band">
    <line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" class="zero"/>
    <path d="${band}" class="band"/><path d="${line}" class="line"/>${ticks}
    <text x="${L}" y="${H - 8}" class="tick">${pts[0]!.n}</text><text x="${W - R}" y="${H - 8}" text-anchor="end" class="tick">${pts.at(-1)!.n} decisions scored</text>
    ${hover}</svg>`
}

export function render(b2: B2Stats, rows: readonly IdeaRow[], run: ReturnType<typeof runner>): string {
  const done = b2.selected >= b2.target
  const pctDone = Math.min(100, (100 * b2.selected) / b2.target)
  const eta =
    run.perDecision === undefined || done
      ? ''
      : ` · selection ~${Math.round(((b2.target - b2.selected) * run.perDecision) / 3600)} h left, then checking the flips`
  const z = b2.se === 0 ? 0 : b2.mean / b2.se
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="60"><title>Arcs lab</title><style>
:root{--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--rule:#e4e3df;--series:#2a78d6;--good:#0ca30c;--warning:#b37800;--critical:#d03b3b}
@media (prefers-color-scheme:dark){:root{--surface:#1a1a19;--ink:#fff;--ink2:#c3c2b7;--rule:#383835;--series:#3987e5;--good:#3fbf3f;--warning:#fab219;--critical:#e66767}}
body{margin:0;background:var(--surface);color:var(--ink);font:15px/1.45 system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:20px 16px 40px}h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px}
.muted{color:var(--ink2)}.bar{height:10px;border-radius:5px;background:var(--rule);overflow:hidden;margin:8px 0}
.bar>span{display:block;height:100%;background:var(--series);border-radius:5px}.stats{display:flex;gap:20px;flex-wrap:wrap;margin:10px 0}
.stat b{display:block;font-size:22px;font-variant-numeric:tabular-nums}table{width:100%;border-collapse:collapse;font-size:14px}
th,td{padding:7px 6px;border-bottom:1px solid var(--rule);text-align:left;vertical-align:top}th{color:var(--ink2);font-weight:500}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.chip{white-space:nowrap}.good{color:var(--good)}.critical{color:var(--critical)}.warning{color:var(--warning)}
svg{width:100%;height:auto}
@media (max-width:600px){thead{display:none}table,tbody,tr,td{display:block}tr{padding:10px 0;border-bottom:1px solid var(--rule)}
td{border:0;padding:2px 0;text-align:left}td.num{text-align:left;display:inline-block;margin-right:14px}td.num::before{content:attr(data-label) ' ';color:var(--ink2)}
td.vs::before{content:'vs ';}}.zero{stroke:var(--ink2);stroke-dasharray:3 3}.band{fill:var(--series);opacity:.18}.line{fill:none;stroke:var(--series);stroke-width:2}
.tick{fill:var(--ink2);font-size:11px}.hit{fill:transparent}.hit:hover{fill:var(--series);opacity:.35}
</style></head><body><main>
<h1>Arcs bot lab</h1><p class="muted">Refreshes every minute · ${esc(new Date().toLocaleString('en-US', { timeZone: 'America/Phoenix' }))} MST</p>

<h2>B2 — do rollouts make the advisor's picks better?</h2>
<p class="muted">Runner <span class="${run.alive ? 'good' : 'critical'}">${run.alive ? '● running' : '○ not running'}</span>${esc(eta)}</p>
<div class="bar" role="progressbar" aria-valuenow="${b2.selected}" aria-valuemax="${b2.target}"><span style="width:${pctDone.toFixed(1)}%"></span></div>
<div class="stats">
 <div class="stat"><b>${b2.selected}/${b2.target}</b><span class="muted">decisions tested</span></div>
 <div class="stat"><b>${b2.flips}</b><span class="muted">rollouts overruled hard</span></div>
 <div class="stat"><b>${b2.evaluated}/${b2.flips}</b><span class="muted">overrules checked</span></div>
 <div class="stat"><b>${b2.evaluated === 0 ? 'not yet' : `${pct(b2.mean, 2)}%`}</b><span class="muted">gain per decision${b2.evaluated === 0 ? ' (needs checked overrules)' : ` (z ${z.toFixed(1)}; pass at 2)`}</span></div>
 <div class="stat"><b>${b2.evaluated === 0 ? '—' : `${b2.falseFlips}/${b2.evaluated}`}</b><span class="muted">overrules that were wrong</span></div>
</div>
${chart(b2)}
<p class="muted">Gain is measured on fresh games played by the strong bot, not the games that chose the overrule. Decisions where the rollouts agreed with hard count as zero.</p>

<h2>Every idea tested</h2>
<table><thead><tr><th>Idea</th><th>vs</th><th class="num">win share Δ</th><th class="num">z</th><th class="num">power Δ</th><th>Verdict</th></tr></thead><tbody>
${rows
  .map((r) => {
    const v = VERDICT[r.verdict]
    return `<tr><td><b>${esc(r.id)}</b> ${esc(r.idea)}<br><span class="muted">${esc(r.probe)}</span></td><td class="muted vs">${esc(r.against)}</td>${gateCell(r.gate)}<td class="chip ${v.cls}">${v.icon} ${esc(r.verdict)}${r.note === undefined ? '' : `<br><span class="muted">${esc(r.note)}</span>`}</td></tr>`
  })
  .join('\n')}
</tbody></table>
<p class="muted">Win share Δ is points per side (challenger seats' wins minus the control's), per game, clustered by deal. A pass needs z ≥ 2.5.</p>
<p class="muted">Last runner line: ${esc(run.last)}</p>
</main></body></html>`
}

/** Start the page (`scripts/lab-ui-serve.ts`). */
export function serve(): void {
  createServer((req, res) => {
    try {
      if (req.url === '/data.json') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ b2: b2FromDisk(), runner: runner() }))
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(render(b2FromDisk(), ideas(), runner()))
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end(`lab page error: ${(e as Error).message}`)
    }
  }).listen(PORT, HOST, () => console.log(`lab page on http://${HOST}:${PORT}`))
}
