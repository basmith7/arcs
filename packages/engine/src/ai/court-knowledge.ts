/**
 * What a held court card does, in the evaluator's units — the C2 table (spec 2026-09-23 rev 3).
 *
 * `courtWorth` prices every card by suit and keys alone; no card text is read (docs/19 §0, a
 * recorded blind spot). These rows add a bonus per held card for what its effect gives each
 * chapter, **net of what `courtWorth` already prices**, so nothing is counted twice.
 *
 * Restricted by the coverage report (docs/19 §22) to cards whose effect is passive or whose ability
 * the bots take at least half the time it is offered. Pricing an ability the bot never uses would
 * only teach it to hoard the card harder — the Weapon lesson (§9). Left out on that ground: the four
 * Unions (0/157), Lattice Spies (0/3), Farseers (0/100), Relic Fence (~4%), Gatekeepers (~19%); the
 * Cartels' supply claim is already scored by `metric`, so they add nothing here.
 *
 * Every number is an argued prior, like the rest of `value.ts`, and the arena is the only judge.
 */
import type { Ambition } from '../state.js'
import type { ChapterIntent } from './intent.js'

export interface CourtKnowledge {
  readonly id: string
  /** Power-equivalent the effect adds per chapter held, beyond `courtWorth`. */
  readonly bonus: number
  /** The ambition the effect serves; scaled by pursuit like `courtWorth` scales by suit. */
  readonly ambition?: Ambition
  readonly why: string
}

export const COURT_KNOWLEDGE: readonly CourtKnowledge[] = [
  { id: 'bc01', bonus: 0.3, ambition: 'Tycoon', why: 'Loyal Engineers: spend any resource as Material — Build without Material' },
  { id: 'bc07', bonus: 0.3, ambition: 'Tycoon', why: 'Loyal Pilots: spend any resource as Fuel — Move without Fuel' },
  { id: 'bc15', bonus: 0.3, ambition: 'Warlord', why: 'Loyal Marines: spend any resource as Weapon — the Battle option on any card' },
  { id: 'bc19', bonus: 0.4, ambition: 'Empath', why: 'Loyal Empaths: spend any resource as Psionic — copy the lead action from any resource' },
  { id: 'bc21', bonus: 0.4, ambition: 'Keeper', why: 'Loyal Keepers: spend any resource as Relic — Secure from any resource' },
  { id: 'bc02', bonus: 0.3, ambition: 'Tycoon', why: 'Mining Interest: Manufacture (Build) gains a Material; taken ~50% when offered' },
  { id: 'bc09', bonus: 0.3, ambition: 'Tycoon', why: 'Shipping Interest: Synthesize (Build) gains a Fuel; taken ~50% when offered' },
  { id: 'bc12', bonus: 0.4, ambition: 'Tyrant', why: 'Prison Wardens: Pressgang/Execute turn captives into resources or trophies; taken 50-80%' },
  { id: 'bc14', bonus: 0.4, ambition: 'Tyrant', why: 'Court Enforcers: Abduct (Battle) takes rival agents off a court card; taken 100%' },
  { id: 'bc23', bonus: 0.2, why: 'Elder Broker: Trade (Tax) swaps a resource with a rival you rule beside; taken 100%' },
  { id: 'bc13', bonus: 0.3, ambition: 'Warlord', why: 'Skirmishers: rerolls Skirmish dice in battle, passive' },
  { id: 'bc18', bonus: 0.3, why: 'Secret Order: declaring Keeper or Empath does not zero your card, passive' },
  { id: 'bc22', bonus: 0.4, why: 'Sworn Guardians: rivals cannot steal your resources or other guild cards, passive' },
  { id: 'bc25', bonus: 0.4, why: 'Galactic Bards: an extra declaration each round nobody has declared; taken 100%' },
  { id: 'bc20', bonus: 0.5, why: 'Silver Tongues: steal a guild card (71%) or a resource from a rival' },
]

const BY_ID = new Map(COURT_KNOWLEDGE.map((r) => [r.id, r]))

const bias = (intent: ChapterIntent, ambition: Ambition): number =>
  0.5 + 1.5 * (intent.pursuing.get(ambition) ?? 0)

/** The table's bonus for a set of held card ids; ids not in the table add nothing. */
export function courtTextFor(held: readonly string[], intent: ChapterIntent): number {
  let total = 0
  for (const id of held) {
    const row = BY_ID.get(id)
    if (row === undefined) continue
    total += row.bonus * (row.ambition === undefined ? 1 : bias(intent, row.ambition))
  }
  return total
}
