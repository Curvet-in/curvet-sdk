import type { HttpClient } from "../core/http";
import type { ModelInfo, RateLimits } from "../types/models";
import type { RequestOptions } from "../types/common";

interface ModelsListResponse {
  success: boolean;
  models: ModelInfo[];
  rateLimits: RateLimits;
}

export interface ModelsListOptions extends RequestOptions {
  /** Filter to a single model type (e.g. "chat", "image", "video"). */
  type?: string;
  /** Bypass the in-memory cache and fetch fresh. */
  refresh?: boolean;
}

/**
 * Live model catalog. The list is dynamic and per-app filtered server-side, so
 * it is always fetched (with a short in-memory cache), never hardcoded.
 */
export class Models {
  private cache?: { at: number; data: ModelsListResponse };

  constructor(
    private client: HttpClient,
    private cacheTtlMs = 60_000,
  ) {}

  private async load(options?: RequestOptions): Promise<ModelsListResponse> {
    return this.client.request<ModelsListResponse>({
      method: "GET",
      path: "/models",
      options,
    });
  }

  private async ensure(options?: ModelsListOptions): Promise<ModelsListResponse> {
    const stale = !this.cache || Date.now() - this.cache.at > this.cacheTtlMs;
    if (options?.refresh || stale) {
      this.cache = { at: Date.now(), data: await this.load(options) };
    }
    return this.cache!.data;
  }

  /** List available models, optionally filtered by `type`. */
  async list(options?: ModelsListOptions): Promise<ModelInfo[]> {
    const data = await this.ensure(options);
    const models = data.models ?? [];
    return options?.type ? models.filter((m) => m.type === options.type) : models;
  }

  /** Find a single model by id (or undefined). */
  async get(id: string, options?: ModelsListOptions): Promise<ModelInfo | undefined> {
    return (await this.list(options)).find((m) => m.id === id);
  }

  /** The app's rate limits as reported by GET /models. */
  async rateLimits(options?: ModelsListOptions): Promise<RateLimits | undefined> {
    return (await this.ensure(options)).rateLimits;
  }
}
