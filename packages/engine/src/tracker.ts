/**
 * Immutable identity tracker: entities live at exactly one location, with per-location
 * validity rules.
 *
 * HRF's equivalent is mutable and cloned by hand, which is a standing source of silent
 * bugs — a field added to the game and forgotten in `cloned()` corrupts every rollout.
 * Here every mutation returns a new tracker sharing structure with the old one.
 *
 * Locations are open strings (see ids.ts), so phase 2 adds new location kinds without
 * touching this file.
 *
 * **Representation (engine-speed spike, docs/spikes/2026-09-engine-speed.md).** Entities and
 * locations are interned to dense integers in a `Space` shared by every tracker descended from the
 * same `emptyTracker()` (append-only, so an id never changes meaning and a sibling branch that
 * interned more names is harmless). Each tracker holds an `Int32Array` entity -> location and an
 * array of per-location lists; a change copies the typed array and the outer array and replaces
 * only the touched lists, and is a new object — so every cache keyed on tracker identity stays
 * valid. `at`, `contents` and `rules` are materialised as `Map`s on first read, for the callers
 * and tests that read them directly; a plain `{ at, contents, rules }` object is still accepted
 * everywhere and converted once.
 */

import type { LocationId } from './ids.js'

export type EntityId = string

/** Returns true if `entity` is allowed to occupy `location`. */
export type LocationRule = (entity: EntityId) => boolean

export interface Tracker {
  /** entity -> location */
  readonly at: ReadonlyMap<EntityId, LocationId>
  /** location -> entities, insertion-ordered */
  readonly contents: ReadonlyMap<LocationId, readonly EntityId[]>
  readonly rules: ReadonlyMap<LocationId, LocationRule>
}

/** The intern tables, shared by a lineage of trackers. Append-only. */
class Space {
  readonly entityIndex = new Map<EntityId, number>()
  readonly entities: EntityId[] = []
  readonly locationIndex = new Map<LocationId, number>()
  readonly locations: LocationId[] = []

  entity(e: EntityId): number {
    let i = this.entityIndex.get(e)
    if (i === undefined) {
      i = this.entities.length
      this.entities.push(e)
      this.entityIndex.set(e, i)
    }
    return i
  }

  location(l: LocationId): number {
    let i = this.locationIndex.get(l)
    if (i === undefined) {
      i = this.locations.length
      this.locations.push(l)
      this.locationIndex.set(l, i)
    }
    return i
  }
}

const ALLOW_ALL: LocationRule = () => true

class DenseTracker implements Tracker {
  #at: Map<EntityId, LocationId> | undefined
  #contents: Map<LocationId, readonly EntityId[]> | undefined
  #rules: Map<LocationId, LocationRule> | undefined

  constructor(
    readonly space: Space,
    /** entity id -> location id, -1 = not placed; shorter than `space.entities` when it grew since. */
    readonly where: Int32Array,
    /** location id -> contents; undefined = not registered here. */
    readonly lists: readonly (readonly EntityId[] | undefined)[],
    readonly ruleOf: readonly (LocationRule | undefined)[],
  ) {}

  get at(): ReadonlyMap<EntityId, LocationId> {
    if (this.#at === undefined) {
      const m = new Map<EntityId, LocationId>()
      for (let e = 0; e < this.where.length; e++) {
        const l = this.where[e]!
        if (l >= 0) m.set(this.space.entities[e]!, this.space.locations[l]!)
      }
      this.#at = m
    }
    return this.#at
  }

  get contents(): ReadonlyMap<LocationId, readonly EntityId[]> {
    if (this.#contents === undefined) {
      const m = new Map<LocationId, readonly EntityId[]>()
      for (let l = 0; l < this.lists.length; l++) {
        const list = this.lists[l]
        if (list !== undefined) m.set(this.space.locations[l]!, list)
      }
      this.#contents = m
    }
    return this.#contents
  }

  get rules(): ReadonlyMap<LocationId, LocationRule> {
    if (this.#rules === undefined) {
      const m = new Map<LocationId, LocationRule>()
      for (let l = 0; l < this.ruleOf.length; l++) {
        const rule = this.ruleOf[l]
        if (rule !== undefined) m.set(this.space.locations[l]!, rule)
      }
      this.#rules = m
    }
    return this.#rules
  }

  /** Location index of `entity`, or -1. */
  whereIs(entity: EntityId): number {
    const e = this.space.entityIndex.get(entity)
    return e === undefined || e >= this.where.length ? -1 : this.where[e]!
  }

  /** Location index of a registered `location`, or -1. */
  registered(location: LocationId): number {
    const l = this.space.locationIndex.get(location)
    return l === undefined || this.lists[l] === undefined ? -1 : l
  }
}

/** Trackers built by hand (`{ at, contents, rules }`, as some tests do), converted once. */
const ADOPTED = new WeakMap<Tracker, DenseTracker>()

