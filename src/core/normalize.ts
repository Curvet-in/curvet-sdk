import type { MediaJob, JobStatus } from "../types/job";

type Obj = Record<string, any>;
const asObj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});

/**
 * The keys a finished POST /video, /audio or /3d puts its output URL under:
 * its own (`videoUrl` / `audioUrl` / `modelUrl`) and, on current servers, the
 * same URL as `mediaUrl`.
 */
const POST_URL_KEYS = ["mediaUrl", "videoUrl", "audioUrl", "modelUrl"] as const;

/**
 * The API returns the output URL under several keys depending on the endpoint:
 * `mediaUrl` (current servers, on /video, /audio and /3d), `videoUrl` (/video),
 * `audioUrl` (/audio), `modelUrl` (/3d), and `output.mediaUrl` (GET /jobs/:id).
 * Unify them. A null URL (a job that finished without one) reads as undefined.
 */
function pickMediaUrl(body: Obj): string | undefined {
  return (
    body?.videoUrl ??
    body?.audioUrl ??
    body?.modelUrl ??
    body?.output?.mediaUrl ??
    body?.mediaUrl ??
    undefined
  );
}

/**
 * Normalize a POST /video|/audio|/3d response, which is EITHER a 200 with the
 * final media URL (job already done) OR a 202 with just a `jobId` to poll.
 *
 * A 200 always carries its URL key, null when the job finished without an
 * output; a 202 never does. So the key's presence, not its value, says the job
 * is done: a finished job with a null URL is "completed", not "processing".
 */
export function normalizeMediaPost(body: unknown): MediaJob {
  const b = asObj(body);
  const mediaUrl = pickMediaUrl(b);
  const finished =
    mediaUrl !== undefined || POST_URL_KEYS.some((k) => Object.prototype.hasOwnProperty.call(b, k));
  const jobId = b.jobId ?? b.metadata?.jobId;
  const status: JobStatus = finished
    ? "completed"
    : b.status === "failed"
      ? "failed"
      : "processing";
  return {
    jobId,
    status,
    mediaUrl,
    usage: b.usage,
    metadata: b.metadata,
    outputMetadata: b.outputMetadata,
    message: b.message,
    statusUrl: b.statusUrl,
    estimatedWaitTime: b.estimatedWaitTime,
    error: b.error ?? null,
    raw: body,
  };
}

/** Normalize a GET /jobs/:id response. */
export function normalizeJob(body: unknown): MediaJob {
  const b = asObj(body);
  const mediaUrl = pickMediaUrl(b);
  const status: JobStatus = (b.status as JobStatus) ?? (mediaUrl ? "completed" : "processing");
  return {
    jobId: b.jobId,
    status,
    progress: b.progress,
    mediaUrl,
    thumbnailUrl: b.output?.thumbnailUrl,
    // `metadata` stays what it always was here (the provider's output
    // metadata); `outputMetadata` names it the same way the POST reply does.
    metadata: b.output?.metadata ?? b.metadata,
    outputMetadata: b.output?.metadata,
    error: b.error ?? null,
    stepError: b.stepError,
    faultKind: b.faultKind,
    faultRetryable: b.faultRetryable,
    cost: b.cost,
    eta: b.eta,
    type: b.type,
    model: b.model,
    pollCount: b.pollCount,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    raw: body,
  };
}
