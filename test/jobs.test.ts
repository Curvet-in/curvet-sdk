import { describe, it, expect } from "vitest";
import { Curvet, JobFailedError, JobTimeoutError } from "../src";
import { mockFetch } from "./helpers";

describe("video.generate (async auto-poll)", () => {
  it("returns immediately on a fast 200 (no polling)", async () => {
    const fetch = mockFetch(() => ({
      status: 200,
      body: { success: true, videoUrl: "https://cdn/fast.mp4", metadata: { jobId: "j" } },
    }));
    const curvet = new Curvet({ appKey: "k", fetch });
    const res = await curvet.video.generate({ model: "wan-2.2", prompt: "x" });
    expect(res.status).toBe("completed");
    expect(res.mediaUrl).toBe("https://cdn/fast.mp4");
    // one POST, zero /jobs polls
    expect(fetch.calls.filter((c) => c.url.includes("/jobs/")).length).toBe(0);
  });

  it("submits then polls processing -> completed, reporting progress", async () => {
    let polls = 0;
    const fetch = mockFetch((url) => {
      if (url.endsWith("/video")) return { status: 202, body: { success: true, jobId: "job_x" } };
      polls++;
      if (polls < 2) {
        return { status: 200, body: { success: true, jobId: "job_x", status: "processing", progress: 40 } };
      }
      return {
        status: 200,
        body: { success: true, jobId: "job_x", status: "completed", progress: 100, output: { mediaUrl: "https://cdn/done.mp4" } },
      };
    });
    const curvet = new Curvet({ appKey: "k", fetch, defaultPollIntervalMs: 1, defaultPollTimeoutMs: 5000 });
    const progress: number[] = [];
    const res = await curvet.video.generate(
      { model: "wan-2.2", prompt: "x" },
      { onProgress: (p) => progress.push(p) },
    );
    expect(res.status).toBe("completed");
    expect(res.mediaUrl).toBe("https://cdn/done.mp4");
    expect(progress).toContain(100);
  });

  it("throws JobFailedError when the job fails", async () => {
    const fetch = mockFetch((url) => {
      if (url.endsWith("/video")) return { status: 202, body: { success: true, jobId: "job_f" } };
      return { status: 200, body: { success: true, jobId: "job_f", status: "failed", error: "upstream boom" } };
    });
    const curvet = new Curvet({ appKey: "k", fetch, defaultPollIntervalMs: 1 });
    const err = await curvet.video.generate({ model: "wan-2.2", prompt: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(JobFailedError);
    expect(err.jobId).toBe("job_f");
    expect(err.message).toContain("upstream boom");
  });

  it("throws JobTimeoutError (carrying jobId) when it never completes", async () => {
    const fetch = mockFetch((url) => {
      if (url.endsWith("/video")) return { status: 202, body: { success: true, jobId: "job_t" } };
      return { status: 200, body: { success: true, jobId: "job_t", status: "processing", progress: 10 } };
    });
    const curvet = new Curvet({ appKey: "k", fetch, defaultPollIntervalMs: 1, defaultPollTimeoutMs: 15 });
    const err = await curvet.video.generate({ model: "wan-2.2", prompt: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(JobTimeoutError);
    expect(err.jobId).toBe("job_t");
  });

  it("submit() does not poll", async () => {
    const fetch = mockFetch(() => ({ status: 202, body: { success: true, jobId: "job_s" } }));
    const curvet = new Curvet({ appKey: "k", fetch });
    const job = await curvet.video.submit({ model: "wan-2.2", prompt: "x" });
    expect(job.status).toBe("processing");
    expect(job.jobId).toBe("job_s");
    expect(fetch.calls.length).toBe(1);
  });
});
