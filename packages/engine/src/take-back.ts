/**
 * Whether a player may take back an action in an online game.
 *
 * Undo in a local game simply replays the journal minus its last entry. Online, the same thing is
 * safe only when the action revealed nothing: otherwise a player could roll, draw or peek, dislike
 * what they saw, and rewind. So a take-back is refused when the action
 *
 *   - moved the RNG (dice rolled, or anything shuffled),
 *   - moved a card out of a hidden pile (any deck) or out of a rival's hand, or
 *   - is a look at a rival's hand (Farseers), which changes nothing in the state but what the
 *     player now knows.
 *
 * A card leaving your *own* hand is allowed: leading the wrong card shows the table a card of yours,
 * which is your loss to take, not an advantage to exploit. Who may take back (the actor, with
 * nobody having acted since) is the server's check, not this one: this judges the action alone.
 */
import type { Action } from './action.js'
import type { RuleResult } from './dispatch.js'
import type { Tracker } from './tracker.js'

/** Actions that reveal hidden information without changing the state. */
const REVEALS_WITHOUT_TRACE = ['ambition/farseers-look']

function isHiddenPile(location: string | undefined): boolean {
  return location !== undefined && (location === 'deck' || location.endsWith(':deck'))
}

/** The first entity that left a pile the actor could not see into, if any. */
function leftHidden(before: Tracker, after: Tracker, actor: string): string | undefined {
  for (const [id, now] of after.at) {
    const was = before.at.get(id)
    if (was === now) continue
    if (isHiddenPile(was)) return 'a card was drawn or revealed'
    // The action discard holds the cards left undealt at setup too, so taking one into a hand is a
    // draw of an unknown card (a Vox effect takes the bottom one).
    if (was === 'discard' && now.startsWith('hand:')) return 'a card was drawn or revealed'
    if (was !== undefined && was.startsWith('hand:') && was !== `hand:${actor}`) {
      return "a card came out of a rival's hand"
    }
  }
  return undefined
}

/**
 * Why `action`, which took the game from `before` to `after`, cannot be taken back; `undefined` when
 * it can. The reason is phrased for the player.
 */
export function takeBackBlock(before: RuleResult, after: RuleResult, action: Action): string | undefined {
  if (after.state.isOver) return 'the game is over'
  if (REVEALS_WITHOUT_TRACE.includes(action.type)) return "you looked at a rival's hand"
  if (after.state.rng.seed !== before.state.rng.seed) return 'dice were rolled or cards shuffled'
  const actor = typeof action['faction'] === 'string' ? action['faction'] : ''
  return (
    leftHidden(before.state.cards, after.state.cards, actor) ??
    leftHidden(before.state.courtCards, after.state.courtCards, actor)
  )
}
