import type { HttpClient } from "../core/http";
import type { ImageGenerateParams, ImageResponse } from "../types/image";
import type { RequestOptions } from "../types/common";

export class Images {
  constructor(private client: HttpClient) {}

  /**
   * Generate an image from a prompt. Synchronous — resolves with `imageUrl`.
   * Sends JSON, or multipart/form-data when `files` are given.
   */
  generate(params: ImageGenerateParams, options?: RequestOptions): Promise<ImageResponse> {
    return this.client.request<ImageResponse>({
      method: "POST",
      path: "/image",
      body: buildBody(params),
      options,
    });
  }
}

function buildBody(params: ImageGenerateParams): unknown {
  const { files, ...fields } = params;
  if (!files || files.length === 0) return fields;
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null) form.append(k, String(v));
  }
  for (const file of files) form.append("files", file);
  return form;
}
