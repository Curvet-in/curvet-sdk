import { sleep } from "./retry";

/** Thrown internally when a poll loop exceeds its timeout. */
export class PollTimeoutError extends Error {
  constructor(message = "Polling timed out") {
    super(message);
    this.name = "PollTimeoutError";
  }
}

export interface PollConfig<T> {
  isTerminal: (result: T) => boolean;
  intervalMs: number;
  timeoutMs: number;
  signal?: AbortSignal;
  onTick?: (result: T) => void;
}

/**
 * Repeatedly call `fn` until `isTerminal` is true (resolves the result) or the
 * timeout elapses (throws PollTimeoutError). Polls immediately, then every
 * `intervalMs`. Honors an AbortSignal between ticks.
 */
export async function pollUntil<T>(fn: () => Promise<T>, cfg: PollConfig<T>): Promise<T> {
  const start = Date.now();
  for (;;) {
    const result = await fn();
    cfg.onTick?.(result);
    if (cfg.isTerminal(result)) return result;
    const elapsed = Date.now() - start;
    if (elapsed >= cfg.timeoutMs) throw new PollTimeoutError();
    const remaining = cfg.timeoutMs - elapsed;
    await sleep(Math.min(cfg.intervalMs, Math.max(0, remaining)), cfg.signal);
  }
}
