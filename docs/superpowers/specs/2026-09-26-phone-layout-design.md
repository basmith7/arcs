# Phone layout — design

Brian's brief (2026-09-26): a proper mobile interface, portrait first, for the core phone job —
**a Discord ping arrives, open the game, take the turn, close it**. Watching and long sessions
are secondary. Build until playable; no review stops. Offer versions where a choice is a matter
of taste and let players pick in Settings.

## Activation

- `html.phone` is on when the window is narrower than 600 CSS px **and** the Settings choice
  "Phone layout" is *Mobile* (the default). Any narrow window qualifies, touch or not, so it can be
  developed in a desktop browser.
- *Zoomable desktop* is the v1 fallback (`phone-canvas.ts`): the desktop table at 1280 wide,
  pinch to zoom. A phone held sideways always gets the canvas — the desktop layout fits there.
- The title screen is unchanged (it already fits a phone).

## Frame (portrait, ~390×750 visible)

```
┌─────────────────────────┐
│ topbar: round · TURN X ☰│  44px, toolbar folded into the ☰ menu
├─────────────────────────┤
│                         │
│   map (zoom + pan)      │  flex 1
│                         │
├─────────────────────────┤
│ dock: current decision  │  hand / Prelude / action tray / ask strip; auto height, capped
├─────────────────────────┤
│ Court Ambit Boards Log  │  tab bar, 52px
└─────────────────────────┘
```

- **Same components, rearranged.** App.tsx keeps mounting every surface; `.app.phone` and CSS in
  `phone.css` place them. Court, ambitions, player boards and the log are hidden until their tab
  opens them as a bottom sheet over the map. Nothing about decisions is duplicated.
- **Sheets follow the decision.** When the current ask's surface is `ambitions`, that sheet opens
  by itself; when it is `map`, sheets close so the map is in view. The tab for a surface that
  holds the current decision carries a dot.
- **Map zoom.** The map sits in a scroll container; zoom sets the SVG's box size (not a
  transform), so Board's `unitsPerPx` measurement and click hit-testing stay correct. One finger
  pans (native scroll), two fingers pinch, and +/−/fit buttons sit in the corner. Default zoom
  fills the map area's height.
- **Hand.** A scrolling row instead of a fan. Hover does not exist on a phone, so a tap *selects*
  a card and its play buttons appear under it; a second tap on a card with one ordinary play
  plays it. (The desktop fan keeps hover.)
- **Hover-only information** gets a tap path where it matters for a decision: the ambition tips.
  `title` tooltips are left alone.
- **Dialogs and full-screen screens** (battle, raid, shelf, slots, ask modal, draft, learned,
  chapter interlude, game over, card zoom, leader reader, settings, rules, name prompt) become
  full-width sheets that scroll; rules in `phone-modals.css`, scoped under `html.phone`.

## Versions (Settings → Phone)

- **Phone layout:** Mobile / Zoomable desktop.
- **Hand:** Row (scrolling, full-size cards) / Grid (all cards visible at once, smaller).

## Testing

Headless Chrome at Pixel 7 / iPhone SE portrait sizes, driven through a real game against bots
and through the fixtures in `saves/` (battle, raid, shelf, lore asks). Each surface gets a
screenshot check. The existing vitest suite must stay green; the engine is untouched.
