import type { EmbeddingModelId } from "./models";

/**
 * How vectors come back. `"float"` (the default) returns each embedding as a
 * `number[]`; `"base64"` returns it as a base64 string of little-endian float32
 * values, which is about a quarter of the JSON size for large batches.
 */
export type EmbeddingEncodingFormat = "float" | "base64";

/**
 * Parameters for `embeddings.create()` — OpenAI's request shape, field for
 * field, snake_case included, so the same object works against any
 * OpenAI-compatible client pointed at Curvet.
 */
export interface EmbeddingCreateParams {
  /**
   * Embedding model id, or one of its aliases (`"openai/text-embedding-3-small"`,
   * `"sentence-transformers/all-minilm-l6-v2"`). Chat models are refused.
   */
  model: EmbeddingModelId;
  /**
   * One text, or a batch of up to 2048 texts. Each item gets its own vector, and
   * `data[i].index` is that item's position in this array. Items must be
   * non-empty and fit the model's input limit; longer ones are refused with a
   * `BadRequestError`, never truncated.
   */
  input: string | string[];
  /**
   * Output vector length, for models that can shorten their output
   * (`text-embedding-3-small`). A fixed-size model such as `all-minilm-l6-v2`
   * refuses it with a `BadRequestError`.
   */
  dimensions?: number;
  /** Defaults to `"float"`. See {@link EmbeddingEncodingFormat}. */
  encoding_format?: EmbeddingEncodingFormat;
  /** An id for your end user, passed through as in OpenAI's API. */
  user?: string;
}

/** One input's vector. */
export interface Embedding<E extends number[] | string = number[]> {
  object: "embedding";
  /** Position of the matching item in `input`. */
  index: number;
  /** `number[]` for `encoding_format: "float"`, a base64 string for `"base64"`. */
  embedding: E;
}

export interface EmbeddingUsage {
  prompt_tokens: number;
  total_tokens: number;
}

/**
 * What a call cost, as Curvet reports it in the response body: the same figures
 * as the `X-Curvet-Credits-Charged`, `X-Curvet-Billing` and `X-Curvet-Tokens-In`
 * headers, which this SDK does not expose.
 */
export interface EmbeddingCharge {
  /** Credits deducted for this call. */
  credits_charged?: number;
  /** How the call was billed: `"metered"`, per input token. */
  billing?: "metered" | (string & {});
  /** Input tokens billed. */
  tokens_in?: number;
}

/** OpenAI's embeddings response: one {@link Embedding} per input, in input order. */
export interface EmbeddingResponse<E extends number[] | string = number[]> {
  object: "list";
  data: Embedding<E>[];
  /** The Curvet id of the model that produced the vectors, even when the request named an alias. */
  model: string;
  usage: EmbeddingUsage;
  /** Curvet's own addition to OpenAI's shape. Absent on deployments that predate it. */
  x_curvet?: EmbeddingCharge;
  [key: string]: unknown;
}
