import type { FetchLike, RequestOptions } from "../types/common";
import {
  CurvetError,
  ConnectionError,
  RateLimitError,
  errorFromResponse,
} from "./errors";
import { fullJitterBackoff, isRetryableStatus, sleep } from "./retry";

export interface HttpClientOptions {
  appKey: string;
  baseURL: string;
  timeout: number;
  maxRetries: number;
  fetch: FetchLike;
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
      "x-app-key": this.opts.appKey,
      accept: "application/json",
      ...(options?.headers ?? {}),
    };
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

        const requestId =
          res.headers.get("x-request-id") ??
          (parsed as any)?.metadata?.requestId ??
          undefined;
        const err = errorFromResponse(res.status, parsed, requestId, res.headers);

        if (isRetryableStatus(res.status) && attempt < maxRetries) {
          await this.backoff(err, attempt, options?.signal);
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

  private async backoff(err: CurvetError | undefined, attempt: number, signal?: AbortSignal) {
    let delay = fullJitterBackoff(attempt);
    if (err instanceof RateLimitError && err.retryAfterMs != null) {
      delay = Math.min(err.retryAfterMs, 30000);
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

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
