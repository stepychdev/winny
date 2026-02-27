use pinocchio::error::ProgramError;

use crate::{
    anchor_compat::instruction_discriminator,
    handlers::{self, degen_common::ClaimAmountsCompat},
};

pub struct ClaimProcessor<'a> {
    pub winner_pubkey: [u8; 32],
    pub round_pubkey: [u8; 32],
    pub vault_pubkey: [u8; 32],
    pub treasury_usdc_ata_pubkey: [u8; 32],
    pub config_account_data: &'a [u8],
    pub round_account_data: &'a mut [u8],
    pub vault_account_data: &'a [u8],
    pub winner_usdc_ata_data: &'a [u8],
    pub treasury_usdc_ata_data: &'a [u8],
    pub vrf_payer_usdc_ata_data: Option<&'a [u8]>,
}

impl<'a> ClaimProcessor<'a> {
    pub fn process(&mut self, ix_data: &[u8]) -> Result<ClaimAmountsCompat, ProgramError> {
        let discriminator = ix_data
            .get(..8)
            .ok_or(ProgramError::InvalidInstructionData)?;

        if discriminator == instruction_discriminator("claim") {
            return handlers::claim::process_anchor_bytes(
                self.winner_pubkey,
                self.round_pubkey,
                self.vault_pubkey,
                self.config_account_data,
                self.round_account_data,
                self.vault_account_data,
                self.winner_usdc_ata_data,
                self.treasury_usdc_ata_pubkey,
                self.treasury_usdc_ata_data,
                self.vrf_payer_usdc_ata_data,
                ix_data,
            );
        }
        if discriminator == instruction_discriminator("auto_claim") {
            return handlers::auto_claim::process_anchor_bytes(
                self.round_pubkey,
                self.vault_pubkey,
                self.config_account_data,
                self.round_account_data,
                self.vault_account_data,
                self.winner_usdc_ata_data,
                self.treasury_usdc_ata_pubkey,
                self.treasury_usdc_ata_data,
                self.vrf_payer_usdc_ata_data,
                ix_data,
            );
        }

        Err(ProgramError::InvalidInstructionData)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::anchor_compat::instruction_discriminator;

    #[test]
    fn routes_auto_claim() {
        let mut round = [0u8; 256];
        let config = [0u8; 128];
        let vault = [0u8; 72];
        let winner = [0u8; 72];
        let treasury = [0u8; 72];

        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("auto_claim"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        let mut processor = ClaimProcessor {
            winner_pubkey: [0u8; 32],
            round_pubkey: [0u8; 32],
            vault_pubkey: [0u8; 32],
            treasury_usdc_ata_pubkey: [0u8; 32],
            config_account_data: &config,
            round_account_data: &mut round,
            vault_account_data: &vault,
            winner_usdc_ata_data: &winner,
            treasury_usdc_ata_data: &treasury,
            vrf_payer_usdc_ata_data: None,
        };

        let err = processor.process(&ix).unwrap_err();
        assert_ne!(err, ProgramError::InvalidInstructionData);
    }
}
