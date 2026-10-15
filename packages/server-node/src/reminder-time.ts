/**
 * Wall-clock slots in an IANA zone, via Intl only. `nextSlotAfter` answers "when is the next
 * HH:MM in this zone" for the daily stall reminder; it copes with zones that observe DST.
 */

export interface DailyTime {
  readonly hour: number
  readonly minute: number
}

/** `"16:30"` -> `{ hour: 16, minute: 30 }`, or `undefined` when it is not a valid 24-hour HH:MM. */
export function parseDailyTime(text: string): DailyTime | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (m === null) return undefined
  const hour = Number(m[1])
  const minute = Number(m[2])
  return hour < 24 && minute < 60 ? { hour, minute } : undefined
}

/** Whether Intl knows the zone name. */
export function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function parts(ms: number, tz: string): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  let f = formatters.get(tz)
  if (f === undefined) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    formatters.set(tz, f)
  }
  const v: Record<string, number> = {}
  for (const p of f.formatToParts(ms)) if (p.type !== 'literal') v[p.type] = Number(p.value)
  return { y: v['year']!, mo: v['month']!, d: v['day']!, h: v['hour']!, mi: v['minute']!, s: v['second']! }
}

/** Offset of the zone from UTC at an instant, in ms (Phoenix: -7 h). */
function offsetAt(ms: number, tz: string): number {
  const p = parts(ms, tz)
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000
}

/** The UTC instant at which the zone's wall clock reads y-mo-d hh:mm. */
function instantOf(y: number, mo: number, d: number, time: DailyTime, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, time.hour, time.minute)
  const first = guess - offsetAt(guess, tz)
  return guess - offsetAt(first, tz)
}

/** The earliest instant strictly after `after` (ms) at which the zone's clock reads `time`. */
export function nextSlotAfter(after: number, time: DailyTime, tz: string): number {
  const local = parts(after, tz)
  for (let day = -1; day <= 2; day += 1) {
    const at = instantOf(local.y, local.mo, local.d + day, time, tz)
    if (at > after) return at
  }
  throw new Error('unreachable: a daily slot always falls within two days')
}
