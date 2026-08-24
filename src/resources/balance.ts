import type { HttpClient } from "../core/http";
import type { RequestOptions } from "../types/common";

export interface BalanceInfo {
  walletBalance?: number;
  totalAvailableUSD: number;
  totalPoints?: number;
  breakdown?: {
    /**
     * The wallet the spend comes out of. On a shared-org plan this is the
     * ORGANISATION's pool, not the user's own money — see `personalCredits`,
     * which is what "yours" means. Naming these apart matters: a client that
     * shows `walletCredits` under a label like "personal" reports a company
     * balance as an individual one.
     */
    walletCredits?: number;
    /** The member's OWN paid balance. Zero is normal on a shared plan. */
    personalCredits?: number;
    /** Of that, what they are actually allowed to spend (config-dependent). */
    personalSpendable?: number;
    totalCredits?: number;
    organizationLimit?: number;
    monthlyUsed?: number;
    isEnterprise?: boolean;
    /** Enterprise credits allotted to this member's own bucket. */
    enterpriseCredits?: number;
    /** Of those, what the monthly cap currently allows them to spend. */
    enterpriseSpendable?: number;
    /** Whether this member spends the shared org pool directly. */
    drawsFromPool?: boolean;
    /** Full org pool balance — only present for members who draw it. */
    orgPoolCredits?: number;
    /** Pool credits spendable right now, after the monthly cap. */
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
