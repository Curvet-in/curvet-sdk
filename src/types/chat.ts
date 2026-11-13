import type { ModelId } from "./models";
import type { Usage } from "./common";

export type ChatRole = "system" | "user" | "assistant";

/** A message whose content is plain text. */
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** A text block inside a message's `content` array. */
export interface ChatTextPart {
  type: "text";
  text: string;
}

/**
 * An image block inside a message's `content` array, read by vision models
 * (`supportsVision` on the model). The server accepts OpenAI's
 * `{ type: "image_url", image_url: { url } }`, the Responses API's
 * `{ type: "input_image", image_url }` and Anthropic-style `{ type: "image", … }`;
 * the image is an https URL or a `data:` URI.
 */
export interface ChatImagePart {
  type: "image_url" | "input_image" | "image";
  image_url?: string | { url: string; detail?: string };
  url?: string;
  source?: unknown;
}

/** One block of a message's `content` array. */
export type ChatContentPart = ChatTextPart | ChatImagePart;

/** A message whose content is an array of text and image blocks. */
export interface ChatContentMessage {
  role: ChatRole;
  content: string | ChatContentPart[];
}

/**
 * JSON mode. `{ type: "json_object" }` asks for any JSON object;
 * `{ type: "json_schema", json_schema: { name, schema, strict } }` for one
 * matching a schema. `{ type: "text" }` is the default. A model whose provider
 * does not take it ignores it and names it in the `X-Curvet-Ignored-Params`
 * response header.
 */
export interface ChatResponseFormat {
  type: "text" | "json_object" | "json_schema";
  /** Required when `type` is `"json_schema"`. Only `schema` is checked: an object, or null. */
  json_schema?: {
    name?: string;
    schema?: Record<string, unknown> | null;
    strict?: boolean;
    [key: string]: unknown;
  };
}

/** How hard a reasoning model thinks. A model that does not take it ignores it. */
export type ChatReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | (string & {});

export interface ChatCreateParams {
  model: ModelId;
  /** Messages; `content` is a string, or an array of text and image blocks. */
  messages: Array<ChatMessage | ChatContentMessage>;
  /** Creativity control (default 0.7). */
  temperature?: number;
  /**
   * Maximum response tokens. Without it, a call billed per token gets the
   * provider's own limit and any other call the model's default (1000 for
   * most). See `maxOutputTokens` on the model.
   */
  maxTokens?: number;
  /**
   * `true` lets another model answer when this one fails (its fallback chain,
   * never a dearer model). Default: strict — only the model asked for answers.
   */
  allowFallbacks?: boolean;
  /** JSON mode; see {@link ChatResponseFormat}. null is the same as absent. */
  responseFormat?: ChatResponseFormat | null;
  /** Nucleus sampling, 0 to 1. null is the same as absent. */
  topP?: number | null;
  /** A stop sequence, or up to 4. `""`, `[]` and null mean none. */
  stop?: string | string[] | null;
  /** A safe integer, for providers that take a seed. null is the same as absent. */
  seed?: number | null;
  /** -2 to 2. null is the same as absent. */
  frequencyPenalty?: number | null;
  /** -2 to 2. null is the same as absent. */
  presencePenalty?: number | null;
  /**
   * Reasoning level for the models that take one. Never refused: a model that
   * does not take it (or a value it does not know) has it left out, named in
   * `X-Curvet-Ignored-Params`.
   */
  reasoningEffort?: ChatReasoningEffort;
  /** One image (https URL or `data:` URI) for a vision model, besides any in the messages. */
  imageUrl?: string;
  /** Images (https URLs or `data:` URIs) for a vision model, besides any in the messages. */
  images?: string[];
}

/** Usage on a chat reply: the charge, plus the tokens behind it. */
export interface ChatUsage extends Usage {
  /** Input tokens, cached input included. null when the provider reported no usage. */
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  /**
   * `"metered"` when billed per token on these counts, `"flat"` when the
   * model's per-call credit applied.
   */
  billing?: "metered" | "flat" | (string & {});
  /**
   * USD in the owner's own wallet after the charge — the wallet alone, without
   * points or enterprise credits (the media routes' `remainingBalance` is a
   * different figure). Absent when the balance could not be read.
   */
  remainingBalance?: number;
}

export interface ChatResponse {
  success: boolean;
  /**
   * The answer's text.
   *
   * **Can be null at runtime** — the server sends null when the model answered
   * with no text (see `finishReason`, e.g. `"tool_calls"`, or a provider that
   * returned an empty answer). The type stays `string` in this release so that
   * existing code such as `res.response.trim()` keeps compiling; guard with
   * `res.response ?? ""` where it matters.
   */
  response: string;
  /**
   * Why the answer stopped: `"stop"`, `"length"` (cut at the answer limit),
   * `"tool_calls"`, or a provider's own value; null when none was reported.
   */
  finishReason?: string | null;
  usage: ChatUsage;
  metadata: {
    /**
     * The model asked for, after alias, retired-id and `"auto"` resolution.
     * With `allowFallbacks` the model that answered may differ.
     */
    model: string;
    latencyMs: number;
    /**
     * The charge's id (the metered job's id under metered billing). The server
     * can omit it; older SDK versions typed it as always present.
     */
    requestId?: string;
    /** The `Idempotency-Key` the call was sent with. */
    idempotencyKey?: string;
  };
}
