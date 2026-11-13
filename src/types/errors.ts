/**
 * The server's code for what went wrong with a model call. Each has a fixed
 * HTTP status on the public API: content_policy 422, input_too_long 413,
 * bad_input 400, needs_input 400, no_output 502, model_retired 410,
 * model_unavailable 404, provider_down 502, provider_busy 429,
 * provider_unavailable 503, timeout 504, insufficient_credits 402,
 * limit_reached 429, connection_needed 424, setup_error 400,
 * upstream_failed 424, interrupted 503, unknown 500.
 */
export type StepErrorCode =
  | "content_policy"
  | "input_too_long"
  | "bad_input"
  | "needs_input"
  | "no_output"
  | "model_retired"
  | "model_unavailable"
  | "provider_down"
  | "provider_busy"
  | "provider_unavailable"
  | "timeout"
  | "insufficient_credits"
  | "limit_reached"
  | "connection_needed"
  | "setup_error"
  | "upstream_failed"
  | "interrupted"
  | "unknown"
  | (string & {});

/** Whose problem a {@link StepError} is. */
export type StepErrorScope =
  | "request"
  | "model"
  | "provider"
  | "account"
  | "wallet"
  | "setup"
  | "platform"
  | (string & {});

/** What the caller can do about a {@link StepError}. */
export type StepErrorAction =
  | "edit_prompt"
  | "shorten_input"
  | "switch_model"
  | "retry"
  | "retry_later"
  | "top_up"
  | "reconnect"
  | "edit_step"
  | (string & {});

/**
 * What went wrong with a model call, in the one shape the server uses
 * everywhere: on a failed request's error body (`err.stepError`) and on a
 * failed media job (`job.stepError`). Fields after `message` appear only when
 * known.
 */
export interface StepError {
  /** Contract version (1). */
  v: number;
  code: StepErrorCode;
  /** The code's fixed title. */
  title: string;
  scope: StepErrorScope;
  retryable: boolean;
  actions: StepErrorAction[];
  /** The sentence to show; at most 600 characters. */
  message: string;
  /** The provider's own words, when safe to show. Never for an account-scope code. */
  providerMessage?: string;
  /** The model asked for. */
  model?: string;
  /** Its display name. */
  modelName?: string;
  /** The model that actually ran, after a fallback. */
  servedModel?: string;
  provider?: string;
  /** The provider's own HTTP status. Never for an account-scope code. */
  providerStatus?: number;
  refundedCredits?: number;
  retryAfterSec?: number;
  /** Up to three models to try instead. */
  suggestedModels?: string[];
  /** The server's internal classification (billing, throttled, …), for support. */
  faultKind?: string;
  /** A job or request id to quote to support. */
  ref?: string;
}
