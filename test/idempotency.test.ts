import { describe, it, expect } from "vitest";
import { Curvet, APIError, BadRequestError } from "../src";
import { newIdempotencyKey } from "../src/core/http";
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
