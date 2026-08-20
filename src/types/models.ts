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
  | (string & {});

/**
 * What a model *does*, as opposed to what modality it belongs to.
 *
 * `type: "audio"` covers both text-to-speech and speech-to-text, and the two are
 * not interchangeable: a `transcription` model takes an audio file on
 * `voice.stt()`, not a prompt on `audio.generate()`. Without this field the two
 * are indistinguishable in the catalogue, and picking the wrong one fails only
 * at request time.
 */
export type ModelCapability = "generation" | "transcription" | (string & {});

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
  id: string;
  name: string;
  cost: number;
  type: ModelType;
  provider: string;
  credits: number;
  supportsVision?: boolean;
  /** "generation" | "transcription" — see {@link ModelCapability}. */
  capability?: ModelCapability;
  /** Whether a call to this model right now reaches real executor code. */
  available?: boolean;
  /** Announced but not yet callable. Only ever true under `include: "all"`. */
  comingSoon?: boolean;
  /** The route that runs it, e.g. `"POST /api/v1/playground/chat"`. */
  endpoint?: string | null;
  /** Where it runs — only `"api"` models are reachable with an app key. */
  surface?: ModelSurface | null;
  /** Token rates when the model meters tokens; null when it is flat-rate. */
  pricing?: ModelPricing | null;
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
