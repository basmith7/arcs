# Arcs online — design

Date: 2026-09-09
Status: approved in conversation, awaiting written review

## 1. Goal

A web app where Brian and friends play Arcs (base game, 2–4 players, Leaders & Lore optional)
from their own devices, live or over days, with bot seats, hosted on Tower behind Pangolin at
`arcs.basmith.net`. The Blighted Reach campaign is a later spec.

## 2. Starting point

This repo is a fork of [willhaywood/open-arcs](https://github.com/willhaywood/open-arcs) (MIT),
taken at upstream commit `fb94454` (2026-09-08). Verified before forking: 1029 tests pass,
`npm run typecheck` is clean. Upstream already provides:

- `packages/engine` — deterministic rules engine, journal replay, base game + Leaders & Lore,
  2–4 players, bots at three levels (`easy`, `normal`, `hard`).
- `apps/web` — Vite + React client; hotseat and joined (multiplayer) modes; per-seat links
  `#/g/<gameId>/s/<seatToken>`; spectator links without a seat token.
- `packages/server` — a `GameStore` interface (`create`, `read`, `append`, optional
  `subscribe`), a platform-free `handle(Request, store)` serving three endpoints, an in-memory
  store, and a Cloudflare Durable Object adapter with a push WebSocket at `/games/:id/live`.
- Real artwork (Kyle Ferrin / Buried Giant Studios) committed on a fan-project,
  take-down-on-request footing. Kept as-is; this deployment is for private play among friends.

Two upstream limits drive this design:

1. **Bots are dropped from joined games** (`NewGame.createShared`), because bots run in the
   browser and their moves would never reach the shared journal.
2. **The server never runs the engine**, so it cannot know whose turn it is and cannot notify.

Both are solved the same way: our server imports `@arcs/engine`.

## 3. Repository layout and upstream tracking

- Clone at `~/Projects/arcs`. Remotes: `origin` = `basmith7/arcs`, `upstream` = open-arcs.
- New code lives in **`packages/server-node`**, plus `Dockerfile`, `docker-compose.prod.yml`,
  `.github/workflows/deploy.yml`, `.devports` entry and this spec. Changes inside `packages/engine`,
  `packages/server` and `apps/web` are kept minimal and additive so `git merge upstream/main` stays
  cheap.
- Dev ports: block **3070–3079**. `3070` = the Node server serving API + built client (same-origin,
  the production shape). `3071` = Vite dev server for the fast loop, pointed at 3070 via
  `VITE_MULTIPLAYER_URL=http://localhost:3070`. Register both in `~/Projects/PORTS.md` and
  `~/Projects/.devports`.

## 4. Server (`packages/server-node`)

Node 22, TypeScript, run with `tsx` in dev and compiled with `tsc` for the image. Dependencies:
`ws` for WebSockets, `node:sqlite` (built into Node 22, already used by upstream's tests) for
storage, `@arcs/server` for `handle` and the store types, `@arcs/engine` for replay and bots.
No framework: upstream's `handle` is `Request → Response`, so the HTTP layer is `node:http` plus a
hand-written shim (IncomingMessage → `Request`, `Response` → ServerResponse, ~40 lines). The
WebSocket upgrade needs the raw `node:http` server anyway, which is why no adapter library is used.

### 4.1 Storage — `SqliteStore implements GameStore`

One database file, path from `DATABASE_PATH` (default `./data/arcs.db`), WAL mode.

```sql
CREATE TABLE game    (id TEXT PRIMARY KEY, options TEXT NOT NULL, created_at INTEGER NOT NULL,
                      webhook_url TEXT, last_notified_length INTEGER NOT NULL DEFAULT -1);
CREATE TABLE seat    (game_id TEXT, ord INTEGER, faction TEXT NOT NULL, token TEXT NOT NULL UNIQUE,
                      name TEXT, is_bot INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (game_id, ord));
CREATE TABLE journal (game_id TEXT, idx INTEGER, action TEXT NOT NULL, PRIMARY KEY (game_id, idx));
```

- `append` is the compare-and-set: `INSERT ... WHERE (SELECT COUNT(*) FROM journal WHERE game_id=?) = ?`
  inside a transaction; row count 0 → `conflict`. It checks the seat and `actorOf` like upstream and
  **does not** check turn order, so upstream's `contract.ts` suite runs against this store unchanged
  (rule 2 of upstream docs/17 §4b). Turn order is the gate's job (§4.3).
- `subscribe` is implemented (in-process `Map<gameId, Set<listener>>`), which is what feeds push.
- `read` accepts a seat token and returns `yourFaction` exactly as upstream.

### 4.2 HTTP and WebSocket

Routes, all same-origin:

| Route | Behaviour |
| --- | --- |
| `POST /games` | Upstream contract, extended: body may carry `bots: string[]`, `botLevel`, `webhookUrl`. Bot seats get no token in the response (nothing to hand out). Options are stored verbatim **including** `bots`/`botLevel`, so every client replays the same game. |
| `GET /games/:id?since=N` | Upstream contract. Also returns `seats: [{faction, name, isBot}]` (no tokens) so the UI can label seats. |
| `POST /games/:id/actions` | Upstream contract, routed through the engine gate (§4.3), which adds a **turn check**. |
| `POST /games/:id/seat` | body `{ seatToken, name }` — claims a name for a seat. 1–24 chars, trimmed. Idempotent. |
| `GET /games/:id/live` | WebSocket. Push-only; message shape `{ from, entries }` identical to upstream's Durable Object so `session.ts` needs no change. Fed by `subscribe`. |
| `GET /healthz` | `200 ok` for Watchtower / Pangolin health checks. |
| everything else | Static files from `apps/web/dist`, falling back to `index.html`. `/games*` never falls through to static. |

### 4.3 The engine gate

`EngineGate` wraps a `GameStore` and is what the HTTP layer talks to. It is the one place the
server runs rules. For a game it holds the last replayed `RuleResult` (LRU of 100 games; a miss
replays the journal with `replayGame(options, journal, defaultRegistry())`, ~25 ms for a full
game). Who acts next is `result.continue`: `kind === 'ask'` names the faction; `over` means the
game is finished. Nothing derived is ever persisted.

- **Turn check.** `append` first compares `actorOf(action)` with the asked faction; mismatch →
  `403 { reason: 'wrong-turn' }`, and nothing is stored. Only then does it call the store's
  compare-and-set. Upstream's contract test "does NOT check whose turn it is" describes the bare
  store and still holds; the gate's own tests assert the opposite for the gate.
- **Bot seats.** After a successful append the gate applies the action to the cached result. If
  the next ask is for a bot seat (`botToAct(result, options.bots)`) it runs `stepBot` with the
  seat's `botForLevel(options.botLevel)`, carrying `asked` between steps as `stepBots` does, and
  appends each bot action through the store with an internal, never-issued seat token. It repeats
  until a human is asked or the game is over, pausing `BOT_PACE` = 1000 ms between bot actions so
  the event visuals in connected clients still read. Bot stepping runs on a per-game promise queue
  so a human append cannot interleave with it. On server start the gate resumes every unfinished
  game whose next ask is a bot.
- **Whose turn** for notifications (§5), computed from the same cached result.

### 4.4 Client changes (small, in `apps/web`)

- `NewGame.createShared` stops dropping bots and sends `bots`, `botLevel`, `webhookUrl`.
- `ShareGame` shows a webhook URL field and hides links for bot seats.
- On first open of a seat link with no name on the server, a small modal asks for a name and calls
  `POST /games/:id/seat`. `SeatBadge` and player boards show names when present, falling back to
  faction colour.
- `store.botsAvailable` returns false in joined games (bots are the server's job), so the browser
  never steps a bot in a joined game.
- The existing "trust the table" note stays in the UI.

## 5. Notifications

When a game has `webhook_url` and, after an append (human or bot), `state.current` is a human seat
that differs from the previous human-to-act, the server POSTs a Discord webhook message:
`**<name or faction>**, it's your turn in Arcs (chapter N) — <seat link>`. The seat link is
`PUBLIC_ORIGIN` + `/#/g/<gameId>/s/<seatToken>`.

- Rate-limit: never more than one message per game per 60 s; if a turn passes back to the same
  player within the window the second ping is skipped. `last_notified_length` records the journal
  length of the last ping so restarts don't repeat it.
- Chapter end and game over each send one message regardless of the window (scores).
- Webhook URL is stored server-side only and is never returned by any endpoint.
- Failures are logged and ignored; notifications are best-effort.

## 6. Deployment

- **Image:** multi-stage `Dockerfile`. Builder: `npm ci`, `npm run build:site` (same-origin build,
  `VITE_MULTIPLAYER_URL=`), `tsc -p packages/server-node`. Runner: `node:22-alpine`, production
  `node_modules` only, `apps/web/dist` + compiled server. `EXPOSE 3070`. No native modules.
- **CI:** `.github/workflows/deploy.yml` mirrors golfbet: on tag `v*` (or manual dispatch) build and
  push `ghcr.io/basmith7/arcs:latest` and `:<tag>`.
- **Tower:** `docker-compose.prod.yml` with `image: ghcr.io/basmith7/arcs:latest`, host port
  `3070:3070`, volume `/mnt/cache/appdata/arcs:/data`, `DATABASE_PATH=/data/arcs.db`,
  `PUBLIC_ORIGIN=https://arcs.basmith.net`, label
  `com.centurylinklabs.watchtower.enable=true` so golfbet's host-wide Watchtower rolls it out.
  Compose file and env live in Tower's appdata share like the other apps.
- **Pangolin:** new resource `arcs.basmith.net → 192.168.1.149:3070` with a Newt health check on
  `/healthz`, created by the documented procedure (Vault "Pangolin VPS Migration"). WebSocket
  upgrade must pass through Traefik; verify with the live socket, since polling fallback would mask
  a broken upgrade. DNS is covered by the existing `*.basmith.net` wildcard.
- **Infrastructure map:** add the arcs row to the App deployments table and the port registry in
  the same session as the deploy.
- Releases are tagged only when Brian asks.

## 7. Testing

- Engine and web tests: untouched, must stay green after every upstream merge.
- `packages/server-node/test`:
  - upstream `describeStoreContract('SqliteStore', ...)` against a temp-file database;
  - turn check rejects an out-of-turn action and accepts the in-turn one;
  - bot stepping: a game with one bot seat and a human lead reaches the human's next ask with the
    bot's actions in the journal, and a restart resumes a bot mid-turn;
  - name claim: set, re-set (idempotent), rejected when empty or over 24 chars;
  - notifications: a fake webhook receives exactly one message on a human turn change, none within
    the rate window, one at chapter end.
- Manual before first tag: two browsers plus one bot on `localhost:3070`, live socket confirmed in
  devtools, a Discord ping received.

## 8. Out of scope (this spec)

- Blighted Reach campaign — own spec; `haunt-roll-fail` (Scala, MIT) is the rules reference.
- Server-side hidden information (redacted hands and rolls). Trust the table.
- Accounts, game listings, chat. Links are the identity; Discord is the chat.
- Replacing the artwork.
