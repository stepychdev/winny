#!/usr/bin/env bash
# Devnet end-to-end smoke: build with patched VRF stubs, deploy, run classic + degen scenarios.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$ROOT_DIR/.." && pwd)"
KEYS_DIR="$ROOT_DIR/devnet-keys"
BUILD_DIR="/tmp/jackpot-pinocchio-devnet-build"
CRATE_BUILD_DIR="/tmp/jackpot-pinocchio-devnet-src"
RPC_URL="https://api.devnet.solana.com"
DEPLOYER_KEYPAIR="${PINOCCHIO_DEPLOYER_KEYPAIR:-/home/scumcheck/jackpot/keypar.json}"

# ── helpers ───────────────────────────────────────────────────────────────────
log() { echo ">>> $*"; }
ensure_keypair() {
  local path="$1"; local label="$2"
  if [[ ! -f "$path" ]]; then
    log "Generating $label keypair → $path"
    solana-keygen new --silent --no-bip39-passphrase -o "$path" >/dev/null
  fi
  echo "$(solana-keygen pubkey "$path")"
}

# ── keypairs (persisted between runs) ─────────────────────────────────────────
mkdir -p "$KEYS_DIR"
PROGRAM_KEYPAIR="$KEYS_DIR/program.json"
VRF_PROGRAM_KEYPAIR="$KEYS_DIR/vrf_program.json"
VRF_IDENTITY_KEYPAIR="$KEYS_DIR/vrf_identity.json"
VRF_QUEUE_KEYPAIR="$KEYS_DIR/vrf_queue.json"

PROGRAM_ID=$(ensure_keypair "$PROGRAM_KEYPAIR" "program")
VRF_PROGRAM_ID=$(ensure_keypair "$VRF_PROGRAM_KEYPAIR" "vrf-program")
VRF_IDENTITY=$(ensure_keypair "$VRF_IDENTITY_KEYPAIR" "vrf-identity")
VRF_QUEUE=$(ensure_keypair "$VRF_QUEUE_KEYPAIR" "vrf-queue")

log "Deployer:     $(solana-keygen pubkey "$DEPLOYER_KEYPAIR")"
log "Program ID:   $PROGRAM_ID"
log "VRF Program:  $VRF_PROGRAM_ID"
log "VRF Identity: $VRF_IDENTITY"
log "VRF Queue:    $VRF_QUEUE"

# ── check deployer balance ────────────────────────────────────────────────────
BALANCE=$(solana balance --url "$RPC_URL" --keypair "$DEPLOYER_KEYPAIR" 2>/dev/null | awk '{print $1}')
log "Deployer balance: ${BALANCE} SOL"
if (( $(echo "$BALANCE < 5" | bc -l) )); then
  log "Need at least 5 SOL. Requesting airdrop..."
  solana airdrop 2 --url "$RPC_URL" --keypair "$DEPLOYER_KEYPAIR" >/dev/null 2>&1 || true
  sleep 3
fi

# ── build VRF stub ────────────────────────────────────────────────────────────
log "Building VRF stub..."
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

VRF_STUB_SRC="$ROOT_DIR/fixtures/vrf_stub_program"
STUB_BUILD_DIR="/tmp/jackpot-pinocchio-devnet-vrf-stub"
if [[ ! -d "$VRF_STUB_SRC" ]]; then
  echo "ERROR: VRF stub source not found at $VRF_STUB_SRC" >&2
  exit 1
fi

rm -rf "$STUB_BUILD_DIR"
cp -R "$VRF_STUB_SRC" "$STUB_BUILD_DIR"
(cd "$STUB_BUILD_DIR" && cargo-build-sbf --sbf-out-dir "$BUILD_DIR" -- -q)

# ── build main program with VRF addresses from env ───────────────────────────
log "Preparing patched source..."
rm -rf "$CRATE_BUILD_DIR"
cp -R "$ROOT_DIR" "$CRATE_BUILD_DIR"
mkdir -p "$(dirname "$CRATE_BUILD_DIR")"/jackpot_anchor_v4/programs/jackpot/src/generated
cp "$REPO_DIR/jackpot_anchor_v4/programs/jackpot/src/generated/degen_pool.rs" \
  "$(dirname "$CRATE_BUILD_DIR")"/jackpot_anchor_v4/programs/jackpot/src/generated/degen_pool.rs

export VRF_PROGRAM_ID
export VRF_QUEUE_ID="$VRF_QUEUE"
export VRF_IDENTITY_ID="$VRF_IDENTITY"

log "Building main program..."
(cd "$CRATE_BUILD_DIR" && cargo-build-sbf --features bpf-entrypoint --sbf-out-dir "$BUILD_DIR" -- -q)

# ── deploy programs ──────────────────────────────────────────────────────────
deploy_program() {
  local so_path="$1" keypair="$2" label="$3"
  local prog_id
  prog_id="$(solana-keygen pubkey "$keypair")"

  # Check if already deployed
  if solana program show "$prog_id" --url "$RPC_URL" >/dev/null 2>&1; then
    log "$label already deployed at $prog_id — upgrading..."
    solana program deploy "$so_path" \
      --program-id "$keypair" \
      --url "$RPC_URL" \
      --keypair "$DEPLOYER_KEYPAIR" \
      --upgrade-authority "$DEPLOYER_KEYPAIR" \
      >/dev/null
  else
    log "Deploying $label → $prog_id..."
    solana program deploy "$so_path" \
      --program-id "$keypair" \
      --url "$RPC_URL" \
      --keypair "$DEPLOYER_KEYPAIR" \
      >/dev/null
  fi
  log "$label deployed: $prog_id"
}

