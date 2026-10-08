# Agent instructions

## Arcs online

Live at https://arcs.basmith.net; deploy, ports and paths are in Vault-13 Infrastructure.md (arcs row).
Release: tag `vX.Y.Z` → `scripts/deploy-now.sh vX.Y.Z`.

Current release: v0.14.0; see CHANGELOG.md.

Still open (verified 2026-09-22 unless noted): webhook transport — the
`game.webhook_url` column is wired but never exercised live; grace timers are in-memory in
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

No retention sweep exists for old games.

Upstream merges use `git merge upstream/main` (kept additive in packages/engine, packages/server,
apps/web). `willhaywood/open-arcs` squash-merges, so its stale side branches read as "ahead" of
`main` while their content is already in it — check the content, not the commit ids. Read the
Infrastructure map before touching arcs deploy or Pangolin.
