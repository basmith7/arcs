# Agent instructions

## Arcs online — current state (as of 2026-09-09)

`~/Projects/arcs` (fork of willhaywood/open-arcs) is live at https://arcs.basmith.net — Tower port
3070, Pangolin resource 20, compose project `arcs`, SQLite at `/mnt/cache/appdata/arcs/arcs.db`.
Release: tag `vX.Y.Z` → GHCR → Watchtower (or `docker compose -p arcs pull && up -d` on Tower).

v0.3.1 adds presence-aware Discord pings (browser Notification while the player's socket is live;
Discord after `PING_GRACE_MS`=10 min idle or 60 s after they leave), a per-seat "Discord pings"
toggle, and one unified Settings modal. Reuses the Pikachu bot token (Tower container
`palworld-discord-bot`) via Tower `.env`; `#arcs` channel id `1547291047279984791`.

Still open: webhook transport never exercised live; grace timers are in-memory so a deploy drops
that turn's follow-up; phone layout and the Blighted Reach campaign are still to spec; three
malformed probe games linger in the prod DB; the `cloudflare` deploy job runs on fork pushes (no-op);
no game retention sweep; `x-forwarded-for` is trusted blindly (fine behind Traefik).

Upstream merges use `git merge upstream/main` (kept additive in packages/engine, packages/server,
apps/web). Read the Infrastructure map before touching arcs deploy or Pangolin.
