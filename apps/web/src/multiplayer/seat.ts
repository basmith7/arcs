/**
 * What this client is, what it may do, and what it may watch.
 *
 * ## Three states, named, because two of them look alike
 *
 * The first version of this carried the seat as `FactionId | null` and it had a hole: `null` meant
 * both "hotseat, so every seat is yours" and "spectator, so none is". Those want opposite
 * behaviour, and collapsing them showed a watching stranger the current player's hand. `SeatView`
 * exists so the compiler asks which one you meant.
 *
 * ## Acting and watching are different questions
 *
 * They were the same question here once, and that was a bug. `viewFor` used to empty the actions of
 * *any* ask not addressed to you — which stopped you acting on someone else's turn, correctly, and
 * also stopped you seeing it. Every decision surface asks `surfaceFor` which surface owns an ask,
 * and an ask with no actions is owned by nobody, so nine of twelve surfaces went blank: the battle
 * window and its dice, the court decisions, the action being taken. A watcher got the board, the log
 * and an empty prompt.
 *
 * So they are now separate — three questions, not one:
 *
 *   - **`canAct`** decides whether the controls work. `App` hands it to `Watching`, which makes the
 *     subtree inert — so a button that would be refused cannot be pressed, and looks it.
 *   - **`viewFor`** decides only what may be *drawn*, and now empties actions for the two surfaces
 *     that are genuinely private (`surfaces.ts` has the list and the argument).
 *   - **`watchedActor`** decides whether the decision surfaces are drawn *at all*, and is the one
 *     of the three that hotseat can answer "yes" to — because a bot's seat is not one of the
 *     browser's players. Watch mode is a preference; the other two are not.
 *
 * Neither is a security boundary. `store.mayAct` refuses the action locally and the server's
 * `actorOf` check refuses it against a tampered client; both are independent of anything here.
 */

import { isPublicSurface, surfaceFor } from '../surfaces.js'
import type { Continue, FactionId } from '@arcs/engine'

export type SeatView =
  /** One browser playing every seat. The default, and how the rules are tested (docs/17 section 7). */
  | { readonly kind: 'hotseat' }
  /** A joined game, holding this faction's seat token. */
  | { readonly kind: 'seat'; readonly faction: FactionId }
  /** A joined game with no seat token: may watch, may not act, may not see a hand. */
  | { readonly kind: 'spectator' }

/** The faction this view plays, or `null` when it plays none — spectating, or not yet loaded. */
function seatOf(view: SeatView): FactionId | null {
  return view.kind === 'seat' ? view.faction : null
}

/**
 * Whether this client may answer the ask in front of it.
 *
 * Hotseat plays every seat, so it always may. A joined client may only when the ask names its own
 * faction — which is also true on `multiAsk`, where it may act if any of the asks is its.
 */
export function canAct(cont: Continue, view: SeatView): boolean {
  if (view.kind === 'hotseat') return true
  const mine = seatOf(view)
  if (mine === null) return false
  if (cont.kind === 'ask') return cont.faction === mine
  if (cont.kind === 'multiAsk') return cont.asks.some((a) => a.faction === mine)
  return false
}

/**
 * The continuation as this client may see it.
 *
 * Passed through untouched unless the surface that would draw it is private and the ask is not
 * yours — in which case the actions are emptied, which is what makes `surfaceFor` decline to draw
 * it at all. Everything else a watcher sees, grayed and inert rather than hidden.
 */
export function viewFor(cont: Continue, view: SeatView): Continue {
  if (view.kind === 'hotseat' || canAct(cont, view)) return cont

  if (cont.kind === 'ask') {
    /*
     * An ask nobody claims is **shown**, not hidden, and that default is load-bearing.
     *
     * The first cut treated `undefined` as private and blanked it, which reintroduced the very
     * regression this file was rewritten to fix — just narrowed to whatever `surfaces.ts` had not
     * got round to claiming. The two-player mulligan was exactly that: unclaimed, so a watcher sat
     * on an empty prompt for it while the actor, whose `AskStrip` draws unclaimed asks on
     * purpose, played on.
     *
     * The two failure modes are not symmetric. Defaulting to hidden costs a dead-looking screen on
     * every new action type until someone notices; defaulting to shown costs a leak only if a
     * *private* surface is added and left out of `PRIVATE` — and privacy is an explicit list that
     * has to be edited to add one. `surfaces.test.ts` forbids unclaimed asks outright, so this is
     * the behaviour when that test has already failed, not a substitute for it.
     */
    const surface = surfaceFor(cont)
    if (surface === undefined) return cont
    return isPublicSurface(surface) ? cont : { ...cont, actions: [] }
  }
  /*
   * `multiAsk` is simultaneous decisions — summits, phase 2. Nothing emits it yet, so this is not
   * reachable, but leaving it to fall through would make the one case that most obviously needs a
   * seat filter the one case without one.
   */
  if (cont.kind === 'multiAsk') {
    return { ...cont, asks: cont.asks.filter((a) => a.faction === seatOf(view)) }
  }
  return cont
}

