/**
 * Local smoke checks for roll2roll Solana Actions endpoints.
 *
 * Usage:
 *   ACTIONS_BASE_URL=http://127.0.0.1:3000/api/actions npx tsx scripts/actions_smoke_local.ts
 *
 * Optional env:
 *   ACTIONS_SMOKE_ACCOUNT=<base58 pubkey>   # defaults to system program pubkey (valid pubkey for tx-building smoke)
 *   ACTIONS_SMOKE_JOIN_AMOUNT=1             # defaults to 1 USDC
 *   ACTIONS_SMOKE_SKIP_POST_JOIN=1          # metadata-only smoke
 */

type Json = any;

const BASE_URL = (process.env.ACTIONS_BASE_URL || "http://127.0.0.1:3000/api/actions").replace(/\/$/, "");
const SMOKE_ACCOUNT = process.env.ACTIONS_SMOKE_ACCOUNT || "11111111111111111111111111111111";
const JOIN_AMOUNT = Number(process.env.ACTIONS_SMOKE_JOIN_AMOUNT || "1");
const SKIP_POST_JOIN = process.env.ACTIONS_SMOKE_SKIP_POST_JOIN === "1";

type CheckResult = { name: string; ok: boolean; details?: string };

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

async function call(method: "GET" | "POST", path: string, body?: Json): Promise<{ status: number; json: Json }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: Json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${method} ${path}: non-JSON response (${res.status})`);
  }
  return { status: res.status, json };
}

function validateActionMetadata(json: Json, routeName: string) {
  assert(isObject(json), `${routeName}: response is not an object`);
  assert(typeof json.title === "string", `${routeName}: missing title`);
  assert(typeof json.label === "string", `${routeName}: missing label`);
  if ("links" in json) {
    assert(isObject(json.links), `${routeName}: links must be object`);
    if ("actions" in (json.links as any)) {
      assert(Array.isArray((json.links as any).actions), `${routeName}: links.actions must be array`);
    }
  }
}

function validateEligibilityShape(json: Json, routeName: string) {
  if (!isObject(json) || !("eligibility" in json)) return;
  const e = (json as any).eligibility;
  assert(isObject(e), `${routeName}: eligibility must be object`);
  assert(typeof e.eligible === "boolean", `${routeName}: eligibility.eligible must be boolean`);
}

function validateTxBuildResponse(json: Json, routeName: string) {
  assert(isObject(json), `${routeName}: tx-build response is not object`);
  assert(json.type === "transaction", `${routeName}: expected type=transaction`);
  assert(typeof json.transaction === "string" && json.transaction.length > 0, `${routeName}: missing transaction`);
  assert(typeof json.message === "string", `${routeName}: missing message`);
  // Very light base64 sanity check.
  assert(/^[A-Za-z0-9+/=]+$/.test(json.transaction), `${routeName}: transaction is not base64-like`);
}

function validateExternalLinkResponse(json: Json, routeName: string) {
  assert(isObject(json), `${routeName}: response is not object`);
  assert(json.type === "external-link", `${routeName}: expected type=external-link`);
  assert(typeof json.externalLink === "string" && json.externalLink.length > 0, `${routeName}: missing externalLink`);
  assert(typeof json.message === "string", `${routeName}: missing message`);
}

async function run(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // 1) Current round read-only (auto-discovery)
  try {
    const { status, json } = await call("GET", "/round");
    assert(status === 200, `GET /round expected 200, got ${status}`);
    assert(typeof json.roundId === "number", "GET /round missing roundId");
    assert(typeof json.project === "string", "GET /round missing project");
    results.push({ name: "GET /round (auto)", ok: true, details: `roundId=${json.roundId}` });

    const roundId = json.roundId as number;

    // 2) Join metadata (auto and explicit)
    {
      const auto = await call("GET", "/join");
      assert(auto.status === 200, `GET /join expected 200, got ${auto.status}`);
      validateActionMetadata(auto.json, "GET /join");
      results.push({ name: "GET /join (auto)", ok: true });
    }
    {
      const explicit = await call("GET", `/join?roundId=${roundId}`);
      assert(explicit.status === 200, `GET /join?roundId expected 200, got ${explicit.status}`);
      validateActionMetadata(explicit.json, "GET /join?roundId");
      results.push({ name: "GET /join (explicit roundId)", ok: true, details: `roundId=${roundId}` });
    }

    // 3) Join tx build (optional)
    if (!SKIP_POST_JOIN) {
      const joinPost = await call("POST", `/join?amount=${JOIN_AMOUNT}`, { account: SMOKE_ACCOUNT });
      assert(joinPost.status === 200, `POST /join expected 200, got ${joinPost.status}`);
      validateTxBuildResponse(joinPost.json, "POST /join");
      results.push({ name: "POST /join tx build (auto round)", ok: true, details: `amount=${JOIN_AMOUNT}` });
    }

    // 4) Claim / Refund metadata (auto + explicit)
    {
      const claimMetaAuto = await call("GET", "/claim");
      assert(claimMetaAuto.status === 200, `GET /claim expected 200, got ${claimMetaAuto.status}`);
      validateActionMetadata(claimMetaAuto.json, "GET /claim");
      results.push({ name: "GET /claim metadata (auto)", ok: true });
    }
    {
      const claimMetaWallet = await call("GET", `/claim?account=${encodeURIComponent(SMOKE_ACCOUNT)}`);
      assert(claimMetaWallet.status === 200, `GET /claim?account expected 200, got ${claimMetaWallet.status}`);
      validateActionMetadata(claimMetaWallet.json, "GET /claim?account");
      validateEligibilityShape(claimMetaWallet.json, "GET /claim?account");
      results.push({ name: "GET /claim metadata (wallet-aware)", ok: true });
    }
    {
      const claimMeta = await call("GET", `/claim?roundId=${roundId}`);
      assert(claimMeta.status === 200, `GET /claim expected 200, got ${claimMeta.status}`);
      validateActionMetadata(claimMeta.json, "GET /claim");
      results.push({ name: "GET /claim metadata (explicit roundId)", ok: true });
    }
    {
      const refundMetaAuto = await call("GET", "/claim-refund");
      assert(refundMetaAuto.status === 200, `GET /claim-refund expected 200, got ${refundMetaAuto.status}`);
      validateActionMetadata(refundMetaAuto.json, "GET /claim-refund");
      results.push({ name: "GET /claim-refund metadata (auto)", ok: true });
    }
    {
      const refundMetaWallet = await call("GET", `/claim-refund?account=${encodeURIComponent(SMOKE_ACCOUNT)}`);
      assert(refundMetaWallet.status === 200, `GET /claim-refund?account expected 200, got ${refundMetaWallet.status}`);
      validateActionMetadata(refundMetaWallet.json, "GET /claim-refund?account");
      validateEligibilityShape(refundMetaWallet.json, "GET /claim-refund?account");
      results.push({ name: "GET /claim-refund metadata (wallet-aware)", ok: true });
    }
    {
      const refundMeta = await call("GET", `/claim-refund?roundId=${roundId}`);
      assert(refundMeta.status === 200, `GET /claim-refund expected 200, got ${refundMeta.status}`);
      validateActionMetadata(refundMeta.json, "GET /claim-refund");
      results.push({ name: "GET /claim-refund metadata (explicit roundId)", ok: true });
    }

    // 5) Batch/degen launcher actions (metadata + external-link POST)
    {
      const joinBatchMeta = await call("GET", "/join-batch");
      assert(joinBatchMeta.status === 200, `GET /join-batch expected 200, got ${joinBatchMeta.status}`);
      validateActionMetadata(joinBatchMeta.json, "GET /join-batch");
      results.push({ name: "GET /join-batch metadata (auto)", ok: true });
    }
    {
      const joinBatchPost = await call("POST", "/join-batch", { account: SMOKE_ACCOUNT });
      assert(joinBatchPost.status === 200, `POST /join-batch expected 200, got ${joinBatchPost.status}`);
      validateExternalLinkResponse(joinBatchPost.json, "POST /join-batch");
      results.push({ name: "POST /join-batch launcher", ok: true });
    }
    {
      const degenMeta = await call("GET", "/claim-degen");
      assert(degenMeta.status === 200, `GET /claim-degen expected 200, got ${degenMeta.status}`);
      validateActionMetadata(degenMeta.json, "GET /claim-degen");
      results.push({ name: "GET /claim-degen metadata (auto)", ok: true });
    }
    {
      const degenMetaWallet = await call("GET", `/claim-degen?account=${encodeURIComponent(SMOKE_ACCOUNT)}`);
      assert(degenMetaWallet.status === 200, `GET /claim-degen?account expected 200, got ${degenMetaWallet.status}`);
      validateActionMetadata(degenMetaWallet.json, "GET /claim-degen?account");
      validateEligibilityShape(degenMetaWallet.json, "GET /claim-degen?account");
      results.push({ name: "GET /claim-degen metadata (wallet-aware)", ok: true });
    }
  } catch (e: any) {
    results.push({ name: "smoke-sequence", ok: false, details: e?.message || String(e) });
  }

  return results;
}

function printSummary(results: CheckResult[]) {
  const ok = results.filter((r) => r.ok).length;
  const fail = results.length - ok;
  console.log(`ACTIONS SMOKE: pass=${ok} fail=${fail}`);
  for (const r of results) {
    console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.details ? ` — ${r.details}` : ""}`);
  }
}

async function main() {
  const results = await run();
  printSummary(results);
  if (results.some((r) => !r.ok)) process.exit(1);
}

// Run only when invoked directly, not when imported for syntax/import smoke checks.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error("ACTIONS SMOKE FATAL:", e?.message || String(e));
    process.exit(1);
  });
}
