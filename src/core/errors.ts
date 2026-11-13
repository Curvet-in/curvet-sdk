import type { CurvetErrorCode, CurvetErrorType, StepError } from "../types/errors";

export interface CurvetErrorOptions {
  status?: number;
  requestId?: string;
  raw?: unknown;
  /** See {@link CurvetError.code}. */
  code?: CurvetErrorCode;
  /** See {@link CurvetError.type}. */
  type?: CurvetErrorType;
  /** See {@link CurvetError.retryable}. */
  retryable?: boolean;
  provider?: string;
  model?: string;
  providerStatus?: number;
  stepError?: StepError;
  jobId?: string;
  runId?: string;
  param?: string;
  retryAfterMs?: number;
}

/** Base class for every error thrown by the SDK. */
export class CurvetError extends Error {
  readonly status?: number;
  /**
   * The server's id for this request (`x-curvet-request-id`, or the body's
   * `requestId` / `error.request_id`). Quote it to support.
   */
  readonly requestId?: string;
  /** The error body exactly as the server sent it. */
  readonly raw?: unknown;
  /**
   * The server's stable machine-readable reason: an {@link ApiErrorCode} for
   * auth, policy, limit, lookup and server refusals (`"invalid_api_key"`,
   * `"rate_limit_exceeded"`, `"route_not_found"`, …), a StepError code for a
   * model or provider failure (`"provider_busy"`, `"content_policy"`, …), an
   * `idempotency_key_*` code, `"upload_too_large"`, `"PROMPT_TOO_LONG"`, or a
   * custom model's state on a 409. Current servers send one on every refusal
   * except some of the chat, image and media routes' own request checks (some
   * 400s, and the 402 with `required`).
   */
  readonly code?: CurvetErrorCode;
  /**
   * OpenAI's error type for the code: `"invalid_request_error"`,
   * `"authentication_error"`, `"permission_error"`, `"rate_limit_error"`,
   * `"insufficient_quota"` or `"api_error"`.
   */
  readonly type?: CurvetErrorType;
  /**
   * Whether the server says a retry can succeed. When it says so, the SDK's
   * automatic retries follow it; when it is absent, the SDK retries 429 and 5xx.
   */
  readonly retryable?: boolean;
  /** For a model or provider failure: the provider that failed. */
  readonly provider?: string;
  /** For a model or provider failure: the model asked for. */
  readonly model?: string;
  /** For a model or provider failure: the provider's own HTTP status. */
  readonly providerStatus?: number;
  /** For a model or provider failure: the full structured error. */
  readonly stepError?: StepError;
  /** The id of the media job that failed, when the error is about one. */
  readonly jobId?: string;
  /** The id of the workflow run that failed, when it was created before it failed (`workflows.run`). */
  readonly runId?: string;
  /** The request field the refusal is about (`model`, `input`, …), when the server names one. */
  readonly param?: string;
  /**
   * How long the server asks the caller to wait before trying again, in ms
   * (`Retry-After`, the StepError's `retryAfterSec`, or a limit's reset time).
   */
  retryAfterMs?: number;
  /**
   * The `Idempotency-Key` this call was sent with (POSTs only). The call may
   * still have completed — and been charged — on the server: retry with
   * `{ idempotencyKey: err.idempotencyKey }` to get its result instead of
   * running it again.
   */
  idempotencyKey?: string;

