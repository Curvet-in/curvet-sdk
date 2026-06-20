import type { MediaJob, JobStatus } from "../types/job";

/**
 * The API returns the output URL under three different keys depending on the
 * endpoint: `videoUrl` (/video), `audioUrl` (/audio), `modelUrl` (/3d), and
 * `output.mediaUrl` (GET /jobs/:id). Unify them.
 */
function pickMediaUrl(body: Record<string, any>): string | undefined {
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
 */
export function normalizeMediaPost(body: unknown): MediaJob {
  const b = (body ?? {}) as Record<string, any>;
  const mediaUrl = pickMediaUrl(b);
  const jobId = b.jobId ?? b.metadata?.jobId;
  const status: JobStatus = mediaUrl
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
    error: b.error ?? null,
    raw: body,
  };
}

/** Normalize a GET /jobs/:id response. */
export function normalizeJob(body: unknown): MediaJob {
  const b = (body ?? {}) as Record<string, any>;
  const mediaUrl = pickMediaUrl(b);
  const status: JobStatus = (b.status as JobStatus) ?? (mediaUrl ? "completed" : "processing");
  return {
    jobId: b.jobId,
    status,
    progress: b.progress,
    mediaUrl,
    metadata: b.output?.metadata ?? b.metadata,
    error: b.error ?? null,
    cost: b.cost,
    eta: b.eta,
    raw: body,
  };
}
