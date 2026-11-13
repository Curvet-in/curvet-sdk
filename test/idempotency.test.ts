import { describe, it, expect } from "vitest";
import { Curvet, APIError, BadRequestError, ConnectionError } from "../src";
import { DEFAULT_IDEMPOTENCY_WAIT_MS, newIdempotencyKey } from "../src/core/http";
import { isIdempotencyInProgress } from "../src/core/retry";
import { mockFetch } from "./helpers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const chatOk = {
  status: 200,
  body: {
    success: true,
    response: "pong",
    usage: { cost: 0.01, credits: 1 },
    metadata: { model: "gpt-4o-mini", latencyMs: 1, requestId: "r" },
  },
};
const params = { model: "gpt-4o-mini", messages: [{ role: "user" as const, content: "hi" }] };
const keyOf = (call: { init: any }) => call.init.headers["idempotency-key"];

describe("Idempotency-Key", () => {
  it("every POST carries a generated UUID key", async () => {
    const fetch = mockFetch(() => chatOk);
    const curvet = new Curvet({ appKey: "k", fetch });
    await curvet.chat.create(params);
    expect(keyOf(fetch.calls[0])).toMatch(UUID);
  });

  it("a retried POST re-sends the SAME key (so the server runs and charges it once)", async () => {
    let n = 0;
    const fetch = mockFetch(() => {
      n++;
      return n < 3 ? { status: 503, body: { success: false, error: "busy" } } : chatOk;
    });
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 2 });
    await curvet.chat.create(params);
    expect(fetch.calls).toHaveLength(3);
    const keys = fetch.calls.map(keyOf);
    expect(keys[0]).toMatch(UUID);
    expect(new Set(keys).size).toBe(1);
  });

  it("a retry after a timeout re-sends the same key too", async () => {
    let n = 0;
    const fetch = mockFetch(async (_url, init) => {
      n++;
      if (n === 1) {
        // Never answers until the SDK's timeout aborts it.
        await new Promise((_, reject) =>
          init.signal.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          }),
        );
      }
      return chatOk;
    });
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 1, timeout: 20 });
    await curvet.chat.create(params);
    expect(fetch.calls).toHaveLength(2);
    expect(keyOf(fetch.calls[1])).toBe(keyOf(fetch.calls[0]));
  });

  it("two separate calls get two different keys", async () => {
    const fetch = mockFetch(() => chatOk);
    const curvet = new Curvet({ appKey: "k", fetch });
    await curvet.chat.create(params);
    await curvet.chat.create(params);
    expect(keyOf(fetch.calls[0])).not.toBe(keyOf(fetch.calls[1]));
  });

  it("the caller's own key is used: options.idempotencyKey", async () => {
    const fetch = mockFetch(() => chatOk);
    const curvet = new Curvet({ appKey: "k", fetch });
    await curvet.chat.create(params, { idempotencyKey: "order-42" });
    expect(keyOf(fetch.calls[0])).toBe("order-42");
  });

  it("the caller's own key is used: an Idempotency-Key header, in any case, sent once", async () => {
    const fetch = mockFetch(() => chatOk);
    const curvet = new Curvet({ appKey: "k", fetch });
    await curvet.chat.create(params, { headers: { "Idempotency-Key": "mine-1" } });
    const headers = fetch.calls[0].init.headers;
    expect(headers["idempotency-key"]).toBe("mine-1");
    expect(Object.keys(headers).filter((h) => h.toLowerCase() === "idempotency-key")).toHaveLength(1);
  });

  it("a GET carries no key", async () => {
    const fetch = mockFetch(() => ({ status: 200, body: { success: true, balance: { totalAvailableUSD: 1 } } }));
    const curvet = new Curvet({ appKey: "k", fetch });
    await curvet.balance.get();
    expect(keyOf(fetch.calls[0])).toBeUndefined();
  });

  it("a 409 'still running' is retried with the same key and returns the first attempt's result", async () => {
    let n = 0;
    const fetch = mockFetch(() => {
      n++;
      return n === 1
        ? {
            status: 409,
            body: { success: false, error: "still running", code: "idempotency_key_in_use" },
            headers: { "retry-after": "0" },
          }
        : chatOk;
    });
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 2 });
    const res = await curvet.chat.create(params);
    expect(res).toBeTruthy();
    expect(fetch.calls).toHaveLength(2);
    expect(keyOf(fetch.calls[1])).toBe(keyOf(fetch.calls[0]));
  });

  it("other 409s and the 422 key-reuse refusal are not retried", async () => {
    const notReplayable = mockFetch(() => ({
      status: 409,
      body: { success: false, error: "completed, streamed", code: "idempotency_key_not_replayable" },
    }));
    const a = new Curvet({ appKey: "k", fetch: notReplayable, maxRetries: 3 });
    await expect(a.chat.create(params)).rejects.toBeInstanceOf(APIError);
    expect(notReplayable.calls).toHaveLength(1);

    const mismatch = mockFetch(() => ({
      status: 422,
      body: { success: false, error: "different request", code: "idempotency_key_mismatch" },
    }));
    const b = new Curvet({ appKey: "k", fetch: mismatch, maxRetries: 3 });
    await expect(b.chat.create(params)).rejects.toBeTruthy();
    expect(mismatch.calls).toHaveLength(1);
  });

  it("recognises the in-progress code in both error envelopes", () => {
    expect(isIdempotencyInProgress(409, { code: "idempotency_key_in_use" })).toBe(true);
    expect(isIdempotencyInProgress(409, { error: { code: "idempotency_key_in_use" } })).toBe(true);
    expect(isIdempotencyInProgress(409, { code: "something_else" })).toBe(false);
    expect(isIdempotencyInProgress(500, { code: "idempotency_key_in_use" })).toBe(false);
    expect(isIdempotencyInProgress(409, "text")).toBe(false);
  });

  it("generated keys are v4 UUIDs, even without crypto.randomUUID", () => {
    expect(newIdempotencyKey()).toMatch(UUID);
    const real = (globalThis as any).crypto;
    try {
      Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true, writable: true });
      const a = newIdempotencyKey();
      const b = newIdempotencyKey();
      expect(a).toMatch(UUID);
      expect(a).not.toBe(b);
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: real, configurable: true, writable: true });
    }
  });
});

