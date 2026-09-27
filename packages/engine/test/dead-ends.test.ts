import { describe, expect, it } from 'vitest'

import { applyExternal, botForLevel, decodeAction, defaultRegistry, runBots, startGame } from '../src/index.js'
import type { Action, NewGameOptions, RuleResult } from '../src/index.js'

/**
 * Nothing on offer costs a pip or a resource and then does nothing.
 *
 * The pip menu only offers an action that `canTake` says can do something, and the Prelude filters
 * its spends the same way. Guild and lore alternatives slipped past that: any alt on an action's
 * menu made the action takeable, and several alts were offered when they could do nothing
 * (Manufacture with the supply empty, Nurture with nothing to tax, Battle with no battle beside
 * Galactic Rifles). Taking one spent the pip, or the Prelude resource, for a line in the log.
 *
 * This walks real bot games with leaders and lore and, at every menu, takes each offered action to
 * see what it opens. A dead end is an ask with nothing but ways out, or a return straight to a
 * menu with nothing changed but the price.
 */
const EXITS = ['action/skip', 'battle/cancel', 'turn/end', 'turn/pass', 'vox/done']
const OPENERS = ['action/take', 'action/guild-alt', 'battle/declare', 'turn/prelude-spend']

const registry = defaultRegistry()

function asked(r: RuleResult): { faction: string; prompt: string; actions: readonly Action[] } | undefined {
  const c = r.continue as { kind: string; faction: string; prompt: string; actions: readonly Action[] }
  return c.kind === 'ask' ? c : undefined
}

/** Held resource tokens per faction slot, so a spend can be told apart from a gain. */
function held(r: RuleResult, faction: string): number {
  let n = 0
  for (const [, at] of r.state.resources.at) if (at.includes(`:${faction}:`) && !at.startsWith('supply')) n++
  return n
}

function isMenu(prompt: string): boolean {
  return / — action \d+ of \d+ /.test(prompt) || prompt.endsWith('— Prelude')
}

function deadEnds(options: NewGameOptions): string[] {
  const played = runBots(startGame(options, registry), options.factions, botForLevel('normal'), registry, 50_000)
  const found: string[] = []
  let r = startGame(options, registry)
  for (const [i, encoded] of played.result.state.journal.entries()) {
    const ask = asked(r)
    if (ask !== undefined && (isMenu(ask.prompt) || ask.actions.some((a) => a.type === 'action/guild-alt'))) {
      for (const opt of ask.actions) {
        if (!OPENERS.includes(opt.type)) continue
        const after = applyExternal(r, opt, registry)
        const next = asked(after)
        const what = `${String(opt['label'] ?? opt.type)} (seed ${options.seed}, index ${i})`
        if (next !== undefined && next.faction === ask.faction && next.actions.every((a) => EXITS.includes(a.type))) {
          found.push(`only exits after ${what}: ${next.prompt}`)
          continue
        }
        const unchanged =
          after.state.figures === r.state.figures &&
          after.state.courtCards === r.state.courtCards &&
          held(after, ask.faction) === held(r, ask.faction) - (opt.type === 'turn/prelude-spend' ? 1 : 0)
        if (next !== undefined && next.faction === ask.faction && isMenu(next.prompt) && unchanged) {
          found.push(`nothing happened after ${what}: back to ${next.prompt}`)
        }
      }
    }
    // Battle, a system, then Cancel on the dice: nothing has been fought, so the same pip is back.
    if (ask !== undefined && isMenu(ask.prompt) && / — action \d+ of /.test(ask.prompt)) {
      const take = ask.actions.find((a) => a.type === 'action/take' && a['action'] === 'Battle')
      let at = take === undefined ? undefined : applyExternal(r, take, registry)
      const declare = at === undefined ? undefined : asked(at)?.actions.find((a) => a.type === 'battle/declare')
      if (at !== undefined && declare !== undefined) at = applyExternal(at, declare, registry)
      const pickSystem = at === undefined ? undefined : asked(at)?.actions.find((a) => a.type === 'battle/system')
      const dice = pickSystem === undefined ? undefined : applyExternal(at!, pickSystem, registry)
      const diceAsk = dice === undefined ? undefined : asked(dice)
      if (diceAsk !== undefined && diceAsk.prompt.endsWith('choose dice')) {
        const cancel = diceAsk.actions.find((a) => a.type === 'battle/cancel')!
        const back = asked(applyExternal(dice!, cancel, registry))
        if (back?.prompt !== ask.prompt) {
          found.push(`dice Cancel spent the pip (seed ${options.seed}, index ${i}): ${ask.prompt} -> ${back?.prompt}`)
        }
      }
    }
    r = applyExternal(r, decodeAction(encoded), registry)
  }
  return found
}

describe('no offered action is a dead end', () => {
  // Seeds where the fuzz found the dead ends this guards (Board4MixUp1, leaders and lore).
  for (const seed of [3018, 3019, 3024, 3025]) {
    it(`leaders and lore, seed ${seed}`, () => {
      const options: NewGameOptions = {
        board: 'Board4MixUp1',
        factions: ['red', 'yellow', 'blue', 'white'],
        seed,
        leadersAndLore: { lorePerPlayer: 2 },
      }
      expect(deadEnds(options)).toEqual([])
    }, 300_000)
  }
})
