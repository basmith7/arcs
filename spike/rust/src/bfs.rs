//! `positionalUncached`'s kernel (scripts/spike/bfs-kernel.ts), ported step for step on the same
//! shapes: string ids, hash map/set lookups, a linear `contains` over the damaged list.
use crate::fx::{FxMap, FxSet};

pub struct Board {
    pub systems: Vec<String>,
    pub gate: FxMap<String, bool>,
    pub adj: FxMap<String, Vec<String>>,
}

pub struct Input {
    pub board: usize,
    pub self_: String,
    pub ships: Vec<(String, String)>,
    pub damaged: Vec<String>,
    pub built: Vec<String>,
    pub colors: FxMap<String, FxSet<String>>,
    pub resource: FxMap<String, bool>,
}

pub fn positional(b: &Board, x: &Input) -> (f64, f64) {
    let fresh: Vec<&(String, String)> = x.ships.iter().filter(|p| !x.damaged.contains(&p.0)).collect();
    let stands: FxSet<&str> = fresh.iter().map(|p| p.1.as_str()).collect();
    let gates_held = stands.iter().filter(|s| b.gate.get(**s) == Some(&true)).count();
    let built: FxSet<&str> = x.built.iter().map(|s| s.as_str()).collect();

    let mut dist: FxMap<&str, i32> = FxMap::default();
    let mut frontier: Vec<&str> = Vec::new();
    for s in &b.systems {
        let rival = match x.colors.get(s) {
            Some(c) => c.len() > if c.contains(&x.self_) { 1 } else { 0 },
            None => false,
        };
        // Board systems are distinct, so a seed is inserted once (the TS `dist.set` needs no check).
        let unexploited = x.resource.get(s) == Some(&true) && !built.contains(s.as_str());
        if rival || unexploited {
            dist.insert(s, 0);
            frontier.push(s);
        }
    }
    for d in 1..=2 {
        let mut next: Vec<&str> = Vec::new();
        for s in &frontier {
            for n in &b.adj[*s] {
                if !dist.contains_key(n.as_str()) {
                    dist.insert(n, d);
                    next.push(n);
                }
            }
        }
        frontier = next;
    }
    // JS numbers: the sums are exact integers, returned as f64 to compare bit for bit.
    let mut threat = 0f64;
    for p in &fresh {
        threat += 3.0 - *dist.get(p.1.as_str()).unwrap_or(&3) as f64;
    }
    (gates_held as f64, threat)
}
