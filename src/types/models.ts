export type ModelType =
  | "chat"
  | "image"
  | "video"
  | "audio"
  | "3d"
  | "web-browse"
  | "design"
  | "ui-builder"
  | "presentation"
  | "embedding"
  | (string & {});

/**
 * What a model *does*, as opposed to what modality it belongs to.
 *
 * `type: "audio"` covers both text-to-speech and speech-to-text, and the two are
 * not interchangeable: a `transcription` model takes an audio file on
 * `voice.stt()`, not a prompt on `audio.generate()`. Without this field the two
 * are indistinguishable in the catalogue, and picking the wrong one fails only
 * at request time. `music` models make music from a prompt on
 * `audio.generate()`; `embedding` models turn text into vectors.
 */
export type ModelCapability =
  | "generation"
  | "transcription"
  | "music"
  | "embedding"
  | (string & {});

/**
 * Which surface can actually execute a model. `"api"` means an app key reaches
 * it; `"dashboard"` means it is wired only into the session-authed UI routes and
 * is therefore not callable from this SDK.
 */
export type ModelSurface = "api" | "dashboard" | (string & {});

/** One prompt-size tier of a model priced by prompt size. */
export interface ModelPricingTier {
  /** The tier applies from this many prompt tokens up. */
  min_prompt_tokens: number;
  input: number;
  output: number;
}

/**
 * Per-token rates in credits per million tokens, for models with a verified
 * token rate. Null for image, video, audio and 3d models, and for chat models
 * without a verified rate, which charge {@link ModelInfo.credits} per request
 * instead.
 */
export interface ModelPricing {
  meter: "tokens" | (string & {});
  unit: "credits_per_million_tokens" | (string & {});
  /**
   * `"metered"` when a call is billed on these rates now; `"flat_per_request"`
   * when the model's flat per-call credit still applies. (`"flat"` is what
   * earlier SDK versions documented; the server sends `"flat_per_request"`.)
   */
  billing: "metered" | "flat_per_request" | "flat" | (string & {});
  input?: number;
  /** 0 for an embedding model. */
  output?: number;
  /** Only for models with a cache-read rate. */
  cached_input?: number;
  /** Only for models priced by prompt size. */
  tiers?: ModelPricingTier[];
  /** Embedding models only: the minimum charge per request, in credits. */
  minimum_per_request?: number;
  [key: string]: unknown;
}

/** The same rate card as {@link ModelPricing}; `x_curvet_pricing` on the OpenAI-style list. */
export type CurvetPricing = ModelPricing;

export interface ModelInfo {
  id: string;
  name: string;
  /** Flat price per call in USD. Not always `credits / 100`: the two are separate columns of the price table. */
  cost: number;
  type: ModelType;
  provider: string;
  /** Flat price per call in credits. For an embedding model, the per-request minimum. */
  credits: number;
  /**
   * Other ids the server accepts for this model: OpenRouter-style aliases for
   * chat models (e.g. `"meta-llama/llama-3.3-70b-instruct"`). Usually empty.
   */
  aliases?: string[];
  /** `"mine"` on the key owner's own custom models; absent otherwise. */
  group?: "mine" | (string & {});
  /** Custom models only: the model it was tuned from. */
  baseModel?: string | null;
  supportsVision?: boolean;
  /** "generation" | "transcription" | "music" | "embedding" — see {@link ModelCapability}. */
  capability?: ModelCapability;
  /** The provider's maximum answer in tokens, where verified. */
  maxOutputTokens?: number;
  /** Whether a call to this model right now reaches real executor code (configured, and not blocked by health). */
  available?: boolean;
  /** Announced but not yet callable. Only ever true under `include: "all"`. */
  comingSoon?: boolean;
  /** The route that runs it, e.g. `"POST /api/v1/playground/chat"`; null when none does. */
  endpoint?: string | null;
  /** Where it runs — only `"api"` models are reachable with an app key. */
  surface?: ModelSurface | null;
  /** Token rates when the model meters tokens; null when it is flat-rate. */
  pricing?: ModelPricing | null;
  /** Why the model is not available now; null when it is. */
  unavailableReason?: string | null;
  /** From the server's model health readings; `"unknown"` when there is none. */
  healthStatus?: string;
  /** Embedding models only: vector length. */
  dims?: number;
  /** Embedding models only: whether `dimensions` is accepted. */
  supportsDimensions?: boolean;
  /** Embedding models only: the most tokens one input may have. */
  maxInputTokens?: number;
}

/**
 * A model's rates in OpenRouter's shape: USD per token, as decimal strings.
 * `pricing` on the OpenAI-style model list.
 */
export interface OpenRouterPricing {
  prompt: string;
  completion: string;
  request: string;
  image: string;
  input_cache_read?: string;
  input_cache_write?: string;
}

/**
 * One model on the OpenAI-style list (`GET /api/v1/models`,
 * `GET /api/v1/public/models`, `GET /api/v1/models/{model}`) — what an
 * OpenAI-compatible client pointed at Curvet reads. This SDK's own
 * `models.list()` reads the richer playground catalogue ({@link ModelInfo}).
 */
export interface OpenAIModel {
  /** Curvet's id, also when the request named an alias. */
  id: string;
  object: "model";
  /** A fixed timestamp; the catalogue has no creation date. */
  created: number;
  /** The provider (openai, anthropic, google, …), or "custom". */
  owned_by: string;
  aliases: string[];
  /** Curvet's rate card, where the model has a verified token rate. */
  x_curvet_pricing?: CurvetPricing;
  /** The same rates in OpenRouter's shape. */
  pricing?: OpenRouterPricing;
  /** Chat models: the context window. Embedding models: the most tokens one input may have. */
  context_length?: number;
  /** The provider's maximum answer, where verified. */
  max_output_tokens?: number;
  /** Embedding models only: the vector length. */
  dimensions?: number;
  architecture: {
    input_modalities: Array<"text" | "image" | (string & {})>;
    output_modalities: Array<"text" | "embeddings" | (string & {})>;
  };
}

/** The OpenAI-style model list: `{ object: "list", data: [...] }`. */
export interface OpenAIModelList {
  object: "list";
  data: OpenAIModel[];
}

export interface RateLimits {
  requestsPerHour: number;
  costCapPerDay: number;
}

/**
 * Known model IDs — provided purely for editor autocomplete.
 * The model catalog is dynamic and per-app filtered, so any string is accepted
 * (see {@link ModelId}); always call `models.list()` for the live catalog.
 */
export type KnownModelId =
  // chat
  | "gpt-4o"
  | "gpt-4o-mini"
  | "qwen-235b"
  | "gemma-4-26b"
  | "perplexity-sonar"
  | "claude-haiku-4-5-20251001"
  | "claude-sonnet-4-6"
  | "claude-opus-4-7"
  // image
  | "flux-2-klein-4b"
  // video
  | "wan-2.2"
  // transcription
  | "whisper-large-v3"
  | "elevenlabs-scribe"
  | "ali-qwen3-asr-flash"
  // smart router pseudo-models
  | "auto"
  | "smart";

/** A model ID. Accepts any string; {@link KnownModelId} drives autocomplete only. */
export type ModelId = KnownModelId | (string & {});
