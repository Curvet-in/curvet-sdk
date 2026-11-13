import type { FetchLike, RequestOptions } from "../types/common";
import {
  CurvetError,
  ConnectionError,
  RateLimitError,
  errorFromResponse,
} from "./errors";
import { fullJitterBackoff, isIdempotencyInProgress, isRetryableStatus, sleep } from "./retry";

const IDEMPOTENCY_HEADER = "idempotency-key";

/**
 * How long a POST keeps asking with its key after a timeout or a 409
 * `idempotency_key_in_use`, by default: long enough for a slow image (60–90 s)
 * or a short job to finish on the server, short enough not to hang a caller
 * for many minutes.
 */
export const DEFAULT_IDEMPOTENCY_WAIT_MS = 120_000;

/** Pause between asks while the server says the call is still running, when it gives no Retry-After. */
const IN_PROGRESS_PAUSE_MS = 1_000;

export interface HttpClientOptions {
  appKey: string;
  baseURL: string;
  timeout: number;
  maxRetries: number;
  fetch: FetchLike;
  /** Header carrying the credential (default "x-app-key"; enterprise uses "x-enterprise-key"). */
  authHeaderName?: string;
  /** See {@link DEFAULT_IDEMPOTENCY_WAIT_MS}; 0 turns the wait off. */
  idempotencyWaitMs?: number;
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
    let idempotencyKey: string | undefined;
    if (method.toUpperCase() === "POST") {
      const passed = Object.keys(headers).find((h) => h.toLowerCase() === IDEMPOTENCY_HEADER);
      idempotencyKey = options?.idempotencyKey || (passed ? headers[passed] : "") || newIdempotencyKey();
      if (passed) delete headers[passed];
      headers[IDEMPOTENCY_HEADER] = idempotencyKey;
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

    try {
      const result = await this.send<T>({ url, method, headers, payload, options, maxRetries, timeout, idempotencyKey });
      // Where the reply has a metadata block, the key goes in it: the call can
      // be asked for again, with the same key, for 24 hours.
      if (idempotencyKey) {
        const meta = (result as any)?.metadata;
        if (meta && typeof meta === "object" && !Array.isArray(meta)) meta.idempotencyKey = idempotencyKey;
      }
      return result;
    } catch (e: any) {
      // Every error this call throws carries its key, so the caller can retry
      // with it and get the result of a call that completed after we gave up.
      if (idempotencyKey && e && typeof e === "object") e.idempotencyKey = idempotencyKey;
      throw e;
    }
  }

  private async send<T>(a: {
    url: string;
    method: string;
    headers: Record<string, string>;
    payload: string | FormData | undefined;
    options?: RequestOptions;
    maxRetries: number;
    timeout: number;
    idempotencyKey?: string;
  }): Promise<T> {
    const { url, method, headers, payload, options, maxRetries, timeout, idempotencyKey } = a;
    const signalOf = options?.signal;

    // After a timeout or a "still running" answer, a keyed POST keeps asking
    // with the same key until this deadline instead of spending maxRetries:
    // the server either answers the first attempt's result (a replay), says it
    // is still running, or — when that attempt was refunded — runs it once more.
    const waitMs = options?.idempotencyWaitMs ?? this.opts.idempotencyWaitMs ?? DEFAULT_IDEMPOTENCY_WAIT_MS;
    let waitUntil: number | undefined;
    const mayKeepAsking = (): boolean => {
      if (!idempotencyKey || !(waitMs > 0)) return false;
      if (waitUntil === undefined) waitUntil = Date.now() + waitMs;
      return Date.now() < waitUntil;
    };
    const untilDeadline = (ms: number) => Math.max(0, Math.min(ms, (waitUntil ?? Date.now()) - Date.now()));

    let attempt = 0;
    for (;;) {
      const { signal, done } = this.makeSignal(timeout, signalOf);
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

        if (isIdempotencyInProgress(res.status, parsed)) {
          if (mayKeepAsking()) {
            await sleep(untilDeadline(retryAfterMs(res.headers) ?? IN_PROGRESS_PAUSE_MS), signalOf);
            continue;
          }
          // The wait is off (no key, or idempotencyWaitMs 0): an ordinary retry.
          if (!(waitMs > 0) && attempt < maxRetries) {
            await this.backoff(err, attempt, signalOf, retryAfterMs(res.headers));
            attempt++;
            continue;
          }
          throw err;
        }
        if (isRetryableStatus(res.status) && attempt < maxRetries) {
          await this.backoff(err, attempt, signalOf);
          attempt++;
          continue;
        }
        throw err;
      } catch (e: any) {
        if (e instanceof CurvetError) throw e;
        // AbortError: distinguish user-abort (rethrow) from our timeout (retry/ConnectionError).
        if (e?.name === "AbortError") {
          if (signalOf?.aborted) throw e;
          // Our timeout. The call may still be running on the server: ask again
          // with the same key until the deadline.
          if (mayKeepAsking()) {
            await sleep(untilDeadline(fullJitterBackoff(0)), signalOf);
            continue;
          }
          if (waitUntil === undefined && attempt < maxRetries) {
            await this.backoff(undefined, attempt, signalOf);
            attempt++;
            continue;
          }
          throw new ConnectionError("Request timed out", { raw: e });
        }
        // Network error before any response — safe to retry.
        if (attempt < maxRetries) {
          await this.backoff(undefined, attempt, signalOf);
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
