import type { ModelId } from "./models";
import type { Usage } from "./common";

export type JobStatus = "processing" | "completed" | "failed";

export type MediaKind = "video" | "audio" | "3d";

/**
 * What a job cost, in USD. Present on a job read back from `jobs.retrieve()`,
 * where `usage` is not — the credit reservation is settled against the job
 * record rather than reported per response, so this is the only cost a poller
 * ever sees.
 */
export interface JobCost {
  /** Quoted up front and reserved against the balance. */
  estimated?: number;
  /** Settled once the job finished; equals `estimated` for flat-rate models. */
  actual?: number;
  /** Still held; the difference is released when the job settles. */
  reserved?: number;
  [key: string]: unknown;
}

/**
 * Unified media-job result. The raw API uses three different URL keys
 * (`videoUrl`/`audioUrl`/`modelUrl`) and a 200-vs-202 split; this normalizes
 * all of them to a single shape with `mediaUrl`.
 */
export interface MediaJob {
  jobId?: string;
  status: JobStatus;
  progress?: number;
  /** Final media URL once completed (image/video/audio/3d output). */
  mediaUrl?: string;
  usage?: Usage;
  metadata?: Record<string, unknown>;
  error?: string | null;
  /** USD cost of the job. See {@link JobCost} — this, not `usage`, is what polling returns. */
  cost?: JobCost;
  eta?: string;
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
