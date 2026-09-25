# Agent instructions

## Arcs online — current state (as of 2026-09-22)

`~/Projects/arcs` (fork of willhaywood/open-arcs) is live at https://arcs.basmith.net — Tower port
3070, Pangolin resource 20, compose project `arcs`, SQLite at `/mnt/cache/appdata/arcs/arcs.db`.
Release: tag `vX.Y.Z` → GHCR → Watchtower (or `docker compose -p arcs pull && up -d` on Tower).
**Current release: v0.8.0.** Keep this line current — it was four releases stale before 09-22.

What has shipped since v0.1.0, newest first: **v0.8.0** a stronger `hard` bot — it sends ships toward what its ambition needs (`moveToward`) and seizes the initiative when that buys a declaration (`seizeReady`); +25 pts win share per side vs the old `hard` at 4p (docs/19 §23), a 6.7x faster evaluator (§21), and `npm run advise -- <gameId> <faction>` (read-only advice for a live seat); **v0.7.1** the rulebook 6.2.3 win tie-break (a tie for
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
`packages/server-node/src/main.ts`, so a deploy drops that turn's follow-up; phone layout and the
Blighted Reach campaign are still to spec; the `Deploy` (cloudflare) job still runs on every fork
push as a no-op; `x-forwarded-for` is trusted blindly in `api.ts` (fine behind Traefik).

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
