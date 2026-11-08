import type { HttpClient } from "../core/http";
import type { RequestOptions } from "../types/common";
import type { EmbeddingCreateParams, EmbeddingResponse } from "../types/embeddings";

/**
 * Text embeddings.
 *
 * Served by `POST /api/v1/embeddings`, the OpenAI-compatible surface. That is a
 * sibling of the playground, not part of it, so this resource uses the v1-root
 * client, as `food` and `voice` do. Request and response are OpenAI's shapes
 * exactly, so a vector from here and one from an OpenAI client pointed at the
 * same base URL are interchangeable.
 */
export class Embeddings {
  constructor(private client: HttpClient) {}

  /**
   * Embed one text or a batch.
   *
   * ```ts
   * const { data } = await curvet.embeddings.create({
   *   model: "text-embedding-3-small",
   *   input: ["first text", "second text"],
   * });
   * data[0].embedding; // number[]
   * ```
   */
  create(
    params: EmbeddingCreateParams & { encoding_format: "base64" },
    options?: RequestOptions,
  ): Promise<EmbeddingResponse<string>>;
  create(
    params: EmbeddingCreateParams & { encoding_format?: "float" },
    options?: RequestOptions,
  ): Promise<EmbeddingResponse<number[]>>;
  create(
    params: EmbeddingCreateParams,
    options?: RequestOptions,
  ): Promise<EmbeddingResponse<number[] | string>>;
  create(
    params: EmbeddingCreateParams,
    options?: RequestOptions,
  ): Promise<EmbeddingResponse<number[] | string>> {
    return this.client.request<EmbeddingResponse<number[] | string>>({
      method: "POST",
      path: "/embeddings",
      body: params,
      options,
    });
  }
}
