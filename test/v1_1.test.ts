import { describe, it, expect } from "vitest";
import { Curvet } from "../src";
import { mockFetch } from "./helpers";

describe("audio & 3d (shared media engine)", () => {
  it("audio.generate normalizes audioUrl -> mediaUrl", async () => {
    const fetch = mockFetch(() => ({
      status: 200,
      body: { success: true, audioUrl: "https://cdn/a.mp3", usage: { cost: 0.02, credits: 2 } },
    }));
    const curvet = new Curvet({ appKey: "k", fetch });
    const res = await curvet.audio.generate({ model: "fish-audio", prompt: "hello" });
    expect(res.status).toBe("completed");
    expect(res.mediaUrl).toBe("https://cdn/a.mp3");
    expect(fetch.calls[0].url).toBe("https://curvet.ai/api/v1/playground/audio");
  });

  it("threeD.generate polls 202 -> completed via modelUrl/output.mediaUrl", async () => {
    const fetch = mockFetch((url) => {
      if (url.endsWith("/3d")) return { status: 202, body: { success: true, jobId: "job_3d" } };
      return { status: 200, body: { success: true, jobId: "job_3d", status: "completed", output: { mediaUrl: "https://cdn/m.glb" } } };
    });
    const curvet = new Curvet({ appKey: "k", fetch, defaultPollIntervalMs: 1 });
    const res = await curvet.threeD.generate({ model: "meshy-3d", prompt: "a vase" });
    expect(res.mediaUrl).toBe("https://cdn/m.glb");
    expect(fetch.calls[0].url).toBe("https://curvet.ai/api/v1/playground/3d");
  });
});

describe("analytics", () => {
  it("passes date query params and unwraps analytics", async () => {
    const fetch = mockFetch(() => ({
      status: 200,
      body: { success: true, analytics: { totalRequests: 42, totalCost: 1.5 }, app: { name: "x" } },
    }));
    const curvet = new Curvet({ appKey: "k", fetch });
    const a = await curvet.analytics.get({ startDate: "2026-01-01", endDate: "2026-02-01" });
    expect(a.totalRequests).toBe(42);
    expect(fetch.calls[0].url).toContain("startDate=2026-01-01");
    expect(fetch.calls[0].url).toContain("endDate=2026-02-01");
  });
});

describe("workflows", () => {
  it("sends JSON when no files", async () => {
    const fetch = mockFetch(() => ({ status: 200, body: { success: true, output: { ok: 1 } } }));
    const curvet = new Curvet({ appKey: "k", fetch });
    const res = await curvet.workflows.run("wf123", { inputs: { topic: "ai" } });
    expect(res.success).toBe(true);
    const call = fetch.calls[0];
    expect(call.url).toBe("https://curvet.ai/api/v1/playground/workflows/wf123/run");
    expect(call.init.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(call.init.body).inputs).toEqual({ topic: "ai" });
  });

  it("sends multipart FormData when files are provided", async () => {
    const fetch = mockFetch(() => ({ status: 200, body: { success: true } }));
    const curvet = new Curvet({ appKey: "k", fetch });
    await curvet.workflows.run("wf123", {
      inputs: { a: 1 },
      files: { image: new Blob(["x"], { type: "text/plain" }) },
    });
    const call = fetch.calls[0];
    expect(call.init.body instanceof FormData).toBe(true);
    // content-type is NOT set by us — fetch adds the multipart boundary
    expect(call.init.headers["content-type"]).toBeUndefined();
  });
});

describe("food & voice (v1-root base, not /playground)", () => {
  it("food.search hits /api/v1/food/search with query", async () => {
    const fetch = mockFetch(() => ({ status: 200, body: { success: true, data: [{ name: "Dosa" }] } }));
    const curvet = new Curvet({ appKey: "k", fetch });
    const items = await curvet.food.search("dosa", { limit: 5 });
    expect(items[0].name).toBe("Dosa");
    expect(fetch.calls[0].url).toBe("https://curvet.ai/api/v1/food/search?q=dosa&limit=5");
  });

  it("voice.stt posts multipart audio to /api/v1/voice/stt/public", async () => {
    const fetch = mockFetch(() => ({ status: 200, body: { success: true, text: "hello world" } }));
    const curvet = new Curvet({ appKey: "k", fetch });
    const res = await curvet.voice.stt({ audio: new Uint8Array([1, 2, 3]), filename: "clip.wav" });
    expect(res.text).toBe("hello world");
    const call = fetch.calls[0];
    expect(call.url).toBe("https://curvet.ai/api/v1/voice/stt/public");
    expect(call.init.body instanceof FormData).toBe(true);
  });
});
