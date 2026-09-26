/**
 * Does a bot's chapter intent move between two of its own actions in one turn? (docs/19 §2b;
 * docs/spikes/2026-09-strategies.md). Plays one 4p game with the three committed strategies and
 * `hard`, recomputes each seat's intent at every decision it takes on its own turn, and counts the
 * consecutive same-turn pairs where it changed, by what changed underneath.
 *
 *   npx vite-node scripts/strategy-flap.ts -- --seed 500 [--index 0]
 */
import { committedIntent, contentsOf, feasibility, intentFor, Location, playGame, seatsForGame, STRATEGIES, strategyBot, botForLevel } from '@arcs/engine'
import type { Bot, FactionId, IntentFn, ObservedState } from '@arcs/engine'

const argv = process.argv.slice(2)
const flag = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`)
  return i === -1 ? undefined : argv[i + 1]
}
const seed = Number(flag('seed') ?? 500)
const index = Number(flag('index') ?? 0)

interface Count { pairs: number; moved: number; causes: Record<string, number> }
const counts = new Map<string, Count>()

const count = (obs: ObservedState, piece: string): number =>
  obs.board.systems.reduce((n, s) => n + contentsOf(obs.figures, Location.system(s)).filter((id) => id.startsWith(`${obs.self}`) && id.includes(piece)).length, 0)
const snapshot = (obs: ObservedState): Record<string, number> => ({
  declared: obs.declared.length,
  markers: obs.ambitionable.length,
  trophies: contentsOf(obs.figures, Location.trophies(obs.self)).length,
  captives: contentsOf(obs.figures, Location.captives(obs.self)).length,
  cities: count(obs, 'City'),
  ships: count(obs, 'Ship'),
})

function watched(bot: Bot, id: string, intentOf: IntentFn): Bot {
  let last: { key: string; pursuing: Map<string, number>; snap: Record<string, number> } | undefined
  const c: Count = { pairs: 0, moved: 0, causes: {} }
  counts.set(id, c)
  // `settle` resolves sub-asks by calling this same bot on hypothetical states, nested inside the
  // real decision; only the outermost call is a decision the game actually takes.
  let depth = 0
  return {
    ...bot,
    id,
    decide(observed, actions, ...rest) {
      if (depth === 0 && observed.current === observed.self) {
        const key = `${observed.chapter}:${observed.round}:${observed.self}`
        const pursuing = new Map(intentOf(observed, observed.self).pursuing)
        const snap = snapshot(observed)
        if (last !== undefined && last.key === key) {
          c.pairs++
          const moved = [...pursuing].some(([a, v]) => Math.abs(v - (last!.pursuing.get(a) ?? 0)) > 1e-9)
          if (moved) {
            c.moved++
            const why = Object.keys(snap).filter((k) => snap[k] !== last!.snap[k]).join('+') || 'rival-side'
            c.causes[why] = (c.causes[why] ?? 0) + 1
          }
        }
        last = { key, pursuing, snap }
      }
      depth++
      try {
        return bot.decide(observed, actions, ...rest)
      } finally {
        depth--
      }
    },
  }
}

const bots = [
  ...Object.values(STRATEGIES).map((s) => watched(strategyBot(s.name), `strat-${s.name}`, committedIntent(s.plan))),
  watched(botForLevel('hard'), 'hard', (o, f) => intentFor(o, f, feasibility)),
]
const factions: FactionId[] = ['red', 'yellow', 'blue', 'white']
const outcome = playGame({ seats: seatsForGame(bots, factions, index), seed, factions })
console.log(JSON.stringify({ seed, index, finished: outcome.finished, counts: Object.fromEntries(counts) }))
