/** Credit/cost usage block returned by synchronous endpoints. */
export interface Usage {
  cost: number;
  credits: number;
  remainingBalance?: number;
  remainingPoints?: number;
}

/** Per-request overrides accepted by every SDK method. */
export interface RequestOptions {
  /** Abort the request (and any polling) via an AbortSignal. */
  signal?: AbortSignal;
  /** Per-request timeout in ms (overrides the client default). */
  timeout?: number;
  /** Per-request max retries (overrides the client default). */
  maxRetries?: number;
  /** Extra headers merged into the request. */
  headers?: Record<string, string>;
  /**
   * For a POST: the `Idempotency-Key` to send. The SDK generates one per call
   * when this is not set, and sends the same key on every retry of that call,
   * so a retried request is run (and charged) once. Pass your own to make a
   * call safe to repeat across processes or restarts: the server answers a
   * repeat of a finished call with its first reply for 24 hours.
   */
  idempotencyKey?: string;
}

/** Minimal structural type for a fetch Response (keeps the SDK runtime-agnostic). */
export interface FetchResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  /**
   * The raw body, for the streaming surfaces (agency runs). Optional so an
   * injected non-streaming fetch — a test double, an older polyfill — still
   * satisfies this type; the streaming code checks for it and errors clearly
   * rather than assuming it is there.
   */
  body?: ReadableStream<Uint8Array> | null;
}

/** Minimal structural type for fetch init options. */
export interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | FormData;
  signal?: AbortSignal;
}

/** Injectable fetch implementation (defaults to global fetch on Node 18+). */
export type FetchLike = (url: string, init?: FetchInit) => Promise<FetchResponse>;
