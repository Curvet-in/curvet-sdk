import { describe, it, expect } from "vitest";
import { Curvet } from "../src";

/**
 * Live contract canary. Skipped unless CURVET_TEST_APP_KEY is set, so normal
 * `npm test` (and CI without the secret) never hits the network or spends credits.
 * Run with: CURVET_TEST_APP_KEY=cvt_app_xxx npm test
 */
const KEY = process.env.CURVET_TEST_APP_KEY;

describe.skipIf(!KEY)("live integration (real gateway)", () => {
  // Constructed lazily: skipIf still evaluates this body to collect tests,
  // so only build the client when a key is actually present.
  const curvet = KEY ? new Curvet({ appKey: KEY }) : (null as unknown as Curvet);

  it("lists models", async () => {
    const models = await curvet.models.list();
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
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
