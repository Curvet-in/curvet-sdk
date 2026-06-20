import { describe, it, expect } from "vitest";
import { Curvet, BadRequestError, AuthError } from "../src";
import { mockFetch } from "./helpers";

describe("retry policy", () => {
  it("retries a 500 then succeeds", async () => {
    let n = 0;
    const fetch = mockFetch(() => {
      n++;
      return n < 2
        ? { status: 500, body: { success: false, error: "transient" } }
        : { status: 200, body: { success: true, balance: { totalAvailableUSD: 50 } } };
    });
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 2 });
    const b = await curvet.balance.get();
    expect(b.totalAvailableUSD).toBe(50);
    expect(n).toBe(2);
  });

  it("retries a 429 respecting resetsIn, then succeeds", async () => {
    let n = 0;
    const fetch = mockFetch(() => {
      n++;
      return n < 2
        ? { status: 429, body: { success: false, error: "rate", rateLimitInfo: { limit: 1, used: 2, resetsIn: 0.01 } } }
        : { status: 200, body: { success: true, balance: { totalAvailableUSD: 1 } } };
    });
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 2 });
    const b = await curvet.balance.get();
    expect(b.totalAvailableUSD).toBe(1);
    expect(n).toBe(2);
  });

  it("does NOT retry a 400", async () => {
    let n = 0;
    const fetch = mockFetch(() => {
      n++;
      return { status: 400, body: { success: false, error: "bad" } };
    });
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 3 });
    await expect(curvet.balance.get()).rejects.toBeInstanceOf(BadRequestError);
    expect(n).toBe(1);
  });

  it("does NOT retry a 401", async () => {
    let n = 0;
    const fetch = mockFetch(() => {
      n++;
      return { status: 401, body: { success: false, error: "Invalid appKey" } };
    });
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 3 });
    await expect(curvet.balance.get()).rejects.toBeInstanceOf(AuthError);
    expect(n).toBe(1);
  });

  it("gives up after maxRetries on persistent 500", async () => {
    let n = 0;
    const fetch = mockFetch(() => {
      n++;
      return { status: 500, body: { success: false, error: "down" } };
    });
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 2 });
    await expect(curvet.balance.get()).rejects.toBeTruthy();
    expect(n).toBe(3); // initial + 2 retries
  });

  it("aborts mid-retry when the signal fires", async () => {
    const controller = new AbortController();
    let n = 0;
    const fetch = mockFetch(() => {
      n++;
      controller.abort(); // abort before the next retry's backoff completes
      return { status: 500, body: { success: false, error: "x" } };
    });
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 5 });
    const err = await curvet.balance.get({ signal: controller.signal }).catch((e) => e);
    expect(err?.name).toBe("AbortError");
  });
});
