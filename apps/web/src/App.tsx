import { isWaiting } from '@arcs/engine'
import { useEffect, useRef, useState } from 'react'

import { AskModal } from './components/AskModal.js'
import { AskStrip } from './components/AskStrip.js'
import { AmbitionTrack } from './components/AmbitionTrack.js'
import { Attribution } from './components/Attribution.js'
import { Battle } from './components/Battle.js'
import { ChapterInterlude } from './components/ChapterInterlude.js'
import { GameOverScreen } from './components/GameOverScreen.js'
import { Board } from './components/Board.js'
import { CourtPanel } from './components/CourtPanel.js'
import { DraftScreen } from './components/DraftScreen.js'
import { LearnedScreen } from './components/LearnedScreen.js'
import { ActionTray } from './components/ActionTray.js'
import { PreludeScreen } from './components/PreludeScreen.js'
import { SlotBoard } from './components/SlotBoard.js'
import { CardShelf } from './components/CardShelf.js'
import { RaidModal } from './components/RaidModal.js'
import { Hand } from './components/Hand.js'
import { LogPanel } from './components/LogPanel.js'
import { NewGame } from './components/NewGame.js'
import { PlayedCards } from './components/PlayedCards.js'
import { PlayerBoards } from './components/PlayerBoards.js'
import { NamePrompt } from './components/NamePrompt.js'
import { SeatBadge } from './components/SeatBadge.js'
import { RulesModal } from './components/RulesModal.js'
import { SettingsModal } from './components/SettingsModal.js'
import { Watching } from './components/Watching.js'
import { initAudio } from './audio.js'
import { canAct, viewFor, watchedActor } from './multiplayer/seat.js'
import { setSettings, useSettings } from './settings.js'
import { setupLabel } from './setups.js'
import { colorOf } from './theme.js'
import { store, useGame, useSeats } from './store.js'

