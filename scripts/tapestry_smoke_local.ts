const baseUrl = (process.env.TAPESTRY_BASE_URL || "http://127.0.0.1:3000/api/tapestry").replace(/\/$/, "");

type Result = { name: string; ok: boolean; detail?: string };

async function run(): Promise<number> {
  const results: Result[] = [];
  const sampleWallet = process.env.TAPESTRY_SMOKE_WALLET || "11111111111111111111111111111111";

  async function check(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (e: any) {
      results.push({ name, ok: false, detail: e?.message || String(e) });
    }
  }

  async function getJson(path: string) {
    const res = await fetch(`${baseUrl}${path}`);
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`${path} invalid JSON (${res.status}): ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
      throw new Error(`${path} expected 200, got ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    }
    return json;
  }

  async function postJson(path: string, body: unknown) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`${path} invalid JSON (${res.status}): ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
      throw new Error(`${path} expected 200, got ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    }
    return json;
  }

  await check("GET /profile", async () => {
    const json = await getJson(`/profile?wallet=${encodeURIComponent(sampleWallet)}`);
    if (json?.ok !== true || !("profile" in json)) throw new Error("missing profile payload");
  });

  await check("POST /profiles", async () => {
    const json = await postJson("/profiles", { wallets: [sampleWallet] });
    if (json?.ok !== true || typeof json?.profiles !== "object") throw new Error("missing profiles map");
  });

  await check("GET /activity-feed", async () => {
    const json = await getJson(`/activity-feed?wallet=${encodeURIComponent(sampleWallet)}&limit=3`);
    if (json?.ok !== true || !Array.isArray(json?.activities)) throw new Error("missing activities[]");
  });

  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log(`TAPESTRY SMOKE: pass=${pass} fail=${fail}`);
  for (const r of results) {
    console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }

  return fail === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then((code) => process.exit(code));
}

export { run };
