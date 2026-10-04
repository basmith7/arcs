#!/usr/bin/env python3
"""Render one highlight image per system, from the colour-indexed region bitmap.

Hovering a piece on the map lights the system it stands in (`SystemGlow` in Board.tsx). The
shape has to be the system's real region — near a border, a ring around the pieces does not say
which band they belong to — and `map-regions.webp` already holds every region as one flat colour
(`render.regionColour` in board-topology). So this cuts each region out once, offline, as a white
edge over a faint white fill, cropped to its bounding box at half resolution (see `labels` for
how the planets and border gaps the bitmap leaves out are filled back in). The app draws it
as a plain `<image>`: no runtime bitmap work, no SVG filter on a hover.

    python3 scripts/build_system_glow.py

Writes assets/images/system-glow/<id>.webp and apps/web/src/system-glow.json ({id: [x, y, w, h]}
in map coordinates).
"""
import json
import os

import numpy as np
from PIL import Image, ImageChops, ImageFilter

TOPO = "packages/engine/src/data/board-topology.json"
REGIONS = "assets/images/map-regions.webp"
OUT_DIR = "assets/images/system-glow"
OUT_JSON = "apps/web/src/system-glow.json"
SCALE = 2        # images are drawn at half the map's resolution and stretched back
EDGE = 4         # edge width, in half-resolution pixels
FILL = 56        # alpha of the interior wash, 0..255
PAD = 4
GROW = 90        # how far, in half-resolution pixels, a region may grow into a gap
# The ARCS medallion in the middle of the map: centre x, y and radii, in map pixels. Not a system.
CENTRE = (1264, 900, 250, 230)


def labels(topo, regions):
    """A system index per half-resolution pixel, -1 for none.

    The bitmap leaves the planets and the border lines between systems transparent, so taken as
    is a lit region has a planet-shaped hole in it. The gaps are filled by growing every region
    outward at once — each transparent pixel goes to whichever system reaches it first — with
    two seeds placed before the growth: each system's planet disc (`render.planet`), so a planet
    that straddles a border is not split between bands, and a void over the middle of the map,
    so the gates do not swallow the ARCS medallion.
    """
    small = regions.resize((regions.width // SCALE, regions.height // SCALE), Image.NEAREST)
    px = np.asarray(small.convert("RGBA"))
    lab = np.full(px.shape[:2], -1, dtype=np.int16)
    solid = px[..., 3] == 255
    for i, s in enumerate(topo["systems"]):
        c = s["render"]["regionColour"]
        rgb = [int(c[k : k + 2], 16) for k in (1, 3, 5)]
        lab[solid & np.all(px[..., :3] == rgb, axis=-1)] = i
    h, w = lab.shape
    yy, xx = np.mgrid[0:h, 0:w]
    for i, s in enumerate(topo["systems"]):
        planet = s["render"]["planet"]
        if planet is not None:
            x, y, r = (v / SCALE for v in planet)
            lab[(lab == -1) & ((xx - x) ** 2 + (yy - y) ** 2 <= r * r)] = i
    VOID = len(topo["systems"])
    cx, cy, rx, ry = (v / SCALE for v in CENTRE)
    lab[(lab == -1) & (((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1)] = VOID
    for _ in range(GROW):
        empty = lab == -1
        if not empty.any():
            break
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            src = np.roll(lab, (dy, dx), axis=(0, 1))
            take = empty & (src != -1) & (lab == -1)
            lab[take] = src[take]
    lab[lab == VOID] = -1
    return lab


def main():
    topo = json.load(open(TOPO))
    regions = Image.open(REGIONS)
    lab = labels(topo, regions)
    os.makedirs(OUT_DIR, exist_ok=True)
    boxes = {}
    for i, s in enumerate(topo["systems"]):
        mask = Image.fromarray(np.where(lab == i, 255, 0).astype(np.uint8))
        box = mask.getbbox()
        if box is None:
            continue
        x0, y0 = max(0, box[0] - PAD), max(0, box[1] - PAD)
        x1, y1 = min(mask.width, box[2] + PAD), min(mask.height, box[3] + PAD)
        m = mask.crop((x0, y0, x1, y1))
        inner = m.filter(ImageFilter.MinFilter(EDGE * 2 + 1))
        edge = ImageChops.subtract(m, inner).filter(ImageFilter.GaussianBlur(1.2))
        wash = inner.point(lambda v: FILL if v else 0)
        out = Image.new("RGBA", m.size, (255, 255, 255, 0))
        out.putalpha(ImageChops.lighter(edge, wash))
        out.save(f"{OUT_DIR}/{s['id']}.webp", lossless=True)
        boxes[s["id"]] = [x0 * SCALE, y0 * SCALE, m.width * SCALE, m.height * SCALE]
    with open(OUT_JSON, "w") as fh:
        rows = [f"  {json.dumps(k)}: {json.dumps(v)}" for k, v in boxes.items()]
        fh.write("{\n" + ",\n".join(rows) + "\n}\n")
    print(f"{len(boxes)} systems")


if __name__ == "__main__":
    main()
