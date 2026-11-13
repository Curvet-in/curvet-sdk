import type { HttpClient } from "../core/http";
import type { RequestOptions } from "../types/common";

/**
 * The key owner's balance. An owner with no account record reads as all zeros.
 * Organisation members get extra `breakdown` fields, which differ between a
 * shared organisation pool (`creditModel: "shared"`) and per-member
 * allocations.
 */
export interface BalanceInfo {
  /** USD in the wallet (for a shared-pool member: pool plus own wallet). Always sent. */
  walletBalance?: number;
  /** USD that can be spent now: wallet, points and any enterprise allocation. */
  totalAvailableUSD: number;
  /** Points (1 point = 1 credit). Always sent. */
  totalPoints?: number;
  breakdown?: {
    /** The wallet in USD. Always sent. */
    walletUSD?: number;
    /** Points, valued in USD. Always sent. */
    pointsAsUSD?: number;
    /**
     * The wallet the spend comes out of. On a shared-org plan this is the
     * ORGANISATION's pool, not the user's own money — see `personalCredits`,
     * which is what "yours" means. Naming these apart matters: a client that
     * shows `walletCredits` under a label like "personal" reports a company
     * balance as an individual one.
     */
    walletCredits?: number;
    /** Points, in credits. Always sent. */
    earnedCredits?: number;
    /** The member's OWN paid balance (shared-pool members only). Zero is normal on a shared plan. */
    personalCredits?: number;
    /**
     * @deprecated The server never sends this field; it is always undefined.
     * For what a member may spend, read `enterpriseSpendable` or
     * `orgPoolSpendable`, and `totalCredits`.
     */
    personalSpendable?: number;
    /** Credits that can be spent now. Always sent. */
    totalCredits?: number;
    /** Shared-pool members only. */
    organizationLimit?: number;
    /** Organisation members only. */
    monthlyUsed?: number;
    /** `true` for organisation members; absent otherwise. */
    isEnterprise?: boolean;
    /** `"shared"` for shared-pool members; absent otherwise. */
    creditModel?: "shared" | (string & {});
    /** Enterprise credits allotted to this member's own bucket. */
    enterpriseCredits?: number;
    /** Of those, what the monthly cap currently allows them to spend (per-member allocation only). */
    enterpriseSpendable?: number;
    /** The member's monthly cap in credits (per-member allocation only); 0 = no cap. */
    creditLimit?: number;
    /** What is left of `creditLimit` (per-member allocation only); null when there is no cap. */
    creditLimitRemaining?: number | null;
    /** Whether this member spends the shared org pool directly (per-member allocation only). */
    drawsFromPool?: boolean;
    /** Full org pool balance — organisation members only. */
    orgPoolCredits?: number;
    /** Pool credits spendable right now, after the monthly cap (per-member allocation only). */
    orgPoolSpendable?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export class Balance {
  constructor(private client: HttpClient) {}

  /** Get the current credit balance for the app owner. */
  async get(options?: RequestOptions): Promise<BalanceInfo> {
    const body = await this.client.request<{ success: boolean; balance: BalanceInfo }>({
      method: "GET",
      path: "/balance",
      options,
    });
    return body.balance;
  }
}
