/**
 * Helius RPC Proxy — Cloudflare Worker
 * Based on magicblock-labs/helius-rpc-proxy with multi-origin ALLOWED_ORIGINS support.
 *
 * Proxies both HTTP JSON-RPC and WebSocket connections to Helius,
 * keeping the API key server-side.
 *
 * Secrets (set via `wrangler secret put`):
 *   HELIUS_API_KEY
 *
 * Env vars (wrangler.toml [vars]):
 *   ALLOWED_ORIGINS — comma-separated list of allowed origins
 */

interface Env {
  HELIUS_API_KEY: string;
  ALLOWED_ORIGINS: string;
}

const HELIUS_RPC = "https://mainnet.helius-rpc.com";
const HELIUS_WS = "wss://mainnet.helius-rpc.com";
const WS_KEEPALIVE_MS = 20_000;

function getAllowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

function isOriginAllowed(origin: string | null, env: Env): boolean {
  if (!origin) return false;
  return getAllowedOrigins(env).includes(origin);
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, solana-client",
  };
}

// ── HTTP handler ────────────────────────────────────────

async function handleHttp(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("Origin");

  // CORS preflight
  if (request.method === "OPTIONS") {
    if (!isOriginAllowed(origin, env)) {
      return new Response(null, { status: 403 });
    }
    return new Response(null, { status: 204, headers: corsHeaders(origin!) });
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  if (origin && !isOriginAllowed(origin, env)) {
    return new Response("Origin not allowed", { status: 403 });
  }

  const url = `${HELIUS_RPC}/?api-key=${env.HELIUS_API_KEY}`;

  const body = await request.text();
  const rpcResponse = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  const headers = new Headers(rpcResponse.headers);
  if (origin) {
    for (const [k, v] of Object.entries(corsHeaders(origin))) {
      headers.set(k, v);
    }
  }

  return new Response(rpcResponse.body, {
    status: rpcResponse.status,
    headers,
  });
}

// ── WebSocket handler ───────────────────────────────────

async function handleWs(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("Origin");
  if (origin && !isOriginAllowed(origin, env)) {
    return new Response("Origin not allowed", { status: 403 });
  }

  const upgradeHeader = request.headers.get("Upgrade");
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }

  const [clientWs, serverSideWs] = Object.values(new WebSocketPair());

  const heliusUrl = `${HELIUS_WS}/?api-key=${env.HELIUS_API_KEY}`;

  // Buffer messages from the client until Helius WS is open
  const bufferedMessages: (string | ArrayBuffer)[] = [];
  let heliusReady = false;

  const heliusWs = new WebSocket(heliusUrl);

  heliusWs.addEventListener("open", () => {
    heliusReady = true;
    // Flush buffered messages
    for (const msg of bufferedMessages) {
      heliusWs.send(msg);
    }
    bufferedMessages.length = 0;
  });

  heliusWs.addEventListener("message", (event) => {
    try {
      serverSideWs.send(event.data as string);
    } catch {
      // Client disconnected
    }
  });

  heliusWs.addEventListener("close", (event) => {
    try {
      serverSideWs.close(event.code, event.reason);
    } catch {
      // Already closed
    }
  });

  heliusWs.addEventListener("error", () => {
    try {
      serverSideWs.close(1011, "Upstream error");
    } catch {
      // Already closed
    }
  });

  // Accept client connection
  serverSideWs.accept();

  serverSideWs.addEventListener("message", (event) => {
    if (heliusReady) {
      heliusWs.send(event.data as string);
    } else {
      bufferedMessages.push(event.data as string | ArrayBuffer);
    }
  });

  serverSideWs.addEventListener("close", () => {
    try {
      heliusWs.close();
    } catch {
      // Already closed
    }
  });

  // Keepalive ping every 20s
  const keepalive = setInterval(() => {
    try {
      if (heliusReady) {
        heliusWs.send(JSON.stringify({ jsonrpc: "2.0", id: 0, method: "ping" }));
      }
    } catch {
      clearInterval(keepalive);
    }
  }, WS_KEEPALIVE_MS);

  // Clean up keepalive when either side closes
  serverSideWs.addEventListener("close", () => clearInterval(keepalive));
  heliusWs.addEventListener("close", () => clearInterval(keepalive));

  return new Response(null, { status: 101, webSocket: clientWs });
}

// ── Entry point ─────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.HELIUS_API_KEY) {
      return new Response("HELIUS_API_KEY not configured", { status: 500 });
    }

    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
      return handleWs(request, env);
    }

    return handleHttp(request, env);
  },
};
