use crate::anchor_compat::ANCHOR_DISCRIMINATOR_LEN;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LayoutError {
    SliceTooShort,
    InvalidBool,
    MathOverflow,
}

pub const PUBKEY_LEN: usize = 32;
pub const CONFIG_BODY_LEN: usize = 154;
pub const CONFIG_ACCOUNT_LEN: usize = ANCHOR_DISCRIMINATOR_LEN + CONFIG_BODY_LEN;
pub const DEGEN_CONFIG_BODY_LEN: usize = 64;
pub const DEGEN_CONFIG_ACCOUNT_LEN: usize = ANCHOR_DISCRIMINATOR_LEN + DEGEN_CONFIG_BODY_LEN;
pub const DEGEN_CLAIM_BODY_LEN: usize = 340;
pub const DEGEN_CLAIM_ACCOUNT_LEN: usize = ANCHOR_DISCRIMINATOR_LEN + DEGEN_CLAIM_BODY_LEN;
pub const PARTICIPANT_BODY_LEN: usize = 103;
pub const PARTICIPANT_ACCOUNT_LEN: usize = ANCHOR_DISCRIMINATOR_LEN + PARTICIPANT_BODY_LEN;
pub const TOKEN_ACCOUNT_CORE_LEN: usize = 64;
pub const TOKEN_ACCOUNT_WITH_AMOUNT_LEN: usize = 72;
pub const MAX_PARTICIPANTS: usize = 200;
pub const ROUND_PARTICIPANTS_BYTES_LEN: usize = PUBKEY_LEN * MAX_PARTICIPANTS;
pub const ROUND_FENWICK_NODE_COUNT: usize = MAX_PARTICIPANTS + 1;
pub const ROUND_FENWICK_BYTES_LEN: usize = 8 * ROUND_FENWICK_NODE_COUNT;
pub const ROUND_BODY_LEN: usize = 8240;
pub const ROUND_ACCOUNT_LEN: usize = ANCHOR_DISCRIMINATOR_LEN + ROUND_BODY_LEN;
pub const ROUND_STATUS_OPEN: u8 = 0;
pub const ROUND_STATUS_LOCKED: u8 = 1;
pub const ROUND_STATUS_VRF_REQUESTED: u8 = 2;
pub const ROUND_STATUS_SETTLED: u8 = 3;
pub const ROUND_STATUS_CLAIMED: u8 = 4;
pub const ROUND_STATUS_CANCELLED: u8 = 5;
pub const DEGEN_CLAIM_STATUS_VRF_REQUESTED: u8 = 1;
pub const DEGEN_CLAIM_STATUS_VRF_READY: u8 = 2;
pub const DEGEN_CLAIM_STATUS_EXECUTING: u8 = 3;
pub const DEGEN_CLAIM_STATUS_CLAIMED_SWAPPED: u8 = 4;
pub const DEGEN_CLAIM_STATUS_CLAIMED_FALLBACK: u8 = 5;
pub const DEGEN_MODE_NONE: u8 = 0;
pub const DEGEN_MODE_VRF_REQUESTED: u8 = 1;
pub const DEGEN_MODE_VRF_READY: u8 = 2;
pub const DEGEN_MODE_EXECUTING: u8 = 3;
pub const DEGEN_MODE_CLAIMED: u8 = 4;
pub const DEGEN_CANDIDATE_WINDOW: u8 = 10;
pub const DEGEN_FALLBACK_REASON_NONE: u8 = 0;
pub const DEFAULT_DEGEN_FALLBACK_TIMEOUT_SEC: u32 = 300;

const ROUND_ROUND_ID_OFFSET: usize = 0;
const ROUND_STATUS_OFFSET: usize = 8;
const ROUND_BUMP_OFFSET: usize = 9;
const ROUND_START_TS_OFFSET: usize = 16;
const ROUND_END_TS_OFFSET: usize = 24;
const ROUND_FIRST_DEPOSIT_TS_OFFSET: usize = 32;
const ROUND_VAULT_USDC_ATA_OFFSET: usize = 40;
const ROUND_TOTAL_USDC_OFFSET: usize = 72;
const ROUND_TOTAL_TICKETS_OFFSET: usize = 80;
const ROUND_PARTICIPANTS_COUNT_OFFSET: usize = 88;
const ROUND_RANDOMNESS_OFFSET: usize = 96;
const ROUND_WINNING_TICKET_OFFSET: usize = 128;
const ROUND_WINNER_OFFSET: usize = 136;
const ROUND_PARTICIPANTS_OFFSET: usize = 168;
const ROUND_BIT_OFFSET: usize = 168 + ROUND_PARTICIPANTS_BYTES_LEN;
const ROUND_VRF_PAYER_OFFSET: usize = ROUND_BIT_OFFSET + ROUND_FENWICK_BYTES_LEN;
const ROUND_VRF_REIMBURSED_OFFSET: usize = ROUND_VRF_PAYER_OFFSET + PUBKEY_LEN;
const ROUND_RESERVED_OFFSET: usize = ROUND_VRF_REIMBURSED_OFFSET + 1;

