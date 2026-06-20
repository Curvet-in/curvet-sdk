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
}

/** Minimal structural type for a fetch Response (keeps the SDK runtime-agnostic). */
export interface FetchResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/** Minimal structural type for fetch init options. */
export interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

/** Injectable fetch implementation (defaults to global fetch on Node 18+). */
export type FetchLike = (url: string, init?: FetchInit) => Promise<FetchResponse>;
