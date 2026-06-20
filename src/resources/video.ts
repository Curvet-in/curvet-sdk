import type { HttpClient } from "../core/http";
import type { MediaJob, VideoGenerateParams, PollOptions } from "../types/job";
import type { RequestOptions } from "../types/common";
import { normalizeMediaPost } from "../core/normalize";
import { Job, type JobDefaults } from "./jobs";
import { CurvetError } from "../core/errors";

/**
 * Video generation. Backed by an async job queue: `generate()` submits and
 * polls to completion (the common case); `submit()` fires and returns the job
 * handle for manual polling.
 *
 * The same implementation backs audio and 3D (v1.1) via the `path` arg.
 */
export class Video {
  constructor(
    private client: HttpClient,
    private defaults: JobDefaults,
    private path: string = "/video",
  ) {}

  /**
   * Submit a job WITHOUT polling. Returns once the server responds — either the
   * 200 fast-path (already done) or a 202 with a jobId.
   *
   * The media POST long-polls server-side and can block well past a normal
   * request timeout, so we default its timeout to the poll budget and disable
   * auto-retry (a retried POST would enqueue a duplicate, double-charged job).
   */
  async submit(params: VideoGenerateParams, options?: RequestOptions): Promise<MediaJob> {
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

  /**
   * Submit and resolve to the finished media. Handles the 200-vs-202 split and
   * polls `/jobs/:id` internally. Throws JobFailedError / JobTimeoutError.
   */
  async generate(
    params: VideoGenerateParams,
    options?: RequestOptions & PollOptions,
  ): Promise<MediaJob> {
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
