# Agent instructions

## Arcs online — current state (as of 2026-09-22)

`~/Projects/arcs` (fork of willhaywood/open-arcs) is live at https://arcs.basmith.net — Tower port
3070, Pangolin resource 20, compose project `arcs`, SQLite at `/mnt/cache/appdata/arcs/arcs.db`.
Release: tag `vX.Y.Z` → GHCR → `scripts/deploy-now.sh vX.Y.Z` (waits for the build, then runs Tower's `deploy-app`).
**Current release: v0.12.0.** Keep this line current — it was four releases stale before 09-22.

What has shipped since v0.1.0, newest first: **v0.12.0** a game link with no seat token (and none stashed in this browser) asks "Who are you?" — the human seats by name, or Just watching; a pick calls `POST /games/:id/claim {faction}` for that seat's token (deliberately trusting: anyone with the game link can take a human seat, never a bot's) and joins it before dropping the watching session; also fleets sit by the gate ring and hovering a piece lights its system; **v0.11.2** your hand can be read on other players' turns in a joined game (it sat inside `Watching`'s `inert`, which blocks `:hover` and taps; it is now beside it); **v0.11.1** Populist Demands' skip (`vox/done`) is drawn in the declare hint (`declareHint` in `surfaces.ts` pairs each declare type with its decline); **v0.11.0** `hard` scores the pip menu with each action's sub-flow resolved (`settleSubflows`, gated as `exp:s1`: +6.3 pts win share per side, z 2.68 — docs/19 §26), and bots think in a worker on both the server (`worker_threads`, `bot-worker.js` beside `main.js`) and the page (a Web Worker), so a multi-second `hard` decision no longer stalls the server or freezes the tab. The week's other experiments (committed strategies, B2, engine speed, learned policy) were null and are written up in docs/19 §26 and `docs/spikes/`; their raw run data is in `runs/archive-2026-09.tar.xz`; **v0.10.1** the phone map pans, pinches and zooms while you watch another turn (only the Board sits inside `Watching`'s `inert`, not MapZoom); **v0.10.0** Undo works online: `POST /games/:id/undo` takes back the seat's own last move while nobody has acted since and it revealed nothing (engine `takeBackBlock`: no dice/shuffle, no card from a deck, the undealt discard or a rival's hand, no Farseers look); watchers get a `reset` push; the Undo button disables itself with the reason. This replaces hand-editing the journal for most misclicks; **v0.9.4** the remaining cost traps from a review: a 350 ms tap guard in `store.apply` (a double tap used to play two actions), alts offered only when opening them does something (`usefulAlts`), refunding opening Cancels on alts and the battle dice, and leader follow-ups marked `followed` so their Cancel never refunds; `dead-ends.test.ts` walks leaders-and-lore bot games for dead ends; **v0.9.3** the same refund for an action bought in the Prelude — the Cancel puts the paid resource back in its slot (`turn/prelude-refund`); **v0.9.2** Discord turn pings carry the bare game link, not the seat's — the browser's stashed seat (`recall`) puts the player in; **v0.9.1** Cancel on an action's first picker (Move, Tax, Build, Repair, Influence, Secure, Battle's system/target) gives the pip back — `refund: true` on the skip; older journaled Cancels still spend it, so saved games replay unchanged; **v0.9.0** a phone layout for the game screen (window < 600px, upright): map in a pinch/pan window, the current decision docked at the bottom, Court/Ambitions/Players/Log as sheets; sideways or by choice, the desktop table on a zoomable canvas (Settings > Phone; spec `docs/superpowers/specs/2026-09-26-phone-layout-design.md`); **v0.8.0** a stronger `hard` bot — it sends ships toward what its ambition needs (`moveToward`) and seizes the initiative when that buys a declaration (`seizeReady`); +25 pts win share per side vs the old `hard` at 4p (docs/19 §23), a 6.7x faster evaluator (§21), and `npm run advise -- <gameId> <faction>` (read-only advice for a live seat); **v0.7.1** the rulebook 6.2.3 win tie-break (a tie for
the most power goes to the tied player earliest in *turn* order, not the earliest seat); **v0.7.0** a
Search tab in the rules reader (Rules Library text in `assets/rules/data/rules-text.json`, refreshed
with `node scripts/fetch_rules_text.mjs`); **v0.6.x** the board hushed while you watch someone else's
turn, and log card/system names made hoverable and drawn as the board's own marks; **v0.5.0** the
in-game rulebook and player aids under `/rules`, turn-grouped log, watch-other-turns feed; **v0.4.1**
Settings > Board > Dim map art; **v0.3.1** presence-aware Discord pings (browser Notification while
the player's socket is live; Discord after `PING_GRACE_MS`=10 min idle or 60 s after they leave), a
per-seat "Discord pings" toggle, and one unified Settings modal. The pings reuse the Pikachu bot
token (Tower container `palworld-discord-bot`) via Tower `.env`; `#arcs` channel id
`1547291047279984791`.

Still open (verified 2026-09-22 unless noted): webhook transport never exercised live — the
`game.webhook_url` column is there and unused; grace timers are in-memory in
`packages/server-node/src/main.ts`, so a deploy drops that turn's follow-up; `normal` still has the pip-menu tie that `hard` no longer has (needs its own gate); bot thinking is one worker per server, so two games' bots take turns thinking; the Blighted Reach campaign is
still to spec; the `Deploy` (cloudflare) job still runs on every fork
push as a no-op; `x-forwarded-for` is trusted blindly in `api.ts` (fine behind Traefik).

**Optional Discord login** (arcs/T-3, spec `docs/superpowers/specs/2026-10-04-optional-login-design.md`):
on only when `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` are set (redirect
`${PUBLIC_ORIGIN}/auth/discord/callback`); unset, every seat plays by link as before, including seats
claimed while it was on. Seat links stay the way in; a signed-in player's "Sit here" tap locks a seat
to their account (`seat.account_id`), and pings then use the account's Discord id. Still open: the
old name-matching (`bot.resolveMember`) and pasted-id Discord links coexist with sign-in; a player who
loses their Discord account is unlocked by hand (`UPDATE seat SET account_id = NULL WHERE token = ?`).

Two rules deviations are known and deliberate, both in docs/15 section 5: the chapter-end ambition
**marker flip** is modelled as HRF's sliding window rather than the rulebook's flip-the-lowest
procedure, and **Gate Ports' "max 1 per gate"** counts per faction where Cloud Cities counts
card-placed cities. The third item there — the win tie-break — was fixed in v0.7.1.

The prod DB holds 13 games and **no retention sweep exists**. Three are malformed probes with the
old options shape (`{"players":2,"seed":N,"bots":["blue"]}` — no board, no factions); six more are
well-formed but were never played (0 journal rows). Only four have real play.

Upstream merges use `git merge upstream/main` (kept additive in packages/engine, packages/server,
apps/web). `willhaywood/open-arcs` squash-merges, so its stale side branches read as "ahead" of
`main` while their content is already in it — check the content, not the commit ids. Read the
Infrastructure map before touching arcs deploy or Pangolin.
