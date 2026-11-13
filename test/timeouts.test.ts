import { describe, it, expect } from "vitest";
import { Curvet, ConnectionError } from "../src";
import { mockFetch, type MockReply } from "./helpers";

/**
 * A timeout on the SDK's side is retried under `maxRetries` only.
 * `idempotencyWaitMs` governs one thing: waiting on a 409
 * `idempotency_key_in_use` while the server finishes the first attempt.
 *
 * Why: chat and embeddings refund the call and free its key when the client
 * hangs up, so a re-send after a timeout is a fresh provider call that times
 * out the same way. Looping on timeouts until `idempotencyWaitMs` made a
 * 30-second chat with `timeout: 10000` cost about 12 provider calls and return
 * nothing. Image, media and workflow routes keep working after the hang-up and
 * answer the retry with 409 until the first attempt finishes — that is the
 * wait's job.
 */

/** A reply that never comes until the SDK's own timeout aborts it. */
function hang(init: any): Promise<never> {
  return new Promise((_, reject) =>
    init.signal.addEventListener("abort", () => {
      const e = new Error("aborted");
      e.name = "AbortError";
      reject(e);
    }),
  );
}

const keyOf = (call: { init: any }) => call.init.headers["idempotency-key"];
const CHAT = { model: "gpt-4o-mini", messages: [{ role: "user" as const, content: "hi" }] };
const inUse: MockReply = {
  status: 409,
  body: { success: false, error: "still running", code: "idempotency_key_in_use", type: "invalid_request_error", retryable: true },
  headers: { "retry-after": "0" },
};
const imageOk: MockReply = {
  status: 200,
  body: {
    success: true,
    imageUrl: "https://cdn/i.png",
    usage: { cost: 0.01, credits: 1, remainingCredits: 99 },
    metadata: { model: "flux-2-klein-4b", latencyMs: 70_000 },
  },
};

describe("a timeout is retried under maxRetries, never by the idempotency wait", () => {
  it("maxRetries: 0 means exactly one send, whatever idempotencyWaitMs is", async () => {
    const fetch = mockFetch(async (_url, init) => hang(init));
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 0, timeout: 20, idempotencyWaitMs: 120_000 });
    const err = await curvet.chat.create(CHAT).catch((e) => e);
    expect(err).toBeInstanceOf(ConnectionError);
    expect(fetch.calls).toHaveLength(1);
    // The key is handed back, so the caller can ask again for the same call.
    expect(err.idempotencyKey).toBe(keyOf(fetch.calls[0]));
  });

  it("a chat that keeps timing out is sent 1 + maxRetries times, not until idempotencyWaitMs runs out", async () => {
    const fetch = mockFetch(async (_url, init) => hang(init));
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 2, timeout: 20, idempotencyWaitMs: 120_000 });
    const started = Date.now();
    const err = await curvet.chat.create(CHAT).catch((e) => e);
    expect(err).toBeInstanceOf(ConnectionError);
    expect(fetch.calls).toHaveLength(3);
    expect(new Set(fetch.calls.map(keyOf)).size).toBe(1);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("a per-call maxRetries: 0 overrides the client's", async () => {
    const fetch = mockFetch(async (_url, init) => hang(init));
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 3, timeout: 20 });
    await curvet.chat.create(CHAT, { maxRetries: 0 }).catch(() => undefined);
    expect(fetch.calls).toHaveLength(1);
  });

  it("a media submit (maxRetries 0 by default) that times out is sent once", async () => {
    const fetch = mockFetch(async (_url, init) => hang(init));
    const curvet = new Curvet({ appKey: "k", fetch });
    const err = await curvet.video
      .submit({ model: "wan-2.2", prompt: "x" }, { timeout: 20 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConnectionError);
    expect(fetch.calls).toHaveLength(1);
  });

  it("a slow image: the timeout is retried once, the server answers 409 while it finishes, then the image", async () => {
    let n = 0;
    const fetch = mockFetch(async (_url, init) => {
      n++;
      if (n === 1) return hang(init);
      if (n <= 3) return inUse;
      return imageOk;
    });
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 1, timeout: 20, idempotencyWaitMs: 5_000 });
    const res = await curvet.image.generate({ model: "flux-2-klein-4b", prompt: "a red cube" });
    expect(res.imageUrl).toBe("https://cdn/i.png");
    expect(fetch.calls).toHaveLength(4);
    expect(new Set(fetch.calls.map(keyOf)).size).toBe(1);
  });

  it("a timeout during the 409 wait still counts against maxRetries", async () => {
    let n = 0;
    const fetch = mockFetch(async (_url, init) => {
      n++;
      if (n === 1) return inUse;
      return hang(init);
    });
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 1, timeout: 20, idempotencyWaitMs: 5_000 });
    const err = await curvet.image.generate({ model: "flux-2-klein-4b", prompt: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(ConnectionError);
    // 409, then a timeout, then one retry that times out too.
    expect(fetch.calls).toHaveLength(3);
  });

  it("the 409 wait is governed by idempotencyWaitMs, not maxRetries", async () => {
    let n = 0;
    const fetch = mockFetch(() => (++n <= 3 ? inUse : imageOk));
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 0, idempotencyWaitMs: 5_000 });
    const res = await curvet.image.generate({ model: "flux-2-klein-4b", prompt: "x" }, { idempotencyKey: "order-42" });
    expect(res.imageUrl).toBe("https://cdn/i.png");
    expect(fetch.calls).toHaveLength(4);
  });
});
