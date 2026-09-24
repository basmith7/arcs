/**
 * One shard of the B2 corpus: plays 4p `hard` self-play games by index and prints, per game, the
 * journal and every card-play decision `hard` made, with each root's tier-1 value.
 */
import { botForLevel, defaultRegistry, encodeAction, isCardPlay, runBots, startGame } from '@arcs/engine'
import type { FactionId } from '@arcs/engine'

const { games, shard, jobs, seed } = JSON.parse(process.argv[2] ?? '{}') as {
  games: number
  shard: number
  jobs: number
  seed: number
}
const F: FactionId[] = ['red', 'yellow', 'blue', 'white']
const reg = defaultRegistry()
const hard = botForLevel('hard')

for (let g = shard; g < games; g += jobs) {
  const options = { board: 'Board4MixUp1', factions: F, seed: seed + g, bots: F }
  const decisions: { idx: number; faction: FactionId; cands: { a: string; t1: number }[]; pick: string }[] = []
  let idx = 0
  const out = runBots(startGame(options, reg), F, hard, reg, 50_000, (faction, offered) => {
    const at = idx++
    if (!isCardPlay(offered)) return
    decisions.push({ idx: at, faction, cands: [], pick: '' })
  })
  // Pair the recorded indices with the decisions' reasoning (runBots returns them in order).
  for (const d of decisions) {
    const dec = out.decisions[d.idx]!
    d.pick = encodeAction(dec.action)
    d.cands = (dec.considered ?? []).map((c) => {
      const kept = /tier-1 (-?\d+\.\d+)/.exec(c.note ?? '')
      return { a: encodeAction(c.action), t1: kept === null ? c.score : Number(kept[1]) }
    })
  }
  process.stdout.write(
    `${JSON.stringify({ seed: seed + g, options, journal: out.result.state.journal, finished: out.result.state.isOver, decisions })}\n`,
  )
}
