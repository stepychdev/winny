const MAINNET_UPSTREAM = process.env.SOLANA_RPC_UPSTREAM;
if (!MAINNET_UPSTREAM) {
  throw new Error("SOLANA_RPC_UPSTREAM env var is required");
}

async function proxyOnce(body) {
  const resp = await fetch(MAINNET_UPSTREAM, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  return { status: resp.status, text };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

  try {
    const { status, text } = await proxyOnce(payload);
    res.status(status).send(text);
  } catch (e) {
    res.status(502).json({
      error: "Mainnet RPC upstream failed",
      details: e instanceof Error ? e.message : String(e),
    });
  }
}
