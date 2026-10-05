/**
 * `#/me`: every game the signed-in account holds a seat in, and a way to bring in the games this
 * browser already knows about (docs/superpowers/specs/2026-10-04-optional-login-design.md, "My Games").
 *
 * It lives outside `<App/>` — `main.tsx` renders it instead — because it has no game state at all;
 * a row is a plain link, and following it reloads into that game like any other link.
 */

import { useCallback, useEffect, useState } from 'react'

import { useAccount } from '../account.js'
import { ApiError, MultiplayerClient, type MyGame } from '../multiplayer/client.js'
import { MULTIPLAYER_URL } from '../multiplayer/config.js'
import { hashFor, rememberedSeats } from '../multiplayer/link.js'
import { colorOf } from '../theme.js'
import { SignInButton, SigninNotice } from './AccountBits.js'

/** A coarse relative time: "just now", "5m ago", "2h ago", "3d ago". */
function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/** Your turn, then in progress, then finished; `sort` is stable, so server order holds within each. */
function rank(g: MyGame): number {
  return g.over ? 2 : g.yourTurn ? 0 : 1
}

function pill(g: MyGame): JSX.Element {
  if (g.over) return <span className="mg-pill">{g.won === true ? 'Won' : 'Lost'}</span>
  return g.yourTurn ? <span className="mg-pill yours">Your turn</span> : <span className="mg-pill">Waiting</span>
}

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'signedOut' } | { kind: 'ok'; games: readonly MyGame[] }

export function MyGames(): JSX.Element {
  const account = useAccount()
  const [client] = useState(() => new MultiplayerClient(MULTIPLAYER_URL!))
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  /* Held here, not in the checklist: "Add selected" reloads the list, which unmounts the checklist. */
  const [taken, setTaken] = useState<readonly string[]>([])

  const refresh = useCallback(() => {
    setLoad({ kind: 'loading' })
    client.myGames().then(
      (games) => setLoad({ kind: 'ok', games: [...games].sort((a, b) => rank(a) - rank(b)) }),
      // A 401 is a session that expired since `/me` answered: show it as signed out, not as broken.
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
        <p>Sign in to see your games on any device.</p>
        <SignInButton />
      </div>
    )
  else if (load.kind === 'loading') body = <p className="mg-note">Loading…</p>
  else if (load.kind === 'error')
    body = (
      <div className="mg-note">
        <p>Couldn't load your games.</p>
        <button className="ghost" onClick={refresh}>
          Retry
        </button>
      </div>
    )
  else
    body = (
      <GameList
        client={client}
        games={load.games}
        onAdded={(refused) => {
          setTaken(refused)
          refresh()
        }}
      />
    )

  return (
    <div className="newgame-wrap">
      <div className="newgame">
        <h1 className="ng-wordmark">Arcs</h1>
        <div className="mg-head">
          <a className="ghost" href="#/">
            New game
          </a>
          <SignInButton hideMyGames />
        </div>
        {body}
        {taken.length > 0 ? (
          <div className="mg-taken">
            Already someone else's:
            <ul>
              {taken.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <SigninNotice />
    </div>
  )
}

function GameList({
  client,
  games,
  onAdded,
}: {
  client: MultiplayerClient
  games: readonly MyGame[]
  onAdded: (refused: readonly string[]) => void
}): JSX.Element {
  const local = rememberedSeats().filter((r) => !games.some((g) => g.gameId === r.gameId))
  return (
    <>
      {games.length === 0 ? (
        <p className="mg-note">No games yet. Start one, or open a game link and tap Sit here.</p>
      ) : (
        <ul className="mg-list">
          {games.map((g) => (
            <li key={g.gameId}>
              <a className="mg-row" href={hashFor(g.gameId, g.seatToken)}>
                <span className="mg-dot" style={{ background: colorOf(g.faction) }} />
                <span className="mg-names">{g.seats.map((s) => s.name ?? s.faction).join(', ')}</span>
                <span className="mg-turn">{g.over ? ago(g.updatedAt) : `Chapter ${g.chapter} · ${ago(g.updatedAt)}`}</span>
                {pill(g)}
              </a>
            </li>
          ))}
        </ul>
      )}
      {local.length > 0 ? <AddFromBrowser client={client} local={local} onAdded={onAdded} /> : null}
    </>
  )
}

interface Candidate {
  readonly gameId: string
  readonly seatToken: string
  readonly label: string
}

function AddFromBrowser({
  client,
  local,
  onAdded,
}: {
  client: MultiplayerClient
  local: readonly { gameId: string; seatToken: string }[]
  onAdded: (refused: readonly string[]) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [candidates, setCandidates] = useState<readonly Candidate[] | null>(null)
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || candidates !== null) return
    let live = true
    void Promise.all(
      local.map(async (r): Promise<Candidate | null> => {
        try {
          const tail = await client.read(r.gameId, 0, r.seatToken)
          const names = (tail.seats ?? []).map((s) => s.name ?? s.faction).join(', ')
          return { ...r, label: `${tail.yourFaction ?? 'watching'} — ${names || r.gameId}` }
        } catch (e) {
          // A game that 404s is gone from the server; anything else still gets listed, by id.
          if (e instanceof ApiError && e.status === 404) return null
          return { ...r, label: r.gameId }
        }
      }),
    ).then((all) => {
      if (live) setCandidates(all.filter((c): c is Candidate => c !== null))
    })
    return () => {
      live = false
    }
  }, [open, candidates, client, local])

  const add = async (): Promise<void> => {
    setBusy(true)
    const refused: string[] = []
    for (const c of candidates ?? []) {
      if (!ticked.has(c.gameId)) continue
      try {
        await client.claim(c.gameId, c.seatToken)
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) refused.push(c.label)
      }
    }
    setBusy(false)
    onAdded(refused)
  }

  if (!open)
    return (
      <button className="ghost mg-import-open" onClick={() => setOpen(true)}>
        Add games from this browser ({local.length})
      </button>
    )

  return (
    <div className="mg-import">
      {candidates === null ? (
        <p>Loading…</p>
      ) : (
        <ul>
          {candidates.map((c) => (
            <li key={c.gameId}>
              <label>
                <input
                  type="checkbox"
                  checked={ticked.has(c.gameId)}
                  onChange={(e) => {
                    const next = new Set(ticked)
                    if (e.target.checked) next.add(c.gameId)
                    else next.delete(c.gameId)
                    setTicked(next)
                  }}
                />
                {c.label}
              </label>
            </li>
          ))}
        </ul>
      )}
      <button className="primary" disabled={busy || ticked.size === 0} onClick={() => void add()}>
        Add selected
      </button>
    </div>
  )
}
