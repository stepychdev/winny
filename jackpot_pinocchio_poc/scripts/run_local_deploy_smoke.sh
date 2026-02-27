#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$ROOT_DIR/.." && pwd)"
TMP_DIR="$(mktemp -d /tmp/jackpot-pinocchio-local.XXXXXX)"
LEDGER_DIR="$TMP_DIR/ledger"
BUILD_DIR="$TMP_DIR/build"
CRATE_BUILD_DIR="$TMP_DIR/jackpot_pinocchio_poc"
KEYPAIR_PATH="$TMP_DIR/deployer.json"
PROGRAM_KEYPAIR_PATH="$TMP_DIR/program.json"
VALIDATOR_LOG="$TMP_DIR/validator.log"
RPC_URL="${PINOCCHIO_RPC_URL:-http://127.0.0.1:8899}"

cleanup() {
  if [[ -n "${VALIDATOR_PID:-}" ]]; then
    kill "$VALIDATOR_PID" >/dev/null 2>&1 || true
    wait "$VALIDATOR_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$BUILD_DIR"
cp -R "$ROOT_DIR" "$CRATE_BUILD_DIR"
mkdir -p "$TMP_DIR/jackpot_anchor_v4/programs/jackpot/src/generated"
cp "$ROOT_DIR/../jackpot_anchor_v4/programs/jackpot/src/generated/degen_pool.rs" \
  "$TMP_DIR/jackpot_anchor_v4/programs/jackpot/src/generated/degen_pool.rs"

solana-keygen new --silent --no-bip39-passphrase -o "$KEYPAIR_PATH" >/dev/null
solana-keygen new --silent --no-bip39-passphrase -o "$PROGRAM_KEYPAIR_PATH" >/dev/null

solana-test-validator --reset --ledger "$LEDGER_DIR" --quiet >"$VALIDATOR_LOG" 2>&1 &
VALIDATOR_PID=$!

for _ in $(seq 1 30); do
  if solana -u "$RPC_URL" block-height >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

solana -u "$RPC_URL" airdrop 20 "$(solana-keygen pubkey "$KEYPAIR_PATH")" >/dev/null

(
  cd "$CRATE_BUILD_DIR"
  cargo-build-sbf \
    --features bpf-entrypoint \
    --sbf-out-dir "$BUILD_DIR" \
    -- -q
)

solana program deploy "$BUILD_DIR/jackpot_pinocchio_poc.so" \
  --program-id "$PROGRAM_KEYPAIR_PATH" \
  --url "$RPC_URL" \
  --keypair "$KEYPAIR_PATH" >/dev/null

PROGRAM_ID="$(solana-keygen pubkey "$PROGRAM_KEYPAIR_PATH")"

(
  cd "$REPO_DIR"
  PINOCCHIO_RPC_URL="$RPC_URL" \
  PINOCCHIO_PROGRAM_ID="$PROGRAM_ID" \
  PINOCCHIO_KEYPAIR_PATH="$KEYPAIR_PATH" \
  npx tsx jackpot_pinocchio_poc/scripts/local_deploy_smoke.ts
)
