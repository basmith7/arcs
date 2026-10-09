---
id: T-10
title: "Catch-up card and Scoreboard: three small polish items from review"
status: todo
priority: low
labels: []
depends: []
created: 2026-10-05T08:37:56Z
updated: 2026-10-05T08:37:56Z
---
Deferred minors from arcs/T-4's reviews (Fable, DeepSeek). None blocks play.

1. **The catch-up card covers map targets for the whole turn.** `.cu-card` (styles.css, z-index 60, 380px; up to 60% of the map on a phone) sits over the map's foot until dismissed, so systems under it can't be tapped. Idea: collapse it to its title once the seat plays its opening card.
2. **The story slot is held 120 s, but the server writes stories one at a time** (`catchup.ts` single chain; one story is up to 4 calls × 30 s). With several games handing off at once a story can land after the slot is released and push the card's height. Idea: per-game concurrency, or hold the slot until a "no story" signal.
3. **Desktop Scoreboard reopens after toggling the phone layout** on and off (`App.tsx` `scoreOpen` is not reset when `phone` turns true).

## Done when
- [ ] The card no longer blocks map taps after the seat's opening play (screenshot)
- [ ] A late story never shifts the card (or the slot holds until the server says no story is coming)
- [ ] Toggling phone layout closes the Scoreboard dialog
