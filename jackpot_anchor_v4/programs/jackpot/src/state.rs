use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};
use crate::constants::MAX_PARTICIPANTS;

/// Wrapper for participants array — bytemuck doesn't impl Pod for arbitrary array sizes.
#[derive(Copy, Clone)]
#[repr(C)]
pub struct ParticipantsArray {
    pub data: [[u8; 32]; MAX_PARTICIPANTS],
}

unsafe impl Pod for ParticipantsArray {}
unsafe impl Zeroable for ParticipantsArray {}

/// Wrapper for Fenwick tree array — bytemuck doesn't impl Pod for arbitrary array sizes.
#[derive(Copy, Clone)]
#[repr(C)]
pub struct FenwickTree {
    pub data: [u64; MAX_PARTICIPANTS + 1],
}

unsafe impl Pod for FenwickTree {}
unsafe impl Zeroable for FenwickTree {}

#[cfg(feature = "idl-build")]
impl anchor_lang::IdlBuild for ParticipantsArray {
    fn create_type() -> Option<anchor_lang::idl::types::IdlTypeDef> {
        use anchor_lang::idl::types::*;
        Some(IdlTypeDef {
            name: "ParticipantsArray".to_string(),
            docs: vec![],
            serialization: IdlSerialization::Bytemuck,
            repr: Some(IdlRepr::C(IdlReprModifier { packed: false, align: None })),
            generics: vec![],
            ty: IdlTypeDefTy::Struct {
                fields: Some(IdlDefinedFields::Named(vec![IdlField {
                    name: "data".to_string(),
                    docs: vec![],
                    ty: IdlType::Array(
                        Box::new(IdlType::Array(Box::new(IdlType::U8), IdlArrayLen::Value(32))),
                        IdlArrayLen::Value(MAX_PARTICIPANTS),
                    ),
                }])),
            },
        })
    }
    fn insert_types(types: &mut std::collections::BTreeMap<String, anchor_lang::idl::types::IdlTypeDef>) {
        if let Some(ty) = Self::create_type() {
            types.insert("ParticipantsArray".to_string(), ty);
        }
    }
    fn get_full_path() -> String {
        "ParticipantsArray".to_string()
    }
}

#[cfg(feature = "idl-build")]
impl anchor_lang::IdlBuild for FenwickTree {
    fn create_type() -> Option<anchor_lang::idl::types::IdlTypeDef> {
        use anchor_lang::idl::types::*;
        Some(IdlTypeDef {
            name: "FenwickTree".to_string(),
            docs: vec![],
            serialization: IdlSerialization::Bytemuck,
            repr: Some(IdlRepr::C(IdlReprModifier { packed: false, align: None })),
            generics: vec![],
            ty: IdlTypeDefTy::Struct {
                fields: Some(IdlDefinedFields::Named(vec![IdlField {
                    name: "data".to_string(),
                    docs: vec![],
                    ty: IdlType::Array(
                        Box::new(IdlType::U64),
                        IdlArrayLen::Value(MAX_PARTICIPANTS + 1),
                    ),
                }])),
            },
        })
    }
    fn insert_types(types: &mut std::collections::BTreeMap<String, anchor_lang::idl::types::IdlTypeDef>) {
        if let Some(ty) = Self::create_type() {
            types.insert("FenwickTree".to_string(), ty);
        }
    }
    fn get_full_path() -> String {
        "FenwickTree".to_string()
    }
}

#[repr(u8)]
pub enum RoundStatus {
    Open = 0,
    Locked = 1,
    VrfRequested = 2,
    Settled = 3,
    Claimed = 4,
    Cancelled = 5,
}

#[account]
pub struct Config {
    pub admin: Pubkey,
    pub usdc_mint: Pubkey,
    pub treasury_usdc_ata: Pubkey,
    pub fee_bps: u16,
    pub ticket_unit: u64,
    pub round_duration_sec: u32,
    pub min_participants: u16,
    pub min_total_tickets: u64,
    pub paused: bool,
    pub bump: u8,
    /// Max USDC (raw, 6 decimals) a single participant can deposit per round. 0 = unlimited.
    pub max_deposit_per_user: u64,
    pub reserved: [u8; 24],
}

