# Agent instructions

## Arcs online

Live at https://arcs.basmith.net; deploy, ports and paths are in Vault-13 Infrastructure.md (arcs row).
Release: tag `vX.Y.Z` → `scripts/deploy-now.sh vX.Y.Z`.

Current release: v0.17.0; see CHANGELOG.md.

Still open (verified 2026-09-22 unless noted): `normal` still has the pip-menu tie that `hard`
no longer has (needs its own gate); bot thinking is one worker per server, so two games' bots take
turns thinking; the Blighted Reach campaign is still to spec; `x-forwarded-for` is trusted blindly
in `api.ts` (fine behind Traefik).

**Durable pings and daily reminder** (`notify.ts`): held turn pings and stall reminders live in
SQLite (`pending_ping`, `reminder`) and one 30 s sweep sends what is due, so a deploy drops nothing.
A game waiting on the same human for 24 h or more gets a Discord ping at the next 16:30
America/Phoenix, then daily, up to 7 per stall; env `REMINDER_TIME` (default `16:30`, `off`
disables) and `REMINDER_TZ`. Pings go through the channel bot only; the per-game webhook is gone.

**Optional Discord login** (spec `docs/superpowers/specs/2026-10-04-optional-login-design.md`):
on in production since v0.14.1 (Pikachu app); on only when `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` are set (redirect
`${PUBLIC_ORIGIN}/auth/discord/callback`); unset, every seat plays by link as before, including seats
claimed while it was on. Seat links stay the way in; a signed-in player's "Sit here" tap locks a seat
to their account (`seat.account_id`), and pings then use the account's Discord id. Kept on purpose
(issue #20): the old name-matching (`bot.resolveMember`) and pasted-id Discord links coexist with
sign-in, because friends who never sign in still need their pings; a claimed seat ignores both and
reads its Discord id through the account. A seat locked to the wrong account is unlocked by its owner
or by any signed-in account holding another seat in the same game (Settings "Release seat", or the
locked banner's "Unlock seat"; `POST /games/:id/release`).

Two rules deviations are known and deliberate, both in docs/15 section 5: the chapter-end ambition
**marker flip** is modelled as HRF's sliding window rather than the rulebook's flip-the-lowest
procedure, and **Gate Ports' "max 1 per gate"** counts per faction where Cloud Cities counts
card-placed cities. The third item there — the win tie-break — was fixed in v0.7.1.

No retention sweep exists for old games.

Upstream merges use `git merge upstream/main` (kept additive in packages/engine, packages/server,
apps/web). `willhaywood/open-arcs` squash-merges, so its stale side branches read as "ahead" of
`main` while their content is already in it — check the content, not the commit ids. Read the
Infrastructure map before touching arcs deploy or Pangolin.
