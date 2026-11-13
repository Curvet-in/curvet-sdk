import type { FetchLike, RequestOptions } from "../types/common";
import {
  CurvetError,
  ConnectionError,
  RateLimitError,
  errorFromResponse,
} from "./errors";
import { fullJitterBackoff, isIdempotencyInProgress, isRetryableStatus, sleep } from "./retry";

const IDEMPOTENCY_HEADER = "idempotency-key";

export interface HttpClientOptions {
  appKey: string;
  baseURL: string;
  timeout: number;
  maxRetries: number;
  fetch: FetchLike;
  /** Header carrying the credential (default "x-app-key"; enterprise uses "x-enterprise-key"). */
  authHeaderName?: string;
}

export interface RequestArgs {
  method: string;
  path: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  options?: RequestOptions;
}

/**
 * The single place that knows about fetch, headers, base URL, error mapping,
 * and retries. Resources call `request()`; everything else stays mockable.
 */
export class HttpClient {
  constructor(private opts: HttpClientOptions) {}

  async request<T = any>(args: RequestArgs): Promise<T> {
    const { method, path, body, query, options } = args;
    const url = this.buildUrl(path, query);
    const maxRetries = options?.maxRetries ?? this.opts.maxRetries;
    const timeout = options?.timeout ?? this.opts.timeout;

    const headers: Record<string, string> = {
      [this.opts.authHeaderName ?? "x-app-key"]: this.opts.appKey,
      accept: "application/json",
      ...(options?.headers ?? {}),
    };
    // One key per logical POST, set once here — outside the retry loop — so
    // every retry of this call carries the same key and the server runs (and
    // charges) it once. The caller's own key wins: `options.idempotencyKey`,
    // or an Idempotency-Key header they passed.
    if (method.toUpperCase() === "POST") {
      const passed = Object.keys(headers).find((h) => h.toLowerCase() === IDEMPOTENCY_HEADER);
      const key = options?.idempotencyKey || (passed ? headers[passed] : "") || newIdempotencyKey();
      if (passed) delete headers[passed];
      headers[IDEMPOTENCY_HEADER] = key;
    }
    let payload: string | FormData | undefined;
    if (body !== undefined) {
      if (typeof FormData !== "undefined" && body instanceof FormData) {
        // Multipart — let fetch set the content-type (with boundary).
        payload = body;
      } else {
        headers["content-type"] = "application/json";
        payload = JSON.stringify(body);
      }
    }

    let attempt = 0;
    for (;;) {
      const { signal, done } = this.makeSignal(timeout, options?.signal);
      try {
        const res = await this.opts.fetch(url, { method, headers, body: payload, signal });
        const text = await res.text();
        const parsed = text ? safeJson(text) : undefined;

        if (res.ok) return parsed as T;

        // The server sends its id as x-curvet-request-id; x-request-id is
        // what older servers (and proxies) send.
        const requestId =
          res.headers.get("x-curvet-request-id") ??
          res.headers.get("x-request-id") ??
          (parsed as any)?.metadata?.requestId ??
          undefined;
        const err = errorFromResponse(res.status, parsed, requestId, res.headers);

        const inProgress = isIdempotencyInProgress(res.status, parsed);
        if ((isRetryableStatus(res.status) || inProgress) && attempt < maxRetries) {
          await this.backoff(err, attempt, options?.signal, inProgress ? retryAfterMs(res.headers) : undefined);
          attempt++;
          continue;
        }
        throw err;
      } catch (e: any) {
        if (e instanceof CurvetError) throw e;
        // AbortError: distinguish user-abort (rethrow) from our timeout (retry/ConnectionError).
        if (e?.name === "AbortError") {
          if (options?.signal?.aborted) throw e;
          if (attempt < maxRetries) {
            await this.backoff(undefined, attempt, options?.signal);
            attempt++;
            continue;
          }
          throw new ConnectionError("Request timed out", { raw: e });
        }
        // Network error before any response — safe to retry.
        if (attempt < maxRetries) {
          await this.backoff(undefined, attempt, options?.signal);
          attempt++;
          continue;
        }
        throw new ConnectionError(e?.message ?? "Network request failed", { raw: e });
      } finally {
        done();
      }
    }
  }

  private async backoff(
    err: CurvetError | undefined,
    attempt: number,
    signal?: AbortSignal,
    waitMs?: number,
  ) {
    let delay = fullJitterBackoff(attempt);
    if (err instanceof RateLimitError && err.retryAfterMs != null) {
      delay = Math.min(err.retryAfterMs, 30000);
    } else if (waitMs != null) {
      delay = Math.min(waitMs, 30000);
    }
    await sleep(delay, signal);
  }

  private buildUrl(path: string, query?: Record<string, string | number | undefined>) {
    const base = this.opts.baseURL.replace(/\/$/, "");
    let url = base + (path.startsWith("/") ? path : "/" + path);
    if (query) {
      const qs = Object.entries(query)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&");
      if (qs) url += "?" + qs;
    }
    return url;
  }

  /** Combine a per-request timeout with an optional user AbortSignal. */
  private makeSignal(timeout: number, userSignal?: AbortSignal) {
    const controller = new AbortController();
    const onUserAbort = () => controller.abort();
    if (userSignal) {
      if (userSignal.aborted) controller.abort();
      else userSignal.addEventListener("abort", onUserAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeout);
    return {
      signal: controller.signal,
      done: () => {
        clearTimeout(timer);
        userSignal?.removeEventListener("abort", onUserAbort);
      },
    };
  }
}

/**
 * A fresh Idempotency-Key: a v4 UUID. `crypto.randomUUID` where the runtime has
 * it (Node 19+, browsers, Deno, Bun); otherwise built from `getRandomValues`, or
 * from Math.random as a last resort (Node 18 has no global crypto) — a key only
 * has to be unique among one app's calls to one route within a day.
 */
export function newIdempotencyKey(): string {
  const c: any = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Retry-After (seconds) as milliseconds, when present and sane. */
function retryAfterMs(headers: { get(name: string): string | null }): number | undefined {
  const raw = headers.get("retry-after");
  if (raw == null || raw.trim() === "") return undefined;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v * 1000 : undefined;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
