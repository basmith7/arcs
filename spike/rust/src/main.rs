//! Step 5, Rust side. Same inputs and outputs as scripts/spike/bench-ts.ts:
//!   cargo run --release -- <trace.txt> <bfs.txt> [iterations=30]
//! Parsing is outside the timed region; each iteration is timed as process CPU
//! (CLOCK_PROCESS_CPUTIME_ID). The first iteration checks every op result against the trace.
mod bfs;
mod fx;
mod tracker;

use fx::{FxMap, FxSet};
use std::fs;
use tracker::Tracker;

#[repr(C)]
struct Timespec {
    sec: i64,
    nsec: i64,
}
extern "C" {
    fn clock_gettime(clk: i32, ts: *mut Timespec) -> i32;
}
fn cpu_ms() -> f64 {
    let mut t = Timespec { sec: 0, nsec: 0 };
    unsafe { clock_gettime(2, &mut t) };
    t.sec as f64 * 1e3 + t.nsec as f64 / 1e6
}

fn op_len(ops: &[i32], i: usize) -> usize {
    match ops[i] {
        0 => 2,
        1 | 5 => 5 + ops[i + 3] as usize,
        4 => 5,
        _ => 4,
    }
}

struct Trace {
    strings: Vec<String>,
    ops: Vec<i32>,
    max_handle: usize,
    drop_at: Vec<i32>,
    drop_new: Vec<bool>,
}

fn load_trace(path: &str) -> Trace {
    let text = fs::read_to_string(path).unwrap();
    let mut lines = text.split('\n');
    let n: usize = lines.next().unwrap().split(' ').next().unwrap().parse().unwrap();
    let strings: Vec<String> = (0..n).map(|_| lines.next().unwrap().to_string()).collect();
    let ops: Vec<i32> = lines.next().unwrap().trim().split(' ').map(|x| x.parse().unwrap()).collect();
    let mut last_use: FxMap<i32, usize> = FxMap::default();
    let mut created: FxMap<i32, usize> = FxMap::default();
    let mut max_handle = 0usize;
    let mut i = 0;
    while i < ops.len() {
        let len = op_len(&ops, i);
        if ops[i] != 0 {
            last_use.insert(ops[i + 1], i);
        }
        if matches!(ops[i], 0 | 1 | 4 | 5) {
            let h = ops[i + len - 1];
            max_handle = max_handle.max(h as usize);
            created.entry(h).or_insert(i);
        }
        i += len;
    }
    let mut drop_at = vec![0i32; ops.len()];
    for (&h, &i) in &last_use {
        drop_at[i] = h;
    }
    let mut drop_new = vec![false; ops.len()];
    for (&h, &i) in &created {
        if !last_use.contains_key(&h) {
            drop_new[i] = true;
        }
    }
    Trace { strings, ops, max_handle, drop_at, drop_new }
}

fn replay(t: &Trace, verify: bool) -> u32 {
    let ops = &t.ops;
    let s = &t.strings;
    let mut table: Vec<Option<Tracker>> = vec![None; t.max_handle + 1];
    let mut sum: i32 = 0;
    let mut i = 0;
    while i < ops.len() {
        let op = ops[i];
        match op {
            0 => {
                table[ops[i + 1] as usize] = if t.drop_new[i] { None } else { Some(Tracker::empty()) };
                i += 2;
                continue;
            }
            1 | 5 => {
                let n = ops[i + 3] as usize;
                let es: Vec<&str> = (0..n).map(|k| s[ops[i + 4 + k] as usize].as_str()).collect();
                let tr = table[ops[i + 1] as usize].as_ref().unwrap();
                let loc = s[ops[i + 2] as usize].as_str();
                let out = if op == 1 { tr.register(loc, &es) } else { tr.place(&es, loc) }.unwrap();
                let oh = ops[i + 4 + n];
                table[oh as usize] = Some(out);
                sum = sum.wrapping_mul(31).wrapping_add(n as i32);
                if t.drop_at[i] != 0 && t.drop_at[i] != oh {
                    table[t.drop_at[i] as usize] = None;
                }
                if t.drop_new[i] {
                    table[oh as usize] = None;
                }
                i += 5 + n;
                continue;
            }
            2 => {
                let c = table[ops[i + 1] as usize].as_ref().unwrap().contents_of(&s[ops[i + 2] as usize]).unwrap();
                sum = sum.wrapping_mul(31).wrapping_add(c.len() as i32);
                if verify && c.len() as i32 != ops[i + 3] {
                    panic!("contentsOf mismatch at {i}");
                }
            }
            3 => {
                let tr = table[ops[i + 1] as usize].as_ref().unwrap();
                let l = tr.location_of(&s[ops[i + 2] as usize]);
                // TS folds the location string's length; read it the same way.
                let len = if l < 0 { -1 } else { tr.space.borrow().locations[l as usize].len() as i32 };
                sum = sum.wrapping_mul(31).wrapping_add(len);
                if verify {
                    let want = ops[i + 3];
                    let got = if l < 0 { None } else { Some(tr.space.borrow().locations[l as usize].to_string()) };
                    let ok = match got {
                        None => want == -1,
                        Some(g) => want >= 0 && s[want as usize] == g,
                    };
                    if !ok {
                        panic!("locationOf mismatch at {i}");
                    }
                }
            }
            4 => {
                let tr = table[ops[i + 1] as usize].as_ref().unwrap();
                let out = tr.move_to(&s[ops[i + 2] as usize], &s[ops[i + 3] as usize]).unwrap();
                let oh = ops[i + 4];
                if let Some(nt) = out {
                    table[oh as usize] = Some(nt);
                } else if oh != ops[i + 1] {
                    panic!("no-op move returned a new handle at {i}");
                }
                sum = sum.wrapping_mul(31).wrapping_add(1);
                if t.drop_at[i] != 0 && t.drop_at[i] != oh {
                    table[t.drop_at[i] as usize] = None;
                }
                if t.drop_new[i] {
                    table[oh as usize] = None;
                }
                i += 5;
                continue;
            }
            6 => {
                let b = table[ops[i + 1] as usize].as_ref().unwrap().has(&s[ops[i + 2] as usize]);
                sum = sum.wrapping_mul(31).wrapping_add(b as i32);
                if verify && b as i32 != ops[i + 3] {
                    panic!("has mismatch at {i}");
                }
            }
            _ => panic!("bad op {op} at {i}"),
        }
        if t.drop_at[i] != 0 {
            table[t.drop_at[i] as usize] = None;
        }
        i += 4;
    }
    sum as u32
}

