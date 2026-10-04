#!/usr/bin/env python3
"""Lay out the fleet points of every planet system, nearest the gate ring first.

`compute_placements.py` packs points around each system's anchor, which sits on the planet. Once
buildings moved onto the planet disc, ships kept the points left over, and those landed wherever
the band had room: some by the gate ring, some out at the board's edge, one on the border with
the gate. A fleet's place should read the same in every system, so this rewrites a planet
system's `render.placements` as points that are

  - inside its region, at least CLEARANCE px from any other colour (relaxed for narrow bands),
  - clear of its planet disc by DISC_MARGIN, so hulls never sit on the building slots,
  - a hull apart (HULL, SPACINGS), so a second fleet does not cover the first,

ordered nearest the map centre first, so the first fleet sits just outside the gate ring and a
crowd grows outward along the band. Gates keep `compute_placements.py`'s points.

    python3 scripts/place_fleets.py
"""
import json
import math

import numpy as np
from PIL import Image

TOPO = "packages/engine/src/data/board-topology.json"
REGIONS = "assets/images/map-regions.webp"
# Passes in order, each adding points until a band holds POINTS. The strict pass places the first
# fleets, well inside and well apart; a narrow band then gives up some of each for the *later*
# points rather than run out of room for a crowded system — the first fleet never moves.
CLEARANCES = (34, 24, 14, 4)
# A hull is ~140 x 58 on the map and a fleet stacks a little up and right, so fleets side by side
# need far more room than fleets one above the other: two points are apart when they clear an
# ellipse of HULL, scaled down by each pass's factor.
HULL = (150, 78)
SPACINGS = (1.0, 0.85, 0.7, 0.55)
DISC_MARGIN = 35
POINTS = 6
GRID = 8


def erode(mask, r):
    """True where the whole (2r+1)-square around the pixel is True — a fast square erosion."""
    k = 2 * r + 1

    def along(a, axis):
        pad = [(r + 1, r) if i == axis else (0, 0) for i in range(2)]
        c = np.cumsum(np.pad(a.astype(np.int32), pad), axis=axis)
        hi = tuple(slice(k, None) if i == axis else slice(None) for i in range(2))
        lo = tuple(slice(0, -k) if i == axis else slice(None) for i in range(2))
        return (c[hi] - c[lo]) == k

    return along(along(mask, 0), 1)


def pack(points, ok, xx, yy, cx, cy, spacing):
    """Greedy: add the allowed point nearest the map centre, then the next one far enough from all."""
    xs, ys = xx[ok], yy[ok]
    for i in np.argsort(np.hypot(xs - cx, ys - cy), kind="stable"):
        p = (int(xs[i]), int(ys[i]))
        if all(math.hypot((p[0] - q[0]) / (HULL[0] * spacing), (p[1] - q[1]) / (HULL[1] * spacing)) >= 1 for q in points):
            points.append(p)
            if len(points) == POINTS:
                break


def main():
    topo = json.load(open(TOPO))
    px = np.asarray(Image.open(REGIONS).convert("RGBA"))
    h, w = px.shape[:2]
    cx, cy = w / 2, h / 2
    yy, xx = np.mgrid[0:h:GRID, 0:w:GRID]
    for s in topo["systems"]:
        planet = s["render"]["planet"]
        if planet is None:
            continue
        colour = s["render"]["regionColour"]
        rgb = [int(colour[i : i + 2], 16) for i in (1, 3, 5)]
        region = (px[..., 3] == 255) & np.all(px[..., :3] == rgb, axis=-1)
        off_disc = np.hypot(xx - planet[0], yy - planet[1]) > planet[2] + DISC_MARGIN
        points = []
        for spacing in SPACINGS:
            for clear in CLEARANCES:
                if len(points) < POINTS:
                    pack(points, erode(region, clear)[::GRID, ::GRID] & off_disc, xx, yy, cx, cy, spacing)
        s["render"]["placements"] = [list(p) for p in points]
        print(f"{s['id']:<12} {len(points)} points, first {points[0]}")
    with open(TOPO, "w") as fh:
        json.dump(topo, fh, indent=2)
        fh.write("\n")


if __name__ == "__main__":
    main()
