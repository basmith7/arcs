#!/usr/bin/env python3
"""Median, spread and paired ratio of an ab.sh run.  ab-summary.py <out.jsonl>..."""
import json, statistics, sys
for path in sys.argv[1:]:
    rows = [json.loads(l) for l in open(path)]
    by = {}
    for r in rows:
        by.setdefault((r['level'], r['players']), {}).setdefault(r['bundle'], {})[r['round']] = r
    for (level, players), b in by.items():
        a, bb = b.get('A', {}), b.get('B', {})
        rounds = sorted(set(a) & set(bb))
        ca = [a[k]['cpuMs'] / 1000 for k in rounds]
        cb = [bb[k]['cpuMs'] / 1000 for k in rounds]
        ratio = [x / y for x, y in zip(ca, cb)]
        same = all(a[k]['decisions'] == bb[k]['decisions'] and a[k]['counts']['advance'] == bb[k]['counts']['advance'] for k in rounds)
        print(f"{path}: {players}p {level}, {len(rounds)} rounds, identical play {same}")
        print(f"  A: median {statistics.median(ca):.2f} s  range {min(ca):.2f}-{max(ca):.2f}")
        print(f"  B: median {statistics.median(cb):.2f} s  range {min(cb):.2f}-{max(cb):.2f}")
        print(f"  A/B per round: median {statistics.median(ratio):.3f}x  range {min(ratio):.3f}-{max(ratio):.3f}")
