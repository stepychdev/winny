/// Anchor-compatible discriminators backed by build-time precomputed constants.
///
/// In production (BPF) builds, `instruction_discriminator()` and
/// `account_discriminator()` resolve to a simple `match` against
/// compile-time constants – **zero SHA-256 at runtime**.
///
/// In `#[cfg(test)]` builds the runtime `sha2` fallback is still
/// available so new test-only discriminator names keep working.
mod precomputed {
    include!(concat!(env!("OUT_DIR"), "/discriminators.rs"));
}

pub const ANCHOR_DISCRIMINATOR_LEN: usize = 8;

// Re-export the precomputed constants for direct access where preferred.
pub use precomputed::*;

#[inline(always)]
pub fn instruction_discriminator(name: &str) -> [u8; ANCHOR_DISCRIMINATOR_LEN] {
    match name {
        "upsert_degen_config"    => precomputed::IX_UPSERT_DEGEN_CONFIG,
        "init_config"            => precomputed::IX_INIT_CONFIG,
        "update_config"          => precomputed::IX_UPDATE_CONFIG,
        "transfer_admin"         => precomputed::IX_TRANSFER_ADMIN,
        "set_treasury_usdc_ata"  => precomputed::IX_SET_TREASURY_USDC_ATA,
        "lock_round"             => precomputed::IX_LOCK_ROUND,
        "start_round"            => precomputed::IX_START_ROUND,
        "admin_force_cancel"     => precomputed::IX_ADMIN_FORCE_CANCEL,
        "deposit_any"            => precomputed::IX_DEPOSIT_ANY,
        "cancel_round"           => precomputed::IX_CANCEL_ROUND,
        "claim_refund"           => precomputed::IX_CLAIM_REFUND,
        "claim"                  => precomputed::IX_CLAIM,
        "auto_claim"             => precomputed::IX_AUTO_CLAIM,
        "close_participant"      => precomputed::IX_CLOSE_PARTICIPANT,
        "close_round"            => precomputed::IX_CLOSE_ROUND,
        "request_vrf"            => precomputed::IX_REQUEST_VRF,
        "vrf_callback"           => precomputed::IX_VRF_CALLBACK,
        "request_degen_vrf"      => precomputed::IX_REQUEST_DEGEN_VRF,
        "degen_vrf_callback"     => precomputed::IX_DEGEN_VRF_CALLBACK,
        "begin_degen_execution"  => precomputed::IX_BEGIN_DEGEN_EXECUTION,
        "claim_degen_fallback"   => precomputed::IX_CLAIM_DEGEN_FALLBACK,
        "claim_degen"            => precomputed::IX_CLAIM_DEGEN,
        "finalize_degen_success" => precomputed::IX_FINALIZE_DEGEN_SUCCESS,
        #[cfg(test)]
        unknown => runtime_discriminator("global", unknown),
        #[cfg(not(test))]
        _ => [0u8; ANCHOR_DISCRIMINATOR_LEN], // unreachable – all names are compile-time known
    }
}

#[inline(always)]
pub fn account_discriminator(name: &str) -> [u8; ANCHOR_DISCRIMINATOR_LEN] {
    match name {
        "Config"      => precomputed::ACCT_CONFIG,
        "Round"       => precomputed::ACCT_ROUND,
        "Participant" => precomputed::ACCT_PARTICIPANT,
        "DegenClaim"  => precomputed::ACCT_DEGENCLAIM,
        "DegenConfig" => precomputed::ACCT_DEGENCONFIG,
        #[cfg(test)]
        unknown => runtime_discriminator("account", unknown),
        #[cfg(not(test))]
        _ => [0u8; ANCHOR_DISCRIMINATOR_LEN], // unreachable
    }
}

// ── Test-only runtime fallback using sha2 ──

#[cfg(test)]
fn runtime_discriminator(namespace: &str, name: &str) -> [u8; ANCHOR_DISCRIMINATOR_LEN] {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(namespace.as_bytes());
    hasher.update(b":");
    hasher.update(name.as_bytes());
    let digest = hasher.finalize();
    let mut out = [0u8; ANCHOR_DISCRIMINATOR_LEN];
    out.copy_from_slice(&digest[..ANCHOR_DISCRIMINATOR_LEN]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn precomputed_instruction_discriminators_match_sha256() {
        let names = [
            "upsert_degen_config", "init_config", "update_config",
            "transfer_admin", "set_treasury_usdc_ata",
            "lock_round", "start_round", "admin_force_cancel",
            "deposit_any", "cancel_round", "claim_refund",
            "claim", "auto_claim", "close_participant", "close_round",
            "request_vrf", "vrf_callback",
            "request_degen_vrf", "degen_vrf_callback",
            "begin_degen_execution", "claim_degen_fallback",
            "claim_degen", "finalize_degen_success",
        ];
        for name in names {
            let precomputed = instruction_discriminator(name);
            let runtime = runtime_discriminator("global", name);
            assert_eq!(precomputed, runtime, "mismatch for instruction '{name}'");
            assert_ne!(precomputed, [0u8; 8], "zero discriminator for '{name}'");
        }
    }

    #[test]
    fn precomputed_account_discriminators_match_sha256() {
        let names = ["Config", "Round", "Participant", "DegenClaim", "DegenConfig"];
        for name in names {
            let precomputed = account_discriminator(name);
            let runtime = runtime_discriminator("account", name);
            assert_eq!(precomputed, runtime, "mismatch for account '{name}'");
            assert_ne!(precomputed, [0u8; 8], "zero discriminator for '{name}'");
        }
    }
}