export function App(): JSX.Element {
  const result = useGame()
  // Seats (names) can change without the position moving — a claim while it is your turn, say —
  // so this needs its own subscription; see the comment on `seatsVersion` in store.ts.
  useSeats()
  const fileInput = useRef<HTMLInputElement>(null)
  /*
   * The log drawer. Local state, deliberately: nothing else reads it, and it must not entangle
   * with saves or undo. No backdrop either — the point of the drawer is reading the log while
   * the game stays playable behind it.
   */
  const [logOpen, setLogOpen] = useState(false)
  /** Escape/cancel dismisses the name prompt for the rest of this session; it does not reappear. */
  const [nameDismissed, setNameDismissed] = useState(false)
  /*
   * The settings dialog. Local state like the log drawer, and mounted on both screens below —
   * the music starts on the title screen, so the volume control has to be reachable there too.
   */
  const [settingsOpen, setSettingsOpen] = useState(false)
  /*
   * Pinning the log is a statement about how you like to play rather than a thing you did to this
   * game, so it lives in settings. Open-but-unpinned stays local state, like the drawer always was.
   */
  const { watchTurns, logPinned } = useSettings()
  /*
   * The rules reader. On both screens for the same reason settings is: someone deciding whether
   * to start a game is exactly the person who wants to read the rulebook first.
   */
  const [rulesOpen, setRulesOpen] = useState(false)
  /*
   * The music. Mounted here rather than in `main.tsx` so it lives exactly as long as the app
   * does, and started before the early return: the title screen is where most first clicks
   * happen, and that click is what the browser wants before it will play anything.
   */
  useEffect(() => initAudio(), [])
  useEffect(() => {
    if (!logOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setLogOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [logOpen])

  function saveGame(): void {
    const json = store.toJSON()
    if (json === null) return
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `arcs-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function loadGame(file: File | undefined): Promise<void> {
    if (file === undefined) return
    try {
      store.load(await file.text())
    } catch (e) {
      alert(`Could not load: ${(e as Error).message}`)
    }
  }

  const loadControl = (
    <>
      <button className="ghost" onClick={() => fileInput.current?.click()}>
        Load
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          void loadGame(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </>
  )

  if (result === null) {
    return (
      <div className="newgame-wrap">
        <NewGame />
        <div className="newgame-load">
          {loadControl}or load a saved game
          <button className="ghost" onClick={() => setRulesOpen(true)}>
            Rules
          </button>
          <button className="ghost" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </div>
        <Attribution />
        {rulesOpen ? <RulesModal onClose={() => setRulesOpen(false)} /> : null}
        {settingsOpen ? <SettingsModal onClose={() => setSettingsOpen(false)} /> : null}
      </div>
    )
  }

  const { state, continue: engineCont } = result
  /*
   * `current` is read from the engine's own answer, before the seat filter — it drives the board
   * highlight and the "waiting for" badge, both of which have to keep naming whoever is genuinely
   * acting. Whose turn it is has never been secret; only their cards are.
   */
  const current =
    engineCont.kind === 'ask'
      ? engineCont.faction
      : isWaiting(engineCont)
        ? undefined
        : state.current
  const seatView = store.seatView()
  const myName = store.mySeatName()
  const myDiscordName = store.mySeatDiscordName()
  const needsName = seatView.kind === 'seat' && myName === undefined && !nameDismissed
  const cont = viewFor(engineCont, seatView)
  /*
   * Whether the controls work. Separate from what is *drawn* — a watcher sees the dice and the
   * court decisions, grayed and inert, and only the two private surfaces are withheld outright.
   */
  const acting = canAct(engineCont, seatView)
  /*
   * Whether the decision surfaces are drawn at all. A bot's turn, or a rival's, is a thing to be
   * told about rather than a menu to read — so the surfaces stand down and the turn feed narrates
   * (`seat.ts`). The hand is the exception and stays: it is yours, it is not a decision, and
   * holding your own cards while somebody else plays is what the table does.
   */
  const watched = watchTurns ? watchedActor(engineCont, seatView, store.botSeats()) : null

  return (
    <div className="app">
      {needsName && seatView.kind === 'seat' ? (
        <NamePrompt
          faction={seatView.faction}
          onSubmit={(name, discordId) => store.claimName(name, discordId)}
          onDismiss={() => setNameDismissed(true)}
        />
      ) : null}
      <header className="topbar">
        <span className="brand">Arcs</span>
        <span className="board-name">{setupLabel(state.board.name)}</span>
        {/* Was the status panel's heading; the panel itself is gone, the player boards
            along the bottom carry everything else it showed. */}
        <span className="turn-meta">
          Act {state.act} · Chapter {state.chapter} · Round {state.round}
        </span>
        {current !== undefined ? (
          <span className="turn-badge">
            <span className="turn-badge-label">Turn</span>
            <span className="turn-badge-who" style={{ color: colorOf(current) }}>
              {store.seatName(current) ?? current}
            </span>
          </span>
        ) : null}
        <SeatBadge
          view={seatView}
          current={current}
          nameOf={(f) => store.seatName(f)}
          {...(myDiscordName === undefined ? {} : { myDiscordName })}
        />
        <div className="toolbar">
          <button className="ghost" onClick={() => store.undo()} disabled={!store.canUndo()}>
            Undo
          </button>
          <button className="ghost" onClick={saveGame}>
            Save
          </button>
          <button className="ghost" onClick={() => setLogOpen((v) => !v)}>
            Log
          </button>
          <button className="ghost" onClick={() => setRulesOpen(true)}>
            Rules
          </button>
          <button className="ghost" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
          {loadControl}
          <button className="ghost" onClick={() => store.reset()}>
            New game
          </button>
        </div>
      </header>

      <main className={logPinned ? 'layout log-pinned' : 'layout'}>
        <section className="board-col">
          <CourtPanel state={state} />
          <PlayedCards state={state} />
          <div className="board-cell">
            {/*
              * Every click on the map dispatches an action, so it is gated like any other surface.
              * Nothing is dimmed: the dimming rule targets controls, and the map has none — a
              * watcher gets the board at full strength and simply cannot move anything on it.
              */}
            <Watching canAct={acting}>
              <Board state={state} cont={cont} />
            </Watching>
            {/*
              * The turn feed, over the map's lower-left and outside `Watching` — it is narration,
              * not a control, and making it inert would take the one thing on screen that explains
              * the pause out of the accessibility tree. Suppressed when the log is pinned, which is
              * the same rows in a bigger frame a few hundred pixels to the right.
              */}
            {watched !== null && !logPinned ? (
              <div className="turn-feed" role="status" aria-live="polite">
                <LogPanel log={state.log} only="last-turn" />
              </div>
            ) : null}
          </div>
          <AmbitionTrack state={state} cont={cont} />
          {/*
            * The decision surfaces. Wrapped so a watcher sees them and cannot touch them —
            * `Watching` is `display: contents`, so `.hand-row` and its siblings stay grid items of
            * `.board-col` exactly as before.
            */}
          {/*
            * A finished game has no actions to guard, and the strip's game-over band (New game,
            * View summary) must work for every seat and for spectators — `canAct` is false for a
            * gameOver continue, so inside `Watching` those buttons would be inert in joined games.
            */}
          {cont.kind === 'gameOver' ? (
            <AskStrip cont={cont} onNewGame={() => store.reset()} />
          ) : (
            <Watching canAct={acting}>
              <div className="hand-row">
                <Hand state={state} cont={cont} />
              </div>
              {/*
                * The three that share the hand's grid area, and none of them mount in watch mode:
                * the Prelude, the tray and the strip are all menus addressed to somebody else, and
                * the fan they would cover is the one thing in this band that is still yours.
                */}
              {watched !== null ? null : (
                <>
                  {/* Shares the hand's grid area, as a sibling: `.hand-row` clips its own children. */}
                  <PreludeScreen state={state} cont={cont} />
                  {/* The action phase, on the same terms as the Prelude: over the hand, map still visible. */}
                  <ActionTray state={state} cont={cont} />
                  {/* Every decision without a bespoke surface, in the same band — see AskStrip. */}
                  <AskStrip cont={cont} onNewGame={() => store.reset()} />
                </>
              )}
            </Watching>
          )}
          <PlayerBoards state={state} current={current} />
        </section>
        {logOpen || logPinned ? (
          <div className="log-drawer" role="complementary" aria-label="Game log">
            <div className="log-drawer-head">
              <span>Log</span>
              <div className="log-drawer-tools">
                <button
                  className={logPinned ? 'ghost log-pin on' : 'ghost log-pin'}
                  title={logPinned ? 'Unpin — float the log over the board' : 'Pin — give the log its own column'}
                  aria-pressed={logPinned}
                  onClick={() => setSettings({ logPinned: !logPinned })}
                >
                  ⇱
                </button>
                {/* Closing unpins. A drawer you shut that comes straight back is a broken button. */}
                <button
                  className="ghost"
                  onClick={() => {
                    setLogOpen(false)
                    setSettings({ logPinned: false })
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
            <LogPanel log={state.log} />
          </div>
        ) : null}
      </main>

      {/*
        * The interludes: chapter scoring and the game's end. Presentation, not decisions — every
        * seat and spectator sees them and dismisses their own — so they live outside `Watching`.
        */}
      <ChapterInterlude />
      <GameOverScreen state={state} cont={cont} />

      {/* Rules: not a decision either, and a spectator has eyes. */}
      {rulesOpen ? <RulesModal onClose={() => setRulesOpen(false)} /> : null}

      {/* Settings: not a decision, so outside `Watching` — a spectator has ears. */}
      {settingsOpen ? (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          {...(seatView.kind === 'seat'
            ? { seat: { faction: seatView.faction, link: store.sessionLink() } }
            : {})}
        />
      ) : null}

      {/*
        * The windows and screens, every one of them somebody's decision. One condition covers the
        * lot because they are all in this file — the property that made a single `Watching` wrapper
        * enough when the rule was "gray them out" makes a single `null` enough now that it is "do
        * not draw them at all". The cost is real and deliberate: a rival's battle window goes too,
        * and the feed narrates the roll instead ("red attacks white in 1-Arrow: rolled 2S/0A/0R →
        * 1 hits"). Someone who would rather watch the dice turns watch mode off.
        */}
      <Watching canAct={acting}>
        {watched !== null ? null : (
          <>
            {/*
              * The battle window, with the dice. It used to be rendered from inside `Board` — harmless,
              * since it is a fixed-position modal, but it put the one surface a watcher most wants
              * outside the wrapper that governs them. Every decision surface is now in this file, which
              * is what makes one wrapper enough.
              */}
            <Battle state={state} cont={cont} />

            {/* The draft is its own screen, over the board it is about to populate. */}
            <DraftScreen state={state} cont={cont} />

            {/* The Archivist's post-setup draw, on the same terms as the draft it follows. */}
            <LearnedScreen cont={cont} />

            {/* Choosing what to keep when the slots are full. */}
            <SlotBoard state={state} cont={cont} />

            {/* Spending raid keys after a battle. */}
            <RaidModal cont={cont} />

            {/* Influence, Secure and Ransack — the court decisions, as the cards themselves. */}
            <CardShelf state={state} cont={cont} />

            {/* The focused matrices: resource picks, card gifts and steals, the Broker's trade. */}
            <AskModal cont={cont} />
          </>
        )}
      </Watching>
    </div>
  )
}
