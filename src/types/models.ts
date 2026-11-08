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
 * at request time. `embedding` models turn text into vectors on
 * `embeddings.create()`.
 */
export type ModelCapability = "generation" | "transcription" | "embedding" | (string & {});

/**
 * Which surface can actually execute a model. `"api"` means an app key reaches
 * it; `"dashboard"` means it is wired only into the session-authed UI routes and
 * is therefore not callable from this SDK.
 */
export type ModelSurface = "api" | "dashboard" | (string & {});

/**
 * Per-token rates, for models that meter tokens. Null for every flat-rate
 * modality (image, video, audio, 3d), which charge {@link ModelInfo.credits}
 * per request instead.
 */
export interface ModelPricing {
  meter: "tokens" | (string & {});
  unit: "credits_per_million_tokens" | (string & {});
  billing: "metered" | "flat" | (string & {});
  input?: number;
  output?: number;
  cached_input?: number;
  [key: string]: unknown;
}

export interface ModelInfo {
  /** The Curvet id. Responses report this id, whichever alias a request used. */
  id: string;
  name: string;
  cost: number;
  type: ModelType;
  provider: string;
  credits: number;
  supportsVision?: boolean;
  /** "generation" | "transcription" | "embedding" — see {@link ModelCapability}. */
  capability?: ModelCapability;
  /** Whether a call to this model right now reaches real executor code. */
  available?: boolean;
  /** Announced but not yet callable. Only ever true under `include: "all"`. */
  comingSoon?: boolean;
  /**
   * The route that runs it, e.g. `"POST /api/v1/playground/chat"`, or
   * `"POST /api/v1/embeddings"` for an embedding model.
   */
  endpoint?: string | null;
  /** Where it runs — only `"api"` models are reachable with an app key. */
  surface?: ModelSurface | null;
  /** Token rates when the model meters tokens; null when it is flat-rate. */
  pricing?: ModelPricing | null;
  /**
   * Other ids the server accepts for this same model, such as the OpenRouter-style
   * `"meta-llama/llama-3.3-70b-instruct"` for `llama-3.3-70b`. A request may use
   * any of them. Absent on deployments that predate aliases.
   */
  aliases?: string[];
  /** Length of each vector, for `type: "embedding"` models (e.g. 1536). */
  dims?: number;
}

export interface RateLimits {
  requestsPerHour: number;
  costCapPerDay: number;
}

/**
 * Known embedding model IDs — editor autocomplete for `embeddings.create()`.
 * Any string is accepted (see {@link EmbeddingModelId}).
 *
 * - `text-embedding-3-small` (OpenAI): 1536 dimensions, shortened with `dimensions`.
 * - `all-minilm-l6-v2` (all-MiniLM-L6-v2): 384 dimensions, fixed.
 */
export type KnownEmbeddingModelId = "text-embedding-3-small" | "all-minilm-l6-v2";

/** An embedding model ID. Accepts any string; {@link KnownEmbeddingModelId} drives autocomplete only. */
export type EmbeddingModelId = KnownEmbeddingModelId | (string & {});

/**
 * Known model IDs — provided purely for editor autocomplete.
 * The model catalog is dynamic and per-app filtered, so any string is accepted
 * (see {@link ModelId}); always call `models.list()` for the live catalog.
 * OpenRouter-style ids such as `meta-llama/llama-3.3-70b-instruct` are accepted
 * as aliases of these (see {@link ModelInfo.aliases}).
 */
export type KnownModelId =
  // chat
  | "gpt-4o"
  | "gpt-4o-mini"
  | "qwen-235b"
  | "gemma-4-26b"
  | "gemini-2.5-flash"
  | "gemini-2.5-flash-lite"
  | "deepseek-chat"
  | "gpt-oss-120b"
  | "llama-3.3-70b"
  | "gemma-4-31b"
  | "nemotron-3.5-lightning"
  | "nemotron-3-super-120b"
  | "nemotron-3.5-super-vl"
  | "nemotron-3-ultra-550b"
  | "ali-qwen3.7-flash"
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
  // embeddings
  | KnownEmbeddingModelId
  // smart router pseudo-models
  | "auto"
  | "smart";

/** A model ID. Accepts any string; {@link KnownModelId} drives autocomplete only. */
export type ModelId = KnownModelId | (string & {});
