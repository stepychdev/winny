use pinocchio::error::ProgramError;

use crate::{errors::JackpotCompatError, legacy_layouts::LayoutError};

const BPS_DENOMINATOR: u64 = 10_000;
const VRF_REIMBURSEMENT_USDC: u64 = 200_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClaimAmountsCompat {
    pub payout: u64,
    pub fee: u64,
    pub vrf_reimburse: u64,
}

pub fn compute_claim_amounts(
    total_usdc: u64,
    fee_bps: u16,
    reimburse_vrf: bool,
) -> Result<ClaimAmountsCompat, ProgramError> {
    let overflow = || ProgramError::from(JackpotCompatError::MathOverflow);
    let vrf_reimburse = if reimburse_vrf {
        VRF_REIMBURSEMENT_USDC.min(total_usdc)
    } else {
        0
    };
    let pot_after_reimburse = total_usdc
        .checked_sub(vrf_reimburse)
        .ok_or_else(overflow)?;
    let fee = ((pot_after_reimburse as u128)
        .checked_mul(fee_bps as u128)
        .ok_or_else(overflow)?)
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or_else(overflow)? as u64;
    let payout = pot_after_reimburse.checked_sub(fee).ok_or_else(overflow)?;
    Ok(ClaimAmountsCompat {
        payout,
        fee,
        vrf_reimburse,
    })
}

pub fn map_layout_err(err: LayoutError) -> ProgramError {
    match err {
        LayoutError::MathOverflow => JackpotCompatError::MathOverflow.into(),
        _ => ProgramError::InvalidAccountData,
    }
}
