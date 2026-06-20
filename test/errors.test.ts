import { describe, it, expect } from "vitest";
import {
  Curvet,
  AuthError,
  PermissionError,
  BadRequestError,
  InsufficientBalanceError,
  RateLimitError,
  APIError,
} from "../src";
import { mockFetch } from "./helpers";

function clientReturning(status: number, body: unknown, headers?: Record<string, string>) {
  const fetch = mockFetch(() => ({ status, body, headers }));
  return new Curvet({ appKey: "k", fetch, maxRetries: 0 });
}

describe("error mapping", () => {
  it("401 -> AuthError", async () => {
    await expect(
      clientReturning(401, { success: false, error: "Invalid appKey" }).balance.get(),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("403 -> PermissionError", async () => {
    await expect(
      clientReturning(403, { success: false, error: "Playground not enabled" }).balance.get(),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("400 -> BadRequestError", async () => {
    await expect(
      clientReturning(400, { success: false, error: "Unknown model" }).balance.get(),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("402 -> InsufficientBalanceError with required/available", async () => {
    const err = await clientReturning(402, {
      success: false,
      error: "Insufficient balance",
      required: 0.01,
      available: 0,
    })
      .balance.get()
      .catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientBalanceError);
    expect(err.required).toBe(0.01);
    expect(err.available).toBe(0);
  });

  it("429 -> RateLimitError with reset info", async () => {
    const err = await clientReturning(429, {
      success: false,
      error: "Rate limit exceeded",
      rateLimitInfo: { limit: 100, used: 101, resetsAt: "2030-01-01T00:00:00Z" },
    })
      .balance.get()
      .catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.kind).toBe("rate");
    expect(err.limit).toBe(100);
    expect(err.resetsAt).toBeInstanceOf(Date);
  });

  it("429 cost cap -> RateLimitError kind 'cost'", async () => {
    const err = await clientReturning(429, {
      success: false,
      error: "Daily cost cap exceeded",
      costCapInfo: { limit: 10, used: "10.05", resetsAt: "2030-01-01T00:00:00Z" },
    })
      .balance.get()
      .catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.kind).toBe("cost");
  });

  it("500 -> APIError", async () => {
    await expect(
      clientReturning(500, { success: false, error: "AI API request failed" }).balance.get(),
    ).rejects.toBeInstanceOf(APIError);
  });

  it("carries status and raw body on the error", async () => {
    const err = await clientReturning(400, { success: false, error: "bad" }).balance.get().catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.raw).toEqual({ success: false, error: "bad" });
  });
});
