export { Curvet, DEFAULT_BASE_URL } from "./client";
export type { CurvetOptions } from "./client";

// Errors
export {
  CurvetError,
  AuthError,
  PermissionError,
  BadRequestError,
  NotFoundError,
  APIError,
  ConnectionError,
  InsufficientBalanceError,
  RateLimitError,
  JobFailedError,
  JobTimeoutError,
} from "./core/errors";
export type { CurvetErrorOptions } from "./core/errors";

// Resources
export { Chat } from "./resources/chat";
export { Images } from "./resources/image";
export { Video } from "./resources/video";
export { Jobs, Job } from "./resources/jobs";
export type { JobDefaults } from "./resources/jobs";
export { Models } from "./resources/models";
export type { ModelsListOptions } from "./resources/models";
export { Balance } from "./resources/balance";
export type { BalanceInfo } from "./resources/balance";

// Types
export type { Usage, RequestOptions, FetchLike } from "./types/common";
export type { ChatRole, ChatMessage, ChatCreateParams, ChatResponse } from "./types/chat";
export type { ImageGenerateParams, ImageResponse } from "./types/image";
export type {
  JobStatus,
  MediaKind,
  MediaJob,
  VideoGenerateParams,
  PollOptions,
} from "./types/job";
export type { ModelType, ModelInfo, RateLimits, KnownModelId, ModelId } from "./types/models";
