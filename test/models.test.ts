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

/** A chat model published with its OpenRouter-style alias. */
const LLAMA = {
  id: "llama-3.3-70b", name: "Llama 3.3 70B", type: "chat", provider: "deepinfra", cost: 0.001, credits: 1,
  capability: "generation", available: true, comingSoon: false, surface: "api", endpoint: "POST /api/v1/playground/chat",
  pricing: { meter: "tokens", unit: "credits_per_million_tokens", billing: "metered", input: 10, output: 32 },
  aliases: ["meta-llama/llama-3.3-70b-instruct"],
};

/** An embedding model, as the app-key catalogue lists one. */
const MINILM = {
  id: "all-minilm-l6-v2", name: "all-MiniLM-L6-v2", type: "embedding", provider: "deepinfra", cost: 0.0001, credits: 0.01,
  capability: "embedding", available: true, comingSoon: false, surface: "api", endpoint: "POST /api/v1/embeddings",
  pricing: { meter: "tokens", unit: "credits_per_million_tokens", billing: "metered", input: 0.5 },
  dims: 384, aliases: ["sentence-transformers/all-minilm-l6-v2"],
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

  it("get() also finds a model by one of its aliases, in any case", async () => {
    const fetch = mockFetch(() => ({
      status: 200,
      body: { success: true, models: [...RUNNABLE, LLAMA, MINILM], rateLimits },
    }));
    const curvet = new Curvet({ appKey: "k", fetch });

    expect((await curvet.models.get("llama-3.3-70b"))?.id).toBe("llama-3.3-70b");
    expect((await curvet.models.get("meta-llama/llama-3.3-70b-instruct"))?.id).toBe("llama-3.3-70b");
    // Hugging Face casing, as people paste it; the server matches it too.
    expect((await curvet.models.get("meta-llama/Llama-3.3-70B-Instruct"))?.id).toBe("llama-3.3-70b");
    expect((await curvet.models.get("sentence-transformers/all-minilm-l6-v2"))?.id).toBe("all-minilm-l6-v2");
    // Ids match regardless of case too, as the server matches them.
    expect((await curvet.models.get("GPT-4o"))?.id).toBe("gpt-4o");
    // A vendor id with no alias row is not guessed at, and entries without
    // `aliases` (older deployments) are passed over rather than tripped on.
    expect(await curvet.models.get("meta-llama/llama-3.1-8b-instruct")).toBeUndefined();
    expect(fetch.calls).toHaveLength(1);
  });

  it("lists embedding models with their vector size and route", async () => {
    const fetch = mockFetch(() => ({
      status: 200,
      body: { success: true, models: [...RUNNABLE, LLAMA, MINILM], rateLimits },
    }));
    const curvet = new Curvet({ appKey: "k", fetch });

    const embedders = await curvet.models.list({ type: "embedding" });
    expect(embedders.map((m) => m.id)).toEqual(["all-minilm-l6-v2"]);
    expect(embedders[0].dims).toBe(384);
    expect(embedders[0].endpoint).toBe("POST /api/v1/embeddings");
    expect((await curvet.models.list({ capability: "embedding" })).map((m) => m.id)).toEqual(["all-minilm-l6-v2"]);
    // Embedders are not generation models, so a generation filter leaves them out.
    expect((await curvet.models.list({ capability: "generation" })).map((m) => m.id)).not.toContain("all-minilm-l6-v2");
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
