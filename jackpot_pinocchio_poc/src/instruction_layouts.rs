use crate::{
    anchor_compat::instruction_discriminator,
    legacy_layouts::{LayoutError, PUBKEY_LEN},
};

pub const UPSERT_DEGEN_CONFIG_IX_LEN: usize = 8 + PUBKEY_LEN + 4;
pub const INIT_CONFIG_IX_LEN: usize = 8 + PUBKEY_LEN + PUBKEY_LEN + 2 + 8 + 4 + 2 + 8 + 8;
pub const TRANSFER_ADMIN_IX_LEN: usize = 8 + PUBKEY_LEN;
pub const ROUND_ID_IX_LEN: usize = 8 + 8;
pub const ROUND_ID_U8_IX_LEN: usize = 8 + 8 + 1;
pub const VRF_CALLBACK_IX_LEN: usize = 8 + 32;
pub const DEGEN_VRF_CALLBACK_IX_LEN: usize = 8 + 32;
pub const BEGIN_DEGEN_EXECUTION_IX_LEN: usize = 8 + 8 + 1 + 4 + 8 + 32;
pub const CLAIM_DEGEN_IX_LEN: usize = 8 + 8 + 1 + 4;
pub const DEPOSIT_ANY_IX_LEN: usize = 8 + 8 + 8 + 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstructionLayoutError {
    SliceTooShort,
    WrongDiscriminator,
    InvalidOptionTag,
    InvalidBool,
}

impl From<LayoutError> for InstructionLayoutError {
    fn from(value: LayoutError) -> Self {
        match value {
            LayoutError::SliceTooShort => Self::SliceTooShort,
            LayoutError::InvalidBool => Self::InvalidBool,
            LayoutError::MathOverflow => Self::SliceTooShort,
        }
    }
}


#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InitConfigArgsCompat {
    pub usdc_mint: [u8; PUBKEY_LEN],
    pub treasury_usdc_ata: [u8; PUBKEY_LEN],
    pub fee_bps: u16,
    pub ticket_unit: u64,
    pub round_duration_sec: u32,
    pub min_participants: u16,
    pub min_total_tickets: u64,
    pub max_deposit_per_user: u64,
}

