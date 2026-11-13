import type { ModelId } from "./models";
import type { Usage } from "./common";
import type { StepError } from "./errors";

/**
 * Where a media job is. `"queued"` comes back from `jobs.retrieve()` for a job
 * that has not started yet; it is not terminal, so polling carries on.
 */
export type JobStatus = "queued" | "processing" | "completed" | "failed";

export type MediaKind = "video" | "audio" | "3d";

/**
 * What a job cost, in USD. Present on a job read back from `jobs.retrieve()`,
 * where `usage` is not — the credit reservation is settled against the job
 * record rather than reported per response, so this is the only cost a poller
 * ever sees.
 */
export interface JobCost {
  /** The list price at creation, reserved against the balance. Always sent. */
  estimated: number;
  /** Settled once the job finished; null until then. Equals `estimated` for flat-rate models. */
  actual?: number | null;
  /** USD still held (credits / 100); the difference is released when the job settles. Always sent. */
  reserved: number;
  [key: string]: unknown;
}

/**
 * Usage on a media reply that finished while the request waited (the 200 of
 * `/video`, `/audio`, `/3d`). Not on a job read back from `jobs.retrieve()` —
 * see {@link MediaJob.cost} there.
 */
export interface MediaUsage extends Usage {
  /**
   * `/audio` only, when long text was spoken in parts: how many (each one a
   * provider call, priced as one). `cost` and `credits` are then what the job
   * reserved.
   */
  parts?: number;
  /**
   * USD the owner can still spend: wallet plus points. Not the same figure as
   * `remainingBalance` on chat and image, which is the wallet alone.
   */
  remainingBalance?: number;
}

/**
 * Unified media-job result. The raw API uses three different URL keys
 * (`videoUrl`/`audioUrl`/`modelUrl`) and a 200-vs-202 split; this normalizes
 * all of them to a single shape with `mediaUrl`. Everything the server sent is
 * also in `raw`.
 */
export interface MediaJob {
  jobId?: string;
  status: JobStatus;
  progress?: number;
  /**
   * Final media URL once completed (video/audio/3d output). Undefined while the
   * job runs, and on a job that finished without an output URL.
   */
  mediaUrl?: string;
  /** A preview image of the output, where the provider made one (`jobs.retrieve()` only). */
  thumbnailUrl?: string | null;
  /** On a reply that finished while the request waited (`submit()` / `generate()` 200). */
  usage?: MediaUsage;
  /**
   * On a submit that finished while the request waited: the call's own facts
   * (`model`, `jobId`, `latencyMs`). On a job read back from `jobs.retrieve()`:
   * the provider's metadata for the output, as before (also in
   * {@link outputMetadata}).
   */
  metadata?: Record<string, unknown>;
  /**
   * The provider's metadata for the output (duration, resolution, format, …;
   * keys vary by provider). Absent while the job has no output.
   */
  outputMetadata?: Record<string, unknown>;
  /** Only when failed: the sentence to show. null otherwise. */
  error?: string | null;
  /** Failed jobs only: the structured error (code, retryable, provider, …). */
  stepError?: StepError | null;
  /** Failed jobs only: the server's classification (billing, throttled, content_policy, …). */
  faultKind?: string | null;
  /** Failed jobs only: whether submitting again can succeed. */
  faultRetryable?: boolean | null;
  /** USD cost of the job. See {@link JobCost} — this, not `usage`, is what polling returns. */
  cost?: JobCost;
  /** When the provider expects the job to finish (ISO 8601), when it gave one; null otherwise. */
  eta?: string | null;
  /** What kind of job this is (`jobs.retrieve()` only). */
  type?: MediaKind;
  /** The model the job runs (`jobs.retrieve()` only). */
  model?: string;
  /** How many times the job has been read (`jobs.retrieve()` only). */
  pollCount?: number;
  /** ISO 8601 (`jobs.retrieve()` only). */
  createdAt?: string;
  /** ISO 8601 (`jobs.retrieve()` only). */
  updatedAt?: string;
  /**
   * On a submit still running after the server's 30-second wait (202): what
   * the server said, e.g. "Video is being generated".
   */
  message?: string;
  /** On a 202: the job's status path on the server (`/api/v1/playground/jobs/<id>`), not a full URL. */
  statusUrl?: string;
  /** On a 202: the server's rough wait, e.g. "1-3 minutes". */
  estimatedWaitTime?: string;
  /** The raw, unnormalized response body. */
  raw: unknown;
}

export interface VideoGenerateParams {
  model: ModelId;
  prompt: string;
  mode?: "text_to_video" | "image_to_video";
  duration?: number;
  resolution?: string;
  [key: string]: unknown;
}

export interface AudioGenerateParams {
  model: ModelId;
  prompt: string;
  voice?: string;
  [key: string]: unknown;
}

export interface ThreeDGenerateParams {
  model: ModelId;
  prompt: string;
  [key: string]: unknown;
}

export interface PollOptions {
  /** Poll interval in ms (default 2500). */
  pollIntervalMs?: number;
  /** Total poll timeout in ms before throwing JobTimeoutError (default 180000). */
  pollTimeoutMs?: number;
  signal?: AbortSignal;
  /** Called on each poll tick with progress (0-100) and ETA if available. */
  onProgress?: (progress: number, eta?: string) => void;
}
