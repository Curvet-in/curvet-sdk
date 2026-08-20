import type { HttpClient } from "../core/http";
import type { ModelCapability, ModelInfo, RateLimits } from "../types/models";
import type { RequestOptions } from "../types/common";

interface ModelsListResponse {
  success: boolean;
  models: ModelInfo[];
  rateLimits: RateLimits;
}

/** Which slice of the catalogue to fetch. */
export type ModelsInclude = "runnable" | "all";

export interface ModelsListOptions extends RequestOptions {
  /** Filter to a single model type (e.g. "chat", "image", "video"). */
  type?: string;
  /**
   * Filter to a single capability. `"generation"` excludes the speech-to-text
   * models that share `type: "audio"` but run on {@link Voice.stt} instead.
   */
  capability?: ModelCapability;
  /**
   * `"runnable"` (the default, and the server's) returns only models this app
   * key can call right now. `"all"` also returns coming-soon and dashboard-only
   * entries, distinguishable by `comingSoon` / `surface` / `available`.
   */
  include?: ModelsInclude;
  /** Bypass the in-memory cache and fetch fresh. */
  refresh?: boolean;
}

/**
 * Live model catalog. The list is dynamic and per-app filtered server-side, so
 * it is always fetched (with a short in-memory cache), never hardcoded.
 */
export class Models {
  /**
   * Keyed by `include`: "runnable" and "all" are different catalogues, and a
   * single slot would serve one under the other's name.
   */
  private cache = new Map<ModelsInclude, { at: number; data: ModelsListResponse }>();

  constructor(
    private client: HttpClient,
    private cacheTtlMs = 60_000,
  ) {}

  private async load(
    include: ModelsInclude,
    options?: RequestOptions,
  ): Promise<ModelsListResponse> {
    return this.client.request<ModelsListResponse>({
      method: "GET",
      path: "/models",
      query: include === "all" ? { include: "all" } : undefined,
      options,
    });
  }

  private async ensure(options?: ModelsListOptions): Promise<ModelsListResponse> {
    const include = options?.include ?? "runnable";
    const hit = this.cache.get(include);
    const stale = !hit || Date.now() - hit.at > this.cacheTtlMs;
    if (options?.refresh || stale) {
      this.cache.set(include, { at: Date.now(), data: await this.load(include, options) });
    }
    return this.cache.get(include)!.data;
  }

  /** List available models, optionally filtered by `type` and `capability`. */
  async list(options?: ModelsListOptions): Promise<ModelInfo[]> {
    const data = await this.ensure(options);
    let models = data.models ?? [];
    if (options?.type) models = models.filter((m) => m.type === options.type);
    if (options?.capability) {
      // `capability` is absent on older deployments; treat that as "generation"
      // so a filtered call does not silently return nothing.
      models = models.filter((m) => (m.capability ?? "generation") === options.capability);
    }
    return models;
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
