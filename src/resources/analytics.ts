import type { HttpClient } from "../core/http";
import type { RequestOptions } from "../types/common";

export interface AnalyticsParams extends RequestOptions {
  /** ISO 8601 start date. */
  startDate?: string;
  /** ISO 8601 end date. */
  endDate?: string;
}

/**
 * One row of a `$group` aggregate. `_id` is whatever the breakdown grouped by —
 * a model id, a category, a status, an error code — and is null when the value
 * was missing on the underlying records.
 */
export interface AnalyticsBreakdownRow {
  _id: string | null;
  /** Total USD spent by this group. */
  totalCost?: number;
  /** Request count. Status and error breakdowns use `count` instead. */
  requestCount?: number;
  count?: number;
  avgCostPerRequest?: number;
  /** Mean latency in ms; null when no row in the group recorded one. */
  avgLatency?: number | null;
  /** Model type, present on the model breakdown. */
  category?: string;
  [key: string]: unknown;
}

export interface AnalyticsOverview {
  totalCost?: number;
  totalRequests?: number;
  avgCostPerRequest?: number;
  avgLatency?: number | null;
  [key: string]: unknown;
}

/**
 * Usage analytics as `/analytics` actually returns them: an overview plus four
 * aggregate breakdowns. Every field is optional because a deployment may add or
 * omit a breakdown, and the flat `totalRequests` / `requestsByModel` keys are
 * retained for the older, flatter shape some deployments still return.
 */
export interface AnalyticsResult {
  overview?: AnalyticsOverview;
  /** Per-model cost, request count and latency, sorted by cost descending. */
  modelBreakdown?: AnalyticsBreakdownRow[];
  /** Per-modality ("chat", "image", "video", …) cost and request count. */
  categoryBreakdown?: AnalyticsBreakdownRow[];
  /** Request counts by terminal status ("completed", "refunded", "failed"). */
  statusBreakdown?: AnalyticsBreakdownRow[];
  /** Failure counts by error code. */
  errorBreakdown?: AnalyticsBreakdownRow[];
  /** @deprecated Older flat shape; prefer `overview.totalRequests`. */
  totalRequests?: number;
  /** @deprecated Older flat shape; prefer `overview.totalCost`. */
  totalCost?: number;
  /** @deprecated Older flat shape; prefer `modelBreakdown`. */
  requestsByModel?: Record<string, number>;
  /** @deprecated Older flat shape; prefer `categoryBreakdown`. */
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
