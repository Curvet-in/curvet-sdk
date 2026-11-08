import { describe, it, expect } from "vitest";
import { Curvet } from "../src";

/**
 * Live contract canary. Skipped unless CURVET_TEST_APP_KEY is set, so normal
 * `npm test` (and CI without the secret) never hits the network or spends credits.
 * Run with: CURVET_TEST_APP_KEY=cvt_app_xxx npm test
 *
 * CURVET_TEST_BASE_URL points it at another deployment (staging), and
 * CURVET_TEST_EMBEDDING_MODEL turns on the embeddings check, which needs a
 * backend that serves POST /api/v1/embeddings.
 */
const KEY = process.env.CURVET_TEST_APP_KEY;
const BASE_URL = process.env.CURVET_TEST_BASE_URL;
const EMBEDDING_MODEL = process.env.CURVET_TEST_EMBEDDING_MODEL;

describe.skipIf(!KEY)("live integration (real gateway)", () => {
  // Constructed lazily: skipIf still evaluates this body to collect tests,
  // so only build the client when a key is actually present.
  const curvet = KEY ? new Curvet({ appKey: KEY, baseURL: BASE_URL }) : (null as unknown as Curvet);

  it("lists models", async () => {
    const models = await curvet.models.list();
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
  });

  // The catalogue flags are what let a caller tell a TTS model from an ASR one.
  // If the gateway ever stops sending them, `models.list({ capability })` starts
  // silently returning the wrong models — so assert them against the real API.
  it("model catalogue carries the capability flags", async () => {
    const models = await curvet.models.list();
    for (const m of models) {
      expect(m.capability).toBeDefined();
      expect(m.surface).toBe("api");
      expect(m.available).toBe(true);
    }
    const asr = await curvet.models.list({ capability: "transcription" });
    expect(asr.length).toBeGreaterThan(0);
    expect(asr.every((m) => m.endpoint?.includes("/voice/stt"))).toBe(true);
  });

  it("include:'all' is a superset of the runnable catalogue", async () => {
    const runnable = await curvet.models.list();
    const all = await curvet.models.list({ include: "all" });
    expect(all.length).toBeGreaterThanOrEqual(runnable.length);
    expect(all.some((m) => m.comingSoon || m.surface !== "api")).toBe(true);
  });

  // AnalyticsResult drifted from the API once already: the SDK declared a flat
  // shape while the gateway returned nested aggregates, and nothing caught it.
  it("analytics returns the nested aggregate shape", async () => {
    const a = await curvet.analytics.get();
    expect(a.overview).toBeDefined();
    expect(typeof a.overview?.totalRequests).toBe("number");
    expect(Array.isArray(a.modelBreakdown)).toBe(true);
    expect(Array.isArray(a.categoryBreakdown)).toBe(true);
    expect(Array.isArray(a.statusBreakdown)).toBe(true);
    expect(Array.isArray(a.errorBreakdown)).toBe(true);
  });

  it("reads balance", async () => {
    const balance = await curvet.balance.get();
    expect(typeof balance.totalAvailableUSD).toBe("number");
  });

  it("chat.create returns a reply", async () => {
    const r = await curvet.chat.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Reply with exactly: pong" }],
      maxTokens: 20,
    });
    expect(r.response.toLowerCase()).toContain("pong");
  }, 30_000);

  it.skipIf(!EMBEDDING_MODEL)("embeddings.create returns one float vector per input", async () => {
    const r = await curvet.embeddings.create({
      model: EMBEDDING_MODEL!,
      input: ["a red cube", "a blue sphere"],
    });
    expect(r.data).toHaveLength(2);
    expect(r.data.map((d) => d.index)).toEqual([0, 1]);
    expect(r.data[0].embedding.length).toBeGreaterThan(0);
    expect(r.data[0].embedding.length).toBe(r.data[1].embedding.length);
    expect(typeof r.data[0].embedding[0]).toBe("number");
    expect(r.usage.prompt_tokens).toBeGreaterThan(0);
    // Every successful call is charged (there is a per-request minimum), and
    // the body says how much.
    expect(r.x_curvet?.credits_charged).toBeGreaterThan(0);
  }, 30_000);

  it("image.generate returns a URL", async () => {
    const r = await curvet.image.generate({
      model: "flux-2-klein-4b",
      prompt: "a red cube on a white background, product photo",
      size: "1024x1024",
    });
    expect(r.imageUrl).toMatch(/^https?:\/\//);
  }, 120_000);

  it("video.generate auto-polls to a completed media URL", async () => {
    const r = await curvet.video.generate({
      model: "wan-2.2",
      prompt: "a calm ocean wave at sunset, cinematic",
    });
    expect(r.status).toBe("completed");
    expect(r.mediaUrl).toMatch(/^https?:\/\//);
  }, 240_000);
});