fn load_bfs(path: &str) -> (Vec<bfs::Board>, Vec<(bfs::Input, (f64, f64))>) {
    let text = fs::read_to_string(path).unwrap();
    let l: Vec<&str> = text.split('\n').collect();
    let mut boards: Vec<Option<bfs::Board>> = Vec::new();
    let mut cases = Vec::new();
    let mut i = 0;
    while i < l.len() {
        let w: Vec<&str> = l[i].split(' ').collect();
        match w[0] {
            "B" => {
                let idx: usize = w[1].parse().unwrap();
                let n: usize = w[2].parse().unwrap();
                let mut b = bfs::Board { systems: vec![], gate: FxMap::default(), adj: FxMap::default() };
                for k in 1..=n {
                    let v: Vec<&str> = l[i + k].split(' ').collect();
                    b.systems.push(v[0].to_string());
                    b.gate.insert(v[0].to_string(), v[1] == "1");
                    let na: usize = v[2].parse().unwrap();
                    b.adj.insert(v[0].to_string(), v[3..3 + na].iter().map(|x| x.to_string()).collect());
                }
                if boards.len() <= idx {
                    boards.resize_with(idx + 1, || None);
                }
                boards[idx] = Some(b);
                i += n + 1;
            }
            "C" => {
                let bi: usize = w[1].parse().unwrap();
                let words = |k: usize| -> Vec<&str> { l[i + k].split(' ').collect() };
                let (sv, dv, uv, kv) = (words(1), words(2), words(3), words(4));
                let ns: usize = sv[1].parse().unwrap();
                let ships = (0..ns).map(|k| (sv[2 + 2 * k].to_string(), sv[3 + 2 * k].to_string())).collect();
                let nd: usize = dv[1].parse().unwrap();
                let nu: usize = uv[1].parse().unwrap();
                let board = boards[bi].as_ref().unwrap();
                let mut colors = FxMap::default();
                let mut resource = FxMap::default();
                let mut p = 1;
                for s in &board.systems {
                    let n: usize = kv[p].parse().unwrap();
                    p += 1;
                    colors.insert(s.clone(), kv[p..p + n].iter().map(|x| x.to_string()).collect::<FxSet<String>>());
                    p += n;
                    resource.insert(s.clone(), kv[p] == "1");
                    p += 1;
                }
                let input = bfs::Input {
                    board: bi,
                    self_: w[2].to_string(),
                    ships,
                    damaged: dv[2..2 + nd].iter().map(|x| x.to_string()).collect(),
                    built: uv[2..2 + nu].iter().map(|x| x.to_string()).collect(),
                    colors,
                    resource,
                };
                cases.push((input, (w[3].parse::<f64>().unwrap(), w[4].parse::<f64>().unwrap())));
                i += 5;
            }
            _ => i += 1,
        }
    }
    (boards.into_iter().map(|b| b.unwrap()).collect(), cases)
}

fn bfs_all(boards: &[bfs::Board], cases: &[(bfs::Input, (f64, f64))], verify: bool) -> u32 {
    let mut sum: i32 = 0;
    for (x, want) in cases {
        let (g, t) = bfs::positional(&boards[x.board], x);
        if verify && (g.to_bits() != want.0.to_bits() || t.to_bits() != want.1.to_bits()) {
            panic!("bfs mismatch");
        }
        sum = sum.wrapping_mul(31).wrapping_add((g as i32) * 7 + t as i32);
    }
    sum as u32
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let iterations: usize = a.get(3).map(|x| x.parse().unwrap()).unwrap_or(30);
    let trace = load_trace(&a[1]);
    let (boards, cases) = load_bfs(&a[2]);
    let mut n_ops = 0;
    let mut i = 0;
    while i < trace.ops.len() {
        i += op_len(&trace.ops, i);
        n_ops += 1;
    }
    let trace_check = replay(&trace, true);
    let bfs_check = bfs_all(&boards, &cases, true);
    let (mut tm, mut bm) = (vec![], vec![]);
    for _ in 0..iterations {
        let t0 = cpu_ms();
        let va = replay(&trace, false);
        let t1 = cpu_ms();
        let vb = bfs_all(&boards, &cases, false);
        let t2 = cpu_ms();
        assert!(va == trace_check && vb == bfs_check, "checksum drift");
        tm.push(format!("{:.2}", t1 - t0));
        bm.push(format!("{:.2}", t2 - t1));
    }
    println!(
        "{{\"lang\":\"rust\",\"ops\":{},\"bfsCases\":{},\"traceCheck\":{},\"bfsCheck\":{},\"traceMs\":[{}],\"bfsMs\":[{}]}}",
        n_ops, cases.len(), trace_check, bfs_check, tm.join(","), bm.join(",")
    );
}
