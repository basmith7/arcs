#!/usr/bin/env python3
"""Render the dimmed map and its structure layer, as a check by overlay.

The app draws this at runtime — the CSS filter in styles.css and
apps/web/src/components/BoardStructure.tsx — and this draws the same thing with PIL so the
geometry can be checked against the printed art without a browser, and so a dim level can be
looked at before it ships.

Two things are being checked. That `css_chain` here and the `--board-dim` filter there stay the
same ramp: the dim is a *contrast* curve, not a fade, because the board prints its planets,
resource symbols, sector numbers and slot markers as bright line art over painted fills, and a
curve that crushes the fills keeps every one of them without redrawing any of it. And that the
vector layer lands on the printed seams — it draws only what the art cannot say for itself,
which is which seams you may travel through.

    python3 scripts/preview_board_structure.py out.png [dim ...] [--board NAME]

`dim` is 0..1, matching the boardDim setting. Pass several to get a strip. `--board` renders a
variant rather than the full map: the out-of-play clusters get their `map-out` overlay and the
ring links come from that board's adjacency, which is the case worth looking at — the ring
reroutes around a missing cluster and only the gold arrow baked into the overlay says so.
"""
import json
import math
import sys
from PIL import Image, ImageDraw, ImageEnhance, ImageFont

TOPO = "packages/engine/src/data/board-topology.json"
ART = "apps/web/public/game-assets/map-no-slots.webp"
OUT_ART = "apps/web/public/game-assets/map-out-%d.webp"

LINE = (150, 186, 255)
LANE = (232, 122, 106)
LINK = (255, 206, 112)
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


def at(cx, cy, ang, r):
    t = math.radians(ang)
    return cx + math.cos(t) * r, cy + math.sin(t) * r


def to_edge(cx, cy, ang, w, h):
    """Where a ray from the centre leaves the map rectangle."""
    t = math.radians(ang)
    dx, dy = math.cos(t), math.sin(t)
    ks = []
    if abs(dx) > 1e-9:
        ks.append(((w if dx > 0 else 0) - cx) / dx)
    if abs(dy) > 1e-9:
        ks.append(((h if dy > 0 else 0) - cy) / dy)
    k = min(x for x in ks if x > 0)
    return cx + dx * k, cy + dy * k


def arc_points(cx, cy, r, lo, hi, step=1.0):
    sweep = (hi - lo) % 360
    n = max(2, int(sweep / step))
    return [at(cx, cy, lo + sweep * i / n, r) for i in range(n + 1)]


def structure(topo, size, alpha, board):
    w, h = size
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    g = topo["geometry"]
    cx, cy = g["centre"]
    core, ring = g["radii"]["core"], g["radii"]["ring"]
    arc = {s["id"]: s["render"]["arc"] for s in topo["systems"]}
    adj = topo["boards"][board]["adjacency"] if board else topo["adjacencyFullBoard"]
    live = set(adj) if board else set(arc)

    def rgba(c):
        return (*c, alpha)

    # Wedge edges. Where two wedges are adjacent their spans meet and this draws one shared
    # line; where they are not, the spans stop short and the pair of lines is the dead seam.
    for div in g["dividers"]["planet"]:
        if div["a"] not in live or div["b"] not in live:
            continue
        linked = div["b"] in adj.get(div["a"], [])
        colour, width = (rgba(LINE), 4) if linked else (rgba(LANE), 5)
        for sid, end in ((div["a"], 1), (div["b"], 0)):
            a = arc[sid][end]
            d.line([at(cx, cy, a, ring), to_edge(cx, cy, a, w, h)], fill=colour, width=width)

    # The ring: one arc per gate segment, so the gaps between them are left open.
    for sid, a in arc.items():
        if a is None or not sid.endswith("-Gate") or sid not in live:
            continue
        for r in (core, ring):
            d.line(arc_points(cx, cy, r, a[0], a[1]), fill=rgba(LINE), width=4)

    # The gate-to-gate links: the ring is a cycle and its gaps are where it joins, so each one is
    # drawn as a passage *along* the ring rather than as a wall across it. From the board's own
    # adjacency, so a ring that reroutes past a missing cluster draws the long way it now runs.
    gates = [s for s in live if s.endswith("-Gate") and s != "7-Gate"]
    mid, seen = (core + ring) / 2, set()
    for a in gates:
        for b in adj.get(a, []):
            if b not in gates or (b, a) in seen:
                continue
            seen.add((a, b))
            ga, gb = arc[a], arc[b]
            fwd, back = (gb[0] - ga[1]) % 360, (ga[0] - gb[1]) % 360
            lo, span = (ga[1], fwd) if fwd <= back else (gb[1], back)
            d.line(arc_points(cx, cy, mid, lo - 1.5, lo + span + 1.5, 0.5),
                   fill=rgba(LINK), width=13)
    return layer


def render(topo, dim, board):
    plate = Image.open(ART).convert("RGBA")
    if board:
        for i in (i for i in range(1, 7) if i not in topo["boards"][board]["clusters"]):
            plate.alpha_composite(Image.open(OUT_ART % i).convert("RGBA"))
    art = css_chain(plate.convert("RGB"), dim)
    w, h = art.size
    art = art.convert("RGBA")
    art.alpha_composite(structure(topo, (w, h), round(255 * min(1, dim * 1.3)), board))
    return art.convert("RGB").resize((OUT, int(OUT * h / w)), Image.LANCZOS)


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    argv = sys.argv[1:]
    board = None
    if "--board" in argv:
        i = argv.index("--board")
        board = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
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
        ImageDraw.Draw(strip).text((16, h * i + 12), label,
                                   fill=(0, 255, 140), font=font)
    strip.save(out)
    print(f"wrote {out}  dims={dims}")


if __name__ == "__main__":
    main()
