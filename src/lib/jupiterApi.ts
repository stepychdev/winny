const JUPITER_API_BASE = "https://api.jup.ag";
const API_KEY = (import.meta.env.VITE_JUPITER_API_KEY || "").trim();

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RETRIES = 2;

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export class JupiterApiError extends Error {
  status: number;
  code: string | number;
  retryable: boolean;

  constructor(message: string, status: number, code: string | number, retryable: boolean) {
    super(message);
    this.name = "JupiterApiError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

interface JupiterRequestOptions {
  method?: HttpMethod;
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeBackoffMs(attempt: number): number {
  const base = 250;
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(base * 2 ** attempt + jitter, 2_500);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function parseErrorPayload(raw: string): { message: string; code?: string | number } {
  if (!raw) return { message: "Unknown Jupiter error" };
  try {
    const parsed = JSON.parse(raw) as { message?: string; error?: string; code?: string | number };
    return {
      message: parsed.message || parsed.error || raw,
      code: parsed.code,
    };
  } catch {
    return { message: raw };
  }
}

function ensureApiKey(): void {
  if (!API_KEY) {
    throw new JupiterApiError(
      "Missing VITE_JUPITER_API_KEY. Create API key on portal.jup.ag and set it in env.",
      401,
      "MISSING_API_KEY",
      false
    );
  }
}

export async function jupiterFetchJson<T>(
  path: string,
  options: JupiterRequestOptions = {}
): Promise<T> {
  ensureApiKey();

  const method = options.method || "GET";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = Math.max(0, Math.min(options.retries ?? MAX_RETRIES, 5));

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${JUPITER_API_BASE}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });

      if (!response.ok) {
        const raw = await response.text();
        const parsed = parseErrorPayload(raw);
        const retryable = isRetryableStatus(response.status);

        if (retryable && attempt < retries) {
          await sleep(computeBackoffMs(attempt));
          continue;
        }

        // Log only final HTTP failure to avoid noisy logs during retry cycles.
        console.error("[JupiterAPI] HTTP error", {
          path,
          method,
          status: response.status,
          code: parsed.code || response.status,
          message: parsed.message,
        });

        throw new JupiterApiError(
          `Jupiter API error ${response.status}: ${parsed.message}`,
          response.status,
          parsed.code || response.status,
          retryable
        );
      }

      return (await response.json()) as T;
    } catch (error: unknown) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      const isTypeError = error instanceof TypeError;

      if ((isAbort || isTypeError) && attempt < retries) {
        await sleep(computeBackoffMs(attempt));
        continue;
      }

      if (error instanceof JupiterApiError) {
        throw error;
      }

      if (isAbort) {
        console.error("[JupiterAPI] Timeout", { path, method, timeoutMs });
        throw new JupiterApiError(`Jupiter API timeout after ${timeoutMs}ms`, 408, "TIMEOUT", true);
      }

      console.error("[JupiterAPI] Network failure", {
        path,
        method,
        message: error instanceof Error ? error.message : "Unknown Jupiter API failure",
      });
      throw new JupiterApiError(
        error instanceof Error ? error.message : "Unknown Jupiter API failure",
        0,
        "NETWORK_ERROR",
        true
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new JupiterApiError("Jupiter API failed after retries", 0, "RETRIES_EXHAUSTED", true);
}

