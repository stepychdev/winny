use pinocchio::error::ProgramError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum JackpotCompatError {
    Paused = 6000,
    InvalidFeeBps = 6001,
    InvalidTicketUnit = 6002,
    RoundNotOpen = 6003,
    RoundNotLocked = 6004,
    RoundNotVrfRequested = 6005,
    RoundNotSettled = 6006,
    RoundAlreadyClaimed = 6007,
    NoDepositsYet = 6008,
    NotEnoughParticipants = 6009,
    NotEnoughTickets = 6010,
    RoundNotEnded = 6011,
    InvalidVault = 6012,
    InvalidTreasury = 6013,
    InvalidUserUsdcAta = 6014,
    InvalidUsdcBalanceBefore = 6015,
    SlippageExceeded = 6016,
    DepositTooSmall = 6017,
    MaxParticipantsReached = 6018,
    OnlyWinnerCanClaim = 6019,
    MathOverflow = 6020,
    Unauthorized = 6021,
    RoundNotCancellable = 6022,
    NoDepositToRefund = 6023,
    AlreadyRefunded = 6024,
    RoundNotCloseable = 6025,
    VaultNotEmpty = 6026,
    InvalidRoundDuration = 6028,
    RoundExpired = 6027,
    ParticipantRoundMismatch = 6029,
    MaxDepositExceeded = 6030,
    InvalidAdmin = 6031,
    ParticipantNotEmpty = 6032,
    CancelNotAllowed = 6033,
    DegenClaimLocked = 6034,
    DegenVrfNotRequested = 6035,
    DegenVrfNotReady = 6036,
    DegenAlreadyRequested = 6037,
    DegenAlreadyClaimed = 6038,
    InvalidDegenClaim = 6039,
    InvalidDegenCandidate = 6040,
    UnauthorizedDegenExecutor = 6041,
    InvalidDegenExecutionState = 6042,
    InvalidDegenExecutorAta = 6043,
    InvalidDegenReceiverAta = 6044,
    InvalidVrfPayerAta = 6045,
    DegenOutputNotReceived = 6046,
    DegenFallbackTooEarly = 6047,
}

impl From<JackpotCompatError> for ProgramError {
    fn from(value: JackpotCompatError) -> Self {
        ProgramError::Custom(value as u32)
    }
}
