use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod state;
pub mod utils;
pub mod instructions;

use instructions::*;

#[cfg(feature = "devnet")]
declare_id!("4PhNzNQ7XZAPrFmwcBFMe2ZY8ZaQWos8nJjcsjv1CHyh");

#[cfg(not(feature = "devnet"))]
declare_id!("3wi11KBqF3Qa7JPP6CH4AFrcXbvaYEXMsEr9cmWQy8Zj");

#[program]
pub mod jackpot {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>, args: InitConfigArgs) -> Result<()> {
        init_config::handler(ctx, args)
    }

    pub fn update_config(ctx: Context<UpdateConfig>, args: UpdateConfigArgs) -> Result<()> {
        update_config::handler(ctx, args)
    }

    pub fn transfer_admin(ctx: Context<TransferAdmin>, new_admin: Pubkey) -> Result<()> {
        transfer_admin::handler(ctx, new_admin)
    }

    pub fn set_treasury_usdc_ata(ctx: Context<SetTreasuryUsdcAta>) -> Result<()> {
        set_treasury_usdc_ata::handler(ctx)
    }

    pub fn start_round(ctx: Context<StartRound>, round_id: u64) -> Result<()> {
        start_round::handler(ctx, round_id)
    }

    pub fn deposit_any(ctx: Context<DepositAny>, round_id: u64, usdc_balance_before: u64, min_out: u64) -> Result<()> {
        deposit_any::handler(ctx, round_id, usdc_balance_before, min_out)
    }

    pub fn lock_round(ctx: Context<LockRound>, round_id: u64) -> Result<()> {
        lock_round::handler(ctx, round_id)
    }

    pub fn request_vrf(ctx: Context<RequestVrf>, round_id: u64) -> Result<()> {
        request_vrf::handler(ctx, round_id)
    }

    pub fn vrf_callback(ctx: Context<VrfCallback>, randomness: [u8; 32]) -> Result<()> {
        vrf_callback::handler(ctx, randomness)
    }

    pub fn request_degen_vrf(ctx: Context<RequestDegenVrf>, round_id: u64) -> Result<()> {
        request_degen_vrf::handler(ctx, round_id)
    }

    pub fn degen_vrf_callback(ctx: Context<DegenVrfCallback>, randomness: [u8; 32]) -> Result<()> {
        degen_vrf_callback::handler(ctx, randomness)
    }

    pub fn upsert_degen_config(
        ctx: Context<UpsertDegenConfig>,
        args: UpsertDegenConfigArgs,
    ) -> Result<()> {
        upsert_degen_config::handler(ctx, args)
    }

    pub fn begin_degen_execution(
        ctx: Context<BeginDegenExecution>,
        round_id: u64,
        candidate_rank: u8,
        token_index: u32,
        min_out_raw: u64,
        route_hash: [u8; 32],
    ) -> Result<()> {
        begin_degen_execution::handler(
            ctx,
            round_id,
            candidate_rank,
            token_index,
            min_out_raw,
            route_hash,
        )
    }

    pub fn finalize_degen_success(
        ctx: Context<FinalizeDegenSuccess>,
        round_id: u64,
    ) -> Result<()> {
        finalize_degen_success::handler(ctx, round_id)
    }

    pub fn claim(ctx: Context<Claim>, round_id: u64) -> Result<()> {
        claim::handler(ctx, round_id)
    }

    pub fn claim_degen_fallback(
        ctx: Context<ClaimDegenFallback>,
        round_id: u64,
        fallback_reason: u8,
    ) -> Result<()> {
        claim_degen_fallback::handler(ctx, round_id, fallback_reason)
    }

    /// Admin-only test settlement (bypasses VRF oracle). Only available with `devnet` feature.
    #[cfg(feature = "devnet")]
    pub fn mock_settle(ctx: Context<MockSettle>, round_id: u64, randomness: [u8; 32]) -> Result<()> {
        mock_settle::handler(ctx, round_id, randomness)
    }

    /// Admin-only test helper to mutate VRF reimbursement metadata. Only with `devnet` feature.
    #[cfg(feature = "devnet")]
    pub fn mock_set_vrf_meta(
        ctx: Context<MockSetVrfMeta>,
        round_id: u64,
        vrf_payer: Pubkey,
        vrf_reimbursed: bool,
    ) -> Result<()> {
        mock_set_vrf_meta::handler(ctx, round_id, vrf_payer, vrf_reimbursed)
    }

    /// Admin-only test helper to emulate degen VRF callback. Only with `devnet` feature.
    #[cfg(feature = "devnet")]
    pub fn mock_set_degen_vrf(
        ctx: Context<MockSetDegenVrf>,
        round_id: u64,
        randomness: [u8; 32],
    ) -> Result<()> {
        mock_set_degen_vrf::handler(ctx, round_id, randomness)
    }

    /// Cancel participation — refund USDC from vault while round is still Open.
    pub fn cancel_round(ctx: Context<CancelRound>, round_id: u64) -> Result<()> {
        cancel_round::handler(ctx, round_id)
    }

    /// Close round account + vault ATA after Claimed/Cancelled. Returns rent to recipient.
    pub fn close_round(ctx: Context<CloseRound>, round_id: u64) -> Result<()> {
        close_round::handler(ctx, round_id)
    }

    /// Admin force-cancel: mark round as Cancelled (vault funds stay in escrow for refunds).
    pub fn admin_force_cancel(ctx: Context<AdminForceCancel>, round_id: u64) -> Result<()> {
        admin_force_cancel::handler(ctx, round_id)
    }

    /// Anyone can trigger claim — funds go to the on-chain winner.
    pub fn auto_claim(ctx: Context<AutoClaim>, round_id: u64) -> Result<()> {
        auto_claim::handler(ctx, round_id)
    }

    /// Close a participant PDA after round is Claimed/Cancelled. Returns rent to participant.
    pub fn close_participant(ctx: Context<CloseParticipant>, round_id: u64) -> Result<()> {
        close_participant::handler(ctx, round_id)
    }

    /// [H-2 fix] Participant self-refund from a force-cancelled round (escrow pattern).
    pub fn claim_refund(ctx: Context<ClaimRefund>, round_id: u64) -> Result<()> {
        claim_refund::handler(ctx, round_id)
    }
}
