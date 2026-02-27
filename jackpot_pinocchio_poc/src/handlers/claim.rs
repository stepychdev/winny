use pinocchio::error::ProgramError;

use crate::{
    errors::JackpotCompatError,
    instruction_layouts::parse_round_id_ix,
    legacy_layouts::{
        ConfigView, RoundLifecycleView, TokenAccountCoreView, DEGEN_MODE_NONE,
        ROUND_STATUS_CLAIMED, ROUND_STATUS_SETTLED, PUBKEY_LEN,
    },
};

use super::degen_common::{ClaimAmountsCompat, compute_claim_amounts, map_layout_err};

#[allow(clippy::too_many_arguments)]
pub fn process_anchor_bytes(
    winner_pubkey: [u8; PUBKEY_LEN],
    round_pubkey: [u8; PUBKEY_LEN],
    vault_pubkey: [u8; PUBKEY_LEN],
    config_account_data: &[u8],
    round_account_data: &mut [u8],
    vault_account_data: &[u8],
    winner_usdc_ata_data: &[u8],
    treasury_usdc_ata_pubkey: [u8; PUBKEY_LEN],
    treasury_usdc_ata_data: &[u8],
    vrf_payer_usdc_ata_data: Option<&[u8]>,
    ix_data: &[u8],
) -> Result<ClaimAmountsCompat, ProgramError> {
    let _round_id =
        parse_round_id_ix(ix_data, "claim").map_err(|_| ProgramError::InvalidInstructionData)?;

    let config = ConfigView::read_from_account_data(config_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let round = RoundLifecycleView::read_from_account_data(round_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;

    if round.status != ROUND_STATUS_SETTLED {
        return Err(JackpotCompatError::RoundNotSettled.into());
    }
    if RoundLifecycleView::read_degen_mode_status_from_account_data(round_account_data)
        .map_err(map_layout_err)?
        != DEGEN_MODE_NONE
    {
        return Err(JackpotCompatError::DegenClaimLocked.into());
    }
    if RoundLifecycleView::read_winner_from_account_data(round_account_data).map_err(map_layout_err)?
        != winner_pubkey
    {
        return Err(JackpotCompatError::OnlyWinnerCanClaim.into());
    }

    let vault = TokenAccountCoreView::read_from_account_data(vault_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if RoundLifecycleView::read_vault_pubkey_from_account_data(round_account_data)
        .map_err(map_layout_err)?
        != vault_pubkey
        || vault.mint != config.usdc_mint
        || vault.owner != round_pubkey
    {
        return Err(JackpotCompatError::InvalidVault.into());
    }

    let winner_ata = TokenAccountCoreView::read_from_account_data(winner_usdc_ata_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if winner_ata.mint != config.usdc_mint || winner_ata.owner != winner_pubkey {
        return Err(JackpotCompatError::InvalidUserUsdcAta.into());
    }

    let treasury_ata = TokenAccountCoreView::read_from_account_data(treasury_usdc_ata_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if treasury_usdc_ata_pubkey != config.treasury_usdc_ata || treasury_ata.mint != config.usdc_mint
    {
        return Err(JackpotCompatError::InvalidTreasury.into());
    }

    let vrf_payer_key =
        RoundLifecycleView::read_vrf_payer_from_account_data(round_account_data).map_err(map_layout_err)?;
    let has_vrf_payer = vrf_payer_key != [0u8; 32]
        && RoundLifecycleView::read_vrf_reimbursed_from_account_data(round_account_data)
            .map_err(map_layout_err)?
            == 0;
    let reimburse_vrf = has_vrf_payer
        && vrf_payer_usdc_ata_data.and_then(|data| {
            TokenAccountCoreView::read_from_account_data(data).ok().and_then(|ata| {
                (ata.mint == config.usdc_mint && ata.owner == vrf_payer_key).then_some(())
            })
        }).is_some();

    let amounts = compute_claim_amounts(round.total_usdc, config.fee_bps, reimburse_vrf)?;

    RoundLifecycleView::write_status_to_account_data(round_account_data, ROUND_STATUS_CLAIMED)
        .map_err(map_layout_err)?;
    if amounts.vrf_reimburse > 0 {
        RoundLifecycleView::write_vrf_reimbursed_to_account_data(round_account_data, 1)
            .map_err(map_layout_err)?;
    }

    Ok(amounts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        anchor_compat::{account_discriminator, instruction_discriminator},
        legacy_layouts::{
            ConfigView, RoundLifecycleView, CONFIG_ACCOUNT_LEN, ROUND_ACCOUNT_LEN,
            ROUND_STATUS_CLAIMED, ROUND_STATUS_SETTLED, TOKEN_ACCOUNT_CORE_LEN, DEGEN_MODE_NONE,
        },
    };

    fn sample_config() -> [u8; CONFIG_ACCOUNT_LEN] {
        let mut data = [0u8; CONFIG_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Config"));
        ConfigView {
            admin: [7u8; 32],
            usdc_mint: [2u8; 32],
            treasury_usdc_ata: [3u8; 32],
            fee_bps: 25,
            ticket_unit: 10_000,
            round_duration_sec: 120,
            min_participants: 2,
            min_total_tickets: 200,
            paused: false,
            bump: 254,
            max_deposit_per_user: 1_000_000,
            reserved: [0u8; 24],
        }
        .write_to_account_data(&mut data)
        .unwrap();
        data
    }

    fn sample_round(reimburse_vrf: bool) -> [u8; ROUND_ACCOUNT_LEN] {
        let mut data = [0u8; ROUND_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Round"));
        RoundLifecycleView {
            round_id: 81,
            status: ROUND_STATUS_SETTLED,
            bump: 201,
            start_ts: 10,
            end_ts: 130,
            first_deposit_ts: 25,
            total_usdc: 1_000_000,
            total_tickets: 200,
            participants_count: 2,
        }
        .write_to_account_data(&mut data)
        .unwrap();
        data[48..80].copy_from_slice(&[8u8; 32]);
        RoundLifecycleView::write_winner_to_account_data(&mut data, &[9u8; 32]).unwrap();
        RoundLifecycleView::write_degen_mode_status_to_account_data(&mut data, DEGEN_MODE_NONE)
            .unwrap();
        if reimburse_vrf {
            RoundLifecycleView::write_vrf_payer_to_account_data(&mut data, &[10u8; 32]).unwrap();
        }
        data
    }

    fn token_account(mint: [u8; 32], owner: [u8; 32]) -> [u8; TOKEN_ACCOUNT_CORE_LEN] {
        let mut data = [0u8; TOKEN_ACCOUNT_CORE_LEN];
        data[..32].copy_from_slice(&mint);
        data[32..64].copy_from_slice(&owner);
        data
    }

    #[test]
    fn applies_claim_and_marks_round_claimed() {
        let config = sample_config();
        let mut round = sample_round(true);
        let vault = token_account([2u8; 32], [8u8; 32]);
        let winner_ata = token_account([2u8; 32], [9u8; 32]);
        let treasury_ata = token_account([2u8; 32], [1u8; 32]);
        let vrf_ata = token_account([2u8; 32], [10u8; 32]);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("claim"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        let amounts = process_anchor_bytes(
            [9u8; 32],
            [8u8; 32],
            [8u8; 32],
            &config,
            &mut round,
            &vault,
            &winner_ata,
            [3u8; 32],
            &treasury_ata,
            Some(&vrf_ata),
            &ix,
        )
        .unwrap();

        assert_eq!(amounts.vrf_reimburse, 200_000);
        assert_eq!(amounts.fee, 2_000);
        assert_eq!(amounts.payout, 798_000);
        let round_view = RoundLifecycleView::read_from_account_data(&round).unwrap();
        assert_eq!(round_view.status, ROUND_STATUS_CLAIMED);
        assert_eq!(
            RoundLifecycleView::read_vrf_reimbursed_from_account_data(&round).unwrap(),
            1
        );
    }

    #[test]
    fn ignores_invalid_vrf_ata_and_skips_reimbursement() {
        let config = sample_config();
        let mut round = sample_round(true);
        let vault = token_account([2u8; 32], [8u8; 32]);
        let winner_ata = token_account([2u8; 32], [9u8; 32]);
        let treasury_ata = token_account([2u8; 32], [1u8; 32]);
        let invalid_vrf_ata = token_account([2u8; 32], [99u8; 32]);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("claim"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        let amounts = process_anchor_bytes(
            [9u8; 32],
            [8u8; 32],
            [8u8; 32],
            &config,
            &mut round,
            &vault,
            &winner_ata,
            [3u8; 32],
            &treasury_ata,
            Some(&invalid_vrf_ata),
            &ix,
        )
        .unwrap();

        assert_eq!(amounts.vrf_reimburse, 0);
        assert_eq!(amounts.fee, 2_500);
        assert_eq!(amounts.payout, 997_500);
        assert_eq!(
            RoundLifecycleView::read_vrf_reimbursed_from_account_data(&round).unwrap(),
            0
        );
    }
}