const DEGEN_CLAIM_ROUND_OFFSET: usize = 0;
const DEGEN_CLAIM_WINNER_OFFSET: usize = DEGEN_CLAIM_ROUND_OFFSET + PUBKEY_LEN;
const DEGEN_CLAIM_ROUND_ID_OFFSET: usize = DEGEN_CLAIM_WINNER_OFFSET + PUBKEY_LEN;
const DEGEN_CLAIM_STATUS_OFFSET: usize = DEGEN_CLAIM_ROUND_ID_OFFSET + 8;
const DEGEN_CLAIM_BUMP_OFFSET: usize = DEGEN_CLAIM_STATUS_OFFSET + 1;
const DEGEN_CLAIM_SELECTED_CANDIDATE_RANK_OFFSET: usize = DEGEN_CLAIM_BUMP_OFFSET + 1;
const DEGEN_CLAIM_FALLBACK_REASON_OFFSET: usize = DEGEN_CLAIM_SELECTED_CANDIDATE_RANK_OFFSET + 1;
const DEGEN_CLAIM_TOKEN_INDEX_OFFSET: usize = DEGEN_CLAIM_FALLBACK_REASON_OFFSET + 1;
const DEGEN_CLAIM_POOL_VERSION_OFFSET: usize = DEGEN_CLAIM_TOKEN_INDEX_OFFSET + 4;
const DEGEN_CLAIM_CANDIDATE_WINDOW_OFFSET: usize = DEGEN_CLAIM_POOL_VERSION_OFFSET + 4;
const DEGEN_CLAIM_PADDING0_OFFSET: usize = DEGEN_CLAIM_CANDIDATE_WINDOW_OFFSET + 1;
const DEGEN_CLAIM_REQUESTED_AT_OFFSET: usize = DEGEN_CLAIM_PADDING0_OFFSET + 7;
const DEGEN_CLAIM_FULFILLED_AT_OFFSET: usize = DEGEN_CLAIM_REQUESTED_AT_OFFSET + 8;
const DEGEN_CLAIM_CLAIMED_AT_OFFSET: usize = DEGEN_CLAIM_FULFILLED_AT_OFFSET + 8;
const DEGEN_CLAIM_FALLBACK_AFTER_TS_OFFSET: usize = DEGEN_CLAIM_CLAIMED_AT_OFFSET + 8;
const DEGEN_CLAIM_PAYOUT_RAW_OFFSET: usize = DEGEN_CLAIM_FALLBACK_AFTER_TS_OFFSET + 8;
const DEGEN_CLAIM_MIN_OUT_RAW_OFFSET: usize = DEGEN_CLAIM_PAYOUT_RAW_OFFSET + 8;
const DEGEN_CLAIM_RECEIVER_PRE_BALANCE_OFFSET: usize = DEGEN_CLAIM_MIN_OUT_RAW_OFFSET + 8;
const DEGEN_CLAIM_TOKEN_MINT_OFFSET: usize = DEGEN_CLAIM_RECEIVER_PRE_BALANCE_OFFSET + 8;
const DEGEN_CLAIM_EXECUTOR_OFFSET: usize = DEGEN_CLAIM_TOKEN_MINT_OFFSET + PUBKEY_LEN;
const DEGEN_CLAIM_RECEIVER_TOKEN_ATA_OFFSET: usize = DEGEN_CLAIM_EXECUTOR_OFFSET + PUBKEY_LEN;
const DEGEN_CLAIM_RANDOMNESS_OFFSET: usize = DEGEN_CLAIM_RECEIVER_TOKEN_ATA_OFFSET + PUBKEY_LEN;
const DEGEN_CLAIM_ROUTE_HASH_OFFSET: usize = DEGEN_CLAIM_RANDOMNESS_OFFSET + 32;
const DEGEN_CLAIM_RESERVED_OFFSET: usize = DEGEN_CLAIM_ROUTE_HASH_OFFSET + 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConfigView {
    pub admin: [u8; PUBKEY_LEN],
    pub usdc_mint: [u8; PUBKEY_LEN],
    pub treasury_usdc_ata: [u8; PUBKEY_LEN],
    pub fee_bps: u16,
    pub ticket_unit: u64,
    pub round_duration_sec: u32,
    pub min_participants: u16,
    pub min_total_tickets: u64,
    pub paused: bool,
    pub bump: u8,
    pub max_deposit_per_user: u64,
    pub reserved: [u8; 24],
}

impl ConfigView {
    pub fn read_from_account_data(data: &[u8]) -> Result<Self, LayoutError> {
        if data.len() < CONFIG_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        Self::read_body(&data[ANCHOR_DISCRIMINATOR_LEN..CONFIG_ACCOUNT_LEN])
    }

    pub fn write_to_account_data(&self, data: &mut [u8]) -> Result<(), LayoutError> {
        if data.len() < CONFIG_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        self.write_body(&mut data[ANCHOR_DISCRIMINATOR_LEN..CONFIG_ACCOUNT_LEN]);
        Ok(())
    }

    pub fn read_body(body: &[u8]) -> Result<Self, LayoutError> {
        if body.len() < CONFIG_BODY_LEN {
            return Err(LayoutError::SliceTooShort);
        }

        let mut offset = 0usize;
        let admin = read_pubkey(body, &mut offset)?;
        let usdc_mint = read_pubkey(body, &mut offset)?;
        let treasury_usdc_ata = read_pubkey(body, &mut offset)?;
        let fee_bps = read_u16(body, &mut offset)?;
        let ticket_unit = read_u64(body, &mut offset)?;
        let round_duration_sec = read_u32(body, &mut offset)?;
        let min_participants = read_u16(body, &mut offset)?;
        let min_total_tickets = read_u64(body, &mut offset)?;
        let paused = read_bool(body, &mut offset)?;
        let bump = read_u8(body, &mut offset)?;
        let max_deposit_per_user = read_u64(body, &mut offset)?;
        let reserved = read_fixed_24(body, &mut offset)?;

        Ok(Self {
            admin,
            usdc_mint,
            treasury_usdc_ata,
            fee_bps,
            ticket_unit,
            round_duration_sec,
            min_participants,
            min_total_tickets,
            paused,
            bump,
            max_deposit_per_user,
            reserved,
        })
    }

