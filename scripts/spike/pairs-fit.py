#!/usr/bin/env python3
"""Step A analysis: does averaging cheap playouts turn §3i's pair label into a learnable one?

    pairs-fit.py runs-spike/pairs/*.jsonl

Pre-registered (2026-09-26, written before any step-A row existed):
  - Primary: held-out R² of a ridge fit of the K=370 label on §3i's feature differences
    (standardised, ridge chosen by 5-fold CV grouped by game on the training games; held out =
    the last quarter of games by id). **Signal if R² >= 0.05; none if R² < 0.01;** between is
    inconclusive.
  - Reported alongside: the same at K = 1, 2, 10, 50 (K=1 replicates §3i); the label's split-half
    reliability (even vs odd salts, Spearman-Brown to K), which is the ceiling any fit can reach;
    and an action-type-pair baseline (one-hot of (a.type, b.type)) fitted the same way.
"""
import json, sys
import numpy as np

rows = [json.loads(l) for p in sys.argv[1:] for l in open(p) if l.strip()]
games = sorted({r['game'] for r in rows})
Y = [np.array([v for v in r['y'] if v is not None], float) for r in rows]
keep = [i for i, y in enumerate(Y) if len(y) >= 300]
rows = [rows[i] for i in keep]; Y = [Y[i] for i in keep]
D = np.array([r['d'] for r in rows], float)
G = np.array([r['game'] for r in rows])
cut = games[int(len(games) * 0.75)]
tr, te = G < cut, G >= cut
allk = sum(len(r['y']) for r in rows); fin = sum(len(y) for y in Y)
print(f"pairs {len(rows)} (of {len(keep) and len(json.loads(open(sys.argv[1]).readline())['y'])}-salt rows kept >=300 finished), games {len(games)}, train/test pairs {tr.sum()}/{te.sum()}")
print(f"finished salt-pairs {fin}/{allk} = {fin/allk:.3f}")
sd1 = np.sqrt(np.mean([y.var(ddof=1) for y in Y]))
ybar = np.array([y.mean() for y in Y])
se = np.sqrt(np.mean([y.var(ddof=1) / len(y) for y in Y]))
print(f"one-playout label SD (within pair) {sd1:.2f}; K-mean label: SD across pairs {ybar.std():.2f}, mean SE {se:.2f}")
odd = np.array([y[1::2].mean() for y in Y]); even = np.array([y[0::2].mean() for y in Y])
rh = np.corrcoef(odd, even)[0, 1]; rel = 2 * rh / (1 + rh)
print(f"split-half r {rh:.3f} -> reliability at full K {rel:.3f}  (the R² ceiling for any predictor)")
print(f"pairs whose feature difference is all zero: {(np.abs(D).sum(1) == 0).mean():.3f}")

def ridge_fit(X, y, lam):
    mu, sd = X.mean(0), X.std(0); sd[sd == 0] = 1
    Z = (X - mu) / sd; ym = y.mean()
    A = Z.T @ Z + lam * len(y) * np.eye(Z.shape[1])
    w = np.linalg.solve(A, Z.T @ (y - ym))
    return lambda Xn: ((Xn - mu) / sd) @ w + ym

def heldout_r2(X, y, lams=(0, 0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1, 3)):
    trg = np.array(sorted(set(G[tr]))); folds = np.array_split(trg, 5)
    def cv(lam):
        err = 0.0
        for f in folds:
            v = np.isin(G, f) & tr; t = tr & ~v
            err += ((ridge_fit(X[t], y[t], lam)(X[v]) - y[v]) ** 2).sum()
        return err
    lam = min(lams, key=cv)
    p = ridge_fit(X[tr], y[tr], lam)(X[te])
    return 1 - ((p - y[te]) ** 2).sum() / ((y[te] - y[te].mean()) ** 2).sum(), lam

types = sorted({(r['a'], r['b']) for r in rows})
T = np.array([[1.0 if (r['a'], r['b']) == t else 0.0 for t in types] for r in rows])
print("\n   K   label SE   held-out R² features (ridge)   R² action-type pair (ridge)")
for K in (1, 2, 10, 50, 370):
    y = np.array([yy[:K].mean() for yy in Y])
    sek = np.sqrt(np.mean([yy.var(ddof=1) / min(K, len(yy)) for yy in Y]))
    r2f, lf = heldout_r2(D, y); r2t, lt = heldout_r2(T, y)
    print(f"{K:>4}   {sek:7.2f}   {r2f:8.3f} ({lf})              {r2t:8.3f} ({lt})")
y = ybar
r2f, _ = heldout_r2(D, y)
verdict = 'SIGNAL' if r2f >= 0.05 else 'NONE' if r2f < 0.01 else 'INCONCLUSIVE'
print(f"\nPrimary (K=all finished, ~370): held-out R² {r2f:.3f} -> {verdict}")
