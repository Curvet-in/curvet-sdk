import type { HttpClient } from "../core/http";
import type { RequestOptions } from "../types/common";

export interface BalanceInfo {
  walletBalance?: number;
  totalAvailableUSD: number;
  totalPoints?: number;
  breakdown?: {
    walletCredits?: number;
    totalCredits?: number;
    organizationLimit?: number;
    monthlyUsed?: number;
    isEnterprise?: boolean;
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
