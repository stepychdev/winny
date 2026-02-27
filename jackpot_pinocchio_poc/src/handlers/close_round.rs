use pinocchio::error::ProgramError;

use crate::{
    errors::JackpotCompatError,
    instruction_layouts::parse_round_id_ix,
    legacy_layouts::{
        RoundLifecycleView, TokenAccountWithAmountView, ROUND_STATUS_CANCELLED,
        ROUND_STATUS_CLAIMED, PUBKEY_LEN,
    },
};

pub fn process_anchor_bytes(
    round_pubkey: [u8; PUBKEY_LEN],
    round_account_data: &[u8],
    vault_account_data: &[u8],
    ix_data: &[u8],
) -> Result<(), ProgramError> {
    let _round_id = parse_round_id_ix(ix_data, "close_round")
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let round = RoundLifecycleView::read_from_account_data(round_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let vault = TokenAccountWithAmountView::read_from_account_data(vault_account_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;

    let closeable =
        round.status == ROUND_STATUS_CLAIMED || round.status == ROUND_STATUS_CANCELLED;
    if !closeable {
        return Err(JackpotCompatError::RoundNotCloseable.into());
    }

    if vault.amount != 0 {
        return Err(JackpotCompatError::VaultNotEmpty.into());
    }

    if vault.owner != round_pubkey {
        return Err(JackpotCompatError::InvalidVault.into());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        anchor_compat::{account_discriminator, instruction_discriminator},
        legacy_layouts::{
            RoundLifecycleView, ROUND_ACCOUNT_LEN, ROUND_STATUS_CLAIMED, ROUND_STATUS_OPEN,
            TOKEN_ACCOUNT_WITH_AMOUNT_LEN,
        },
    };

    fn sample_round(round_id: u64, status: u8) -> [u8; ROUND_ACCOUNT_LEN] {
        let mut data = [0u8; ROUND_ACCOUNT_LEN];
        data[..8].copy_from_slice(&account_discriminator("Round"));
        RoundLifecycleView {
            round_id,
            status,
            bump: 201,
            start_ts: 10,
            end_ts: 130,
            first_deposit_ts: 25,
            total_usdc: 1_250_000,
            total_tickets: 200,
            participants_count: 2,
        }
        .write_to_account_data(&mut data)
        .unwrap();
        data
    }

    fn sample_vault(round_pubkey: [u8; 32], amount: u64) -> [u8; TOKEN_ACCOUNT_WITH_AMOUNT_LEN] {
        let mut data = [0u8; TOKEN_ACCOUNT_WITH_AMOUNT_LEN];
        data[..32].copy_from_slice(&[7u8; 32]);
        data[32..64].copy_from_slice(&round_pubkey);
        data[64..72].copy_from_slice(&amount.to_le_bytes());
        data
    }

    #[test]
    fn allows_close_for_terminal_round_with_empty_vault() {
        let round_id = 81u64;
        let round_pubkey = [4u8; 32];
        let round_data = sample_round(round_id, ROUND_STATUS_CLAIMED);
        let vault_data = sample_vault(round_pubkey, 0);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("close_round"));
        ix.extend_from_slice(&round_id.to_le_bytes());

        process_anchor_bytes(round_pubkey, &round_data, &vault_data, &ix).unwrap();
    }

    #[test]
    fn rejects_non_terminal_round() {
        let round_id = 81u64;
        let round_pubkey = [4u8; 32];
        let round_data = sample_round(round_id, ROUND_STATUS_OPEN);
        let vault_data = sample_vault(round_pubkey, 0);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("close_round"));
        ix.extend_from_slice(&round_id.to_le_bytes());

        let err = process_anchor_bytes(round_pubkey, &round_data, &vault_data, &ix).unwrap_err();
        assert_eq!(err, JackpotCompatError::RoundNotCloseable.into());
    }

    #[test]
    fn rejects_non_empty_vault() {
        let round_id = 81u64;
        let round_pubkey = [4u8; 32];
        let round_data = sample_round(round_id, ROUND_STATUS_CLAIMED);
        let vault_data = sample_vault(round_pubkey, 1);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("close_round"));
        ix.extend_from_slice(&round_id.to_le_bytes());

        let err = process_anchor_bytes(round_pubkey, &round_data, &vault_data, &ix).unwrap_err();
        assert_eq!(err, JackpotCompatError::VaultNotEmpty.into());
    }

    #[test]
    fn rejects_vault_owned_by_other_account() {
        let round_id = 81u64;
        let round_pubkey = [4u8; 32];
        let round_data = sample_round(round_id, ROUND_STATUS_CLAIMED);
        let vault_data = sample_vault([9u8; 32], 0);

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("close_round"));
        ix.extend_from_slice(&round_id.to_le_bytes());

        let err = process_anchor_bytes(round_pubkey, &round_data, &vault_data, &ix).unwrap_err();
        assert_eq!(err, JackpotCompatError::InvalidVault.into());
    }
}
