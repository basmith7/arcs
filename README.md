## Self-hosting (this fork)

`packages/server-node` is a Node 22 server that stores games in SQLite, runs the engine to refuse
out-of-turn actions and play bot seats, and posts Discord turn pings. Dev: `npm run build:site && npm run dev:server`
(port 3070). Production: `docker-compose.prod.yml`, image `ghcr.io/basmith7/arcs`, built on `v*` tags.
Design: `docs/superpowers/specs/2026-09-09-arcs-online-design.md`.
