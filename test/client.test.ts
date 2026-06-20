import { describe, it, expect, beforeEach } from "vitest";
import { Curvet } from "../src";
import { mockFetch } from "./helpers";

describe("Curvet client", () => {
  beforeEach(() => {
    delete process.env.CURVET_APP_KEY;
  });

  it("throws when no app key is provided", () => {
    expect(() => new Curvet({})).toThrow(/Missing Curvet app key/);
  });

  it("reads the app key from CURVET_APP_KEY", () => {
    process.env.CURVET_APP_KEY = "cvt_app_env";
    const fetch = mockFetch(() => ({ status: 200, body: { success: true, balance: { totalAvailableUSD: 1 } } }));
    expect(() => new Curvet({ fetch })).not.toThrow();
  });

  it("injects x-app-key and never sends an Authorization header", async () => {
    const fetch = mockFetch(() => ({
      status: 200,
      body: {
        success: true,
        response: "pong",
        usage: { cost: 0.01, credits: 1 },
        metadata: { model: "gpt-4o-mini", latencyMs: 1, requestId: "r" },
      },
    }));
    const curvet = new Curvet({ appKey: "cvt_app_test", fetch });
    await curvet.chat.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] });

    const headers = fetch.calls[0].init.headers;
    expect(headers["x-app-key"]).toBe("cvt_app_test");
    expect(headers.authorization ?? headers.Authorization).toBeUndefined();
  });

  it("targets the production base URL by default", async () => {
    const fetch = mockFetch(() => ({ status: 200, body: { success: true, balance: { totalAvailableUSD: 1 } } }));
    const curvet = new Curvet({ appKey: "k", fetch });
    await curvet.balance.get();
    expect(fetch.calls[0].url).toBe("https://curvet.ai/api/v1/playground/balance");
  });
});