/**
 * Whose hand to fan along the bottom, or `null` for nobody's.
 *
 * Hotseat shows whoever is being asked — that is what hotseat is — **among the humans**. A bot's
 * seat is not one of the browser's players: its hand is exactly as private as a rival's in a
 * joined game, and fanning it face-up during its paced turn was a leak. So while a bot is being
 * asked, a lone human keeps their own cards on the table (you hold your cards while others play),
 * and with several humans nobody's are shown — there is no one "you" to pick.
 *
 * A seat shows its **own** cards, on its turn and off it, which is both the fix for the original
 * leak and closer to the tabletop. A spectator holds none and is shown none. `humans` only
 * matters for hotseat; joined games already refuse bot seats (`botsAvailable`).
 */
export function handOwner(
  view: SeatView,
  asked: FactionId,
  humans?: readonly FactionId[],
): FactionId | null {
  if (view.kind === 'hotseat') {
    if (humans === undefined || humans.includes(asked)) return asked
    return humans.length === 1 ? humans[0]! : null
  }
  if (view.kind === 'seat') return view.faction
  return null
}

/**
 * The faction this client is *watching* act, or `null` when it is this client's own move.
 *
 * The third question the seat boundary has to answer, and the one `canAct` cannot. `canAct` is
 * unconditionally true in hotseat — playing every seat is what hotseat is — so its negation says
 * "you are watching" exactly never, including all the way through a bot's turn. But a bot's seat
 * is not one of the browser's players, which `handOwner` already argues above for the hand and
 * which is just as true of the tray, the strip and the battle window: drawing a bot's decision
 * surfaces asks the human to read a menu that is about to answer itself.
 *
 * So the rule is *whose move is this, and is it mine*, per view:
 *
 *   - **hotseat** — theirs only when a bot is asked. Several humans at one keyboard all count as
 *     you, so watch mode never comes on for a hotseat game between people.
 *   - **seat** — theirs when the ask names anyone else. Read off the *ask*, not `state.current`,
 *     so a decision handed to you mid-rival-turn (the defender assigning hits) takes you straight
 *     out of watch mode and draws its surface.
 *   - **spectator** — always theirs. That is what spectating is.
 *
 * Presentation only, and deliberately independent of `viewFor`: this decides whether a surface is
 * *drawn*, `viewFor` decides what may be *seen* when one is, and `store.mayAct` plus the server's
 * `actorOf` are what actually refuse an action. Turning this off (the watch-mode setting) must
 * never be able to leak anything, which is why it can only ever hide.
 */
export function watchedActor(
  cont: Continue,
  view: SeatView,
  bots: readonly FactionId[],
): FactionId | null {
  /*
   * `multiAsk` has no single actor to name, so there is nobody to watch and the surfaces draw as
   * they always have. Nothing emits it yet; answering it explicitly keeps the one case that would
   * most obviously confuse a "whose turn is it" rule from falling through to a wrong answer.
   */
  if (cont.kind !== 'ask') return null
  const actor = cont.faction

  if (view.kind === 'spectator') return actor
  if (view.kind === 'seat') return actor === view.faction ? null : actor
  return bots.includes(actor) ? actor : null
}

/**
 * The same ask with nothing to click — what the map is handed while somebody else is acting.
 *
 * ## Why the board needs its own answer
 *
 * `watchedActor` lets `App` stand a surface down by not mounting it, and that is the whole story
 * for the tray, the strip and the Prelude. The map is different: it is the thing being watched, so
 * it has to stay on screen while ceasing to be a menu. Without this it did not — `canAct` is
 * unconditionally true in hotseat, so `viewFor` passed a bot's ask through untouched and the board
 * drew "Click a system to move from" under a turn the player could not take.
 *
 * ## Why emptying `actions` rather than a `watching` prop
 *
 * Every affordance `Board` draws — the hint bar, the move reticles, battle and build and rifles
 * targets, the hand modes, the declare rows on the ambition track — is derived from `cont.actions`
 * and from nothing else. Emptying that one field stands all of them down at once, and stands down
 * the ones nobody has written yet. A boolean prop would have to be *remembered* at each new
 * affordance, which is the shape of bug `surfaces.ts` exists to document: a rule spread across
 * components that do not know about each other, silently incomplete the day someone adds a case.
 *
 * The actor is kept, because whose move it is has never been secret and the board still colours it.
 *
 * Presentation only. This hides an offer that was never this client's to take; `store.mayAct` and
 * the server's `actorOf` are what refuse the action.
 */
export function hushed(cont: Continue): Continue {
  if (cont.kind === 'ask') return { ...cont, actions: [] }
  if (cont.kind === 'multiAsk') return { ...cont, asks: cont.asks.map((a) => ({ ...a, actions: [] })) }
  return cont
}
