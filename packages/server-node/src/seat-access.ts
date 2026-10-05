/** Whether a signed-in (or signed-out) account may act through a seat: locked once someone else has claimed it. */
export type Access = 'ok' | 'locked'

export function seatAccess(seat: { readonly accountId?: string }, accountId: string | undefined): Access {
  return seat.accountId === undefined || seat.accountId === accountId ? 'ok' : 'locked'
}
