use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Protocol is paused")]
    Paused,
    #[msg("Invalid fee bps")]
    InvalidFeeBps,
    #[msg("Invalid ticket unit")]
    InvalidTicketUnit,
    #[msg("Round is not open")]
    RoundNotOpen,
    #[msg("Round is not locked")]
    RoundNotLocked,
    #[msg("Round is not in VRF requested state")]
    RoundNotVrfRequested,
    #[msg("Round is not settled")]
    RoundNotSettled,
    #[msg("Round already claimed")]
    RoundAlreadyClaimed,
    #[msg("Round has no deposits yet")]
    NoDepositsYet,
    #[msg("Not enough participants")]
    NotEnoughParticipants,
    #[msg("Not enough tickets")]
    NotEnoughTickets,
    #[msg("Round countdown has not ended")]
    RoundNotEnded,
    #[msg("Invalid vault account")]
    InvalidVault,
    #[msg("Invalid treasury account")]
    InvalidTreasury,
    #[msg("Invalid user USDC ATA")]
    InvalidUserUsdcAta,
    #[msg("USDC balance decreased unexpectedly before deposit")]
    InvalidUsdcBalanceBefore,
    #[msg("Received USDC is below min_out")]
    SlippageExceeded,
    #[msg("Deposit too small to mint at least one ticket")]
    DepositTooSmall,
    #[msg("Too many participants for MVP limit")]
    MaxParticipantsReached,
    #[msg("Only winner can claim")]
    OnlyWinnerCanClaim,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Round is not cancellable")]
    RoundNotCancellable,
    #[msg("No deposit to refund")]
    NoDepositToRefund,
    #[msg("Already refunded")]
    AlreadyRefunded,
    #[msg("Round is not in a closeable state (must be Claimed or Cancelled)")]
    RoundNotCloseable,
    #[msg("Vault still has tokens — cannot close")]
    VaultNotEmpty,
    #[msg("Round timer has expired — no more deposits accepted")]
    RoundExpired,
    #[msg("Invalid round duration (must be > 0)")]
    InvalidRoundDuration,
    #[msg("Participant does not belong to this round")]
    ParticipantRoundMismatch,
    #[msg("Deposit exceeds max per-user limit for this round")]
    MaxDepositExceeded,
    #[msg("Invalid admin address")]
    InvalidAdmin,
    #[msg("Participant still has refundable balance or tickets")]
    ParticipantNotEmpty,
    #[msg("Cannot cancel — other participants have deposits in this round")]
    CancelNotAllowed,
    #[msg("Classic claim is locked because degen mode was selected")]
    DegenClaimLocked,
    #[msg("Degen VRF has not been requested for this round")]
    DegenVrfNotRequested,
    #[msg("Degen VRF is not ready yet")]
    DegenVrfNotReady,
    #[msg("Degen VRF was already requested")]
    DegenAlreadyRequested,
    #[msg("Degen claim was already completed")]
    DegenAlreadyClaimed,
    #[msg("Invalid degen claim account")]
    InvalidDegenClaim,
    #[msg("Invalid degen candidate selection")]
    InvalidDegenCandidate,
    #[msg("Unauthorized degen executor")]
    UnauthorizedDegenExecutor,
    #[msg("Invalid degen execution state")]
    InvalidDegenExecutionState,
    #[msg("Invalid degen executor ATA")]
    InvalidDegenExecutorAta,
    #[msg("Invalid receiver token ATA")]
    InvalidDegenReceiverAta,
    #[msg("Invalid VRF payer USDC ATA")]
    InvalidVrfPayerAta,
    #[msg("Degen output was not received")]
    DegenOutputNotReceived,
    #[msg("Degen fallback is not yet available")]
    DegenFallbackTooEarly,
}
