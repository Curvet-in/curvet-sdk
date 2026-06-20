import type { HttpClient } from "../core/http";
import type { RequestOptions } from "../types/common";

export interface FoodItem {
  [key: string]: unknown;
}

/**
 * Indian Food Dataset API. Mounted as a sibling of the playground under
 * `/api/v1/food`, so it uses the v1-root HTTP client. Requires the app to have
 * Food API access enabled.
 */
export class Food {
  constructor(private client: HttpClient) {}

  /** List dishes (default limit 20). */
  async list(opts?: { limit?: number } & RequestOptions): Promise<FoodItem[]> {
    const { limit, ...options } = opts ?? {};
    const body = await this.client.request<{ success: boolean; data: FoodItem[]; count: number }>({
      method: "GET",
      path: "/food",
      query: { limit },
      options,
    });
    return body.data;
  }

  /** Full-text search for dishes. */
  async search(query: string, opts?: { limit?: number } & RequestOptions): Promise<FoodItem[]> {
    const { limit, ...options } = opts ?? {};
    const body = await this.client.request<{ success: boolean; data: FoodItem[] }>({
      method: "GET",
      path: "/food/search",
      query: { q: query, limit },
      options,
    });
    return body.data;
  }

  /** Natural-language dish recommendations. */
  async recommendations(prompt: string, options?: RequestOptions): Promise<FoodItem[]> {
    const body = await this.client.request<{ success: boolean; data: FoodItem[] }>({
      method: "POST",
      path: "/food/recommendations",
      body: { prompt },
      options,
    });
    return body.data;
  }
}
