use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use crate::constants::{BPS_DENOMINATOR, VRF_REIMBURSEMENT_USDC};
use crate::errors::ErrorCode;

pub struct ClaimAmounts {
    pub fee: u64,
    pub payout: u64,
    pub vrf_reimburse: u64,
}

pub fn checked_add_u64(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b).ok_or(ErrorCode::MathOverflow.into())
}

pub fn checked_add_i64(a: i64, b: i64) -> Result<i64> {
    a.checked_add(b).ok_or(ErrorCode::MathOverflow.into())
}

pub fn compute_claim_amounts(
    total_usdc: u64,
    fee_bps: u16,
    reimburse_vrf: bool,
) -> Result<ClaimAmounts> {
    let vrf_reimburse = if reimburse_vrf {
        VRF_REIMBURSEMENT_USDC.min(total_usdc)
    } else {
        0
    };

    let pot_after_reimburse = total_usdc
        .checked_sub(vrf_reimburse)
        .ok_or(ErrorCode::MathOverflow)?;

    let fee = ((pot_after_reimburse as u128)
        .checked_mul(fee_bps as u128)
        .ok_or(ErrorCode::MathOverflow)?)
    .checked_div(BPS_DENOMINATOR as u128)
    .ok_or(ErrorCode::MathOverflow)? as u64;

    let payout = pot_after_reimburse
        .checked_sub(fee)
        .ok_or(ErrorCode::MathOverflow)?;

    Ok(ClaimAmounts {
        fee,
        payout,
        vrf_reimburse,
    })
}

pub fn bit_add(bit: &mut [u64], mut i: usize, delta: u64) -> Result<()> {
    let n = bit.len() - 1; // 1-indexed
    while i <= n {
        bit[i] = bit[i].checked_add(delta).ok_or(ErrorCode::MathOverflow)?;
        i += i & (!i + 1); // i += lowbit(i)
    }
    Ok(())
}

/// Subtract `delta` tickets from participant at 1-based index `i` in the Fenwick tree.
/// Used when a participant cancels to keep the tree in sync with total_tickets.
pub fn bit_sub(bit: &mut [u64], mut i: usize, delta: u64) -> Result<()> {
    let n = bit.len() - 1;
    while i <= n {
        bit[i] = bit[i].checked_sub(delta).ok_or(ErrorCode::MathOverflow)?;
        i += i & (!i + 1);
    }
    Ok(())
}

pub fn bit_find_prefix(bit: &[u64], target: u64) -> Result<usize> {
    let n = bit.len() - 1;
    let mut bit_mask = 1usize;
    while bit_mask <= n {
        bit_mask <<= 1;
    }
    let mut idx = 0usize;
    let mut cur = 0u64;
    let mut step = bit_mask;
    while step > 0 {
        let next = idx + step;
        if next <= n {
            let cand = cur.checked_add(bit[next]).ok_or(ErrorCode::MathOverflow)?;
            if cand < target {
                idx = next;
                cur = cand;
            }
        }
        step >>= 1;
    }
    Ok(idx + 1)
}

pub fn derive_degen_candidate_indices(
    randomness: &[u8; 32],
    pool_version: u32,
    pool_len: usize,
    count: usize,
) -> Vec<usize> {
    let mut selected = Vec::with_capacity(count);

    for rank in 0..count {
        let mut nonce: u32 = 0;

        loop {
            let digest = hashv(&[
                randomness,
                &pool_version.to_le_bytes(),
                &(rank as u32).to_le_bytes(),
                &nonce.to_le_bytes(),
            ]);

            let bytes = digest.to_bytes();
            let raw = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
            let index = (raw as usize) % pool_len;

            if !selected.contains(&index) {
                selected.push(index);
                break;
            }

            nonce = nonce.saturating_add(1);
        }
    }

    selected
}

pub fn derive_degen_candidate_index_at_rank(
    randomness: &[u8; 32],
    pool_version: u32,
    pool_len: usize,
    rank: usize,
) -> usize {
    derive_degen_candidate_indices(randomness, pool_version, pool_len, rank + 1)[rank]
}
