#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURES_DIR="$ROOT_DIR/tests/fixtures"
TMP_DIR="$(mktemp -d /tmp/jpino-mollusk.XXXXXX)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$FIXTURES_DIR"

cp -R "$ROOT_DIR" "$TMP_DIR/jackpot_pinocchio_poc"
mkdir -p "$TMP_DIR/jackpot_anchor_v4/programs/jackpot/src/generated"
cp "$ROOT_DIR/../jackpot_anchor_v4/programs/jackpot/src/generated/degen_pool.rs" \
  "$TMP_DIR/jackpot_anchor_v4/programs/jackpot/src/generated/degen_pool.rs"

# ── Build main program ELF ──────────────────────────────────
(
  cd "$TMP_DIR/jackpot_pinocchio_poc"
  cargo-build-sbf \
    --features bpf-entrypoint \
    --sbf-out-dir "$FIXTURES_DIR" \
    -- -q
)

# ── Build token stub (synthetic 72-byte layout) ─────────────
cp -R "$ROOT_DIR/fixtures/token_stub_program" "$TMP_DIR/token_stub_program"
(
  cd "$TMP_DIR/token_stub_program"
  cargo-build-sbf \
    --sbf-out-dir "$FIXTURES_DIR" \
    -- -q
)

cd "$ROOT_DIR"
cargo test --test mollusk_smoke -- --ignored --nocapture
