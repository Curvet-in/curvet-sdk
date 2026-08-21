import { describe, it, expect } from "vitest";
import { Curvet, DeviceFlowPending } from "../src";
import { mockFetch } from "./helpers";

const START = {
  deviceCode: "dc-123",
  userCode: "BCDF-GHJK",
  requestedScopes: ["apps:read", "apps:write", "apps:keys"],
  verificationUri: "https://curvet.in/cli",
  verificationUriComplete: "https://curvet.in/cli?code=BCDF-GHJK",
  expiresIn: 600,
  interval: 0, // no real waiting in tests
};

describe("auth.deviceCode", () => {
  it("asks without credentials, because none exist yet", async () => {
    const fetch = mockFetch(() => ({ status: 201, body: START }));
    const curvet = new Curvet({ cliToken: "cvt_cli_x", fetch });
    const start = await curvet.auth.deviceCode({ deviceName: "laptop" });

    expect(start.userCode).toBe("BCDF-GHJK");
    expect(fetch.calls[0].url).toContain("/auth/cli/device/code");
    // Sending a credential here would be meaningless — and misleading, since the
    // whole point is that the caller does not have one yet.
    expect(fetch.calls[0].init.headers["x-cli-token"]).toBeUndefined();
  });
});

describe("auth.pollForToken", () => {
  it("keeps polling while the human has not answered, then returns the token", async () => {
    let n = 0;
    const fetch = mockFetch(() => {
      n++;
      if (n < 3) return { status: 400, body: { error: "authorization_pending" } };
      return {
        status: 200,
        body: {
          token: "cvt_cli_abc",
          tokenId: "t1",
          scopes: ["apps:read"],
          expiresAt: "2026-11-19T00:00:00Z",
          reusedDevice: false,
          defaultApp: null,
        },
      };
    });
    const curvet = new Curvet({ cliToken: "x", fetch });
    const result = await curvet.auth.pollForToken(START);
    expect(result.token).toBe("cvt_cli_abc");
    expect(n).toBe(3);
  });

  // slow_down exists to be obeyed; ignoring the widened interval is how a client
  // gets itself rate-limited.
  it("adopts the interval the server widens it to", async () => {
    const intervals: number[] = [];
    let n = 0;
    const fetch = mockFetch(() => {
      n++;
      if (n === 1) return { status: 400, body: { error: "slow_down", interval: 2 } };
      return {
        status: 200,
        body: { token: "t", tokenId: "1", scopes: [], expiresAt: "", reusedDevice: false, defaultApp: null },
      };
    });
    const curvet = new Curvet({ cliToken: "x", fetch });
    const started = Date.now();
    await curvet.auth.pollForToken({ ...START, interval: 0 }, {}, {
      onPoll: () => intervals.push(Date.now() - started),
    });
    expect(n).toBe(2);
    // First poll at ~1s (floored), second only after the widened 2s.
    expect(intervals[1] - intervals[0]).toBeGreaterThanOrEqual(1900);
  }, 20_000);

  it("stops on a denial rather than polling forever", async () => {
    const fetch = mockFetch(() => ({ status: 400, body: { error: "access_denied" } }));
    const curvet = new Curvet({ cliToken: "x", fetch });
    await expect(curvet.auth.pollForToken(START)).rejects.toMatchObject({
      code: "access_denied",
    });
  });

  it("stops when the code expires", async () => {
    const fetch = mockFetch(() => ({ status: 400, body: { error: "expired_token" } }));
    const curvet = new Curvet({ cliToken: "x", fetch });
    await expect(curvet.auth.pollForToken(START)).rejects.toMatchObject({
      code: "expired_token",
    });
  });

  it("separates 'keep waiting' from 'give up'", () => {
    expect(new DeviceFlowPending("authorization_pending", "").isPending).toBe(true);
    expect(new DeviceFlowPending("slow_down", "").isPending).toBe(true);
    expect(new DeviceFlowPending("access_denied", "").isPending).toBe(false);
    expect(new DeviceFlowPending("expired_token", "").isPending).toBe(false);
  });
});

