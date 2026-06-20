import type { HttpClient } from "../core/http";
import type { MediaJob, PollOptions } from "../types/job";
import type { RequestOptions } from "../types/common";
import { normalizeJob } from "../core/normalize";
import { pollUntil, PollTimeoutError } from "../core/poll";
import { JobFailedError, JobTimeoutError } from "../core/errors";

export interface JobDefaults {
  pollIntervalMs: number;
  pollTimeoutMs: number;
}

export class Jobs {
  constructor(
    private client: HttpClient,
    private defaults: JobDefaults,
  ) {}

  /** Fetch the current status of an async job once (no polling). */
  async retrieve(jobId: string, options?: RequestOptions): Promise<MediaJob> {
    const body = await this.client.request({
      method: "GET",
      path: `/jobs/${encodeURIComponent(jobId)}`,
      options,
    });
    return normalizeJob(body);
  }

  /** Get a {@link Job} handle to poll/await an existing job by id. */
  handle(jobId: string): Job {
    return new Job(jobId, this.client, this.defaults);
  }
}

/** A handle to a single async media job. */
export class Job {
  constructor(
    readonly id: string,
    private client: HttpClient,
    private defaults: JobDefaults,
  ) {}

  /** One status fetch (no polling). */
  retrieve(options?: RequestOptions): Promise<MediaJob> {
    return new Jobs(this.client, this.defaults).retrieve(this.id, options);
  }

  /**
   * Poll until the job reaches a terminal state.
   * Resolves with the completed job, or throws JobFailedError / JobTimeoutError.
   */
  async wait(opts: PollOptions = {}): Promise<MediaJob> {
    const intervalMs = opts.pollIntervalMs ?? this.defaults.pollIntervalMs;
    const timeoutMs = opts.pollTimeoutMs ?? this.defaults.pollTimeoutMs;

    let result: MediaJob;
    try {
      result = await pollUntil(() => this.retrieve({ signal: opts.signal }), {
        intervalMs,
        timeoutMs,
        signal: opts.signal,
        isTerminal: (r) => r.status === "completed" || r.status === "failed",
        onTick: (r) => opts.onProgress?.(r.progress ?? 0, r.eta),
      });
    } catch (e) {
      if (e instanceof PollTimeoutError) {
        throw new JobTimeoutError(
          `Job ${this.id} did not complete within ${timeoutMs}ms`,
          this.id,
        );
      }
      throw e;
    }

    if (result.status === "failed") {
      throw new JobFailedError(result.error || `Job ${this.id} failed`, this.id, {
        raw: result.raw,
      });
    }
    return result;
  }
}
