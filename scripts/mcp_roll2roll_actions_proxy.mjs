#!/usr/bin/env node

/**
 * Minimal MCP proxy server for roll2roll Actions endpoints.
 *
 * Purpose:
 * - expose a small, safe tool surface for AI agents
 * - reuse /api/actions tx-building endpoints as the single source of truth
 * - avoid pulling a full MCP SDK dependency for MVP
 *
 * Tools:
 * - get_current_round
 * - get_join_action_metadata
 * - get_claim_action_metadata
 * - get_refund_action_metadata
 * - get_join_batch_action_metadata
 * - get_degen_claim_action_metadata
 * - join_round_usdc
 * - open_batch_join
 * - claim_prize
 * - open_degen_claim
 * - claim_refund
 *
 * Environment:
 * - ROLL2ROLL_ACTIONS_BASE_URL (default http://localhost:3000/api/actions)
 */

const BASE_URL = (process.env.ROLL2ROLL_ACTIONS_BASE_URL || "http://localhost:3000/api/actions").replace(/\/$/, "");

function sendMessage(msg) {
  const json = JSON.stringify(msg);
  const body = Buffer.from(json, "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function sendResult(id, result) {
  sendMessage({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message, data) {
  sendMessage({
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  });
}

async function callAction(method, path, { query = {}, body } = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

function textToolResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

const TOOLS = [
  {
    name: "get_current_round",
    description: "Fetch current active roll2roll round details (read-only).",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_join_action_metadata",
    description: "Fetch Solana Action metadata for joining the latest open round with USDC.",
    inputSchema: {
      type: "object",
      properties: {
        roundId: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_join_batch_action_metadata",
    description: "Fetch Solana Action metadata for batch/multi-token join launcher (opens in-app batch flow).",
    inputSchema: {
      type: "object",
      properties: {
        roundId: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_claim_action_metadata",
    description:
      "Fetch Solana Action metadata for classic USDC prize claim. Optional account adds eligibility summary.",
    inputSchema: {
      type: "object",
      properties: {
        roundId: { type: "integer", minimum: 0 },
        account: { type: "string", description: "Optional wallet pubkey (base58) for eligibility summary" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_degen_claim_action_metadata",
    description:
      "Fetch Solana Action metadata for lite degen claim launcher (opens in-app degen claim flow). Optional account adds eligibility summary.",
    inputSchema: {
      type: "object",
      properties: {
        roundId: { type: "integer", minimum: 0 },
        account: { type: "string", description: "Optional wallet pubkey (base58) for eligibility summary" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_refund_action_metadata",
    description:
      "Fetch Solana Action metadata for refund claim. Optional account adds eligibility summary.",
    inputSchema: {
      type: "object",
      properties: {
        roundId: { type: "integer", minimum: 0 },
        account: { type: "string", description: "Optional wallet pubkey (base58) for eligibility summary" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "join_round_usdc",
    description: "Build unsigned tx to join a round with USDC using roll2roll Actions API.",
    inputSchema: {
      type: "object",
      properties: {
        account: { type: "string", description: "User wallet pubkey (base58)" },
        amount: { type: "number", exclusiveMinimum: 0, description: "USDC amount" },
        roundId: { type: "integer", minimum: 0, description: "Optional; latest open round is auto-selected if omitted" },
      },
      required: ["account", "amount"],
      additionalProperties: false,
    },
  },
  {
    name: "open_batch_join",
    description:
      "Return an external-link Action response that opens roll2roll batch deposit flow in-app. Optional legs JSON can prefill batch for agents.",
    inputSchema: {
      type: "object",
      properties: {
        account: { type: "string", description: "User wallet pubkey (base58)" },
        roundId: { type: "integer", minimum: 0 },
        legs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              mint: { type: "string" },
              amount: { type: "number", exclusiveMinimum: 0 },
            },
            required: ["mint", "amount"],
            additionalProperties: false,
          },
        },
      },
      required: ["account"],
      additionalProperties: false,
    },
  },
  {
    name: "claim_prize",
    description: "Build unsigned tx for classic USDC prize claim.",
    inputSchema: {
      type: "object",
      properties: {
        account: { type: "string", description: "Winner wallet pubkey (base58)" },
        roundId: { type: "integer", minimum: 0 },
      },
      required: ["account"],
      additionalProperties: false,
    },
  },
  {
    name: "open_degen_claim",
    description:
      "Return an external-link Action response that opens the existing lite degen claim flow in-app (2-step: claim + Jupiter swap).",
    inputSchema: {
      type: "object",
      properties: {
        account: { type: "string", description: "Winner wallet pubkey (base58)" },
        roundId: { type: "integer", minimum: 0 },
      },
      required: ["account"],
      additionalProperties: false,
    },
  },
  {
    name: "claim_refund",
    description: "Build unsigned tx for cancelled-round refund claim.",
    inputSchema: {
      type: "object",
      properties: {
        account: { type: "string", description: "User wallet pubkey (base58)" },
        roundId: { type: "integer", minimum: 0 },
      },
      required: ["account"],
      additionalProperties: false,
    },
  },
];

async function handleToolCall(name, args) {
  switch (name) {
    case "get_current_round":
      return textToolResult(await callAction("GET", "/round"));
    case "get_join_action_metadata":
      return textToolResult(await callAction("GET", "/join", { query: { roundId: args?.roundId } }));
    case "get_claim_action_metadata":
      return textToolResult(
        await callAction("GET", "/claim", { query: { roundId: args?.roundId, account: args?.account } })
      );
    case "get_join_batch_action_metadata":
      return textToolResult(await callAction("GET", "/join-batch", { query: { roundId: args?.roundId } }));
    case "get_degen_claim_action_metadata":
      return textToolResult(
        await callAction("GET", "/claim-degen", { query: { roundId: args?.roundId, account: args?.account } })
      );
    case "get_refund_action_metadata":
      return textToolResult(
        await callAction("GET", "/claim-refund", { query: { roundId: args?.roundId, account: args?.account } })
      );
    case "join_round_usdc":
      return textToolResult(
        await callAction("POST", "/join", {
          query: { amount: args.amount, roundId: args.roundId },
          body: { account: args.account },
        })
      );
    case "open_batch_join":
      return textToolResult(
        await callAction("POST", "/join-batch", {
          query: {
            roundId: args.roundId,
            legs: Array.isArray(args.legs) ? JSON.stringify(args.legs) : undefined,
          },
          body: { account: args.account },
        })
      );
    case "claim_prize":
      return textToolResult(
        await callAction("POST", "/claim", {
          query: { roundId: args.roundId },
          body: { account: args.account },
        })
      );
    case "open_degen_claim":
      return textToolResult(
        await callAction("POST", "/claim-degen", {
          query: { roundId: args.roundId },
          body: { account: args.account },
        })
      );
    case "claim_refund":
      return textToolResult(
        await callAction("POST", "/claim-refund", {
          query: { roundId: args.roundId },
          body: { account: args.account },
        })
      );
    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { code: "UNKNOWN_TOOL" });
  }
}

async function onRequest(msg) {
  const { id, method, params } = msg;

  if (method === "initialize") {
    return sendResult(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: {
        name: "roll2roll-actions-mcp-proxy",
        version: "0.1.0",
      },
    });
  }

  if (method === "notifications/initialized") {
    return; // no-op notification
  }

  if (method === "tools/list") {
    return sendResult(id, { tools: TOOLS });
  }

  if (method === "tools/call") {
    try {
      const result = await handleToolCall(params?.name, params?.arguments ?? {});
      return sendResult(id, result);
    } catch (e) {
      return sendError(
        id,
        -32001,
        e?.message || "Tool execution failed",
        e?.payload ? { payload: e.payload, status: e.status } : undefined
      );
    }
  }

  return sendError(id, -32601, `Method not found: ${method}`);
}

let inputBuffer = Buffer.alloc(0);

function tryParseFrames() {
  while (true) {
    const headerEnd = inputBuffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;

    const header = inputBuffer.subarray(0, headerEnd).toString("utf8");
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      inputBuffer = Buffer.alloc(0);
      return;
    }
    const bodyLen = Number(match[1]);
    const frameLen = headerEnd + 4 + bodyLen;
    if (inputBuffer.length < frameLen) return;

    const body = inputBuffer.subarray(headerEnd + 4, frameLen).toString("utf8");
    inputBuffer = inputBuffer.subarray(frameLen);

    let msg;
    try {
      msg = JSON.parse(body);
    } catch (e) {
      sendError(null, -32700, "Parse error", { bodyPreview: body.slice(0, 200) });
      continue;
    }

    Promise.resolve(onRequest(msg)).catch((e) => {
      if (msg?.id !== undefined) sendError(msg.id, -32000, e?.message || "Internal error");
    });
  }
}

process.stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  tryParseFrames();
});

process.stdin.on("end", () => process.exit(0));
process.stdin.resume();
