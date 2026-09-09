#!/usr/bin/env python3
"""Render the map art at a dim level, as a check without a browser.

The app does this at runtime with the CSS filter on `.map-plate` in styles.css, and this does the
same arithmetic with PIL so a level can be looked at before it ships. The dim is a *contrast*
curve, not a fade: the board prints its planets, resource symbols, sector numbers and slot markers
as bright line art over painted fills, so a curve that crushes the fills keeps every one of them
without redrawing any of it. `css_chain` here and the filter there are one ramp — change both.

    python3 scripts/preview_board_dim.py out.png [dim ...] [--board NAME]

`dim` is 0..1, matching the boardDim setting. Pass several to get a strip. `--board` composites the
`map-out` overlays for a variant's out-of-play clusters, which take the same curve as the plate.
"""
import json
import sys
from PIL import Image, ImageDraw, ImageEnhance, ImageFont

TOPO = "packages/engine/src/data/board-topology.json"
ART = "apps/web/public/game-assets/map-no-slots.webp"
OUT_ART = "apps/web/public/game-assets/map-out-%d.webp"
OUT = 1264


def css_chain(im, dim):
    """`saturate() contrast() brightness()`, in the order the browser applies them."""
    sat, contrast, bright = 1 - 0.3 * dim, 1 + 1.2 * dim, 1 - 0.55 * dim
    im = ImageEnhance.Color(im).enhance(sat)
    lut = []
    for v in range(256):
        x = (v / 255 - 0.5) * contrast + 0.5
        lut.append(max(0, min(255, round(x * bright * 255))))
    return im.point(lut * 3)


def render(topo, dim, board):
    plate = Image.open(ART).convert("RGBA")
    if board:
        for i in (i for i in range(1, 7) if i not in topo["boards"][board]["clusters"]):
            plate.alpha_composite(Image.open(OUT_ART % i).convert("RGBA"))
    art = css_chain(plate.convert("RGB"), dim)
    w, h = art.size
    return art.resize((OUT, int(OUT * h / w)), Image.LANCZOS)


def main():
    argv = sys.argv[1:]
    board = None
    if "--board" in argv:
        i = argv.index("--board")
        board = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    if not argv:
        raise SystemExit(__doc__)
    out, dims = argv[0], [float(x) for x in argv[1:]] or [0.7]
    topo = json.load(open(TOPO))
    try:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", 26)
    except OSError:
        font = ImageFont.load_default()
    frames = [render(topo, d, board) for d in dims]
    w, h = frames[0].size
    strip = Image.new("RGB", (w, h * len(frames)))
    for i, (f, dim) in enumerate(zip(frames, dims)):
        strip.paste(f, (0, h * i))
        label = f"dim {round(dim * 100)}%" + (f"  {board}" if board else "")
        ImageDraw.Draw(strip).text((16, h * i + 12), label, fill=(0, 255, 140), font=font)
    strip.save(out)
    print(f"wrote {out}  dims={dims}")


if __name__ == "__main__":
    main()
