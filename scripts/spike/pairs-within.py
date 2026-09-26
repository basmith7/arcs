#!/usr/bin/env python3
"""Step A, exploratory (NOT pre-registered): is there signal in the averaged pair label *within*
each action-type pair, i.e. beyond "leading beats passing"?

    pairs-within.py   (reads runs-spike/pairs/s*.jsonl and ctx*.jsonl)

Same rows (>= 300 finished salts), same held-out split (last quarter of games), ridge chosen by
5-fold CV grouped by game. Context = featuresOf at the position (39) + chapter, round, power rank,
gap to the best rival, menu size. Types with < 40 pairs share one "other" block.
"""
import glob, json
import numpy as np

B = '/home/basmith7/Projects/arcs-speed/runs-spike/pairs/'
rows = [json.loads(l) for p in glob.glob(B + 's*.jsonl') for l in open(p)]
ctx = {(c['game'], c['step']): c for p in glob.glob(B + 'ctx*.jsonl') for l in open(p) for c in [json.loads(l)]}
rows = [r for r in rows if sum(v is not None for v in r['y']) >= 300]
y = np.array([np.mean([v for v in r['y'] if v is not None]) for r in rows])
G = np.array([r['game'] for r in rows])
games = sorted(set(G)); cut = games[int(len(games) * 0.75)]
tr, te = G < cut, G >= cut
pair = [(r['a'], r['b']) for r in rows]
counts = {t: sum(1 for p in pair if p == t) for t in set(pair)}
big = sorted([t for t, n in counts.items() if n >= 40], key=lambda t: -counts[t])
typ = [p if p in big else ('other',) for p in pair]
tlist = big + [('other',)]
C = np.array([ctx[(r['game'], r['step'])]['x'] + [ctx[(r['game'], r['step'])][k] for k in ('chapter', 'round', 'rank', 'gap')] + [r['n']] for r in rows], float)
D = np.array([r['d'] for r in rows], float)
T = np.array([[1.0 if t == u else 0.0 for u in tlist] for t in typ])

def inter(X):
    return np.hstack([T[:, [j]] * X for j in range(len(tlist))])

def fit(X, y, lam):
    mu, sd = X.mean(0), X.std(0); sd[sd == 0] = 1
    Z = (X - mu) / sd; ym = y.mean()
    w = np.linalg.lstsq(Z.T @ Z + lam * len(y) * np.eye(Z.shape[1]), Z.T @ (y - ym), rcond=None)[0]
    return lambda Xn: ((Xn - mu) / sd) @ w + ym

def evaluate(X, lams=(0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1, 3, 10)):
    folds = np.array_split(np.array(sorted(set(G[tr]))), 5)
    def cv(lam):
        e = 0.0
        for f in folds:
            v = np.isin(G, f) & tr; t = tr & ~v
            e += ((fit(X[t], y[t], lam)(X[v]) - y[v]) ** 2).sum()
        return e
    lam = min(lams, key=cv)
    p = fit(X[tr], y[tr], lam)(X[te])
    return p, lam

def r2(p, m):
    yt = y[te][m]; return 1 - ((p[m] - yt) ** 2).sum() / ((yt - yt.mean()) ** 2).sum()

allm = np.ones(te.sum(), bool)
lp = np.array([t == ('turn/lead', 'turn/pass') for t in typ])[te]
p0, l0 = evaluate(T)
p1, l1 = evaluate(np.hstack([T, inter(C)]))
p2, l2 = evaluate(np.hstack([T, inter(np.hstack([C, D]))]))
print(f"pairs {len(y)}, train/test {tr.sum()}/{te.sum()}, types with >=40 pairs: {len(big)}")
print(f"{'model':42} {'all':>7} {'lead/pass':>10} {'all other':>10}   ridge")
for name, p, lam in (('type only', p0, l0), ('type x context', p1, l1), ('type x (context + feature diff)', p2, l2)):
    print(f"{name:42} {r2(p, allm):7.3f} {r2(p, lp):10.3f} {r2(p, ~lp):10.3f}   {lam}")
print("\nPer type, held-out: n, label SD, R² of type x (context + diff) vs the type mean")
for t in tlist:
    m = np.array([u == t for u in typ])[te]
    if m.sum() >= 8:
        print(f"  {' vs '.join(t):45} n={m.sum():3d}  sd={y[te][m].std():5.2f}  R²={r2(p2, m):6.3f}")
