#!/usr/bin/env python3
"""Derive the board's polar geometry and merge it into board-topology.json.

The printed map is a set of radial wedges around the gate ring, not a field of islands. The
region bitmap knows the *angles* of those wedges but not their boundaries: it is an eroded
hit-testing mask, so every region is shrunk away from its neighbours by a few degrees and the
painted seams between them are gone. Erosion is symmetric, though, which is the whole trick —
the true boundary sits at the midpoint of the gap the erosion left behind.

What comes out:

  geometry.centre        the gate ring's centre, from the six gate regions' centre of mass
  geometry.radii         core / ring / wedge shells, each taken at the midpoint between the
                         inner shell's outer edge and the outer shell's inner edge
  geometry.dividers      the 24 boundary angles, planet and gate, each naming the two systems
                         it separates
  render.arc             per system, the angular span it actually occupies

`arc` is where the rules land. Two wedges touching on the board does not mean you can travel
between them: within a cluster angular neighbours are always adjacent, but across clusters they
are not, except for the two special planet links (5-Hex<->6-Arrow, 2-Hex<->3-Arrow). The printed
board says so by drawing those two seams tight and the other four as wide dark lanes. So an
adjacent pair's spans meet exactly at the divider, and a non-adjacent pair's stop short of it —
the lane is the gap that leaves, and it means "you cannot go this way".

    python3 scripts/build_board_geometry.py \
        packages/engine/src/data/board-topology.json \
        apps/web/public/game-assets/map-regions.webp
"""
import json
import math
import sys
from PIL import Image

# How wide a dead cluster seam is drawn, in degrees. The four printed lanes measure 3.1-4.5
# degrees across; one width for all four reads as deliberate where copying the variation reads
# as noise, and the number that matters is "wider than a line", not the exact span.
LANE_DEG = 3.4

# Sampling stride over the mask. The angles are stable well below this; it is only here to keep
# a 4.5M-pixel pass off the critical path.
STRIDE = 2


def load_regions(topo, mask_path):
    """Every sampled pixel of each system's region, in map coordinates."""
    im = Image.open(mask_path).convert("RGB")
    w, h = im.size
    if (w, h) != (topo["mapSize"]["width"], topo["mapSize"]["height"]):
        raise SystemExit(f"mask is {w}x{h}, topology says {topo['mapSize']}")
    by_colour = {}
    for s in topo["systems"]:
        c = s["render"]["regionColour"]
        if c:
            by_colour[tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))] = s["id"]
    pts = {sid: [] for sid in by_colour.values()}
    px = im.load()
    for y in range(0, h, STRIDE):
        for x in range(0, w, STRIDE):
            sid = by_colour.get(px[x, y])
            if sid:
                pts[sid].append((x, y))
    missing = [sid for sid, p in pts.items() if len(p) < 100]
    if missing:
        raise SystemExit(f"regions too small to measure: {missing}")
    return pts


def centre_of(pts, ids):
    n = sum(len(pts[i]) for i in ids)
    return (sum(x for i in ids for x, _ in pts[i]) / n,
            sum(y for i in ids for _, y in pts[i]) / n)


def polar(pts, sid, cx, cy):
    """Angular span (degrees, may wrap) and radial extent of one region."""
    ang = [math.atan2(y - cy, x - cx) for x, y in pts[sid]]
    rad = [math.hypot(y - cy, x - cx) for x, y in pts[sid]]
    # Unwrap about the mean direction so a region straddling 0 degrees measures correctly.
    mx = sum(math.cos(t) for t in ang)
    my = sum(math.sin(t) for t in ang)
    mid = math.atan2(my, mx)
    rel = [((t - mid + math.pi) % (2 * math.pi)) - math.pi for t in ang]
    return (math.degrees(mid + min(rel)) % 360, math.degrees(mid + max(rel)) % 360,
            min(rad), max(rad))


def ring_order(spans, ids):
    """The ids in angular order, starting wherever the sort lands."""
    return sorted(ids, key=lambda i: spans[i][0])


def dividers(spans, order):
    """Boundary angle between each neighbouring pair: the midpoint of the eroded gap."""
    out = []
    for k, a in enumerate(order):
        b = order[(k + 1) % len(order)]
        hi, lo = spans[a][1], spans[b][0]
        gap = (lo - hi) % 360
        out.append({"angle": round((hi + gap / 2) % 360, 3), "a": a, "b": b})
    return out


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    topo_path, mask_path = sys.argv[1], sys.argv[2]
    topo = json.load(open(topo_path))
    pts = load_regions(topo, mask_path)

    gates = [s["id"] for s in topo["systems"] if s["isGate"] and s["id"] != "7-Gate"]
    planets = [s["id"] for s in topo["systems"] if not s["isGate"]]
    cx, cy = centre_of(pts, gates)
    spans = {sid: polar(pts, sid, cx, cy) for sid in pts}

    # Three shells, each boundary halfway between what the erosion left of its two neighbours.
    core_out = spans["7-Gate"][3]
    ring_in = min(spans[g][2] for g in gates)
    ring_out = max(spans[g][3] for g in gates)
    wedge_in = min(spans[p][2] for p in planets)
    radii = {
        "core": round((core_out + ring_in) / 2, 1),
        "ring": round((ring_out + wedge_in) / 2, 1),
    }
    if not core_out < radii["core"] < ring_in or not ring_out < radii["ring"] < wedge_in:
        raise SystemExit(f"shells overlap: {core_out} {ring_in} {ring_out} {wedge_in}")

    planet_order, gate_order = ring_order(spans, planets), ring_order(spans, gates)
    planet_div, gate_div = dividers(spans, planet_order), dividers(spans, gate_order)

    # A span runs divider to divider, less half a lane at any seam you cannot travel through.
    adj = topo["adjacencyFullBoard"]
    arcs = {}
    for divs, order in ((planet_div, planet_order), (gate_div, gate_order)):
        edge = {}
        for d in divs:
            linked = d["b"] in adj.get(d["a"], [])
            edge[(d["a"], "hi")] = d["angle"] - (0 if linked else LANE_DEG / 2)
            edge[(d["b"], "lo")] = d["angle"] + (0 if linked else LANE_DEG / 2)
        for sid in order:
            arcs[sid] = [round(edge[(sid, "lo")] % 360, 3), round(edge[(sid, "hi")] % 360, 3)]

    for s in topo["systems"]:
        sid = s["id"]
        s["render"]["arc"] = arcs.get(sid)
    topo["geometry"] = {
        "centre": [round(cx, 1), round(cy, 1)],
        "radii": radii,
        "laneDegrees": LANE_DEG,
        "dividers": {"planet": planet_div, "gate": gate_div},
    }

    with open(topo_path, "w") as f:
        json.dump(topo, f, indent=2)
        f.write("\n")
    print(f"centre ({cx:.1f}, {cy:.1f})  core r{radii['core']}  ring r{radii['ring']}")
    print(f"{len(planet_div)} planet dividers, {len(gate_div)} gate dividers")
    lanes = [d for d in planet_div if d["b"] not in adj.get(d["a"], [])]
    print("dead seams (drawn as lanes): " + ", ".join(f'{d["a"]}|{d["b"]}' for d in lanes))


if __name__ == "__main__":
    main()