describe("request id on errors", () => {
  it("reads x-curvet-request-id, which is what the server sends", async () => {
    const fetch = mockFetch(() => ({
      status: 400,
      body: { success: false, error: "bad" },
      headers: { "x-curvet-request-id": "cv-123", "x-request-id": "older" },
    }));
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 0 });
    const err = await curvet.chat.create(params).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestError);
    expect(err.requestId).toBe("cv-123");
  });

  it("falls back to x-request-id", async () => {
    const fetch = mockFetch(() => ({
      status: 400,
      body: { success: false, error: "bad" },
      headers: { "x-request-id": "older-1" },
    }));
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 0 });
    const err = await curvet.chat.create(params).catch((e) => e);
    expect(err.requestId).toBe("older-1");
  });
});

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
const inUse = {
  status: 409,
  body: { success: false, error: "still running", code: "idempotency_key_in_use" },
  headers: { "retry-after": "0" },
};

describe("waiting for a call the server is still running", () => {
  it("a call slower than the timeout: keeps asking with the same key until the result arrives, maxRetries untouched", async () => {
    // Attempt 1 times out (the image takes longer than `timeout`); the server is
    // still running it for the next two asks, then answers its result.
    let n = 0;
    const fetch = mockFetch(async (_url, init) => {
      n++;
      if (n === 1) return hang(init);
      if (n <= 3) return inUse;
      return chatOk;
    });
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 0, timeout: 20, idempotencyWaitMs: 5_000 });
    const res = await curvet.chat.create(params);
    expect(res.response).toBe("pong");
    expect(fetch.calls).toHaveLength(4);
    expect(new Set(fetch.calls.map(keyOf)).size).toBe(1);
    expect(res.metadata.idempotencyKey).toBe(keyOf(fetch.calls[0]));
  });

  it("gives up at the deadline, and the error carries the key to retry with", async () => {
    const fetch = mockFetch(() => inUse);
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 5, idempotencyWaitMs: 60 });
    const started = Date.now();
    const err = await curvet.chat.create(params).catch((e) => e);
    expect(err).toBeInstanceOf(APIError);
    expect(err.status).toBe(409);
    expect(err.idempotencyKey).toBe(keyOf(fetch.calls[0]));
    expect(fetch.calls.length).toBeGreaterThan(1);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("a timeout past the deadline is a ConnectionError that carries the key", async () => {
    const fetch = mockFetch(async (_url, init) => hang(init));
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 0, timeout: 20, idempotencyWaitMs: 50 });
    const err = await curvet.chat.create(params).catch((e) => e);
    expect(err).toBeInstanceOf(ConnectionError);
    expect(err.idempotencyKey).toBe(keyOf(fetch.calls[0]));
    expect(new Set(fetch.calls.map(keyOf)).size).toBe(1);
  });

  it("the caller's AbortSignal stops the wait at once", async () => {
    const controller = new AbortController();
    const fetch = mockFetch(() => {
      setTimeout(() => controller.abort(), 10);
      return { ...inUse, headers: { "retry-after": "30" } };
    });
    const curvet = new Curvet({ appKey: "k", fetch, idempotencyWaitMs: 60_000 });
    const started = Date.now();
    const err = await curvet.chat.create(params, { signal: controller.signal }).catch((e) => e);
    expect(err?.name).toBe("AbortError");
    expect(err.idempotencyKey).toBe(keyOf(fetch.calls[0]));
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(fetch.calls).toHaveLength(1);
  });

  it("idempotencyWaitMs: 0 turns the wait off: a 409 in_use is an ordinary retry under maxRetries", async () => {
    const fetch = mockFetch(() => inUse);
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 0 });
    const err = await curvet.chat.create(params, { idempotencyWaitMs: 0 }).catch((e) => e);
    expect(err.status).toBe(409);
    expect(fetch.calls).toHaveLength(1);
  });

  it("the default wait covers a slow image without hanging for many minutes", () => {
    expect(DEFAULT_IDEMPOTENCY_WAIT_MS).toBeGreaterThanOrEqual(90_000);
    expect(DEFAULT_IDEMPOTENCY_WAIT_MS).toBeLessThanOrEqual(5 * 60_000);
  });
});

describe("the key is handed back", () => {
  it("on every error a POST throws", async () => {
    const fetch = mockFetch(() => ({ status: 400, body: { success: false, error: "bad" } }));
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 0 });
    const err = await curvet.chat.create(params).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestError);
    expect(err.idempotencyKey).toMatch(UUID);
    expect(err.idempotencyKey).toBe(keyOf(fetch.calls[0]));
  });

  it("not on a GET, which has none", async () => {
    const fetch = mockFetch(() => ({ status: 400, body: { success: false, error: "bad" } }));
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 0 });
    const err = await curvet.balance.get().catch((e) => e);
    expect(err.idempotencyKey).toBeUndefined();
  });

  it("so the caller's own retry can reuse it and get the first result", async () => {
    let n = 0;
    const fetch = mockFetch(() => (++n === 1 ? { status: 503, body: { success: false, error: "busy" } } : chatOk));
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 0 });
    const err = await curvet.chat.create(params).catch((e) => e);
    const res = await curvet.chat.create(params, { idempotencyKey: err.idempotencyKey });
    expect(keyOf(fetch.calls[1])).toBe(keyOf(fetch.calls[0]));
    expect(res.metadata.idempotencyKey).toBe(err.idempotencyKey);
  });
});
