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

/**
 * The `code` of every `/api/v1` refusal that is not a model or provider
 * failure (those carry a {@link StepErrorCode}). Stable: the sentence may
 * change, the code does not. With its HTTP status:
 *
 * - the key and its account: `missing_api_key`, `invalid_api_key`,
 *   `api_key_revoked`, `api_key_expired`, `app_key_not_accepted` (401);
 *   `app_not_active`, `api_not_enabled`, `developer_account_not_found`,
 *   `developer_not_approved`, `user_not_found`, `account_suspended` (403);
 * - policy: `model_required` (400); `model_not_allowed`,
 *   `model_blocked_by_policy`, `category_not_allowed`, `food_api_not_enabled`,
 *   `per_call_limit_exceeded`, `ip_not_allowed`, `tool_not_allowed` (403);
 *   `content_filtered` (422); `rate_limit_exceeded`, `daily_cost_cap_exceeded`,
 *   `budget_exhausted` (429, retryable, with Retry-After);
 * - lookups: `workflow_not_found`, `workflow_run_not_found`, `job_not_found`
 *   (404); `workflow_access_denied`, `workflow_run_access_denied` (403);
 * - the server itself: `route_not_found` (404), `invalid_json` (400),
 *   `body_too_large` (413), `bad_request` (another 4xx), `ip_rate_limited`
 *   (429, retryable, with Retry-After).
 *
 * Any other string is accepted, so a code added later does not break compilation.
 */
export type ApiErrorCode =
  | "missing_api_key"
  | "invalid_api_key"
  | "api_key_revoked"
  | "api_key_expired"
  | "app_key_not_accepted"
  | "app_not_active"
  | "api_not_enabled"
  | "developer_account_not_found"
  | "developer_not_approved"
  | "user_not_found"
  | "account_suspended"
  | "model_required"
  | "model_not_allowed"
  | "model_blocked_by_policy"
  | "category_not_allowed"
  | "food_api_not_enabled"
  | "per_call_limit_exceeded"
  | "ip_not_allowed"
  | "tool_not_allowed"
  | "content_filtered"
  | "rate_limit_exceeded"
  | "daily_cost_cap_exceeded"
  | "budget_exhausted"
  | "workflow_not_found"
  | "workflow_access_denied"
  | "workflow_run_not_found"
  | "workflow_run_access_denied"
  | "job_not_found"
  | "route_not_found"
  | "invalid_json"
  | "body_too_large"
  | "bad_request"
  | "ip_rate_limited"
  | "balance_held"
  | "workflow_run_stopped"
  | "prompt_required"
  | "model_unknown"
  | "model_wrong_type"
  | "model_not_chat"
  | "text_too_long"
  | "upload_too_large"
  | "messages_required"
  | "invalid_parameter"
  | "image_input_not_supported"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "too_many_requests"
  | "request_refused"
  | (string & {});

/** The `Idempotency-Key` refusals. */
export type IdempotencyErrorCode =
  | "idempotency_key_in_use"
  | "idempotency_key_not_replayable"
  | "idempotency_key_mismatch"
  | "idempotency_key_invalid";

/**
 * Any `code` an error can carry: an {@link ApiErrorCode}, a
 * {@link StepErrorCode}, an {@link IdempotencyErrorCode}, or one of the
 * routes' own (`upload_too_large`, `PROMPT_TOO_LONG`, `model_not_found`,
 * `insufficient_quota`, a custom model's state on a 409). Any other string is
 * accepted.
 */
export type CurvetErrorCode =
  | ApiErrorCode
  | StepErrorCode
  | IdempotencyErrorCode
  | "upload_too_large"
  | "PROMPT_TOO_LONG"
  | "model_not_found"
  | "insufficient_quota"
  | (string & {});

/** OpenAI's error type for a code. */
export type CurvetErrorType =
  | "invalid_request_error"
  | "authentication_error"
  | "permission_error"
  | "rate_limit_error"
  | "insufficient_quota"
  | "api_error"
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
