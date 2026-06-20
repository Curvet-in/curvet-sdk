import type { HttpClient } from "../core/http";
import type { ImageGenerateParams, ImageResponse } from "../types/image";
import type { RequestOptions } from "../types/common";

export class Images {
  constructor(private client: HttpClient) {}

  /** Generate an image from a prompt. Synchronous — resolves with `imageUrl`. */
  generate(params: ImageGenerateParams, options?: RequestOptions): Promise<ImageResponse> {
    return this.client.request<ImageResponse>({
      method: "POST",
      path: "/image",
      body: params,
      options,
    });
  }
}
