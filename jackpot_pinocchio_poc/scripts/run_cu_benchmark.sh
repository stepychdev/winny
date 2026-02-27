#!/usr/bin/env bash
# CU benchmark: runs the classic round smoke with verbose validator logs,
# then parses CU per instruction.  Also reports .so size comparison.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d /tmp/cu-bench.XXXXXX)"
trap 'kill "$VALIDATOR_PID" 2>/dev/null; rm -rf "$TMP_DIR"' EXIT

RPC_URL="http://127.0.0.1:8899"
LEDGER_DIR="$TMP_DIR/ledger"
VALIDATOR_LOG="$TMP_DIR/validator.log"
BUILD_DIR="$TMP_DIR/build"
STUB_BUILD_DIR="$TMP_DIR/vrf_stub"
CRATE_BUILD_DIR="$TMP_DIR/jackpot_pinocchio_poc"

KEYPAIR_PATH="$TMP_DIR/deployer.json"
PROGRAM_KEYPAIR_PATH="$TMP_DIR/program.json"
VRF_PROGRAM_KEYPAIR_PATH="$TMP_DIR/vrf_program.json"
VRF_IDENTITY_KEYPAIR_PATH="$TMP_DIR/vrf_identity.json"
VRF_QUEUE_KEYPAIR_PATH="$TMP_DIR/vrf_queue.json"

mkdir -p "$BUILD_DIR"
cp -R "$ROOT_DIR" "$CRATE_BUILD_DIR"
cp -R "$ROOT_DIR/fixtures/vrf_stub_program" "$STUB_BUILD_DIR"
mkdir -p "$TMP_DIR/jackpot_anchor_v4/programs/jackpot/src/generated"
cp "$ROOT_DIR/../jackpot_anchor_v4/programs/jackpot/src/generated/degen_pool.rs" \
  "$TMP_DIR/jackpot_anchor_v4/programs/jackpot/src/generated/degen_pool.rs"

solana-keygen new --silent --no-bip39-passphrase -o "$KEYPAIR_PATH" >/dev/null
solana-keygen new --silent --no-bip39-passphrase -o "$PROGRAM_KEYPAIR_PATH" >/dev/null
solana-keygen new --silent --no-bip39-passphrase -o "$VRF_PROGRAM_KEYPAIR_PATH" >/dev/null
solana-keygen new --silent --no-bip39-passphrase -o "$VRF_IDENTITY_KEYPAIR_PATH" >/dev/null
solana-keygen new --silent --no-bip39-passphrase -o "$VRF_QUEUE_KEYPAIR_PATH" >/dev/null

VRF_PROGRAM_ID="$(solana-keygen pubkey "$VRF_PROGRAM_KEYPAIR_PATH")"
VRF_IDENTITY_PUBKEY="$(solana-keygen pubkey "$VRF_IDENTITY_KEYPAIR_PATH")"
VRF_QUEUE_PUBKEY="$(solana-keygen pubkey "$VRF_QUEUE_KEYPAIR_PATH")"

export VRF_PROGRAM_ID
export VRF_QUEUE_ID="$VRF_QUEUE_PUBKEY"
export VRF_IDENTITY_ID="$VRF_IDENTITY_PUBKEY"

(cd "$STUB_BUILD_DIR" && cargo-build-sbf --sbf-out-dir "$BUILD_DIR" -- -q)

# Start validator with log-messages-bytes-limit for full CU output
solana-test-validator --reset --ledger "$LEDGER_DIR" --quiet \
  --log-messages-bytes-limit 50000 \
  --bpf-program "$VRF_PROGRAM_ID" "$BUILD_DIR/vrf_stub_program.so" >"$VALIDATOR_LOG" 2>&1 &
VALIDATOR_PID=$!

for _ in $(seq 1 30); do
  if solana -u "$RPC_URL" block-height >/dev/null 2>&1; then break; fi
  sleep 1
done

solana -u "$RPC_URL" airdrop 20 "$(solana-keygen pubkey "$KEYPAIR_PATH")" >/dev/null

(
  cd "$CRATE_BUILD_DIR"
  cargo-build-sbf --features bpf-entrypoint --sbf-out-dir "$BUILD_DIR" -- -q
)

PROGRAM_ID="$(solana-keygen pubkey "$PROGRAM_KEYPAIR_PATH")"

solana -u "$RPC_URL" program deploy \
  --program-id "$PROGRAM_KEYPAIR_PATH" \
  --keypair "$KEYPAIR_PATH" \
  "$BUILD_DIR/jackpot_pinocchio_poc.so" >/dev/null

# ── Report .so size ──
PINOCCHIO_SIZE=$(stat -c%s "$BUILD_DIR/jackpot_pinocchio_poc.so")
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║              BINARY SIZE COMPARISON                  ║"
echo "╠══════════════════════════════════════════════════════╣"
printf "║  Pinocchio:  %'9d bytes  (%s)  ║\n" "$PINOCCHIO_SIZE" "$(numfmt --to=iec-i --suffix=B $PINOCCHIO_SIZE)"
if [[ -f /tmp/anchor-bench/jackpot.so ]]; then
  ANCHOR_SIZE=$(stat -c%s /tmp/anchor-bench/jackpot.so)
  RATIO=$(echo "scale=1; $ANCHOR_SIZE / $PINOCCHIO_SIZE" | bc)
  printf "║  Anchor:     %'9d bytes  (%s)  ║\n" "$ANCHOR_SIZE" "$(numfmt --to=iec-i --suffix=B $ANCHOR_SIZE)"
  printf "║  Ratio:      Pinocchio is %sx smaller        ║\n" "$RATIO"
fi
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── Run classic round smoke (uses sendIxs which goes through validator) ──
PINOCCHIO_RPC_URL="$RPC_URL" \
  PINOCCHIO_PROGRAM_ID="$PROGRAM_ID" \
  PINOCCHIO_KEYPAIR_PATH="$KEYPAIR_PATH" \
  PINOCCHIO_VRF_IDENTITY_KEYPAIR_PATH="$VRF_IDENTITY_KEYPAIR_PATH" \
  PINOCCHIO_VRF_PROGRAM_ID="$VRF_PROGRAM_ID" \
  PINOCCHIO_VRF_QUEUE_PUBKEY="$VRF_QUEUE_PUBKEY" \
  npx tsx "$ROOT_DIR/scripts/local_classic_round_smoke.ts" >/dev/null

# ── Parse CU from validator log ──
echo "╔══════════════════════════════════════════════════════╗"
echo "║     PINOCCHIO CU BENCHMARK (classic round)          ║"
echo "╠══════════════════════════════════════════════════════╣"

# Extract lines: "Program <PROGRAM_ID> consumed <N> of <M> compute units"
# Only top-level invocations (of 1400000 or 499850 — the CU-limited budget)
TOTAL_CU=0
IX_NUM=0
while IFS= read -r line; do
  CU=$(echo "$line" | grep -oP 'consumed \K[0-9]+')
  IX_NUM=$((IX_NUM + 1))
  TOTAL_CU=$((TOTAL_CU + CU))
  printf "║  instruction #%-2d  │ %'8d CU            ║\n" "$IX_NUM" "$CU"
done < <(grep "$PROGRAM_ID consumed" "$VALIDATOR_LOG" | grep -v 'invoke \[2\]')

echo "╠══════════════════════════════════════════════════════╣"
printf "║  TOTAL  (%d ixs)     │ %'8d CU            ║\n" "$IX_NUM" "$TOTAL_CU"
echo "╚══════════════════════════════════════════════════════╝"
