extern crate alloc;

use alloc::vec::Vec;
use sha2::{Digest, Sha256};

mod live_generated_pool {
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../jackpot_anchor_v4/programs/jackpot/src/generated/degen_pool.rs"
    ));
}

pub fn pool_version() -> u32 {
    live_generated_pool::DEGEN_POOL_VERSION
}

pub fn pool_len() -> usize {
    live_generated_pool::DEGEN_POOL.len()
}

pub fn pool_snapshot_sha256() -> &'static str {
    live_generated_pool::DEGEN_POOL_SNAPSHOT_SHA256
}

pub fn degen_token_mint_by_index(index: u32) -> Option<[u8; 32]> {
    live_generated_pool::DEGEN_POOL.get(index as usize).copied()
}

pub fn derive_degen_candidate_indices(
    randomness: &[u8; 32],
    pool_version: u32,
    count: usize,
) -> Vec<u32> {
    let mut selected = Vec::with_capacity(count);
    let pool_len = pool_len();

    for rank in 0..count {
        let mut nonce: u32 = 0;
        loop {
            let mut hasher = Sha256::new();
            hasher.update(randomness);
            hasher.update(pool_version.to_le_bytes());
            hasher.update((rank as u32).to_le_bytes());
            hasher.update(nonce.to_le_bytes());
            let digest = hasher.finalize();
            let raw = u32::from_le_bytes([digest[0], digest[1], digest[2], digest[3]]);
            let index = raw as usize % pool_len;
            if !selected.iter().any(|existing| *existing as usize == index) {
                selected.push(index as u32);
                break;
            }
            nonce = nonce.checked_add(1).expect("degen candidate nonce overflow");
        }
    }

    selected
}

pub fn derive_degen_candidate_index_at_rank(
    randomness: &[u8; 32],
    pool_version: u32,
    rank: usize,
) -> u32 {
    derive_degen_candidate_indices(randomness, pool_version, rank + 1)[rank]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_stable_candidate_indices_from_live_pool() {
        let randomness: [u8; 32] = core::array::from_fn(|i| i as u8);
        let indices = derive_degen_candidate_indices(&randomness, 1, 10);
        assert_eq!(indices, vec![3593, 1483, 392, 2661, 1708, 4051, 3116, 1859, 869, 3958]);
        assert_eq!(derive_degen_candidate_index_at_rank(&randomness, 1, 9), 3958);
    }

    #[test]
    fn returns_live_pool_version_and_mints() {
        assert_eq!(pool_version(), 1);
        assert_eq!(pool_len(), 4533);
        assert_eq!(pool_snapshot_sha256(), "2bc963513778c7a45a8800c2a1dc99e1dd8f25d2c1ac25d274292f9b5f52a79e");
        assert!(degen_token_mint_by_index(0).is_some());
        assert!(degen_token_mint_by_index(4533).is_none());
    }
}
