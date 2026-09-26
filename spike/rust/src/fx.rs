//! FxHash (rustc's hasher), inlined to stay dependency-free. std's default SipHash is DoS-resistant
//! and ~3-5x slower on short keys; no engine port would use it.
use std::collections::{HashMap, HashSet};
use std::hash::{BuildHasherDefault, Hasher};

#[derive(Default, Clone, Copy)]
pub struct Fx(u64);
const K: u64 = 0x51_7c_c1_b7_27_22_0a_95;
impl Hasher for Fx {
    #[inline]
    fn write(&mut self, bytes: &[u8]) {
        let mut h = self.0;
        let mut b = bytes;
        while b.len() >= 8 {
            h = (h.rotate_left(5) ^ u64::from_le_bytes(b[..8].try_into().unwrap())).wrapping_mul(K);
            b = &b[8..];
        }
        if b.len() >= 4 {
            h = (h.rotate_left(5) ^ u32::from_le_bytes(b[..4].try_into().unwrap()) as u64).wrapping_mul(K);
            b = &b[4..];
        }
        for &x in b {
            h = (h.rotate_left(5) ^ x as u64).wrapping_mul(K);
        }
        self.0 = h;
    }
    #[inline]
    fn write_u8(&mut self, i: u8) {
        self.0 = (self.0.rotate_left(5) ^ i as u64).wrapping_mul(K);
    }
    #[inline]
    fn write_usize(&mut self, i: usize) {
        self.0 = (self.0.rotate_left(5) ^ i as u64).wrapping_mul(K);
    }
    #[inline]
    fn finish(&self) -> u64 {
        self.0
    }
}
pub type FxMap<K, V> = HashMap<K, V, BuildHasherDefault<Fx>>;
pub type FxSet<K> = HashSet<K, BuildHasherDefault<Fx>>;