describe("apps", () => {
  it("sends the CLI token, not the app key", async () => {
    const fetch = mockFetch(() => ({ status: 200, body: { data: [] } }));
    const curvet = new Curvet({ appKey: "app_1", cliToken: "cvt_cli_2", fetch });
    await curvet.apps.list();
    expect(fetch.calls[0].url).toContain("/api/v1/developer/apps");
    expect(fetch.calls[0].init.headers["x-cli-token"]).toBe("cvt_cli_2");
    expect(fetch.calls[0].init.headers["x-app-key"]).toBeUndefined();
  });

  it("passes configuration through on create", async () => {
    const fetch = mockFetch(() => ({ status: 201, body: { data: { _id: "a1", name: "CLI" } } }));
    const curvet = new Curvet({ cliToken: "t", fetch });
    await curvet.apps.create({
      name: "CLI",
      allowedModels: ["gpt-4o-mini"],
      rateLimits: { requestsPerHour: 250 },
    });
    const sent = JSON.parse(fetch.calls[0].init.body);
    expect(sent.allowedModels).toEqual(["gpt-4o-mini"]);
    expect(sent.rateLimits.requestsPerHour).toBe(250);
  });

  it("returns the rotated pair", async () => {
    const fetch = mockFetch(() => ({
      status: 200,
      body: { data: { appKey: "app_new", appSecret: "s3cret" } },
    }));
    const curvet = new Curvet({ cliToken: "t", fetch });
    expect(await curvet.apps.rotateKeys("a1")).toEqual({ appKey: "app_new", appSecret: "s3cret" });
  });
});

describe("credentials", () => {
  it("accepts a CLI token as the only credential", () => {
    expect(() => new Curvet({ cliToken: "cvt_cli_x", fetch: mockFetch(() => ({ status: 200, body: {} })) })).not.toThrow();
  });

  it("still refuses to construct with nothing at all", () => {
    const fetch = mockFetch(() => ({ status: 200, body: {} }));
    const saved = { ...process.env };
    delete process.env.CURVET_APP_KEY;
    delete process.env.CURVET_ENTERPRISE_KEY;
    delete process.env.CURVET_CLI_TOKEN;
    expect(() => new Curvet({ fetch })).toThrow(/Missing credentials/);
    Object.assign(process.env, saved);
  });

  // An enterprise key and a CLI token reach the same router by different mounts;
  // sending one to the other's URL is a 401 nobody would enjoy debugging.
  it("routes enterprise calls by whichever credential is present", async () => {
    const fetch = mockFetch(() => ({ status: 200, body: { members: [] } }));
    const viaKey = new Curvet({ enterpriseKey: "cvent_ent_1", fetch });
    await viaKey.enterprise.members.list();
    expect(fetch.calls[0].url).toContain("/api/v1/enterprise/members");
    expect(fetch.calls[0].init.headers["x-enterprise-key"]).toBe("cvent_ent_1");

    const fetch2 = mockFetch(() => ({ status: 200, body: { members: [] } }));
    const viaCli = new Curvet({ cliToken: "cvt_cli_2", fetch: fetch2 });
    await viaCli.enterprise.members.list();
    expect(fetch2.calls[0].url).toContain("/api/v1/cli/enterprise/members");
    expect(fetch2.calls[0].init.headers["x-cli-token"]).toBe("cvt_cli_2");
  });

  it("prefers the enterprise key when both are present", async () => {
    const fetch = mockFetch(() => ({ status: 200, body: { members: [] } }));
    const curvet = new Curvet({ enterpriseKey: "cvent_ent_1", cliToken: "cvt_cli_2", fetch });
    await curvet.enterprise.members.list();
    expect(fetch.calls[0].url).toContain("/api/v1/enterprise/members");
  });
});

// A 429 mid-login is not a failure. The user may be seconds from clicking
// Authorise; dropping the code because we polled too eagerly loses their login.
describe("rate limiting during a login", () => {
  it("backs off and keeps waiting instead of abandoning the code", async () => {
    let n = 0;
    const fetch = mockFetch(() => {
      n++;
      if (n === 1) return { status: 429, body: { error: "slow_down" } };
      return {
        status: 200,
        body: { token: "cvt_cli_ok", tokenId: "1", scopes: [], expiresAt: "", reusedDevice: false, defaultApp: null },
      };
    });
    const curvet = new Curvet({ cliToken: "x", fetch });
    const result = await curvet.auth.pollForToken(
      { deviceCode: "dc", interval: 0, expiresIn: 600 },
      {},
      { timeoutMs: 60_000 },
    );
    expect(result.token).toBe("cvt_cli_ok");
    expect(n).toBe(2);
  }, 60_000);

  it("treats a 429 as pending, not terminal", () => {
    expect(new DeviceFlowPending("rate_limited", "").isPending).toBe(true);
  });
});
