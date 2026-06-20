import { describe, it, expect } from "vitest";
import { Curvet } from "../src";
import { mockFetch } from "./helpers";

const MODELS_BODY = {
  success: true,
  models: [
    { id: "gpt-4o", name: "GPT-4o", type: "chat", provider: "openai", cost: 0.01, credits: 1 },
    { id: "flux-2-klein-4b", name: "Flux 2 Klein", type: "image", provider: "deepinfra", cost: 0.01, credits: 1 },
    { id: "wan-2.2", name: "WAN 2.2", type: "video", provider: "deepinfra", cost: 0.09, credits: 9 },
  ],
  rateLimits: { requestsPerHour: 100, costCapPerDay: 10 },
};

describe("models", () => {
  it("lists, caches, and filters by type", async () => {
    let n = 0;
    const fetch = mockFetch(() => {
      n++;
      return { status: 200, body: MODELS_BODY };
    });
    const curvet = new Curvet({ appKey: "k", fetch });

    const all = await curvet.models.list();
    expect(all).toHaveLength(3);

    const chat = await curvet.models.list({ type: "chat" });
    expect(chat.map((m) => m.id)).toEqual(["gpt-4o"]);
    expect(n).toBe(1); // served from cache

    const fresh = await curvet.models.list({ refresh: true });
    expect(fresh).toHaveLength(3);
    expect(n).toBe(2); // cache busted
  });

  it("get() finds a single model", async () => {
    const fetch = mockFetch(() => ({ status: 200, body: MODELS_BODY }));
    const curvet = new Curvet({ appKey: "k", fetch });
    const m = await curvet.models.get("wan-2.2");
    expect(m?.type).toBe("video");
    expect(await curvet.models.get("nope")).toBeUndefined();
  });

  it("exposes rate limits", async () => {
    const fetch = mockFetch(() => ({ status: 200, body: MODELS_BODY }));
    const curvet = new Curvet({ appKey: "k", fetch });
    expect((await curvet.models.rateLimits())?.requestsPerHour).toBe(100);
  });
});