impl InitConfigArgsCompat {
    pub fn parse(ix_data: &[u8]) -> Result<Self, InstructionLayoutError> {
        if ix_data.len() < INIT_CONFIG_IX_LEN {
            return Err(InstructionLayoutError::SliceTooShort);
        }
        let expected = instruction_discriminator("init_config");
        if ix_data[..8] != expected {
            return Err(InstructionLayoutError::WrongDiscriminator);
        }

        let mut offset = 8usize;
        Ok(Self {
            usdc_mint: read_fixed_pubkey(ix_data, &mut offset)?,
            treasury_usdc_ata: read_fixed_pubkey(ix_data, &mut offset)?,
            fee_bps: read_fixed_u16(ix_data, &mut offset)?,
            ticket_unit: read_fixed_u64(ix_data, &mut offset)?,
            round_duration_sec: read_fixed_u32(ix_data, &mut offset)?,
            min_participants: read_fixed_u16(ix_data, &mut offset)?,
            min_total_tickets: read_fixed_u64(ix_data, &mut offset)?,
            max_deposit_per_user: read_fixed_u64(ix_data, &mut offset)?,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BeginDegenExecutionArgsCompat {
    pub round_id: u64,
    pub candidate_rank: u8,
    pub token_index: u32,
    pub min_out_raw: u64,
    pub route_hash: [u8; 32],
}

impl BeginDegenExecutionArgsCompat {
    pub fn parse(ix_data: &[u8]) -> Result<Self, InstructionLayoutError> {
        if ix_data.len() < BEGIN_DEGEN_EXECUTION_IX_LEN {
            return Err(InstructionLayoutError::SliceTooShort);
        }
        let expected = instruction_discriminator("begin_degen_execution");
        if ix_data[..8] != expected {
            return Err(InstructionLayoutError::WrongDiscriminator);
        }

        let round_id = u64::from_le_bytes(
            ix_data[8..16].try_into().map_err(|_| InstructionLayoutError::SliceTooShort)?,
        );
        let candidate_rank = ix_data[16];
        let token_index = u32::from_le_bytes(
            ix_data[17..21].try_into().map_err(|_| InstructionLayoutError::SliceTooShort)?,
        );
        let min_out_raw = u64::from_le_bytes(
            ix_data[21..29].try_into().map_err(|_| InstructionLayoutError::SliceTooShort)?,
        );
        let mut route_hash = [0u8; 32];
        route_hash.copy_from_slice(&ix_data[29..61]);

        Ok(Self {
            round_id,
            candidate_rank,
            token_index,
            min_out_raw,
            route_hash,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClaimDegenArgsCompat {
    pub round_id: u64,
    pub candidate_rank: u8,
    pub token_index: u32,
}

impl ClaimDegenArgsCompat {
    pub fn parse(ix_data: &[u8]) -> Result<Self, InstructionLayoutError> {
        if ix_data.len() < CLAIM_DEGEN_IX_LEN {
            return Err(InstructionLayoutError::SliceTooShort);
        }
        let expected = instruction_discriminator("claim_degen");
        if ix_data[..8] != expected {
            return Err(InstructionLayoutError::WrongDiscriminator);
        }

        let round_id = u64::from_le_bytes(
            ix_data[8..16].try_into().map_err(|_| InstructionLayoutError::SliceTooShort)?,
        );
        let candidate_rank = ix_data[16];
        let token_index = u32::from_le_bytes(
            ix_data[17..21].try_into().map_err(|_| InstructionLayoutError::SliceTooShort)?,
        );

        Ok(Self {
            round_id,
            candidate_rank,
            token_index,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DepositAnyArgsCompat {
    pub round_id: u64,
    pub usdc_balance_before: u64,
    pub min_out: u64,
}

impl DepositAnyArgsCompat {
    pub fn parse(ix_data: &[u8]) -> Result<Self, InstructionLayoutError> {
        if ix_data.len() < DEPOSIT_ANY_IX_LEN {
            return Err(InstructionLayoutError::SliceTooShort);
        }
        let expected = instruction_discriminator("deposit_any");
        if ix_data[..8] != expected {
            return Err(InstructionLayoutError::WrongDiscriminator);
        }

        Ok(Self {
            round_id: u64::from_le_bytes(
                ix_data[8..16].try_into().map_err(|_| InstructionLayoutError::SliceTooShort)?,
            ),
            usdc_balance_before: u64::from_le_bytes(
                ix_data[16..24].try_into().map_err(|_| InstructionLayoutError::SliceTooShort)?,
            ),
            min_out: u64::from_le_bytes(
                ix_data[24..32].try_into().map_err(|_| InstructionLayoutError::SliceTooShort)?,
            ),
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UpsertDegenConfigArgsCompat {
    pub executor: [u8; PUBKEY_LEN],
    pub fallback_timeout_sec: u32,
}

impl UpsertDegenConfigArgsCompat {
    pub fn parse(ix_data: &[u8]) -> Result<Self, InstructionLayoutError> {
        if ix_data.len() < UPSERT_DEGEN_CONFIG_IX_LEN {
            return Err(InstructionLayoutError::SliceTooShort);
        }
        let expected = instruction_discriminator("upsert_degen_config");
        if ix_data[..8] != expected {
            return Err(InstructionLayoutError::WrongDiscriminator);
        }

        let mut offset = 8usize;
        let mut executor = [0u8; PUBKEY_LEN];
        executor.copy_from_slice(&ix_data[offset..offset + PUBKEY_LEN]);
        offset += PUBKEY_LEN;
        let fallback_timeout_sec = u32::from_le_bytes([
            ix_data[offset],
            ix_data[offset + 1],
            ix_data[offset + 2],
            ix_data[offset + 3],
        ]);

        Ok(Self {
            executor,
            fallback_timeout_sec,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TransferAdminArgsCompat {
    pub new_admin: [u8; PUBKEY_LEN],
}

impl TransferAdminArgsCompat {
    pub fn parse(ix_data: &[u8]) -> Result<Self, InstructionLayoutError> {
        if ix_data.len() < TRANSFER_ADMIN_IX_LEN {
            return Err(InstructionLayoutError::SliceTooShort);
        }
        let expected = instruction_discriminator("transfer_admin");
        if ix_data[..8] != expected {
            return Err(InstructionLayoutError::WrongDiscriminator);
        }

        let mut new_admin = [0u8; PUBKEY_LEN];
        new_admin.copy_from_slice(&ix_data[8..8 + PUBKEY_LEN]);
        Ok(Self { new_admin })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct UpdateConfigArgsCompat {
    pub fee_bps: Option<u16>,
    pub ticket_unit: Option<u64>,
    pub round_duration_sec: Option<u32>,
    pub min_participants: Option<u16>,
    pub min_total_tickets: Option<u64>,
    pub paused: Option<bool>,
    pub max_deposit_per_user: Option<u64>,
}

impl UpdateConfigArgsCompat {
    pub fn parse(ix_data: &[u8]) -> Result<Self, InstructionLayoutError> {
        if ix_data.len() < 8 {
            return Err(InstructionLayoutError::SliceTooShort);
        }
        let expected = instruction_discriminator("update_config");
        if ix_data[..8] != expected {
            return Err(InstructionLayoutError::WrongDiscriminator);
        }

        let mut offset = 8usize;
        Ok(Self {
            fee_bps: read_option_u16(ix_data, &mut offset)?,
            ticket_unit: read_option_u64(ix_data, &mut offset)?,
            round_duration_sec: read_option_u32(ix_data, &mut offset)?,
            min_participants: read_option_u16(ix_data, &mut offset)?,
            min_total_tickets: read_option_u64(ix_data, &mut offset)?,
            paused: read_option_bool(ix_data, &mut offset)?,
            max_deposit_per_user: read_option_u64(ix_data, &mut offset)?,
        })
    }
}

pub fn parse_no_arg_ix(ix_data: &[u8], ix_name: &str) -> Result<(), InstructionLayoutError> {
    if ix_data.len() < 8 {
        return Err(InstructionLayoutError::SliceTooShort);
    }
    let expected = instruction_discriminator(ix_name);
    if ix_data[..8] != expected {
        return Err(InstructionLayoutError::WrongDiscriminator);
    }
    Ok(())
}

pub fn parse_round_id_ix(ix_data: &[u8], ix_name: &str) -> Result<u64, InstructionLayoutError> {
    if ix_data.len() < ROUND_ID_IX_LEN {
        return Err(InstructionLayoutError::SliceTooShort);
    }
    let expected = instruction_discriminator(ix_name);
    if ix_data[..8] != expected {
        return Err(InstructionLayoutError::WrongDiscriminator);
    }
    Ok(u64::from_le_bytes([
        ix_data[8],
        ix_data[9],
        ix_data[10],
        ix_data[11],
        ix_data[12],
        ix_data[13],
        ix_data[14],
        ix_data[15],
    ]))
}

pub fn parse_round_id_u8_ix(
    ix_data: &[u8],
    ix_name: &str,
) -> Result<(u64, u8), InstructionLayoutError> {
    if ix_data.len() < ROUND_ID_U8_IX_LEN {
        return Err(InstructionLayoutError::SliceTooShort);
    }
    let expected = instruction_discriminator(ix_name);
    if ix_data[..8] != expected {
        return Err(InstructionLayoutError::WrongDiscriminator);
    }
    let round_id = u64::from_le_bytes([
        ix_data[8],
        ix_data[9],
        ix_data[10],
        ix_data[11],
        ix_data[12],
        ix_data[13],
        ix_data[14],
        ix_data[15],
    ]);
    Ok((round_id, ix_data[16]))
}

pub fn parse_vrf_callback_ix(ix_data: &[u8]) -> Result<[u8; 32], InstructionLayoutError> {
    if ix_data.len() < VRF_CALLBACK_IX_LEN {
        return Err(InstructionLayoutError::SliceTooShort);
    }
    let expected = instruction_discriminator("vrf_callback");
    if ix_data[..8] != expected {
        return Err(InstructionLayoutError::WrongDiscriminator);
    }
    let mut randomness = [0u8; 32];
    randomness.copy_from_slice(&ix_data[8..40]);
    Ok(randomness)
}

pub fn parse_degen_vrf_callback_ix(ix_data: &[u8]) -> Result<[u8; 32], InstructionLayoutError> {
    if ix_data.len() < DEGEN_VRF_CALLBACK_IX_LEN {
        return Err(InstructionLayoutError::SliceTooShort);
    }
    let expected = instruction_discriminator("degen_vrf_callback");
    if ix_data[..8] != expected {
        return Err(InstructionLayoutError::WrongDiscriminator);
    }
    let mut randomness = [0u8; 32];
    randomness.copy_from_slice(&ix_data[8..40]);
    Ok(randomness)
}

fn read_option_tag(data: &[u8], offset: &mut usize) -> Result<u8, InstructionLayoutError> {
    if data.len() < *offset + 1 {
        return Err(InstructionLayoutError::SliceTooShort);
    }
    let out = data[*offset];
    *offset += 1;
    if out > 1 {
        return Err(InstructionLayoutError::InvalidOptionTag);
    }
    Ok(out)
}

fn read_fixed_pubkey(
    data: &[u8],
    offset: &mut usize,
) -> Result<[u8; PUBKEY_LEN], InstructionLayoutError> {
    if data.len() < *offset + PUBKEY_LEN {
        return Err(InstructionLayoutError::SliceTooShort);
    }
    let mut out = [0u8; PUBKEY_LEN];
    out.copy_from_slice(&data[*offset..*offset + PUBKEY_LEN]);
    *offset += PUBKEY_LEN;
    Ok(out)
}

fn read_fixed_u16(data: &[u8], offset: &mut usize) -> Result<u16, InstructionLayoutError> {
    if data.len() < *offset + 2 {
        return Err(InstructionLayoutError::SliceTooShort);
    }
    let out = u16::from_le_bytes([data[*offset], data[*offset + 1]]);
    *offset += 2;
    Ok(out)
}

fn read_fixed_u32(data: &[u8], offset: &mut usize) -> Result<u32, InstructionLayoutError> {
    if data.len() < *offset + 4 {
        return Err(InstructionLayoutError::SliceTooShort);
    }
    let out = u32::from_le_bytes([
        data[*offset],
        data[*offset + 1],
        data[*offset + 2],
        data[*offset + 3],
    ]);
    *offset += 4;
    Ok(out)
}

fn read_fixed_u64(data: &[u8], offset: &mut usize) -> Result<u64, InstructionLayoutError> {
    if data.len() < *offset + 8 {
        return Err(InstructionLayoutError::SliceTooShort);
    }
    let out = u64::from_le_bytes([
        data[*offset],
        data[*offset + 1],
        data[*offset + 2],
        data[*offset + 3],
        data[*offset + 4],
        data[*offset + 5],
        data[*offset + 6],
        data[*offset + 7],
    ]);
    *offset += 8;
    Ok(out)
}

fn read_option_u16(data: &[u8], offset: &mut usize) -> Result<Option<u16>, InstructionLayoutError> {
    if read_option_tag(data, offset)? == 0 {
        return Ok(None);
    }
    if data.len() < *offset + 2 {
        return Err(InstructionLayoutError::SliceTooShort);
    }
    let out = u16::from_le_bytes([data[*offset], data[*offset + 1]]);
    *offset += 2;
    Ok(Some(out))
}

fn read_option_u32(data: &[u8], offset: &mut usize) -> Result<Option<u32>, InstructionLayoutError> {
    if read_option_tag(data, offset)? == 0 {
        return Ok(None);
    }
    if data.len() < *offset + 4 {
        return Err(InstructionLayoutError::SliceTooShort);
    }
    let out = u32::from_le_bytes([
        data[*offset],
        data[*offset + 1],
        data[*offset + 2],
        data[*offset + 3],
    ]);
    *offset += 4;
    Ok(Some(out))
}

fn read_option_u64(data: &[u8], offset: &mut usize) -> Result<Option<u64>, InstructionLayoutError> {
    if read_option_tag(data, offset)? == 0 {
        return Ok(None);
    }
    if data.len() < *offset + 8 {
        return Err(InstructionLayoutError::SliceTooShort);
    }
    let out = u64::from_le_bytes([
        data[*offset],
        data[*offset + 1],
        data[*offset + 2],
        data[*offset + 3],
        data[*offset + 4],
        data[*offset + 5],
        data[*offset + 6],
        data[*offset + 7],
    ]);
    *offset += 8;
    Ok(Some(out))
}

fn read_option_bool(data: &[u8], offset: &mut usize) -> Result<Option<bool>, InstructionLayoutError> {
    if read_option_tag(data, offset)? == 0 {
        return Ok(None);
    }
    if data.len() < *offset + 1 {
        return Err(InstructionLayoutError::SliceTooShort);
    }
    let out = match data[*offset] {
        0 => false,
        1 => true,
        _ => return Err(InstructionLayoutError::InvalidBool),
    };
    *offset += 1;
    Ok(Some(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_upsert_degen_config_anchor_bytes() {
        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("upsert_degen_config"));
        ix.extend_from_slice(&[9u8; 32]);
        ix.extend_from_slice(&300u32.to_le_bytes());

        let parsed = UpsertDegenConfigArgsCompat::parse(&ix).unwrap();
        assert_eq!(parsed.executor, [9u8; 32]);
        assert_eq!(parsed.fallback_timeout_sec, 300);
    }

    #[test]
    fn parses_update_config_anchor_bytes() {
        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("update_config"));
        ix.push(1);
        ix.extend_from_slice(&25u16.to_le_bytes());
        ix.push(1);
        ix.extend_from_slice(&10_000u64.to_le_bytes());
        ix.push(1);
        ix.extend_from_slice(&120u32.to_le_bytes());
        ix.push(1);
        ix.extend_from_slice(&2u16.to_le_bytes());
        ix.push(1);
        ix.extend_from_slice(&200u64.to_le_bytes());
        ix.push(1);
        ix.push(1);
        ix.push(1);
        ix.extend_from_slice(&1_000_000u64.to_le_bytes());

        let parsed = UpdateConfigArgsCompat::parse(&ix).unwrap();
        assert_eq!(parsed.fee_bps, Some(25));
        assert_eq!(parsed.ticket_unit, Some(10_000));
        assert_eq!(parsed.round_duration_sec, Some(120));
        assert_eq!(parsed.min_participants, Some(2));
        assert_eq!(parsed.min_total_tickets, Some(200));
        assert_eq!(parsed.paused, Some(true));
        assert_eq!(parsed.max_deposit_per_user, Some(1_000_000));
    }

    #[test]
    fn parses_transfer_admin_anchor_bytes() {
        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("transfer_admin"));
        ix.extend_from_slice(&[5u8; 32]);

        let parsed = TransferAdminArgsCompat::parse(&ix).unwrap();
        assert_eq!(parsed.new_admin, [5u8; 32]);
    }

    #[test]
    fn parses_no_arg_set_treasury_ix() {
        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("set_treasury_usdc_ata"));
        parse_no_arg_ix(&ix, "set_treasury_usdc_ata").unwrap();
    }

    #[test]
    fn parses_round_id_ix() {
        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("lock_round"));
        ix.extend_from_slice(&81u64.to_le_bytes());

        let parsed = parse_round_id_ix(&ix, "lock_round").unwrap();
        assert_eq!(parsed, 81);
    }

    #[test]
    fn parses_round_id_u8_ix() {
        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("claim_degen_fallback"));
        ix.extend_from_slice(&81u64.to_le_bytes());
        ix.push(7);

        let parsed = parse_round_id_u8_ix(&ix, "claim_degen_fallback").unwrap();
        assert_eq!(parsed, (81, 7));
    }

    #[test]
    fn parses_degen_vrf_callback_ix() {
        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("degen_vrf_callback"));
        ix.extend_from_slice(&[7u8; 32]);

        let parsed = parse_degen_vrf_callback_ix(&ix).unwrap();
        assert_eq!(parsed, [7u8; 32]);
    }
    #[test]
    fn parses_begin_degen_execution_ix() {
        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("begin_degen_execution"));
        ix.extend_from_slice(&81u64.to_le_bytes());
        ix.push(4);
        ix.extend_from_slice(&123u32.to_le_bytes());
        ix.extend_from_slice(&777u64.to_le_bytes());
        ix.extend_from_slice(&[9u8; 32]);

        let parsed = BeginDegenExecutionArgsCompat::parse(&ix).unwrap();
        assert_eq!(parsed.round_id, 81);
        assert_eq!(parsed.candidate_rank, 4);
        assert_eq!(parsed.token_index, 123);
        assert_eq!(parsed.min_out_raw, 777);
        assert_eq!(parsed.route_hash, [9u8; 32]);
    }

    #[test]
    fn parses_claim_degen_ix() {
        let mut ix = Vec::new();
        ix.extend_from_slice(&instruction_discriminator("claim_degen"));
        ix.extend_from_slice(&81u64.to_le_bytes());
        ix.push(3);
        ix.extend_from_slice(&456u32.to_le_bytes());

        let parsed = ClaimDegenArgsCompat::parse(&ix).unwrap();
        assert_eq!(parsed.round_id, 81);
        assert_eq!(parsed.candidate_rank, 3);
        assert_eq!(parsed.token_index, 456);
    }

}
