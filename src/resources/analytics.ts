import type { HttpClient } from "../core/http";
import type { RequestOptions } from "../types/common";

export interface AnalyticsParams extends RequestOptions {
  /** ISO 8601 start date. */
  startDate?: string;
  /** ISO 8601 end date. */
  endDate?: string;
}

export interface AnalyticsResult {
  totalRequests?: number;
  totalCost?: number;
  requestsByModel?: Record<string, number>;
  requestsByCategory?: Record<string, number>;
  [key: string]: unknown;
}

export class Analytics {
  constructor(private client: HttpClient) {}

  /** Usage analytics for the app, optionally bounded by a date range. */
  async get(params: AnalyticsParams = {}): Promise<AnalyticsResult> {
    const { startDate, endDate, ...options } = params;
    const body = await this.client.request<{ success: boolean; analytics: AnalyticsResult }>({
      method: "GET",
      path: "/analytics",
      query: { startDate, endDate },
      options,
    });
    return body.analytics;
  }
}