impl Config {
    pub const SPACE: usize = 8
        + 32 + 32 + 32
        + 2
        + 8
        + 4
        + 2
        + 8
        + 1
        + 1
        + 8
        + 24;
}

/// Round account — zero-copy to avoid stack overflow (~21KB).
/// All instructions must use `AccountLoader<'info, Round>` and call `.load()` / `.load_mut()`.
#[account(zero_copy)]
#[repr(C)]
pub struct Round {
    pub round_id: u64,
    pub status: u8,
    pub bump: u8,
    pub _padding: [u8; 6],

    pub start_ts: i64,
    pub end_ts: i64,
    pub first_deposit_ts: i64,

    pub vault_usdc_ata: [u8; 32],

    pub total_usdc: u64,
    pub total_tickets: u64,
    pub participants_count: u16,
    pub _padding2: [u8; 6],

    pub randomness: [u8; 32],
    pub winning_ticket: u64,
    pub winner: [u8; 32],

    pub participants: ParticipantsArray,
    pub bit: FenwickTree,

    pub vrf_payer: [u8; 32],
    pub vrf_reimbursed: u8,
    pub reserved: [u8; 31],
}

impl Round {
    pub const SPACE: usize = 8 + core::mem::size_of::<Round>();

    pub fn vault_pubkey(&self) -> Pubkey {
        Pubkey::new_from_array(self.vault_usdc_ata)
    }

    pub fn winner_pubkey(&self) -> Pubkey {
        Pubkey::new_from_array(self.winner)
    }

    pub fn participant_pubkey(&self, index: usize) -> Pubkey {
        Pubkey::new_from_array(self.participants.data[index])
    }

    pub fn degen_mode_status(&self) -> u8 {
        self.reserved[0]
    }

    pub fn set_degen_mode_status(&mut self, status: u8) {
        self.reserved[0] = status;
    }
}

#[account]
#[derive(Default)]
pub struct Participant {
    pub round: Pubkey,
    pub user: Pubkey,
    pub index: u16,
    pub bump: u8,
    pub tickets_total: u64,
    pub usdc_total: u64,
    pub deposits_count: u32,
    pub reserved: [u8; 16],
}

impl Participant {
    pub const SPACE: usize = 8
        + 32 + 32
        + 2 + 1
        + 8 + 8
        + 4
        + 16;
}

#[repr(u8)]
pub enum DegenClaimStatus {
    VrfRequested = 1,
    VrfReady = 2,
    Executing = 3,
    ClaimedSwapped = 4,
    ClaimedFallback = 5,
}

#[account]
#[derive(Default)]
pub struct DegenConfig {
    pub executor: Pubkey,
    pub fallback_timeout_sec: u32,
    pub bump: u8,
    pub reserved: [u8; 27],
}

impl DegenConfig {
    pub const SPACE: usize = 8
        + 32
        + 4
        + 1
        + 27;
}

#[account]
#[derive(Default)]
pub struct DegenClaim {
    pub round: Pubkey,
    pub winner: Pubkey,
    pub round_id: u64,
    pub status: u8,
    pub bump: u8,
    pub selected_candidate_rank: u8,
    pub fallback_reason: u8,
    pub token_index: u32,
    pub pool_version: u32,
    pub candidate_window: u8,
    pub _padding0: [u8; 7],
    pub requested_at: i64,
    pub fulfilled_at: i64,
    pub claimed_at: i64,
    pub fallback_after_ts: i64,
    pub payout_raw: u64,
    pub min_out_raw: u64,
    pub receiver_pre_balance: u64,
    pub token_mint: Pubkey,
    pub executor: Pubkey,
    pub receiver_token_ata: Pubkey,
    pub randomness: [u8; 32],
    pub route_hash: [u8; 32],
    pub reserved: [u8; 32],
}

impl DegenClaim {
    pub const SPACE: usize = 8
        + 32
        + 32
        + 8
        + 1
        + 1
        + 1
        + 1
        + 4
        + 4
        + 1
        + 7
        + 8
        + 8
        + 8
        + 8
        + 8
        + 8
        + 8
        + 32
        + 32
        + 32
        + 32
        + 32
        + 32;
}
