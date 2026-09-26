#!/usr/bin/env python3
"""Step 2/3: playout unit cost and the training budget table.
   budget.py runs-spike/playout/*.jsonl"""
import json, statistics, sys
rows = [json.loads(l) for p in sys.argv[1:] for l in open(p)]
groups = {}
for r in rows:
    players = 4 if r['game'].startswith('n4') else 2
    groups.setdefault((r.get('policy', 'normal'), players), []).append(r)
unit = {}
for (policy, players), rs in sorted(groups.items()):
    c = sorted(r['cpuMs'] / 1000 for r in rs)
    q = lambda p: c[min(len(c) - 1, int(p * (len(c) - 1) + 0.5))]
    fin = sum(r['finished'] for r in rs)
    unit[(policy, players)] = statistics.mean(c)
    print(f"{policy:6} {players}p: n={len(c)} finished={fin}  median {statistics.median(c):.3f} s  mean {statistics.mean(c):.3f} s  "
          f"p10 {q(.1):.3f}  p90 {q(.9):.3f}  max {c[-1]:.3f}")
print()
for players in (2, 4):
    if ('normal', players) not in unit: continue
    u = unit[('normal', players)]
    print(f"### {players}p, unit = mean {u:.2f} CPU-s per `normal` playout")
    print("| label | positions | playouts | core-hours @1x | @5x | @10x | @20x | days on 14 cores @1x | @10x |")
    print("|---|---|---|---|---|---|---|---|---|")
    for label, k in (('§3i-grade (370/position)', 370), ('AlphaZero-style (12/position)', 12)):
        for n in (10_000, 100_000, 1_000_000):
            ch = n * k * u / 3600
            print(f"| {label} | {n:,} | {n*k:,} | {ch:,.0f} | {ch/5:,.0f} | {ch/10:,.0f} | {ch/20:,.0f} | {ch/14/24:,.1f} | {ch/10/14/24:,.1f} |")
    print()
