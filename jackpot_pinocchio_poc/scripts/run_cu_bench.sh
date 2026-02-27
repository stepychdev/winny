#!/usr/bin/env bash
# Build SBF fixtures (Pinocchio + Anchor + token stub) then run the Mollusk
# CU benchmark.
#
# Output:
#   target/benches/mx_compute_units.md  — Pinocchio ↔ Anchor matrix
#   target/benches/compute_units.md     — Pinocchio-only (init ix)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURES_DIR="$ROOT_DIR/tests/fixtures"
TMP_DIR="$(mktemp -d /tmp/jpino-bench.XXXXXX)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$FIXTURES_DIR"
mkdir -p "$ROOT_DIR/target/benches"

# ── Copy source to temp (build.rs reads sibling anchor crate) ─
cp -R "$ROOT_DIR" "$TMP_DIR/jackpot_pinocchio_poc"
mkdir -p "$TMP_DIR/jackpot_anchor_v4/programs/jackpot/src/generated"
cp "$ROOT_DIR/../jackpot_anchor_v4/programs/jackpot/src/generated/degen_pool.rs" \
  "$TMP_DIR/jackpot_anchor_v4/programs/jackpot/src/generated/degen_pool.rs"

# ── Build Pinocchio ELF ─────────────────────────────────────
echo "→ Building Pinocchio SBF ELF…"
(
  cd "$TMP_DIR/jackpot_pinocchio_poc"
  cargo-build-sbf \
    --features bpf-entrypoint \
    --sbf-out-dir "$FIXTURES_DIR" \
    -- -q
)

# ── Build Anchor ELF (devnet declare_id) ─────────────────────
echo "→ Building Anchor SBF ELF…"
(
  cd "$ROOT_DIR/../jackpot_anchor_v4"
  cargo-build-sbf \
    --manifest-path programs/jackpot/Cargo.toml \
    --features devnet \
    --sbf-out-dir "$FIXTURES_DIR" \
    -- -q
)

# ── Build token stub ────────────────────────────────────────
echo "→ Building token stub…"
cp -R "$ROOT_DIR/fixtures/token_stub_program" "$TMP_DIR/token_stub_program"
(
  cd "$TMP_DIR/token_stub_program"
  cargo-build-sbf \
    --sbf-out-dir "$FIXTURES_DIR" \
    -- -q
)

# ── Run CU benchmark ────────────────────────────────────────
echo "→ Running CU benchmark…"
cd "$ROOT_DIR"
cargo bench --bench compute_units

echo ""
echo "✓ Done — see target/benches/mx_compute_units.md  (matrix)"
echo "         and target/benches/compute_units.md     (pinocchio-only)"