    pub fn write_body(&self, body: &mut [u8]) {
        let mut offset = 0usize;
        write_bytes(body, &mut offset, &self.admin);
        write_bytes(body, &mut offset, &self.usdc_mint);
        write_bytes(body, &mut offset, &self.treasury_usdc_ata);
        write_u16(body, &mut offset, self.fee_bps);
        write_u64(body, &mut offset, self.ticket_unit);
        write_u32(body, &mut offset, self.round_duration_sec);
        write_u16(body, &mut offset, self.min_participants);
        write_u64(body, &mut offset, self.min_total_tickets);
        write_u8(body, &mut offset, self.paused as u8);
        write_u8(body, &mut offset, self.bump);
        write_u64(body, &mut offset, self.max_deposit_per_user);
        write_bytes(body, &mut offset, &self.reserved);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DegenConfigView {
    pub executor: [u8; PUBKEY_LEN],
    pub fallback_timeout_sec: u32,
    pub bump: u8,
    pub reserved: [u8; 27],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DegenClaimView {
    pub round: [u8; PUBKEY_LEN],
    pub winner: [u8; PUBKEY_LEN],
    pub round_id: u64,
    pub status: u8,
    pub bump: u8,
    pub selected_candidate_rank: u8,
    pub fallback_reason: u8,
    pub token_index: u32,
    pub pool_version: u32,
    pub candidate_window: u8,
    pub padding0: [u8; 7],
    pub requested_at: i64,
    pub fulfilled_at: i64,
    pub claimed_at: i64,
    pub fallback_after_ts: i64,
    pub payout_raw: u64,
    pub min_out_raw: u64,
    pub receiver_pre_balance: u64,
    pub token_mint: [u8; PUBKEY_LEN],
    pub executor: [u8; PUBKEY_LEN],
    pub receiver_token_ata: [u8; PUBKEY_LEN],
    pub randomness: [u8; 32],
    pub route_hash: [u8; 32],
    pub reserved: [u8; 32],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ParticipantView {
    pub round: [u8; PUBKEY_LEN],
    pub user: [u8; PUBKEY_LEN],
    pub index: u16,
    pub bump: u8,
    pub tickets_total: u64,
    pub usdc_total: u64,
    pub deposits_count: u32,
    pub reserved: [u8; 16],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TokenAccountCoreView {
    pub mint: [u8; PUBKEY_LEN],
    pub owner: [u8; PUBKEY_LEN],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TokenAccountWithAmountView {
    pub mint: [u8; PUBKEY_LEN],
    pub owner: [u8; PUBKEY_LEN],
    pub amount: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RoundLifecycleView {
    pub round_id: u64,
    pub status: u8,
    pub bump: u8,
    pub start_ts: i64,
    pub end_ts: i64,
    pub first_deposit_ts: i64,
    pub total_usdc: u64,
    pub total_tickets: u64,
    pub participants_count: u16,
}

impl TokenAccountCoreView {
    pub fn read_from_account_data(data: &[u8]) -> Result<Self, LayoutError> {
        if data.len() < TOKEN_ACCOUNT_CORE_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        let mut offset = 0usize;
        let mint = read_pubkey(data, &mut offset)?;
        let owner = read_pubkey(data, &mut offset)?;
        Ok(Self { mint, owner })
    }
}

impl TokenAccountWithAmountView {
    pub fn read_from_account_data(data: &[u8]) -> Result<Self, LayoutError> {
        if data.len() < TOKEN_ACCOUNT_WITH_AMOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        let mut offset = 0usize;
        let mint = read_pubkey(data, &mut offset)?;
        let owner = read_pubkey(data, &mut offset)?;
        let amount = read_u64(data, &mut offset)?;
        Ok(Self {
            mint,
            owner,
            amount,
        })
    }

    pub fn write_amount_to_account_data(data: &mut [u8], amount: u64) -> Result<(), LayoutError> {
        if data.len() < TOKEN_ACCOUNT_WITH_AMOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        data[64..72].copy_from_slice(&amount.to_le_bytes());
        Ok(())
    }
}

impl RoundLifecycleView {
    pub fn read_from_account_data(data: &[u8]) -> Result<Self, LayoutError> {
        if data.len() < ROUND_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        Self::read_body(&data[ANCHOR_DISCRIMINATOR_LEN..ROUND_ACCOUNT_LEN])
    }

    pub fn write_to_account_data(&self, data: &mut [u8]) -> Result<(), LayoutError> {
        if data.len() < ROUND_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        self.write_body(&mut data[ANCHOR_DISCRIMINATOR_LEN..ROUND_ACCOUNT_LEN])?;
        Ok(())
    }

    pub fn write_status_to_account_data(data: &mut [u8], status: u8) -> Result<(), LayoutError> {
        if data.len() < ROUND_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        data[ANCHOR_DISCRIMINATOR_LEN + ROUND_STATUS_OFFSET] = status;
        Ok(())
    }

    pub fn read_vault_pubkey_from_account_data(
        data: &[u8],
    ) -> Result<[u8; PUBKEY_LEN], LayoutError> {
        if data.len() < ROUND_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        let body = &data[ANCHOR_DISCRIMINATOR_LEN..ROUND_ACCOUNT_LEN];
        read_pubkey_at(body, ROUND_VAULT_USDC_ATA_OFFSET)
    }

    pub fn write_vault_pubkey_to_account_data(
        data: &mut [u8],
        vault: &[u8; PUBKEY_LEN],
    ) -> Result<(), LayoutError> {
        if data.len() < ROUND_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        let body = &mut data[ANCHOR_DISCRIMINATOR_LEN..ROUND_ACCOUNT_LEN];
        write_bytes_at(body, ROUND_VAULT_USDC_ATA_OFFSET, vault)
    }

    pub fn read_randomness_from_account_data(data: &[u8]) -> Result<[u8; 32], LayoutError> {
        if data.len() < ROUND_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        let body = &data[ANCHOR_DISCRIMINATOR_LEN..ROUND_ACCOUNT_LEN];
        read_fixed_32_at(body, ROUND_RANDOMNESS_OFFSET)
    }

    pub fn write_randomness_to_account_data(
        data: &mut [u8],
        randomness: &[u8; 32],
    ) -> Result<(), LayoutError> {
        if data.len() < ROUND_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        let body = &mut data[ANCHOR_DISCRIMINATOR_LEN..ROUND_ACCOUNT_LEN];
        write_bytes_at(body, ROUND_RANDOMNESS_OFFSET, randomness)
    }

    pub fn read_winning_ticket_from_account_data(data: &[u8]) -> Result<u64, LayoutError> {
        if data.len() < ROUND_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        let body = &data[ANCHOR_DISCRIMINATOR_LEN..ROUND_ACCOUNT_LEN];
        read_u64_at(body, ROUND_WINNING_TICKET_OFFSET)
    }

    pub fn write_winning_ticket_to_account_data(
        data: &mut [u8],
        winning_ticket: u64,
    ) -> Result<(), LayoutError> {
        if data.len() < ROUND_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        let body = &mut data[ANCHOR_DISCRIMINATOR_LEN..ROUND_ACCOUNT_LEN];
        write_u64_at(body, ROUND_WINNING_TICKET_OFFSET, winning_ticket)
    }

    pub fn read_winner_from_account_data(data: &[u8]) -> Result<[u8; PUBKEY_LEN], LayoutError> {
        if data.len() < ROUND_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        let body = &data[ANCHOR_DISCRIMINATOR_LEN..ROUND_ACCOUNT_LEN];
        read_pubkey_at(body, ROUND_WINNER_OFFSET)
    }

    pub fn write_winner_to_account_data(
        data: &mut [u8],
        winner: &[u8; PUBKEY_LEN],
    ) -> Result<(), LayoutError> {
        if data.len() < ROUND_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        let body = &mut data[ANCHOR_DISCRIMINATOR_LEN..ROUND_ACCOUNT_LEN];
        write_bytes_at(body, ROUND_WINNER_OFFSET, winner)
    }

    pub fn read_participant_pubkey_from_account_data(
        data: &[u8],
        index_zero_based: usize,
    ) -> Result<[u8; PUBKEY_LEN], LayoutError> {
        if data.len() < ROUND_ACCOUNT_LEN || index_zero_based >= MAX_PARTICIPANTS {
            return Err(LayoutError::SliceTooShort);
        }
        let body = &data[ANCHOR_DISCRIMINATOR_LEN..ROUND_ACCOUNT_LEN];
        read_pubkey_at(body, ROUND_PARTICIPANTS_OFFSET + (index_zero_based * PUBKEY_LEN))
    }

    pub fn write_participant_pubkey_to_account_data(
        data: &mut [u8],
        index_zero_based: usize,
        participant: &[u8; PUBKEY_LEN],
    ) -> Result<(), LayoutError> {
        if data.len() < ROUND_ACCOUNT_LEN || index_zero_based >= MAX_PARTICIPANTS {
            return Err(LayoutError::SliceTooShort);
        }
        let body = &mut data[ANCHOR_DISCRIMINATOR_LEN..ROUND_ACCOUNT_LEN];
        write_bytes_at(
            body,
            ROUND_PARTICIPANTS_OFFSET + (index_zero_based * PUBKEY_LEN),
            participant,
        )
    }

    pub fn bit_find_prefix_in_account_data(data: &[u8], target: u64) -> Result<usize, LayoutError> {
        if data.len() < ROUND_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        let body = &data[ANCHOR_DISCRIMINATOR_LEN..ROUND_ACCOUNT_LEN];
        let n = ROUND_FENWICK_NODE_COUNT - 1;
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
                let node = read_u64_at(body, ROUND_BIT_OFFSET + (next * 8))?;
                let cand = cur.checked_add(node).ok_or(LayoutError::MathOverflow)?;
                if cand < target {
                    idx = next;
                    cur = cand;
                }
            }
            step >>= 1;
        }
        Ok(idx + 1)
    }

    pub fn read_vrf_payer_from_account_data(data: &[u8]) -> Result<[u8; PUBKEY_LEN], LayoutError> {
        if data.len() < ROUND_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        let body = &data[ANCHOR_DISCRIMINATOR_LEN..ROUND_ACCOUNT_LEN];
        read_pubkey_at(body, ROUND_VRF_PAYER_OFFSET)
    }

    pub fn write_vrf_payer_to_account_data(
        data: &mut [u8],
        vrf_payer: &[u8; PUBKEY_LEN],
    ) -> Result<(), LayoutError> {
        if data.len() < ROUND_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        let body = &mut data[ANCHOR_DISCRIMINATOR_LEN..ROUND_ACCOUNT_LEN];
        write_bytes_at(body, ROUND_VRF_PAYER_OFFSET, vrf_payer)
    }

    pub fn read_vrf_reimbursed_from_account_data(data: &[u8]) -> Result<u8, LayoutError> {
        if data.len() < ROUND_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        let body = &data[ANCHOR_DISCRIMINATOR_LEN..ROUND_ACCOUNT_LEN];
        read_u8_at(body, ROUND_VRF_REIMBURSED_OFFSET)
    }

    pub fn write_vrf_reimbursed_to_account_data(
        data: &mut [u8],
        reimbursed: u8,
    ) -> Result<(), LayoutError> {
        if data.len() < ROUND_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        let body = &mut data[ANCHOR_DISCRIMINATOR_LEN..ROUND_ACCOUNT_LEN];
        write_u8_at(body, ROUND_VRF_REIMBURSED_OFFSET, reimbursed)
    }

    pub fn read_degen_mode_status_from_account_data(data: &[u8]) -> Result<u8, LayoutError> {
        if data.len() < ROUND_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        let body = &data[ANCHOR_DISCRIMINATOR_LEN..ROUND_ACCOUNT_LEN];
        read_u8_at(body, ROUND_RESERVED_OFFSET)
    }

    pub fn write_degen_mode_status_to_account_data(
        data: &mut [u8],
        status: u8,
    ) -> Result<(), LayoutError> {
        if data.len() < ROUND_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        let body = &mut data[ANCHOR_DISCRIMINATOR_LEN..ROUND_ACCOUNT_LEN];
        write_u8_at(body, ROUND_RESERVED_OFFSET, status)
    }

    pub fn bit_sub_in_account_data(
        data: &mut [u8],
        mut index: usize,
        delta: u64,
    ) -> Result<(), LayoutError> {
        if data.len() < ROUND_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        if index == 0 || index > ROUND_FENWICK_NODE_COUNT - 1 {
            return Err(LayoutError::SliceTooShort);
        }

        let body = &mut data[ANCHOR_DISCRIMINATOR_LEN..ROUND_ACCOUNT_LEN];
        let n = ROUND_FENWICK_NODE_COUNT - 1;

        while index <= n {
            let node_offset = ROUND_BIT_OFFSET + (index * 8);
            let current = read_u64_at(body, node_offset)?;
            let next = current.checked_sub(delta).ok_or(LayoutError::MathOverflow)?;
            write_u64_at(body, node_offset, next)?;
            index += index & (!index + 1);
        }

        Ok(())
    }

    pub fn bit_add_in_account_data(
        data: &mut [u8],
        mut index: usize,
        delta: u64,
    ) -> Result<(), LayoutError> {
        if data.len() < ROUND_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        if index == 0 || index > ROUND_FENWICK_NODE_COUNT - 1 {
            return Err(LayoutError::SliceTooShort);
        }

        let body = &mut data[ANCHOR_DISCRIMINATOR_LEN..ROUND_ACCOUNT_LEN];
        let n = ROUND_FENWICK_NODE_COUNT - 1;

        while index <= n {
            let node_offset = ROUND_BIT_OFFSET + (index * 8);
            let current = read_u64_at(body, node_offset)?;
            let next = current.checked_add(delta).ok_or(LayoutError::MathOverflow)?;
            write_u64_at(body, node_offset, next)?;
            index += index & (!index + 1);
        }

        Ok(())
    }

    pub fn write_bit_node_to_account_data(
        data: &mut [u8],
        index: usize,
        value: u64,
    ) -> Result<(), LayoutError> {
        if data.len() < ROUND_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        if index == 0 || index > ROUND_FENWICK_NODE_COUNT - 1 {
            return Err(LayoutError::SliceTooShort);
        }

        let body = &mut data[ANCHOR_DISCRIMINATOR_LEN..ROUND_ACCOUNT_LEN];
        write_u64_at(body, ROUND_BIT_OFFSET + (index * 8), value)
    }

    pub fn read_body(body: &[u8]) -> Result<Self, LayoutError> {
        if body.len() < ROUND_BODY_LEN {
            return Err(LayoutError::SliceTooShort);
        }

        Ok(Self {
            round_id: read_u64_at(body, ROUND_ROUND_ID_OFFSET)?,
            status: read_u8_at(body, ROUND_STATUS_OFFSET)?,
            bump: read_u8_at(body, ROUND_BUMP_OFFSET)?,
            start_ts: read_i64_at(body, ROUND_START_TS_OFFSET)?,
            end_ts: read_i64_at(body, ROUND_END_TS_OFFSET)?,
            first_deposit_ts: read_i64_at(body, ROUND_FIRST_DEPOSIT_TS_OFFSET)?,
            total_usdc: read_u64_at(body, ROUND_TOTAL_USDC_OFFSET)?,
            total_tickets: read_u64_at(body, ROUND_TOTAL_TICKETS_OFFSET)?,
            participants_count: read_u16_at(body, ROUND_PARTICIPANTS_COUNT_OFFSET)?,
        })
    }

    pub fn write_body(&self, body: &mut [u8]) -> Result<(), LayoutError> {
        if body.len() < ROUND_BODY_LEN {
            return Err(LayoutError::SliceTooShort);
        }

        write_u64_at(body, ROUND_ROUND_ID_OFFSET, self.round_id)?;
        write_u8_at(body, ROUND_STATUS_OFFSET, self.status)?;
        write_u8_at(body, ROUND_BUMP_OFFSET, self.bump)?;
        write_i64_at(body, ROUND_START_TS_OFFSET, self.start_ts)?;
        write_i64_at(body, ROUND_END_TS_OFFSET, self.end_ts)?;
        write_i64_at(body, ROUND_FIRST_DEPOSIT_TS_OFFSET, self.first_deposit_ts)?;
        write_u64_at(body, ROUND_TOTAL_USDC_OFFSET, self.total_usdc)?;
        write_u64_at(body, ROUND_TOTAL_TICKETS_OFFSET, self.total_tickets)?;
        write_u16_at(body, ROUND_PARTICIPANTS_COUNT_OFFSET, self.participants_count)?;
        Ok(())
    }
}

impl DegenConfigView {
    pub fn read_from_account_data(data: &[u8]) -> Result<Self, LayoutError> {
        if data.len() < DEGEN_CONFIG_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        Self::read_body(&data[ANCHOR_DISCRIMINATOR_LEN..DEGEN_CONFIG_ACCOUNT_LEN])
    }

    pub fn write_to_account_data(&self, data: &mut [u8]) -> Result<(), LayoutError> {
        if data.len() < DEGEN_CONFIG_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        self.write_body(&mut data[ANCHOR_DISCRIMINATOR_LEN..DEGEN_CONFIG_ACCOUNT_LEN]);
        Ok(())
    }

    pub fn read_body(body: &[u8]) -> Result<Self, LayoutError> {
        if body.len() < DEGEN_CONFIG_BODY_LEN {
            return Err(LayoutError::SliceTooShort);
        }

        let mut offset = 0usize;
        let executor = read_pubkey(body, &mut offset)?;
        let fallback_timeout_sec = read_u32(body, &mut offset)?;
        let bump = read_u8(body, &mut offset)?;
        let reserved = read_fixed_27(body, &mut offset)?;

        Ok(Self {
            executor,
            fallback_timeout_sec,
            bump,
            reserved,
        })
    }

    pub fn write_body(&self, body: &mut [u8]) {
        let mut offset = 0usize;
        write_bytes(body, &mut offset, &self.executor);
        write_u32(body, &mut offset, self.fallback_timeout_sec);
        write_u8(body, &mut offset, self.bump);
        write_bytes(body, &mut offset, &self.reserved);
    }
}

impl DegenClaimView {
    pub fn read_from_account_data(data: &[u8]) -> Result<Self, LayoutError> {
        if data.len() < DEGEN_CLAIM_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        Self::read_body(&data[ANCHOR_DISCRIMINATOR_LEN..DEGEN_CLAIM_ACCOUNT_LEN])
    }

    pub fn write_to_account_data(&self, data: &mut [u8]) -> Result<(), LayoutError> {
        if data.len() < DEGEN_CLAIM_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        self.write_body(&mut data[ANCHOR_DISCRIMINATOR_LEN..DEGEN_CLAIM_ACCOUNT_LEN]);
        Ok(())
    }

    pub fn read_body(body: &[u8]) -> Result<Self, LayoutError> {
        if body.len() < DEGEN_CLAIM_BODY_LEN {
            return Err(LayoutError::SliceTooShort);
        }

        Ok(Self {
            round: read_pubkey_at(body, DEGEN_CLAIM_ROUND_OFFSET)?,
            winner: read_pubkey_at(body, DEGEN_CLAIM_WINNER_OFFSET)?,
            round_id: read_u64_at(body, DEGEN_CLAIM_ROUND_ID_OFFSET)?,
            status: read_u8_at(body, DEGEN_CLAIM_STATUS_OFFSET)?,
            bump: read_u8_at(body, DEGEN_CLAIM_BUMP_OFFSET)?,
            selected_candidate_rank: read_u8_at(body, DEGEN_CLAIM_SELECTED_CANDIDATE_RANK_OFFSET)?,
            fallback_reason: read_u8_at(body, DEGEN_CLAIM_FALLBACK_REASON_OFFSET)?,
            token_index: read_u32_at(body, DEGEN_CLAIM_TOKEN_INDEX_OFFSET)?,
            pool_version: read_u32_at(body, DEGEN_CLAIM_POOL_VERSION_OFFSET)?,
            candidate_window: read_u8_at(body, DEGEN_CLAIM_CANDIDATE_WINDOW_OFFSET)?,
            padding0: read_fixed_7_at(body, DEGEN_CLAIM_PADDING0_OFFSET)?,
            requested_at: read_i64_at(body, DEGEN_CLAIM_REQUESTED_AT_OFFSET)?,
            fulfilled_at: read_i64_at(body, DEGEN_CLAIM_FULFILLED_AT_OFFSET)?,
            claimed_at: read_i64_at(body, DEGEN_CLAIM_CLAIMED_AT_OFFSET)?,
            fallback_after_ts: read_i64_at(body, DEGEN_CLAIM_FALLBACK_AFTER_TS_OFFSET)?,
            payout_raw: read_u64_at(body, DEGEN_CLAIM_PAYOUT_RAW_OFFSET)?,
            min_out_raw: read_u64_at(body, DEGEN_CLAIM_MIN_OUT_RAW_OFFSET)?,
            receiver_pre_balance: read_u64_at(body, DEGEN_CLAIM_RECEIVER_PRE_BALANCE_OFFSET)?,
            token_mint: read_pubkey_at(body, DEGEN_CLAIM_TOKEN_MINT_OFFSET)?,
            executor: read_pubkey_at(body, DEGEN_CLAIM_EXECUTOR_OFFSET)?,
            receiver_token_ata: read_pubkey_at(body, DEGEN_CLAIM_RECEIVER_TOKEN_ATA_OFFSET)?,
            randomness: read_fixed_32_at(body, DEGEN_CLAIM_RANDOMNESS_OFFSET)?,
            route_hash: read_fixed_32_at(body, DEGEN_CLAIM_ROUTE_HASH_OFFSET)?,
            reserved: read_fixed_32_at(body, DEGEN_CLAIM_RESERVED_OFFSET)?,
        })
    }

    pub fn write_body(&self, body: &mut [u8]) {
        write_bytes_at(body, DEGEN_CLAIM_ROUND_OFFSET, &self.round).unwrap();
        write_bytes_at(body, DEGEN_CLAIM_WINNER_OFFSET, &self.winner).unwrap();
        write_u64_at(body, DEGEN_CLAIM_ROUND_ID_OFFSET, self.round_id).unwrap();
        write_u8_at(body, DEGEN_CLAIM_STATUS_OFFSET, self.status).unwrap();
        write_u8_at(body, DEGEN_CLAIM_BUMP_OFFSET, self.bump).unwrap();
        write_u8_at(body, DEGEN_CLAIM_SELECTED_CANDIDATE_RANK_OFFSET, self.selected_candidate_rank)
            .unwrap();
        write_u8_at(body, DEGEN_CLAIM_FALLBACK_REASON_OFFSET, self.fallback_reason).unwrap();
        write_u32_at(body, DEGEN_CLAIM_TOKEN_INDEX_OFFSET, self.token_index).unwrap();
        write_u32_at(body, DEGEN_CLAIM_POOL_VERSION_OFFSET, self.pool_version).unwrap();
        write_u8_at(body, DEGEN_CLAIM_CANDIDATE_WINDOW_OFFSET, self.candidate_window).unwrap();
        write_bytes_at(body, DEGEN_CLAIM_PADDING0_OFFSET, &self.padding0).unwrap();
        write_i64_at(body, DEGEN_CLAIM_REQUESTED_AT_OFFSET, self.requested_at).unwrap();
        write_i64_at(body, DEGEN_CLAIM_FULFILLED_AT_OFFSET, self.fulfilled_at).unwrap();
        write_i64_at(body, DEGEN_CLAIM_CLAIMED_AT_OFFSET, self.claimed_at).unwrap();
        write_i64_at(body, DEGEN_CLAIM_FALLBACK_AFTER_TS_OFFSET, self.fallback_after_ts).unwrap();
        write_u64_at(body, DEGEN_CLAIM_PAYOUT_RAW_OFFSET, self.payout_raw).unwrap();
        write_u64_at(body, DEGEN_CLAIM_MIN_OUT_RAW_OFFSET, self.min_out_raw).unwrap();
        write_u64_at(body, DEGEN_CLAIM_RECEIVER_PRE_BALANCE_OFFSET, self.receiver_pre_balance).unwrap();
        write_bytes_at(body, DEGEN_CLAIM_TOKEN_MINT_OFFSET, &self.token_mint).unwrap();
        write_bytes_at(body, DEGEN_CLAIM_EXECUTOR_OFFSET, &self.executor).unwrap();
        write_bytes_at(body, DEGEN_CLAIM_RECEIVER_TOKEN_ATA_OFFSET, &self.receiver_token_ata).unwrap();
        write_bytes_at(body, DEGEN_CLAIM_RANDOMNESS_OFFSET, &self.randomness).unwrap();
        write_bytes_at(body, DEGEN_CLAIM_ROUTE_HASH_OFFSET, &self.route_hash).unwrap();
        write_bytes_at(body, DEGEN_CLAIM_RESERVED_OFFSET, &self.reserved).unwrap();
    }
}

impl ParticipantView {
    pub fn read_from_account_data(data: &[u8]) -> Result<Self, LayoutError> {
        if data.len() < PARTICIPANT_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        Self::read_body(&data[ANCHOR_DISCRIMINATOR_LEN..PARTICIPANT_ACCOUNT_LEN])
    }

    pub fn write_to_account_data(&self, data: &mut [u8]) -> Result<(), LayoutError> {
        if data.len() < PARTICIPANT_ACCOUNT_LEN {
            return Err(LayoutError::SliceTooShort);
        }
        self.write_body(&mut data[ANCHOR_DISCRIMINATOR_LEN..PARTICIPANT_ACCOUNT_LEN]);
        Ok(())
    }

    pub fn read_body(body: &[u8]) -> Result<Self, LayoutError> {
        if body.len() < PARTICIPANT_BODY_LEN {
            return Err(LayoutError::SliceTooShort);
        }

        let mut offset = 0usize;
        let round = read_pubkey(body, &mut offset)?;
        let user = read_pubkey(body, &mut offset)?;
        let index = read_u16(body, &mut offset)?;
        let bump = read_u8(body, &mut offset)?;
        let tickets_total = read_u64(body, &mut offset)?;
        let usdc_total = read_u64(body, &mut offset)?;
        let deposits_count = read_u32(body, &mut offset)?;
        let reserved = read_fixed_16(body, &mut offset)?;

        Ok(Self {
            round,
            user,
            index,
            bump,
            tickets_total,
            usdc_total,
            deposits_count,
            reserved,
        })
    }

    pub fn write_body(&self, body: &mut [u8]) {
        let mut offset = 0usize;
        write_bytes(body, &mut offset, &self.round);
        write_bytes(body, &mut offset, &self.user);
        write_u16(body, &mut offset, self.index);
        write_u8(body, &mut offset, self.bump);
        write_u64(body, &mut offset, self.tickets_total);
        write_u64(body, &mut offset, self.usdc_total);
        write_u32(body, &mut offset, self.deposits_count);
        write_bytes(body, &mut offset, &self.reserved);
    }
}

fn read_pubkey(data: &[u8], offset: &mut usize) -> Result<[u8; PUBKEY_LEN], LayoutError> {
    if data.len() < *offset + PUBKEY_LEN {
        return Err(LayoutError::SliceTooShort);
    }
    let mut out = [0u8; PUBKEY_LEN];
    out.copy_from_slice(&data[*offset..*offset + PUBKEY_LEN]);
    *offset += PUBKEY_LEN;
    Ok(out)
}

fn read_pubkey_at(data: &[u8], offset: usize) -> Result<[u8; PUBKEY_LEN], LayoutError> {
    if data.len() < offset + PUBKEY_LEN {
        return Err(LayoutError::SliceTooShort);
    }
    let mut out = [0u8; PUBKEY_LEN];
    out.copy_from_slice(&data[offset..offset + PUBKEY_LEN]);
    Ok(out)
}

fn read_fixed_32_at(data: &[u8], offset: usize) -> Result<[u8; 32], LayoutError> {
    if data.len() < offset + 32 {
        return Err(LayoutError::SliceTooShort);
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&data[offset..offset + 32]);
    Ok(out)
}

fn read_fixed_24(data: &[u8], offset: &mut usize) -> Result<[u8; 24], LayoutError> {
    if data.len() < *offset + 24 {
        return Err(LayoutError::SliceTooShort);
    }
    let mut out = [0u8; 24];
    out.copy_from_slice(&data[*offset..*offset + 24]);
    *offset += 24;
    Ok(out)
}

fn read_fixed_7_at(data: &[u8], offset: usize) -> Result<[u8; 7], LayoutError> {
    if data.len() < offset + 7 {
        return Err(LayoutError::SliceTooShort);
    }
    let mut out = [0u8; 7];
    out.copy_from_slice(&data[offset..offset + 7]);
    Ok(out)
}

fn read_fixed_16(data: &[u8], offset: &mut usize) -> Result<[u8; 16], LayoutError> {
    if data.len() < *offset + 16 {
        return Err(LayoutError::SliceTooShort);
    }
    let mut out = [0u8; 16];
    out.copy_from_slice(&data[*offset..*offset + 16]);
    *offset += 16;
    Ok(out)
}

fn read_fixed_27(data: &[u8], offset: &mut usize) -> Result<[u8; 27], LayoutError> {
    if data.len() < *offset + 27 {
        return Err(LayoutError::SliceTooShort);
    }
    let mut out = [0u8; 27];
    out.copy_from_slice(&data[*offset..*offset + 27]);
    *offset += 27;
    Ok(out)
}

fn read_u8(data: &[u8], offset: &mut usize) -> Result<u8, LayoutError> {
    if data.len() < *offset + 1 {
        return Err(LayoutError::SliceTooShort);
    }
    let out = data[*offset];
    *offset += 1;
    Ok(out)
}

fn read_u8_at(data: &[u8], offset: usize) -> Result<u8, LayoutError> {
    data.get(offset).copied().ok_or(LayoutError::SliceTooShort)
}

fn read_bool(data: &[u8], offset: &mut usize) -> Result<bool, LayoutError> {
    match read_u8(data, offset)? {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(LayoutError::InvalidBool),
    }
}

fn read_u16(data: &[u8], offset: &mut usize) -> Result<u16, LayoutError> {
    if data.len() < *offset + 2 {
        return Err(LayoutError::SliceTooShort);
    }
    let out = u16::from_le_bytes([data[*offset], data[*offset + 1]]);
    *offset += 2;
    Ok(out)
}

fn read_u16_at(data: &[u8], offset: usize) -> Result<u16, LayoutError> {
    if data.len() < offset + 2 {
        return Err(LayoutError::SliceTooShort);
    }
    Ok(u16::from_le_bytes([data[offset], data[offset + 1]]))
}

fn read_u32(data: &[u8], offset: &mut usize) -> Result<u32, LayoutError> {
    if data.len() < *offset + 4 {
        return Err(LayoutError::SliceTooShort);
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

fn read_u64(data: &[u8], offset: &mut usize) -> Result<u64, LayoutError> {
    if data.len() < *offset + 8 {
        return Err(LayoutError::SliceTooShort);
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

fn read_u32_at(data: &[u8], offset: usize) -> Result<u32, LayoutError> {
    if data.len() < offset + 4 {
        return Err(LayoutError::SliceTooShort);
    }
    Ok(u32::from_le_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
    ]))
}

fn read_u64_at(data: &[u8], offset: usize) -> Result<u64, LayoutError> {
    if data.len() < offset + 8 {
        return Err(LayoutError::SliceTooShort);
    }
    Ok(u64::from_le_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
        data[offset + 4],
        data[offset + 5],
        data[offset + 6],
        data[offset + 7],
    ]))
}

fn read_i64_at(data: &[u8], offset: usize) -> Result<i64, LayoutError> {
    read_u64_at(data, offset).map(|value| value as i64)
}

fn write_bytes<const N: usize>(data: &mut [u8], offset: &mut usize, value: &[u8; N]) {
    data[*offset..*offset + N].copy_from_slice(value);
    *offset += N;
}

fn write_bytes_at(data: &mut [u8], offset: usize, value: &[u8]) -> Result<(), LayoutError> {
    let end = offset.checked_add(value.len()).ok_or(LayoutError::MathOverflow)?;
    if data.len() < end {
        return Err(LayoutError::SliceTooShort);
    }
    data[offset..end].copy_from_slice(value);
    Ok(())
}

fn write_u8(data: &mut [u8], offset: &mut usize, value: u8) {
    data[*offset] = value;
    *offset += 1;
}

fn write_u8_at(data: &mut [u8], offset: usize, value: u8) -> Result<(), LayoutError> {
    if data.len() < offset + 1 {
        return Err(LayoutError::SliceTooShort);
    }
    data[offset] = value;
    Ok(())
}

fn write_u16(data: &mut [u8], offset: &mut usize, value: u16) {
    let bytes = value.to_le_bytes();
    data[*offset..*offset + 2].copy_from_slice(&bytes);
    *offset += 2;
}

fn write_u16_at(data: &mut [u8], offset: usize, value: u16) -> Result<(), LayoutError> {
    if data.len() < offset + 2 {
        return Err(LayoutError::SliceTooShort);
    }
    data[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
    Ok(())
}

fn write_u32(data: &mut [u8], offset: &mut usize, value: u32) {
    let bytes = value.to_le_bytes();
    data[*offset..*offset + 4].copy_from_slice(&bytes);
    *offset += 4;
}

fn write_u64(data: &mut [u8], offset: &mut usize, value: u64) {
    let bytes = value.to_le_bytes();
    data[*offset..*offset + 8].copy_from_slice(&bytes);
    *offset += 8;
}

fn write_u32_at(data: &mut [u8], offset: usize, value: u32) -> Result<(), LayoutError> {
    if data.len() < offset + 4 {
        return Err(LayoutError::SliceTooShort);
    }
    data[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    Ok(())
}

fn write_u64_at(data: &mut [u8], offset: usize, value: u64) -> Result<(), LayoutError> {
    if data.len() < offset + 8 {
        return Err(LayoutError::SliceTooShort);
    }
    data[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
    Ok(())
}

fn write_i64_at(data: &mut [u8], offset: usize, value: i64) -> Result<(), LayoutError> {
    write_u64_at(data, offset, value as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::anchor_compat::account_discriminator;

    #[test]
    fn config_lengths_match_live_program() {
        assert_eq!(CONFIG_BODY_LEN, 154);
        assert_eq!(CONFIG_ACCOUNT_LEN, 162);
    }

    #[test]
    fn degen_config_lengths_match_live_program() {
        assert_eq!(DEGEN_CONFIG_BODY_LEN, 64);
        assert_eq!(DEGEN_CONFIG_ACCOUNT_LEN, 72);
    }

    #[test]
    fn degen_claim_lengths_match_live_program() {
        assert_eq!(DEGEN_CLAIM_BODY_LEN, 340);
        assert_eq!(DEGEN_CLAIM_ACCOUNT_LEN, 348);
    }

    #[test]
    fn config_round_trip_preserves_anchor_layout() {
        let view = ConfigView {
            admin: [1u8; 32],
            usdc_mint: [2u8; 32],
            treasury_usdc_ata: [3u8; 32],
            fee_bps: 25,
            ticket_unit: 10_000,
            round_duration_sec: 120,
            min_participants: 2,
            min_total_tickets: 200,
            paused: true,
            bump: 254,
            max_deposit_per_user: 1_000_000,
            reserved: [9u8; 24],
        };

        let mut data = [0u8; CONFIG_ACCOUNT_LEN];
        data[..ANCHOR_DISCRIMINATOR_LEN].copy_from_slice(&[7u8; ANCHOR_DISCRIMINATOR_LEN]);
        view.write_to_account_data(&mut data).unwrap();
        let parsed = ConfigView::read_from_account_data(&data).unwrap();

        assert_eq!(parsed, view);
        assert_eq!(&data[..ANCHOR_DISCRIMINATOR_LEN], &[7u8; ANCHOR_DISCRIMINATOR_LEN]);
    }

    #[test]
    fn degen_config_round_trip_preserves_anchor_layout() {
        let view = DegenConfigView {
            executor: [4u8; 32],
            fallback_timeout_sec: 300,
            bump: 201,
            reserved: [8u8; 27],
        };

        let mut data = [0u8; DEGEN_CONFIG_ACCOUNT_LEN];
        data[..ANCHOR_DISCRIMINATOR_LEN].copy_from_slice(&[5u8; ANCHOR_DISCRIMINATOR_LEN]);
        view.write_to_account_data(&mut data).unwrap();
        let parsed = DegenConfigView::read_from_account_data(&data).unwrap();

        assert_eq!(parsed, view);
        assert_eq!(&data[..ANCHOR_DISCRIMINATOR_LEN], &[5u8; ANCHOR_DISCRIMINATOR_LEN]);
    }

    #[test]
    fn token_account_core_reads_mint_and_owner() {
        let mut data = [0u8; TOKEN_ACCOUNT_CORE_LEN];
        data[..32].copy_from_slice(&[2u8; 32]);
        data[32..64].copy_from_slice(&[3u8; 32]);

        let parsed = TokenAccountCoreView::read_from_account_data(&data).unwrap();
        assert_eq!(parsed.mint, [2u8; 32]);
        assert_eq!(parsed.owner, [3u8; 32]);
    }

    #[test]
    fn token_account_with_amount_reads_amount() {
        let mut data = [0u8; TOKEN_ACCOUNT_WITH_AMOUNT_LEN];
        data[..32].copy_from_slice(&[2u8; 32]);
        data[32..64].copy_from_slice(&[3u8; 32]);
        data[64..72].copy_from_slice(&123_456u64.to_le_bytes());

        let parsed = TokenAccountWithAmountView::read_from_account_data(&data).unwrap();
        assert_eq!(parsed.mint, [2u8; 32]);
        assert_eq!(parsed.owner, [3u8; 32]);
        assert_eq!(parsed.amount, 123_456);
    }

    #[test]
    fn round_lengths_match_live_program() {
        assert_eq!(ROUND_PARTICIPANTS_BYTES_LEN, 6_400);
        assert_eq!(ROUND_FENWICK_BYTES_LEN, 1_608);
        assert_eq!(ROUND_BODY_LEN, 8_240);
        assert_eq!(ROUND_ACCOUNT_LEN, 8_248);
    }

    #[test]
    fn round_lifecycle_round_trip_preserves_live_offsets() {
        let view = RoundLifecycleView {
            round_id: 81,
            status: ROUND_STATUS_OPEN,
            bump: 201,
            start_ts: 10,
            end_ts: 130,
            first_deposit_ts: 25,
            total_usdc: 1_250_000,
            total_tickets: 125,
            participants_count: 2,
        };

        let mut data = [0u8; ROUND_ACCOUNT_LEN];
        data[..ANCHOR_DISCRIMINATOR_LEN].copy_from_slice(&account_discriminator("Round"));
        view.write_to_account_data(&mut data).unwrap();

        let parsed = RoundLifecycleView::read_from_account_data(&data).unwrap();
        assert_eq!(parsed, view);
    }

    #[test]
    fn degen_claim_round_trip_preserves_anchor_layout() {
        let view = DegenClaimView {
            round: [1u8; 32],
            winner: [2u8; 32],
            round_id: 81,
            status: DEGEN_CLAIM_STATUS_VRF_READY,
            bump: 201,
            selected_candidate_rank: u8::MAX,
            fallback_reason: DEGEN_FALLBACK_REASON_NONE,
            token_index: 17,
            pool_version: 9,
            candidate_window: DEGEN_CANDIDATE_WINDOW,
            padding0: [0u8; 7],
            requested_at: 100,
            fulfilled_at: 120,
            claimed_at: 0,
            fallback_after_ts: 420,
            payout_raw: 975_000,
            min_out_raw: 0,
            receiver_pre_balance: 0,
            token_mint: [3u8; 32],
            executor: [4u8; 32],
            receiver_token_ata: [5u8; 32],
            randomness: [6u8; 32],
            route_hash: [7u8; 32],
            reserved: [8u8; 32],
        };

        let mut data = [0u8; DEGEN_CLAIM_ACCOUNT_LEN];
        data[..ANCHOR_DISCRIMINATOR_LEN].copy_from_slice(&[7u8; ANCHOR_DISCRIMINATOR_LEN]);
        view.write_to_account_data(&mut data).unwrap();
        let parsed = DegenClaimView::read_from_account_data(&data).unwrap();

        assert_eq!(parsed, view);
        assert_eq!(&data[..ANCHOR_DISCRIMINATOR_LEN], &[7u8; ANCHOR_DISCRIMINATOR_LEN]);
    }

    #[test]
    fn round_status_write_only_mutates_status_byte() {
        let view = RoundLifecycleView {
            round_id: 7,
            status: ROUND_STATUS_OPEN,
            bump: 8,
            start_ts: 11,
            end_ts: 22,
            first_deposit_ts: 33,
            total_usdc: 44,
            total_tickets: 55,
            participants_count: 2,
        };

        let mut data = [0u8; ROUND_ACCOUNT_LEN];
        data[..ANCHOR_DISCRIMINATOR_LEN].copy_from_slice(&account_discriminator("Round"));
        view.write_to_account_data(&mut data).unwrap();

        RoundLifecycleView::write_status_to_account_data(&mut data, ROUND_STATUS_CANCELLED).unwrap();

        let parsed = RoundLifecycleView::read_from_account_data(&data).unwrap();
        assert_eq!(parsed.round_id, 7);
        assert_eq!(parsed.status, ROUND_STATUS_CANCELLED);
        assert_eq!(parsed.total_usdc, 44);
        assert_eq!(parsed.total_tickets, 55);
    }

    #[test]
    fn round_vault_accessor_reads_live_offset() {
        let mut data = [0u8; ROUND_ACCOUNT_LEN];
        data[..ANCHOR_DISCRIMINATOR_LEN].copy_from_slice(&account_discriminator("Round"));
        let view = RoundLifecycleView {
            round_id: 9,
            status: ROUND_STATUS_OPEN,
            bump: 17,
            start_ts: 10,
            end_ts: 20,
            first_deposit_ts: 11,
            total_usdc: 500,
            total_tickets: 50,
            participants_count: 1,
        };
        view.write_to_account_data(&mut data).unwrap();
        data[ANCHOR_DISCRIMINATOR_LEN + ROUND_VAULT_USDC_ATA_OFFSET
            ..ANCHOR_DISCRIMINATOR_LEN + ROUND_VAULT_USDC_ATA_OFFSET + 32]
            .copy_from_slice(&[6u8; 32]);

        let parsed = RoundLifecycleView::read_vault_pubkey_from_account_data(&data).unwrap();
        assert_eq!(parsed, [6u8; 32]);
    }

    #[test]
    fn round_bit_sub_mutates_fenwick_nodes() {
        let mut data = [0u8; ROUND_ACCOUNT_LEN];
        data[..ANCHOR_DISCRIMINATOR_LEN].copy_from_slice(&account_discriminator("Round"));
        let view = RoundLifecycleView {
            round_id: 81,
            status: ROUND_STATUS_OPEN,
            bump: 201,
            start_ts: 10,
            end_ts: 130,
            first_deposit_ts: 25,
            total_usdc: 1_250_000,
            total_tickets: 125,
            participants_count: 2,
        };
        view.write_to_account_data(&mut data).unwrap();

        {
            let mut idx = 1usize;
            while idx < ROUND_FENWICK_NODE_COUNT {
                RoundLifecycleView::write_bit_node_to_account_data(&mut data, idx, 125).unwrap();
                idx += idx & (!idx + 1);
                if idx == 0 {
                    break;
                }
            }
        }

        RoundLifecycleView::bit_sub_in_account_data(&mut data, 1, 25).unwrap();

        let body = &data[ANCHOR_DISCRIMINATOR_LEN..ROUND_ACCOUNT_LEN];
        assert_eq!(read_u64_at(body, ROUND_BIT_OFFSET + 8).unwrap(), 100);
        assert_eq!(read_u64_at(body, ROUND_BIT_OFFSET + 16).unwrap(), 100);
        assert_eq!(read_u64_at(body, ROUND_BIT_OFFSET + 32).unwrap(), 100);
    }

    #[test]
    fn participant_lengths_match_live_program() {
        assert_eq!(PARTICIPANT_BODY_LEN, 103);
        assert_eq!(PARTICIPANT_ACCOUNT_LEN, 111);
    }

    #[test]
    fn participant_round_trip_preserves_anchor_layout() {
        let view = ParticipantView {
            round: [1u8; 32],
            user: [2u8; 32],
            index: 7,
            bump: 201,
            tickets_total: 123,
            usdc_total: 456,
            deposits_count: 3,
            reserved: [9u8; 16],
        };

        let mut data = [0u8; PARTICIPANT_ACCOUNT_LEN];
        data[..ANCHOR_DISCRIMINATOR_LEN].copy_from_slice(&account_discriminator("Participant"));
        view.write_to_account_data(&mut data).unwrap();

        let parsed = ParticipantView::read_from_account_data(&data).unwrap();
        assert_eq!(parsed, view);
    }
}
