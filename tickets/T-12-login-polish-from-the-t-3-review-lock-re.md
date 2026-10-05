---
id: T-12
title: Login polish from the T-3 review (lock refresh, presence, CSRF, silent failures)
status: todo
priority: low
labels: []
depends: []
created: 2026-10-05T19:42:05Z
updated: 2026-10-05T19:42:05Z
---
Minor findings from the Fable/DeepSeek reviews of arcs/T-3, left for later:
1. Presence is checked only at websocket upgrade (`server.ts` ~198): a socket opened before a `/sit` keeps presence for the locked seat and can hold back the owner's Discord ping. Re-check `seatAccess` in the 'active' handler, or drop that seat's presence in `onSeatsChanged`.
2. Client lock state only refreshes on `resync`: after a release, a watcher keeps the locked banner until reload; after someone else sits, a tab looks playable until its next move 403s. On a seats push where your seat's `owner` changed, call `resync()`.
3. Cookie POSTs (`/sit`, `/release`, `/auth/logout`) accept `text/plain` from sibling `*.basmith.net` origins (SameSite is site-wide). Check `Origin` against `PUBLIC_ORIGIN`, or require `content-type: application/json`; consider `__Host-` cookie names when Secure.
4. Silent failures: `App.tsx` `onSit={() => void store.sitHere()}` swallows 401/403; `MyGames.tsx` "Add selected" reports only 403s.
5. An owner renaming through `/seat` still runs `bot.resolveMember` and writes `seat.discord_id` while claimed; skip the Discord branch when `accountId` is set.
6. `seat.account_id` has no index or `REFERENCES account(id)` (the spec has the FK).

## Done when
- [ ] Each item fixed or consciously dropped, with a test for 1–3.
