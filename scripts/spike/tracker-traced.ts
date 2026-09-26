/**
 * Engine-speed spike only: the tracker API, recording every call into `TRACE` for replay by the
 * TS/Rust benchmark (scripts/spike/trace-*.ts, spike/rust). Substituted for `tracker.js` by the
 * esbuild plugin in scripts/spike/build-trace.mjs — never imported by the engine itself.
 *
 * Trace: a string table and a flat Int32 op stream. Handles number tracker objects in order of
 * first sight (0 = unknown). Ops:
 *   0 empty -> out            1 register h loc n e1..en -> out    2 contentsOf h loc -> len
 *   3 locationOf h e -> loc|-1  4 move h e loc -> out            5 place h loc n e1..en -> out
 *   6 has h loc -> 0|1
 * Every op ends with its result (a handle for tracker-returning ops).
 */
import * as T from '../../packages/engine/src/tracker.js'
import type { EntityId, LocationRule, Tracker } from '../../packages/engine/src/tracker.js'
import type { LocationId } from '../../packages/engine/src/ids.js'

export type { EntityId, LocationRule, Tracker }

export const TRACE = { on: false, strings: [] as string[], ops: [] as number[], limit: 3_000_000 }
const stringIndex = new Map<string, number>()
const handles = new WeakMap<object, number>()
let nextHandle = 1

function s(x: string): number {
  let i = stringIndex.get(x)
  if (i === undefined) {
    i = TRACE.strings.length
    TRACE.strings.push(x)
    stringIndex.set(x, i)
  }
  return i
}
function h(t: Tracker): number {
  let i = handles.get(t)
  if (i === undefined) handles.set(t, (i = nextHandle++))
  return i
}
const rec = (): boolean => TRACE.on && TRACE.ops.length < TRACE.limit

export function emptyTracker(): Tracker {
  const out = T.emptyTracker()
  if (rec()) TRACE.ops.push(0, h(out))
  return out
}
export function register(tracker: Tracker, location: LocationId, options: { rule?: LocationRule; contents?: readonly EntityId[] } = {}): Tracker {
  const out = T.register(tracker, location, options)
  if (rec()) {
    const c = options.contents ?? []
    TRACE.ops.push(1, h(tracker), s(location), c.length, ...c.map(s), h(out))
  }
  return out
}
export function registerAll(tracker: Tracker, locations: readonly LocationId[]): Tracker {
  return locations.reduce((t, l) => register(t, l), tracker)
}
export function has(tracker: Tracker, location: LocationId): boolean {
  const out = T.has(tracker, location)
  if (rec()) TRACE.ops.push(6, h(tracker), s(location), out ? 1 : 0)
  return out
}
export function contentsOf(tracker: Tracker, location: LocationId): readonly EntityId[] {
  const out = T.contentsOf(tracker, location)
  if (rec()) TRACE.ops.push(2, h(tracker), s(location), out.length)
  return out
}
export function locationOf(tracker: Tracker, entity: EntityId): LocationId | undefined {
  const out = T.locationOf(tracker, entity)
  if (rec()) TRACE.ops.push(3, h(tracker), s(entity), out === undefined ? -1 : s(out))
  return out
}
export function move(tracker: Tracker, entity: EntityId, to: LocationId): Tracker {
  const out = T.move(tracker, entity, to)
  if (rec()) TRACE.ops.push(4, h(tracker), s(entity), s(to), h(out))
  return out
}
export function moveAll(tracker: Tracker, entities: readonly EntityId[], to: LocationId): Tracker {
  return entities.reduce((t, e) => move(t, e, to), tracker)
}
export function place(tracker: Tracker, entities: readonly EntityId[], location: LocationId): Tracker {
  const out = T.place(tracker, entities, location)
  if (rec()) TRACE.ops.push(5, h(tracker), s(location), entities.length, ...entities.map(s), h(out))
  return out
}
export const digest = T.digest
