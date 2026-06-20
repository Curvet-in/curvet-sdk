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

export interface ModelInfo {
  id: string;
  name: string;
  cost: number;
  type: ModelType;
  provider: string;
  credits: number;
  supportsVision?: boolean;
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
  // smart router pseudo-models
  | "auto"
  | "smart";

/** A model ID. Accepts any string; {@link KnownModelId} drives autocomplete only. */
export type ModelId = KnownModelId | (string & {});
