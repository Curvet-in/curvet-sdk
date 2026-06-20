import type { HttpClient } from "../core/http";
import type { MediaJob, PollOptions } from "../types/job";
import type { RequestOptions } from "../types/common";
import { normalizeMediaPost } from "../core/normalize";
import { Job, type JobDefaults } from "./jobs";
import { CurvetError } from "../core/errors";

export interface MediaParamsBase {
  model: string;
  prompt: string;
  [key: string]: unknown;
}

/**
 * Generic engine for the async media endpoints (video / audio / 3d). They all
 * enqueue the same server-side job queue, so they share one implementation
 * parameterized by `path` and request param type.
 *
 * `generate()` submits and polls to completion; `submit()` fires without polling.
 */
export class MediaResource<P extends MediaParamsBase> {
  constructor(
    protected client: HttpClient,
    protected defaults: JobDefaults,
    protected path: string,
  ) {}

  /**
   * Submit WITHOUT polling. The media POST long-polls server-side and can block
   * well past a normal request timeout, so we default its timeout to the poll
   * budget and disable auto-retry (a retried POST would enqueue a duplicate job).
   */
  async submit(params: P, options?: RequestOptions): Promise<MediaJob> {
    const reqOptions: RequestOptions = {
      ...options,
      timeout: options?.timeout ?? this.defaults.pollTimeoutMs,
      maxRetries: options?.maxRetries ?? 0,
    };
    const body = await this.client.request({
      method: "POST",
      path: this.path,
      body: params,
      options: reqOptions,
    });
    return normalizeMediaPost(body);
  }

  /** Submit and resolve to the finished media (auto-polls /jobs/:id). */
  async generate(params: P, options?: RequestOptions & PollOptions): Promise<MediaJob> {
    const submitted = await this.submit(params, options);
    if (submitted.status === "completed" || submitted.status === "failed") {
      return submitted;
    }
    if (!submitted.jobId) {
      throw new CurvetError("Async job did not return a jobId to poll", {
        raw: submitted.raw,
      });
    }
    const job = new Job(submitted.jobId, this.client, this.defaults);
    return job.wait({
      pollIntervalMs: options?.pollIntervalMs,
      pollTimeoutMs: options?.pollTimeoutMs,
      signal: options?.signal,
      onProgress: options?.onProgress,
    });
  }
}
