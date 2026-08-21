import type { HttpClient } from "../core/http";
import type { RequestOptions } from "../types/common";
import type { ModelId, ModelType } from "../types/models";

export interface AppRateLimits {
  requestsPerHour?: number;
  /** USD per day. */
  costCapPerDay?: number;
}

export interface DeveloperApp {
  _id: string;
  name: string;
  description?: string;
  status?: "draft" | "live" | (string & {});
  appKey?: string;
  playgroundEnabled?: boolean;
  /** Empty means every model the account can reach. */
  allowedModels?: ModelId[];
  allowedCategories?: ModelType[];
  rateLimits?: AppRateLimits;
  createdAt?: string;
  [key: string]: unknown;
}

export interface CreateAppParams {
  name: string;
  description?: string;
  website?: string;
  category?: string;
  /** Restrict the app to these model ids. Omit for no restriction. */
  allowedModels?: ModelId[];
  allowedCategories?: ModelType[];
  rateLimits?: AppRateLimits;
}

export type UpdateAppParams = Partial<CreateAppParams> & {
  status?: string;
  playgroundEnabled?: boolean;
};

export interface RotatedKeys {
  appKey: string;
  /** Shown once — it is not readable again. */
  appSecret: string;
}

/**
 * App management, authenticated with a CLI token from `curvet login`.
 *
 * Not reachable with an app key: an app key authenticates an *app*, and letting
 * one mint or rotate another would make revoking it meaningless. Requires the
 * `apps:read` / `apps:write` / `apps:keys` scopes accordingly.
 */
export class Apps {
  constructor(private client: HttpClient) {}

  /** Every app on the account. Needs `apps:read`. */
  async list(options?: RequestOptions): Promise<DeveloperApp[]> {
    const body = await this.client.request<{ data?: DeveloperApp[]; apps?: DeveloperApp[] }>({
      method: "GET",
      path: "/apps",
      options,
    });
    return body.data ?? body.apps ?? [];
  }

  /** One app by id. Needs `apps:read`. */
  async retrieve(appId: string, options?: RequestOptions): Promise<DeveloperApp> {
    const body = await this.client.request<{ data?: DeveloperApp } & DeveloperApp>({
      method: "GET",
      path: `/apps/${appId}`,
      options,
    });
    return body.data ?? body;
  }

  /** Create an app and get its key. Needs `apps:write`. */
  async create(params: CreateAppParams, options?: RequestOptions): Promise<DeveloperApp> {
    const body = await this.client.request<{ data?: DeveloperApp; app?: DeveloperApp }>({
      method: "POST",
      path: "/apps",
      body: params,
      options,
    });
    return (body.data ?? body.app) as DeveloperApp;
  }

  /** Update an app's configuration. Needs `apps:write`. */
  async update(
    appId: string,
    params: UpdateAppParams,
    options?: RequestOptions,
  ): Promise<DeveloperApp> {
    const body = await this.client.request<{ data?: DeveloperApp } & DeveloperApp>({
      method: "PATCH",
      path: `/apps/${appId}`,
      body: params,
      options,
    });
    return body.data ?? body;
  }

  /** Delete an app and its data. Needs `apps:write`. Not reversible. */
  async delete(appId: string, options?: RequestOptions): Promise<void> {
    await this.client.request({ method: "DELETE", path: `/apps/${appId}`, options });
  }

  /**
   * Replace an app's key and secret. Needs `apps:keys`.
   *
   * The old key stops working immediately, so anything still using it starts
   * failing the moment this returns — including deployed apps.
   */
  async rotateKeys(appId: string, options?: RequestOptions): Promise<RotatedKeys> {
    const body = await this.client.request<{ data: RotatedKeys }>({
      method: "POST",
      path: `/apps/${appId}/rotate-keys`,
      body: {},
      options,
    });
    return body.data;
  }

  /** Read an app's secret. Needs `apps:keys`. */
  async secret(appId: string, options?: RequestOptions): Promise<string> {
    const body = await this.client.request<{ data?: { appSecret?: string }; appSecret?: string }>({
      method: "GET",
      path: `/apps/${appId}/secret`,
      options,
    });
    return (body.data?.appSecret ?? body.appSecret) as string;
  }
}
