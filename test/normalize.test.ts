import { describe, it, expect } from "vitest";
import { normalizeMediaPost, normalizeJob } from "../src/core/normalize";

describe("normalizeMediaPost", () => {
  it("video 200 (with the duplicate-metadata server quirk) -> mediaUrl from videoUrl", () => {
    const body = {
      success: true,
      videoUrl: "https://cdn/x/v.mp4",
      usage: { cost: 0.09, credits: 9 },
      metadata: { model: "wan-2.2", jobId: "job_1", latencyMs: 100 },
    };
    const n = normalizeMediaPost(body);
    expect(n.status).toBe("completed");
    expect(n.mediaUrl).toBe("https://cdn/x/v.mp4");
    expect(n.jobId).toBe("job_1");
  });

  it("audio 200 -> mediaUrl from audioUrl", () => {
    expect(normalizeMediaPost({ audioUrl: "https://cdn/a.mp3" }).mediaUrl).toBe("https://cdn/a.mp3");
  });

  it("3d 200 -> mediaUrl from modelUrl", () => {
    expect(normalizeMediaPost({ modelUrl: "https://cdn/m.glb" }).mediaUrl).toBe("https://cdn/m.glb");
  });

  it("202 processing -> jobId, no mediaUrl", () => {
    const n = normalizeMediaPost({
      success: true,
      jobId: "job_2",
      statusUrl: "/api/v1/playground/jobs/job_2",
      estimatedWaitTime: "1-3 minutes",
      message: "Video is being generated",
    });
    expect(n.status).toBe("processing");
    expect(n.jobId).toBe("job_2");
    expect(n.mediaUrl).toBeUndefined();
  });
});

describe("normalizeJob", () => {
  it("reads output.mediaUrl and status", () => {
    const n = normalizeJob({
      success: true,
      jobId: "j",
      status: "completed",
      progress: 100,
      output: { mediaUrl: "https://cdn/o.mp4", metadata: { format: "mp4" } },
      error: null,
    });
    expect(n.status).toBe("completed");
    expect(n.mediaUrl).toBe("https://cdn/o.mp4");
    expect(n.metadata).toEqual({ format: "mp4" });
    expect(n.progress).toBe(100);
  });

  it("surfaces failure status and error", () => {
    const n = normalizeJob({ success: true, jobId: "j", status: "failed", error: "boom" });
    expect(n.status).toBe("failed");
    expect(n.error).toBe("boom");
  });
});
