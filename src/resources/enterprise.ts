import type { HttpClient } from "../core/http";
import type { RequestOptions } from "../types/common";

export type EnterpriseRole = "member" | "admin";

export interface CreateInviteParams {
  /** Role the invitee will be assigned on signup (default "member"). */
  role?: EnterpriseRole;
  /** Enterprise credits to reserve for the invitee, funded from the org pool on redemption. */
  allottedCredits?: number;
  /** Per-member monthly spend cap set on join (0 = no cap). */
  creditLimit?: number;
  /** How long the single-use token stays valid, in days. */
  expiresInDays?: number;
  /** Optionally bind the token to a specific email. */
  email?: string;
  /** Human-readable label for your own reference. */
  label?: string;
}

export interface EnterpriseInvite {
  _id: string;
  organizationId: string;
  organizationName?: string;
  role: EnterpriseRole;
  allottedCredits: number;
  creditLimit: number;
  boundEmail: string | null;
  status: "pending" | "claimed" | "expired" | "revoked";
  label: string;
  expiresAt: string | null;
  fundedCredits: number;
  createdAt: string;
  [key: string]: unknown;
}

export interface CreateInviteResult {
  invite: EnterpriseInvite;
  /** The raw single-use token — shown ONCE. Persist it now if you need it. */
  token: string;
  /** Ready-to-share signup URL with the token embedded (?einvite=...). */
  url: string;
}

export interface EnterpriseMember {
  firebaseUid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  role: EnterpriseRole;
  allotted: number;
  used: number;
  remaining: number | null;
  cap: number;
  personalCredits: number;
  isRestricted: boolean;
}

export interface EnterpriseOverview {
  organization: Record<string, unknown>;
  pool: { balance: number; allocatedToMembers: number; totalUsedThisMonth: number };
  memberCount: number;
  seatsRemaining: number | null;
  month: string;
  members: EnterpriseMember[];
}

/** Enterprise invite-link management. */
class EnterpriseInvites {
  constructor(private client: HttpClient) {}

  /** Generate a single-use, short-lived, scoped invite link for a new/registered member. */
  async create(
    params: CreateInviteParams = {},
    options?: RequestOptions,
  ): Promise<CreateInviteResult> {
    const body = await this.client.request<{ success: boolean } & CreateInviteResult>({
      method: "POST",
      path: "/invites",
      body: params,
      options,
    });
    return { invite: body.invite, token: body.token, url: body.url };
  }

  /** List invites for the organization (optionally filtered by status). */
  async list(
    params: { status?: EnterpriseInvite["status"] } = {},
    options?: RequestOptions,
  ): Promise<EnterpriseInvite[]> {
    const body = await this.client.request<{ success: boolean; invites: EnterpriseInvite[] }>({
      method: "GET",
      path: "/invites",
      query: { status: params.status },
      options,
    });
    return body.invites;
  }

  /** Revoke a pending invite so it can no longer be redeemed. */
  async revoke(inviteId: string, options?: RequestOptions): Promise<void> {
    await this.client.request({ method: "DELETE", path: `/invites/${inviteId}`, options });
  }
}

/** Enterprise member management. */
class EnterpriseMembers {
  constructor(private client: HttpClient) {}

  /** List members with their per-person credit allocation and usage. */
  async list(options?: RequestOptions): Promise<EnterpriseMember[]> {
    const body = await this.client.request<{ success: boolean; members: EnterpriseMember[] }>({
      method: "GET",
      path: "/members",
      options,
    });
    return body.members;
  }

  /**
   * Assign (positive) or reclaim (negative) enterprise credits for a member.
   * Assignments are debited from the shared org pool.
   */
  async assignCredits(
    firebaseUid: string,
    amount: number,
    params: { description?: string } = {},
    options?: RequestOptions,
  ): Promise<Record<string, unknown>> {
    return this.client.request({
      method: "PATCH",
      path: `/members/${firebaseUid}/credits`,
      body: { amount, description: params.description },
      options,
    });
  }

  /** Set a member's monthly spend cap (0 = no cap). */
  async setLimit(
    firebaseUid: string,
    creditLimit: number,
    options?: RequestOptions,
  ): Promise<Record<string, unknown>> {
    return this.client.request({
      method: "PATCH",
      path: `/members/${firebaseUid}/limit`,
      body: { creditLimit },
      options,
    });
  }

  /** Change a member's role (admin/member). */
  async setRole(
    firebaseUid: string,
    role: EnterpriseRole,
    options?: RequestOptions,
  ): Promise<Record<string, unknown>> {
    return this.client.request({
      method: "PATCH",
      path: `/members/${firebaseUid}/role`,
      body: { role },
      options,
    });
  }

  /** Remove a member (their enterprise credits are reclaimed to the pool). */
  async remove(firebaseUid: string, options?: RequestOptions): Promise<Record<string, unknown>> {
    return this.client.request({
      method: "DELETE",
      path: `/members/${firebaseUid}`,
      options,
    });
  }
}

/**
 * Enterprise admin API. Authenticated with an Enterprise API key (x-enterprise-key),
 * scoped to a single organization.
 *
 * ```ts
 * const curvet = new Curvet({ enterpriseKey: process.env.CURVET_ENTERPRISE_KEY });
 * const { url } = await curvet.enterprise.invites.create({ allottedCredits: 2000 });
 * ```
 */
export class Enterprise {
  readonly invites: EnterpriseInvites;
  readonly members: EnterpriseMembers;

  constructor(private client: HttpClient) {
    this.invites = new EnterpriseInvites(client);
    this.members = new EnterpriseMembers(client);
  }

  /** Dashboard overview: pool balance, seats, and per-member usage. */
  async overview(options?: RequestOptions): Promise<EnterpriseOverview> {
    const body = await this.client.request<{ success: boolean } & EnterpriseOverview>({
      method: "GET",
      path: "/overview",
      options,
    });
    return body;
  }
}
