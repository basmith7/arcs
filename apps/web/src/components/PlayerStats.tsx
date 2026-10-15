/**
 * `#/me/stats`: the signed-in player's record, built server-side from the games they have claimed
 * (docs/superpowers/specs/2026-10-14-player-stats-design.md). Outside `<App/>` like My Games: it
 * has no game state, and a history row is a plain link into the game.
 */

import { leaderCard } from '@arcs/engine'
import type { FactionId } from '@arcs/engine'
import { useCallback, useEffect, useState } from 'react'

import { useAccount } from '../account.js'
import { ApiError, MultiplayerClient, type MyStats, type StatsGame } from '../multiplayer/client.js'
import { MULTIPLAYER_URL } from '../multiplayer/config.js'
import { hashFor } from '../multiplayer/link.js'
import { colorOf } from '../theme.js'
import { SignInButton, SigninNotice } from './AccountBits.js'

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'signedOut' } | { kind: 'ok'; stats: MyStats }

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
const ordinal = (n: number): string => ['1st', '2nd', '3rd', '4th'][n - 1] ?? `${n}th`
const one = (n: number): string => n.toFixed(1)

/** A leader's card name; an id this build doesn't know falls back to the id rather than throwing. */
function leaderName(id: string): string {
  try {
    return leaderCard(id).name
  } catch {
    return id
  }
}

function date(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function result(g: StatsGame): string {
  if (!g.over) return `Chapter ${g.chapter}`
  return g.won === true ? 'Won' : `${ordinal(g.place ?? 0)} of ${g.players}`
}

export function PlayerStats(): JSX.Element {
  const account = useAccount()
  const [client] = useState(() => new MultiplayerClient(MULTIPLAYER_URL!))
  const [load, setLoad] = useState<Load>({ kind: 'loading' })

  const refresh = useCallback(() => {
    setLoad({ kind: 'loading' })
    client.myStats().then(
      (stats) => setLoad({ kind: 'ok', stats }),
      (e: unknown) => setLoad(e instanceof ApiError && e.status === 401 ? { kind: 'signedOut' } : { kind: 'error' }),
    )
  }, [client])

  const signedIn = account.loaded && account.account !== null
  useEffect(() => {
    if (signedIn) refresh()
  }, [signedIn, refresh])

  let body: JSX.Element
  if (!account.loaded) body = <p className="mg-note">Loading…</p>
  else if (account.account === null || load.kind === 'signedOut')
    body = (
      <div className="mg-note">
        <p>Sign in to see your stats.</p>
        <SignInButton />
      </div>
    )
  else if (load.kind === 'loading') body = <p className="mg-note">Loading…</p>
  else if (load.kind === 'error')
    body = (
      <div className="mg-note">
        <p>Couldn't load your stats.</p>
        <button className="ghost" onClick={refresh}>
          Retry
        </button>
      </div>
    )
  else body = <Stats stats={load.stats} />

  return (
    <div className="newgame-wrap">
      <div className="newgame">
        <h1 className="ng-wordmark">Arcs</h1>
        <div className="mg-head">
          <a className="ghost" href="#/me">
            My games
          </a>
          <a className="ghost" href="#/">
            New game
          </a>
        </div>
        {body}
      </div>
      <SigninNotice />
    </div>
  )
}

function Stats({ stats }: { stats: MyStats }): JSX.Element {
  const { summary, byLeader, byColour, games } = stats
  const sizes = Object.keys(summary.averagePower).sort()
  const useLeaders = Object.keys(byLeader).length > 0
  const rows = Object.entries(useLeaders ? byLeader : byColour).sort((a, b) => b[1].played - a[1].played)

  return (
    <>
      <p className="ps-record">
        {summary.played} {summary.played === 1 ? 'game' : 'games'}, {summary.won} won
        {summary.inProgress > 0 ? <span className="ps-sub"> · {summary.inProgress} in progress</span> : null}
      </p>

      {sizes.length > 0 ? (
        <ul className="ps-avgs">
          {sizes.map((n) => (
            <li key={n}>
              {n} players: power {one(summary.averagePower[n]!)}, place {one(summary.averagePlace[n]!)}
            </li>
          ))}
        </ul>
      ) : null}

      {rows.length > 0 ? (
        <div className="ps-scroll">
          <table className="ps-table">
            <thead>
              <tr>
                <th>{useLeaders ? 'Leader' : 'Colour'}</th>
                <th>Played</th>
                <th>Won</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([key, t]) => (
                <tr key={key}>
                  <td>
                    {useLeaders ? (
                      leaderName(key)
                    ) : (
                      <>
                        <span className="mg-dot ps-dot" style={{ background: colorOf(key as FactionId) }} /> {cap(key)}
                      </>
                    )}
                  </td>
                  <td>{t.played}</td>
                  <td>{t.won}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {games.length > 0 ? (
        <ul className="mg-list ps-history">
          {games.map((g) => (
            <li key={g.gameId}>
              <a className="mg-row ps-row" href={hashFor(g.gameId, g.seatToken)}>
                <span className="mg-dot" style={{ background: colorOf(g.colour as FactionId) }} />
                <span className="ps-main">
                  <span className="ps-line">
                    {result(g)} · {g.power} power
                    {g.leader !== undefined ? ` · ${leaderName(g.leader)}` : ''}
                    {g.soloHotseat ? ' · hotseat' : ''}
                  </span>
                  <span className="ps-table-names">
                    {g.table.map((t) => t.name ?? t.owner ?? cap(t.colour)).join(', ')}
                  </span>
                </span>
                <span className="mg-turn">{date(g.updatedAt)}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mg-note ps-foot">
        Only games you've claimed are counted. Add older games from this browser in <a href="#/me">My games</a>.
      </p>
    </>
  )
}
