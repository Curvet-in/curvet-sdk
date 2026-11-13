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
  /** Total spent by this group, in the usage records' unit. */
  totalCost?: number;
  /** Request count. Status and error breakdowns use `count` instead. */
  requestCount?: number;
  count?: number;
  /** On the category breakdown; null when it could not be computed. */
  avgCostPerRequest?: number | null;
  /** Mean latency in ms; null when no row in the group recorded one. */
  avgLatency?: number | null;
  /** Model type, on the model breakdown; null when the records lack one. */
  category?: string | null;
  [key: string]: unknown;
}

export interface AnalyticsOverview {
  /** The aggregation's group key: null, present when there was any usage. */
  _id?: null;
  totalCost?: number;
  totalRequests?: number;
  avgCostPerRequest?: number | null;
  avgLatency?: number | null;
  [key: string]: unknown;
}

/** The app the key belongs to, as `/analytics` reports it. */
export interface AnalyticsApp {
  name: string;
  /** The app's legacy appKey, in full; null when it has none. */
  appKey: string | null;
}

/**
 * Usage analytics as `/analytics` returns them: an overview plus four aggregate
 * breakdowns, and the `app` they belong to.
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
  /**
   * The app these numbers belong to. Sent beside `analytics` in the reply;
   * the SDK puts it here.
   */
  app?: AnalyticsApp;
  /** @deprecated Never returned by the server; always undefined. Read `overview.totalRequests`. */
  totalRequests?: number;
  /** @deprecated Never returned by the server; always undefined. Read `overview.totalCost`. */
  totalCost?: number;
  /** @deprecated Never returned by the server; always undefined. Read `modelBreakdown`. */
  requestsByModel?: Record<string, number>;
  /** @deprecated Never returned by the server; always undefined. Read `categoryBreakdown`. */
  requestsByCategory?: Record<string, number>;
  [key: string]: unknown;
}

export class Analytics {
  constructor(private client: HttpClient) {}

  /** Usage analytics for the app, optionally bounded by a date range. */
  async get(params: AnalyticsParams = {}): Promise<AnalyticsResult> {
    const { startDate, endDate, ...options } = params;
    const body = await this.client.request<{
      success: boolean;
      analytics: AnalyticsResult;
      app?: AnalyticsApp;
    }>({
      method: "GET",
      path: "/analytics",
      query: { startDate, endDate },
      options,
    });
    const analytics = body.analytics;
    // `app` arrives beside `analytics`; carry it on the result rather than drop it.
    if (analytics && typeof analytics === "object" && body.app !== undefined && analytics.app === undefined) {
      return { ...analytics, app: body.app };
    }
    return analytics;
  }
}