function dense(tracker: Tracker): DenseTracker {
  if (tracker instanceof DenseTracker) return tracker
  let d = ADOPTED.get(tracker)
  if (d === undefined) {
    const space = new Space()
    const lists: (readonly EntityId[] | undefined)[] = []
    const ruleOf: (LocationRule | undefined)[] = []
    for (const [location, list] of tracker.contents) {
      const l = space.location(location)
      lists[l] = list
      // `{ ...tracker, contents, at }` (as tests write) copies own fields only, so no `rules`.
      ruleOf[l] = (tracker.rules as ReadonlyMap<LocationId, LocationRule> | undefined)?.get(location) ?? ALLOW_ALL
    }
    for (const e of tracker.at.keys()) space.entity(e)
    const where = new Int32Array(space.entities.length).fill(-1)
    for (const [e, location] of tracker.at) where[space.entity(e)] = space.location(location)
    d = new DenseTracker(space, where, lists, ruleOf)
    ADOPTED.set(tracker, d)
  }
  return d
}

/** `where`, widened to the space's current entity count, as a fresh copy. */
function widened(t: DenseTracker): Int32Array {
  const n = t.space.entities.length
  if (n === t.where.length) return t.where.slice()
  const out = new Int32Array(n).fill(-1)
  out.set(t.where)
  return out
}

export function emptyTracker(): Tracker {
  return new DenseTracker(new Space(), new Int32Array(0), [], [])
}

/** Declare a location. Registering the same location twice is a programming error. */
export function register(
  tracker: Tracker,
  location: LocationId,
  options: { rule?: LocationRule; contents?: readonly EntityId[] } = {},
): Tracker {
  const t = dense(tracker)
  if (t.registered(location) >= 0) {
    throw new Error(`location already registered: ${location}`)
  }
  const rule = options.rule ?? ALLOW_ALL
  const initial = options.contents ?? []
  const space = t.space
  const l = space.location(location)

  for (const entity of initial) space.entity(entity)
  const where = widened(t)
  for (const entity of initial) {
    const e = space.entityIndex.get(entity)!
    if (where[e]! >= 0) throw new Error(`entity already placed: ${entity}`)
    if (!rule(entity)) throw new Error(`entity ${entity} not allowed at ${location}`)
    where[e] = l
  }

  const lists = t.lists.slice()
  lists[l] = [...initial]
  const ruleOf = t.ruleOf.slice()
  ruleOf[l] = rule
  return new DenseTracker(space, where, lists, ruleOf)
}

export function registerAll(tracker: Tracker, locations: readonly LocationId[]): Tracker {
  return locations.reduce((t, l) => register(t, l), tracker)
}

export function has(tracker: Tracker, location: LocationId): boolean {
  return dense(tracker).registered(location) >= 0
}

export function contentsOf(tracker: Tracker, location: LocationId): readonly EntityId[] {
  const t = dense(tracker)
  const l = t.registered(location)
  if (l < 0) throw new Error(`location not registered: ${location}`)
  return t.lists[l]!
}

export function locationOf(tracker: Tracker, entity: EntityId): LocationId | undefined {
  const t = dense(tracker)
  const l = t.whereIs(entity)
  return l < 0 ? undefined : t.space.locations[l]
}

/**
 * Move an entity to a location. Validates that the entity exists, the location exists,
 * and the location's rule accepts it — which catches a large class of "piece in two
 * places" bugs at the point of the move rather than three rules later.
 */
export function move(tracker: Tracker, entity: EntityId, to: LocationId): Tracker {
  const t = dense(tracker)
  const from = t.whereIs(entity)
  if (from < 0) throw new Error(`entity not registered: ${entity}`)
  const l = t.registered(to)
  if (l < 0) throw new Error(`location not registered: ${to}`)

  if (!t.ruleOf[l]!(entity)) throw new Error(`entity ${entity} not allowed at ${to}`)

  if (from === l) return tracker

  const lists = t.lists.slice()
  lists[from] = t.lists[from]!.filter((e) => e !== entity)
  lists[l] = [...t.lists[l]!, entity]

  const where = t.where.slice()
  where[t.space.entityIndex.get(entity)!] = l

  return new DenseTracker(t.space, where, lists, t.ruleOf)
}

export function moveAll(
  tracker: Tracker,
  entities: readonly EntityId[],
  to: LocationId,
): Tracker {
  return entities.reduce((t, e) => move(t, e, to), tracker)
}

/** Add entities that were not previously tracked anywhere. */
export function place(
  tracker: Tracker,
  entities: readonly EntityId[],
  location: LocationId,
): Tracker {
  const t = dense(tracker)
  const l = t.registered(location)
  if (l < 0) {
    throw new Error(`location not registered: ${location}`)
  }
  const rule = t.ruleOf[l]!
  const space = t.space
  for (const entity of entities) space.entity(entity)
  const where = widened(t)
  const list = [...t.lists[l]!]

  for (const entity of entities) {
    const e = space.entityIndex.get(entity)!
    if (where[e]! >= 0) throw new Error(`entity already placed: ${entity}`)
    if (!rule(entity)) throw new Error(`entity ${entity} not allowed at ${location}`)
    where[e] = l
    list.push(entity)
  }
  const lists = t.lists.slice()
  lists[l] = list
  return new DenseTracker(space, where, lists, t.ruleOf)
}

/** Stable digest of tracker contents, for golden-replay assertions. */
export function digest(tracker: Tracker): string {
  return [...tracker.contents.entries()]
    .filter(([, entities]) => entities.length > 0)
    .map(([location, entities]) => `${location}=${[...entities].sort().join(',')}`)
    .sort()
    .join('|')
}
