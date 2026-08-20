import { describe, it, expect } from "vitest";
import { Curvet } from "../src";
import { mockFetch } from "./helpers";

const RUNNABLE = [
  { id: "gpt-4o", name: "GPT-4o", type: "chat", provider: "openai", cost: 0.01, credits: 1, capability: "generation", available: true, comingSoon: false, surface: "api", endpoint: "POST /api/v1/playground/chat", pricing: { meter: "tokens", unit: "credits_per_million_tokens", billing: "metered", input: 500, output: 3000 } },
  { id: "flux-2-klein-4b", name: "Flux 2 Klein", type: "image", provider: "deepinfra", cost: 0.01, credits: 1, capability: "generation", available: true, comingSoon: false, surface: "api", endpoint: "POST /api/v1/playground/image", pricing: null },
  { id: "wan-2.2", name: "WAN 2.2", type: "video", provider: "deepinfra", cost: 0.09, credits: 9, capability: "generation", available: true, comingSoon: false, surface: "api", endpoint: "POST /api/v1/playground/video", pricing: null },
  { id: "ali-qwen3-tts-flash", name: "Qwen3 TTS Flash", type: "audio", provider: "dashscope", cost: 0.01, credits: 1, capability: "generation", available: true, comingSoon: false, surface: "api", endpoint: "POST /api/v1/playground/audio", pricing: null },
  { id: "whisper-large-v3", name: "Whisper Large V3", type: "audio", provider: "deepinfra", cost: 0.01, credits: 1, capability: "transcription", available: true, comingSoon: false, surface: "api", endpoint: "POST /api/v1/voice/stt/public", pricing: null },
];

const COMING_SOON = {
  id: "sunno-ai", name: "Suno AI", type: "audio", provider: "suno", cost: 0.02, credits: 2,
  capability: "generation", available: false, comingSoon: true, surface: null, endpoint: null, pricing: null,
};

const rateLimits = { requestsPerHour: 100, costCapPerDay: 10 };

/** Serve the runnable catalogue by default and the full one for `include=all`. */
function catalogueFetch() {
  return mockFetch((url) => ({
    status: 200,
    body: {
      success: true,
      models: url.includes("include=all") ? [...RUNNABLE, COMING_SOON] : RUNNABLE,
      rateLimits,
    },
  }));
}

describe("models", () => {
  it("lists, caches, and filters by type", async () => {
    let n = 0;
    const fetch = mockFetch(() => {
      n++;
      return { status: 200, body: { success: true, models: RUNNABLE, rateLimits } };
    });
    const curvet = new Curvet({ appKey: "k", fetch });

    const all = await curvet.models.list();
    expect(all).toHaveLength(5);

    const chat = await curvet.models.list({ type: "chat" });
    expect(chat.map((m) => m.id)).toEqual(["gpt-4o"]);
    expect(n).toBe(1); // served from cache

    const fresh = await curvet.models.list({ refresh: true });
    expect(fresh).toHaveLength(5);
    expect(n).toBe(2); // cache busted
  });

  it("get() finds a single model", async () => {
    const fetch = catalogueFetch();
    const curvet = new Curvet({ appKey: "k", fetch });
    const m = await curvet.models.get("wan-2.2");
    expect(m?.type).toBe("video");
    expect(await curvet.models.get("nope")).toBeUndefined();
  });

  it("exposes rate limits", async () => {
    const fetch = catalogueFetch();
    const curvet = new Curvet({ appKey: "k", fetch });
    expect((await curvet.models.rateLimits())?.requestsPerHour).toBe(100);
  });

  it("carries the catalogue flags through", async () => {
    const fetch = catalogueFetch();
    const curvet = new Curvet({ appKey: "k", fetch });
    const whisper = await curvet.models.get("whisper-large-v3");
    expect(whisper?.capability).toBe("transcription");
    expect(whisper?.endpoint).toBe("POST /api/v1/voice/stt/public");
    expect(whisper?.surface).toBe("api");
    const gpt = await curvet.models.get("gpt-4o");
    expect(gpt?.pricing?.output).toBe(3000);
  });

  it("separates transcription models from generation models", async () => {
    const fetch = catalogueFetch();
    const curvet = new Curvet({ appKey: "k", fetch });

    const speakable = await curvet.models.list({ type: "audio", capability: "generation" });
    expect(speakable.map((m) => m.id)).toEqual(["ali-qwen3-tts-flash"]);

    const listenable = await curvet.models.list({ capability: "transcription" });
    expect(listenable.map((m) => m.id)).toEqual(["whisper-large-v3"]);
  });

  it("treats a missing capability as generation", async () => {
    const fetch = mockFetch(() => ({
      status: 200,
      body: { success: true, models: [{ id: "old", name: "Old", type: "chat", provider: "x", cost: 0, credits: 0 }], rateLimits },
    }));
    const curvet = new Curvet({ appKey: "k", fetch });
    expect(await curvet.models.list({ capability: "generation" })).toHaveLength(1);
  });

  it("include:'all' asks for the full catalogue and caches it separately", async () => {
    const fetch = catalogueFetch();
    const curvet = new Curvet({ appKey: "k", fetch });

    const runnable = await curvet.models.list();
    expect(runnable.map((m) => m.id)).not.toContain("sunno-ai");

    const everything = await curvet.models.list({ include: "all" });
    expect(everything.map((m) => m.id)).toContain("sunno-ai");
    expect(everything.find((m) => m.id === "sunno-ai")?.comingSoon).toBe(true);

    // The second call must not have been answered from the runnable cache, and
    // the runnable view must not have been overwritten by the full one.
    expect(fetch.calls).toHaveLength(2);
    expect(fetch.calls[0].url).not.toContain("include=");
    expect(fetch.calls[1].url).toContain("include=all");
    expect((await curvet.models.list()).map((m) => m.id)).not.toContain("sunno-ai");
    expect(fetch.calls).toHaveLength(2);
  });
});
