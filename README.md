## Self-hosting (this fork)

`packages/server-node` is a Node 22 server that stores games in SQLite, runs the engine to refuse
out-of-turn actions and play bot seats, and posts Discord turn pings. Dev: `npm run build:site && npm run dev:server`
(port 3070). Production: `docker-compose.prod.yml`, image `ghcr.io/basmith7/arcs`, built on `v*` tags.
Design: `docs/superpowers/specs/2026-09-09-arcs-online-design.md`.

Turn and game-over pings can tag a player on Discord with `<@id>` instead of just naming them.
When sitting down, a player may paste their Discord user ID (Settings → Advanced → Developer Mode,
then right-click yourself → Copy User ID) — a bare snowflake or an `@mention` both work. Set
`DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID` and (optionally) `DISCORD_CHANNEL_ID` and the server does
this automatically: it looks up a guild member whose username, display name or nickname matches the
claimed seat name, so most players never have to paste anything. `DISCORD_CHANNEL_ID` additionally
lets games with no webhook of their own post turn pings to that channel via the bot. `allowed_mentions`
always locks the ping down to the specific tagged user(s); it never allows `@everyone`, roles, or
untagged mentions through.

If you're active on the board (a live socket, seen within the last two minutes) when it becomes
your turn, we notify you there first — a browser notification and a flashing tab title, if you've
granted permission — instead of pinging Discord right away. The Discord ping only follows if you
haven't moved after 10 minutes, or sooner if you close the tab and don't come back within a minute.
Each seat has its own "Discord pings" toggle (on by default, in Settings → Notifications) to opt out
of pings entirely on either transport; it has no effect on game-over or chapter-end messages, which
always post. Grace windows are configurable via `PRESENCE_ACTIVE_MS` (default 120000), `PING_GRACE_MS`
(default 600000) and `LEAVE_GRACE_MS` (default 60000).
