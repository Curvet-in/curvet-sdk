import { describe, it, expect, beforeEach } from "vitest";
import { Curvet } from "../src";
import { mockFetch } from "./helpers";

const KEY = "cvent_ent_test";

/** A client wired to a mock transport, plus the recorded calls. */
function client(handler: Parameters<typeof mockFetch>[0]) {
  const fetch = mockFetch(handler);
  return { curvet: new Curvet({ enterpriseKey: KEY, fetch }), fetch };
}

describe("enterprise", () => {
  beforeEach(() => {
    delete process.env.CURVET_APP_KEY;
    delete process.env.CURVET_ENTERPRISE_KEY;
  });

  it("targets /api/v1/enterprise and authenticates with x-enterprise-key", async () => {
    const { curvet, fetch } = client(() => ({
      status: 200,
      body: { success: true, members: [] },
    }));
    await curvet.enterprise.members.list();

    expect(fetch.calls[0].url).toBe("https://curvet.ai/api/v1/enterprise/members");
    const headers = fetch.calls[0].init.headers;
    expect(headers["x-enterprise-key"]).toBe(KEY);
    expect(headers["Authorization"]).toBeUndefined();
  });

  describe("members.setPoolAccess", () => {
    it("PATCHes pool-access and returns the resolved setting", async () => {
      const { curvet, fetch } = client(() => ({
        status: 200,
        body: { success: true, drawsFromPool: true, effective: true },
      }));

      const res = await curvet.enterprise.members.setPoolAccess("uid-123", true);

      const call = fetch.calls[0];
      expect(call.init.method).toBe("PATCH");
      expect(call.url).toBe(
        "https://curvet.ai/api/v1/enterprise/members/uid-123/pool-access",
      );
      expect(JSON.parse(call.init.body)).toEqual({ drawsFromPool: true });
      expect(res).toEqual({ success: true, drawsFromPool: true, effective: true });
    });

    it("sends null to restore the role default rather than omitting the field", async () => {
      // null is meaningful here ("inherit from role"), so it must survive
      // serialisation — an omitted key would leave the override in place.
      const { curvet, fetch } = client(() => ({
        status: 200,
        body: { success: true, drawsFromPool: null, effective: true },
      }));

      const res = await curvet.enterprise.members.setPoolAccess("uid-123", null);

      expect(JSON.parse(fetch.calls[0].init.body)).toEqual({ drawsFromPool: null });
      expect(res.drawsFromPool).toBeNull();
      expect(res.effective).toBe(true);
    });

    it("revokes access with false", async () => {
      const { curvet, fetch } = client(() => ({
        status: 200,
        body: { success: true, drawsFromPool: false, effective: false },
      }));

      const res = await curvet.enterprise.members.setPoolAccess("uid-123", false);

      expect(JSON.parse(fetch.calls[0].init.body)).toEqual({ drawsFromPool: false });
      expect(res.effective).toBe(false);
    });

    it("surfaces the 400 from a shared-model org", async () => {
      const { curvet } = client(() => ({
        status: 400,
        body: {
          success: false,
          error:
            "Pool access is a per_member setting. In a shared org every member already draws the pool.",
        },
      }));

      await expect(
        curvet.enterprise.members.setPoolAccess("uid-123", true),
      ).rejects.toThrow(/per_member setting/);
    });
  });

  it("members.list exposes the pool-access fields", async () => {
    const { curvet } = client(() => ({
      status: 200,
      body: {
        success: true,
        members: [
          {
            firebaseUid: "admin-uid",
            email: "admin@school.edu",
            role: "admin",
            allotted: 0,
            used: 250,
            remaining: 4750,
            cap: 5000,
            personalCredits: 0,
            drawsFromPool: null,
            drawsFromPoolEffective: true,
            isRestricted: false,
          },
          {
            firebaseUid: "student-uid",
            email: "student@school.edu",
            role: "member",
            allotted: 2000,
            used: 0,
            remaining: 1000,
            cap: 1000,
            personalCredits: 100,
            drawsFromPool: false,
            drawsFromPoolEffective: false,
            isRestricted: false,
          },
        ],
      },
    }));

    const [admin, student] = await curvet.enterprise.members.list();
    // null means "inherited"; the effective value is what actually applies.
    expect(admin.drawsFromPool).toBeNull();
    expect(admin.drawsFromPoolEffective).toBe(true);
    expect(student.drawsFromPool).toBe(false);
    expect(student.drawsFromPoolEffective).toBe(false);
  });
});
