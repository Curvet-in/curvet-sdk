/** Exponential backoff with full jitter. */
export function fullJitterBackoff(attempt: number, baseMs = 500, capMs = 8000): number {
  const exp = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.random() * exp;
}

/** Sleep that rejects with an AbortError if the signal fires. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function abortError(): Error {
  const e = new Error("The operation was aborted.");
  e.name = "AbortError";
  return e;
}

/** Only 429 and 5xx are safe to retry. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * A 409 that says an earlier attempt with the same Idempotency-Key is still
 * running (typically the attempt that timed out on our side). Retrying with the
 * same key returns that attempt's result once it finishes, without running it again.
 */
export function isIdempotencyInProgress(status: number, body: unknown): boolean {
  if (status !== 409 || !body || typeof body !== "object") return false;
  const b = body as Record<string, any>;
  const code = b.code ?? (b.error && typeof b.error === "object" ? b.error.code : undefined);
  return code === "idempotency_key_in_use";
}