deploy_program "$BUILD_DIR/vrf_stub_program.so"        "$VRF_PROGRAM_KEYPAIR"  "VRF Stub"
deploy_program "$BUILD_DIR/jackpot_pinocchio_poc.so"   "$PROGRAM_KEYPAIR"      "Jackpot Pinocchio"

# ── pre-fund accounts for e2e tests ──────────────────────────────────────────
# Devnet airdrop is rate-limited, so fund from deployer via transfer
fund_if_needed() {
  local pubkey="$1" label="$2" amount="${3:-0.1}"
  local bal
  bal=$(solana balance "$pubkey" --url "$RPC_URL" 2>/dev/null | awk '{print $1}' || echo "0")
  if (( $(echo "$bal < $amount" | bc -l) )); then
    log "Funding $label ($pubkey) with ${amount} SOL..."
    solana transfer "$pubkey" "$amount" \
      --url "$RPC_URL" --keypair "$DEPLOYER_KEYPAIR" \
      --allow-unfunded-recipient --no-wait >/dev/null 2>&1
    sleep 2
  fi
}

fund_if_needed "$VRF_IDENTITY" "VRF Identity" 0.1
fund_if_needed "$VRF_QUEUE" "VRF Queue" 0.05

# ── create shared USDC mint for both scenarios ───────────────────────────────
USDC_MINT_KEYPAIR="$KEYS_DIR/usdc_mint.json"
ensure_keypair "$USDC_MINT_KEYPAIR" "usdc-mint" >/dev/null
USDC_MINT="$(solana-keygen pubkey "$USDC_MINT_KEYPAIR")"

# Create SPL mint if it doesn't exist yet
if ! spl-token display "$USDC_MINT" --url "$RPC_URL" >/dev/null 2>&1; then
  log "Creating USDC mock mint..."
  spl-token create-token --url "$RPC_URL" \
    --fee-payer "$DEPLOYER_KEYPAIR" \
    --mint-authority "$(solana-keygen pubkey "$DEPLOYER_KEYPAIR")" \
    --decimals 6 \
    "$USDC_MINT_KEYPAIR" >/dev/null
fi
log "USDC Mint: $USDC_MINT"

# Use timestamp-based round IDs to avoid collisions on re-runs
ROUND_BASE=$(($(date +%s) % 100000 * 10))
CLASSIC_ROUND_ID=$((ROUND_BASE + 1))
DEGEN_ROUND_ID=$((ROUND_BASE + 2))

# ── e2e scenario 1: classic round ────────────────────────────────────────────
log "═══ E2E Scenario 1: Classic Round (round=$CLASSIC_ROUND_ID) ═══"
(
  cd "$REPO_DIR"
  PINOCCHIO_RPC_URL="$RPC_URL" \
  PINOCCHIO_PROGRAM_ID="$PROGRAM_ID" \
  PINOCCHIO_KEYPAIR_PATH="$DEPLOYER_KEYPAIR" \
  PINOCCHIO_VRF_PROGRAM_ID="$VRF_PROGRAM_ID" \
  PINOCCHIO_VRF_IDENTITY_KEYPAIR_PATH="$VRF_IDENTITY_KEYPAIR" \
  PINOCCHIO_VRF_QUEUE_PUBKEY="$VRF_QUEUE" \
  PINOCCHIO_ROUND_ID="$CLASSIC_ROUND_ID" \
  PINOCCHIO_USDC_MINT="$USDC_MINT" \
  npx tsx jackpot_pinocchio_poc/scripts/local_classic_round_smoke.ts
)
log "Classic round: GREEN ✓"

# ── e2e scenario 2: degen fallback ───────────────────────────────────────────
log "═══ E2E Scenario 2: Degen Fallback (round=$DEGEN_ROUND_ID) ═══"
(
  cd "$REPO_DIR"
  PINOCCHIO_RPC_URL="$RPC_URL" \
  PINOCCHIO_PROGRAM_ID="$PROGRAM_ID" \
  PINOCCHIO_KEYPAIR_PATH="$DEPLOYER_KEYPAIR" \
  PINOCCHIO_VRF_PROGRAM_ID="$VRF_PROGRAM_ID" \
  PINOCCHIO_VRF_IDENTITY_KEYPAIR_PATH="$VRF_IDENTITY_KEYPAIR" \
  PINOCCHIO_VRF_QUEUE_PUBKEY="$VRF_QUEUE" \
  PINOCCHIO_ROUND_ID="$DEGEN_ROUND_ID" \
  PINOCCHIO_USDC_MINT="$USDC_MINT" \
  PINOCCHIO_DEGEN_FALLBACK_TIMEOUT_SEC="2" \
  npx tsx jackpot_pinocchio_poc/scripts/local_degen_fallback_smoke.ts
)
log "Degen fallback: GREEN ✓"

# ── summary ──────────────────────────────────────────────────────────────────
log ""
log "╔═══════════════════════════════════════╗"
log "║  DEVNET E2E: ALL SCENARIOS PASSED     ║"
log "╚═══════════════════════════════════════╝"
log ""
log "Program:       $PROGRAM_ID"
log "VRF Stub:      $VRF_PROGRAM_ID"
log "VRF Identity:  $VRF_IDENTITY"
log "VRF Queue:     $VRF_QUEUE"
log "RPC:           $RPC_URL"