  constructor(message: string, opts: CurvetErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.status = opts.status;
    this.requestId = opts.requestId;
    this.raw = opts.raw;
    // Set only what the server sent, so an error does not grow a dozen
    // `undefined` keys when logged.
    if (opts.code !== undefined) this.code = opts.code;
    if (opts.type !== undefined) this.type = opts.type;
    if (opts.retryable !== undefined) this.retryable = opts.retryable;
    if (opts.provider !== undefined) this.provider = opts.provider;
    if (opts.model !== undefined) this.model = opts.model;
    if (opts.providerStatus !== undefined) this.providerStatus = opts.providerStatus;
    if (opts.stepError !== undefined) this.stepError = opts.stepError;
    if (opts.jobId !== undefined) this.jobId = opts.jobId;
    if (opts.runId !== undefined) this.runId = opts.runId;
    if (opts.param !== undefined) this.param = opts.param;
    if (opts.retryAfterMs !== undefined) this.retryAfterMs = opts.retryAfterMs;
    // Restore prototype chain so `instanceof` works after transpilation.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 401 — missing or invalid `x-app-key`. */
export class AuthError extends CurvetError {}
/** 403 — app not active, playground not enabled, or model/category not allowed. */
export class PermissionError extends CurvetError {}
/** 400 — invalid/unknown model or malformed payload. */
export class BadRequestError extends CurvetError {}
/**
 * 404 — job or workflow not found (also for a malformed id), a path the server
 * does not serve, or a model that is not available (`code: "model_unavailable"`).
 */
export class NotFoundError extends CurvetError {}
/**
 * 5xx — upstream/server error — and any other status without a class of its
 * own. The 4xx classes below extend it, so code that caught a 409, 410, 413,
 * 422 or 424 as `APIError` still does.
 */
export class APIError extends CurvetError {}
/**
 * 409 — an `Idempotency-Key` refusal (`idempotency_key_in_use`,
 * `idempotency_key_not_replayable`), or a custom model that is not ready.
 */
export class ConflictError extends APIError {}
/** 410 — the model is retired (`code: "model_retired"`). */
export class GoneError extends APIError {}
/** 413 — the input or an upload is too large (`input_too_long`, `upload_too_large`). */
export class PayloadTooLargeError extends APIError {}
/**
 * 422 — refused by content policy (`content_policy`), or the same
 * `Idempotency-Key` sent with a different request (`idempotency_key_mismatch`).
 */
export class UnprocessableEntityError extends APIError {}
/** 424 — a connected app is needed (`connection_needed`) or a step it depends on failed (`upstream_failed`). */
export class FailedDependencyError extends APIError {}
/** Network failure or timeout before a response was received. */
export class ConnectionError extends CurvetError {}

/** 402 — not enough credits to complete the request. */
export class InsufficientBalanceError extends CurvetError {
  /** The price, in USD. */
  required?: number;
  /** The balance, in USD (wallet plus points). */
  available?: number;
  /** The price in credits, where the server sends it (`/audio`). */
  requiredCredits?: number;
}

/**
 * 429 — the key's hourly request limit (`kind: "rate"`), its daily cost cap
 * (`"cost"`), a key, organisation or platform credit budget (`"budget"`), the
 * server's per-IP limit (`kind: "rate"`, `code: "ip_rate_limited"`), or a busy
 * provider (`kind: "rate"`, `code: "provider_busy"`). Read from either error
 * envelope (the playground's `rateLimitInfo` / `costCapInfo` / `budgetInfo`, or
 * the OpenAI-style `error.limit`).
 */
export class RateLimitError extends CurvetError {
  kind?: "rate" | "cost" | "budget";
  limit?: number;
  used?: number;
  resetsAt?: Date;
  // `retryAfterMs` is declared on CurvetError (every error can carry one).
  /** For `kind: "budget"`: whose budget — `"key"`, `"org"` or `"platform"`. */
  scope?: string;
  /** For `kind: "budget"`: the budget's period — `"day"`, `"week"` or `"month"`. */
  period?: string;
}

/** An async media job finished with status "failed". */
export class JobFailedError extends CurvetError {
  readonly jobId: string;
  constructor(message: string, jobId: string, opts: CurvetErrorOptions = {}) {
    super(message, opts);
    this.jobId = jobId;
  }
}

/** An async media job did not finish within the poll timeout. */
export class JobTimeoutError extends CurvetError {
  readonly jobId: string;
  constructor(message: string, jobId: string, opts: CurvetErrorOptions = {}) {
    super(message, opts);
    this.jobId = jobId;
  }
}

/** An async workflow run finished with status "failed" (or "stopped"). */
export class WorkflowRunFailedError extends CurvetError {
  readonly runId: string;
  constructor(message: string, runId: string, opts: CurvetErrorOptions = {}) {
    super(message, opts);
    this.runId = runId;
  }
}

/** An async workflow run did not finish within the poll timeout. */
export class WorkflowRunTimeoutError extends CurvetError {
  readonly runId: string;
  constructor(message: string, runId: string, opts: CurvetErrorOptions = {}) {
    super(message, opts);
    this.runId = runId;
  }
}

interface HeaderBag {
  get(name: string): string | null;
}

type Obj = Record<string, any>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};

/** `Retry-After` in ms, when it is a sane number of seconds. */
export function retryAfterHeaderMs(headers?: HeaderBag): number | undefined {
  const raw = headers?.get?.("retry-after");
  if (raw == null || raw.trim() === "") return undefined;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v * 1000 : undefined;
}

/**
 * The fields a StepError contributes to a thrown error. Used for an error body
 * and for a failed job read back from `jobs.retrieve()`.
 */
export function stepErrorFields(stepError: unknown): CurvetErrorOptions {
  if (!isObj(stepError)) return {};
  const se = stepError as StepError;
  const wait = num(se.retryAfterSec);
  return {
    code: str(se.code),
    retryable: bool(se.retryable),
    provider: str(se.provider),
    model: str(se.model),
    providerStatus: num(se.providerStatus),
    stepError: se,
    retryAfterMs: wait !== undefined ? wait * 1000 : undefined,
  };
}

/**
 * Map an HTTP status + JSON error body to the right typed error.
 *
 * Reads both envelopes the server answers in: the playground's
 * `{ success: false, error: "<sentence>", code, type, retryable, stepError,
 * requestId, jobId, runId, … }` and the OpenAI-style routes'
 * `{ error: { message, type, code, param, provider, model, provider_status,
 * retryable, request_id, limit } }`.
 */
export function errorFromResponse(
  status: number,
  body: unknown,
  requestId?: string,
  headers?: HeaderBag,
): CurvetError {
  const b: Obj = isObj(body) ? body : {};
  const oa: Obj | undefined = isObj(b.error) ? b.error : undefined;
  const se = stepErrorFields(b.stepError);
  const message =
    typeof b.error === "string"
      ? b.error
      : typeof oa?.message === "string"
        ? oa.message
        : `HTTP ${status}`;
  // `retryAfter` (seconds) is in the body of the server's own per-IP refusal.
  const bodyWait = num(b.retryAfter);
  const base: CurvetErrorOptions = {
    status,
    requestId: requestId ?? str(b.requestId) ?? str(oa?.request_id),
    raw: body,
    code: str(b.code) ?? str(oa?.code) ?? se.code,
    type: str(b.type) ?? str(oa?.type),
    retryable: bool(b.retryable) ?? bool(oa?.retryable) ?? se.retryable,
    provider: str(oa?.provider) ?? se.provider,
    model: str(oa?.model) ?? se.model,
    providerStatus: num(oa?.provider_status) ?? se.providerStatus,
    stepError: se.stepError,
    jobId: str(b.jobId),
    runId: str(b.runId),
    param: str(oa?.param),
    retryAfterMs:
      retryAfterHeaderMs(headers) ?? se.retryAfterMs ?? (bodyWait !== undefined ? bodyWait * 1000 : undefined),
  };

  switch (status) {
    case 400:
      return new BadRequestError(message, base);
    case 401:
      return new AuthError(message, base);
    case 402: {
      const e = new InsufficientBalanceError(message, base);
      e.required = b.required;
      e.available = b.available;
      if (b.requiredCredits !== undefined) e.requiredCredits = b.requiredCredits;
      return e;
    }
    case 403:
      return new PermissionError(message, base);
    case 404:
      return new NotFoundError(message, base);
    case 409:
      return new ConflictError(message, base);
    case 410:
      return new GoneError(message, base);
    case 413:
      return new PayloadTooLargeError(message, base);
    case 422:
      return new UnprocessableEntityError(message, base);
    case 424:
      return new FailedDependencyError(message, base);
    case 429: {
      const e = new RateLimitError(message, base);
      // The playground names the limit by which object it sends; the
      // OpenAI-style envelope sends one `limit` object with a `kind`.
      const oaLimit: Obj | undefined = isObj(oa?.limit) ? oa.limit : undefined;
      const info: Obj | undefined = isObj(b.rateLimitInfo)
        ? b.rateLimitInfo
        : isObj(b.costCapInfo)
          ? b.costCapInfo
          : isObj(b.budgetInfo)
            ? b.budgetInfo
            : oaLimit;
      const isCost =
        (!isObj(b.rateLimitInfo) && isObj(b.costCapInfo)) ||
        oaLimit?.kind === "cost_per_day" ||
        base.code === "daily_cost_cap_exceeded";
      const isBudget =
        (!isObj(b.rateLimitInfo) && !isObj(b.costCapInfo) && isObj(b.budgetInfo)) ||
        oaLimit?.kind === "budget" ||
        base.code === "budget_exhausted";
      e.kind = isCost ? "cost" : isBudget ? "budget" : "rate";
      if (info) {
        e.limit = num(info.limit);
        // The cost cap sends `used` as a string with four decimals ("10.0000").
        e.used = num(info.used);
        const reset = info.resetsAt ?? info.resets_at;
        if (reset) {
          const at = new Date(reset);
          if (!Number.isNaN(at.getTime())) e.resetsAt = at;
        }
        if (e.kind === "budget") {
          e.scope = str(info.scope);
          e.period = str(info.period);
        }
      }
      // `resetsIn` (seconds) is what older servers sent; Retry-After and the
      // StepError's retryAfterSec are already on `base`; else wait for the reset.
      const resetsIn = num(info?.resetsIn);
      if (resetsIn !== undefined) e.retryAfterMs = resetsIn * 1000;
      else if (e.retryAfterMs === undefined && e.resetsAt) {
        e.retryAfterMs = Math.max(0, e.resetsAt.getTime() - Date.now());
      }
      return e;
    }
    default:
      return new APIError(message, base);
  }
}
