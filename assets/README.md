# Asset Manifest

`manifest.json` — **912 image asset declarations** extracted from haunt-roll-fail's
`haunt-roll-fail/arcs/meta.scala`, which is MIT licensed.

**This directory contains no image data and should not.** See "Sourcing" below.

Date extracted: 2026-07-22

## What's in the manifest

Every entry carries:

| Field | Meaning |
| --- | --- |
| `id` | The name the engine refers to the asset by |
| `filename` | Basename on disk (usually identical to `id`) |
| `scale` | Percentage the source art is downscaled to at build time |
| `lossless` | Whether HRF encodes this losslessly |
| `src` | Path in the (unpublished) source tree, e.g. `icon/material.png` |
| `url` | Path on HRF's server, e.g. `/hrf/webp2/arcs/images/icon/material.webp` |

## Groups

| Group | Count | Scale | What it is |
| --- | ---: | ---: | --- |
| `(root)` | 55 | 100% | Map, region index bitmaps, broken-gate overlays, chapter/act markers |
| `icon` | 67 | 40% | Resources, suits, UI glyphs |
| `action` | 121 | 100% | The action card deck |
| `court` | 46 | 100% | Guild and Vox cards |
| `setup` | 12 | 100% | Setup cards |
| `leader` | 16 | 100% | Leaders (Leaders & Lore) |
| `lore` | 30 | 100% | Lore cards (Leaders & Lore) |
| `empire` | 25 | 100% | Campaign empire boards |
| `fate` | 25 | 100% | Fate cards |
| `f01`–`f24` | 370 | 100% | Per-fate card sets — 24 groups |
| `ambition` | 11 | 41.4% | Ambition markers |
| `figure` | 110 | 11–54.3% | Ships, cities, starports, agents, per colour — 6 groups by scale |

Phase 1 (base game + Leaders & Lore) needs roughly `(root)`, `icon`, `action`, `court`, `setup`,
`leader`, `lore`, `ambition`, `figure` ≈ **468 assets**. The remaining ~444 (`empire`, `fate`,
`f01`–`f24`) are campaign-only — see [docs/04](../docs/04-scope-and-phasing.md).

## Notable findings

**The conditional-loading mechanism is unused.** Every group's condition in HRF is literally
`true`, so a base-game player downloads all 444 campaign assets they will never see. Our manifest
should populate those conditions for real — this is the concrete case for the conditional manifest
recommended in [docs/04](../docs/04-scope-and-phasing.md), section 3.

**The 21 lossless entries are functional, not decorative.** `map-regions` and
`map-regions-select` are the colour-indexed hit-testing bitmaps (see
[docs/01](../docs/01-reference-implementation-hrf.md), section 3.5) — every system is a flat unique
RGB value, so *any* lossy compression corrupts them. The broken-gate overlays are lossless for the
same reason. If we adopt the same technique, these must never go through a lossy encoder.

**Scale factors tell us relative render sizes.** Figures at 11% versus cards at 100% indicates the
source art is uniformly high-resolution and downscaled per use. Useful for sizing our own art, but
note the manifest records *percentages, not pixel dimensions* — actual dimensions are not derivable
from it.

## Sourcing — decided: local personal use only

**Decision (2026-07-22): option 3 from [docs/01](../docs/01-reference-implementation-hrf.md),
section 4.3 — a personal-use-only build that is never shared, published or uploaded.**

The images are the physical game's component art (Leder Games / Kyle Ferrin). They are **not** in
HRF's MIT-licensed repository, and that exclusion is deliberate: the code is MIT, the artwork is
not. HRF hosts it without a licence we can inherit.

`assets/images/` therefore holds a local working copy fetched from HRF's server via
`scripts/fetch_assets.py`, and it is **gitignored at the repo root**. The constraints that follow
from this choice, which apply permanently unless the art is replaced:

- Nothing under `assets/images/` may be committed, published, uploaded or redistributed.
- The project cannot be released, open-sourced or hosted publicly in this form.
- Escaping that means replacing the art with original work — at which point the manifest below
  becomes the specification for what needs drawing.

The manifest remains the more portable asset: it is the **specification** — exactly which art must
exist, in which groups, at which relative sizes, and which entries have functional
(non-decorative) requirements. Build the renderer against manifest ids, never against file paths,
and swapping the art set later touches no engine or render code.

### Fetching

```bash
python3 scripts/fetch_assets.py                 # all 912
python3 scripts/fetch_assets.py --group figure  # one group
```

Resumable and skips existing files. Rate-limited on purpose — hrf.im is a hobbyist's server, so
concurrency is capped at 4 with a per-request delay. Don't raise them.

### Downscaled copies

```bash
python3 scripts/build_small_art.py              # writes a `.sm.webp` beside each card image
```

**Run this after fetching.** The card art is 744x1039 and the app draws it at 118x165 in the hand,
98x139 in the court rail; loading the originals for those meant one screen decoded ~10 megapixels
of bitmap to paint a few hundred thousand pixels of card. Half size covers every such use with a
2x display in mind, and `smallArt()` in `apps/web/src/assets.ts` is what the app calls for them.
Only `CardZoom` and the draft's card reader — the two places a card is *read* — load the original.

## Regenerating

```bash
python3 scripts/extract_manifest.py <path-to>/haunt-roll-fail/arcs/meta.scala assets/manifest.json
```

The extractor reads Scala declarations and performs no network access.

## Audio

`audio/` is not part of the manifest — it holds one file, `halo.mp3`, the background music the web
app loops. It is served through the `apps/web/public/audio` symlink, the same arrangement
`public/game-assets` uses for `images/`.

The source was 4:22 at ~237 kbps (7.7 MB). It is committed re-encoded, because the browser
downloads it in full and nothing about quiet loop music under a board game needs a transparent
bitrate:

```sh
ffmpeg -i source.mp3 -map 0:a:0 -map_metadata -1 -codec:a libmp3lame -b:a 96k -joint_stereo 1 \
  -ar 44100 assets/audio/halo.mp3
```

That is 3.0 MB. Rights in the track are **not** settled — see `THIRD-PARTY-NOTICES.md` section 3.
