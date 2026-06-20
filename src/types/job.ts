import type { ModelId } from "./models";
import type { Usage } from "./common";

export type JobStatus = "processing" | "completed" | "failed";

export type MediaKind = "video" | "audio" | "3d";

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
  cost?: unknown;
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

export interface PollOptions {
  /** Poll interval in ms (default 2500). */
  pollIntervalMs?: number;
  /** Total poll timeout in ms before throwing JobTimeoutError (default 180000). */
  pollTimeoutMs?: number;
  signal?: AbortSignal;
  /** Called on each poll tick with progress (0-100) and ETA if available. */
  onProgress?: (progress: number, eta?: string) => void;
}
