export interface CurvetErrorOptions {
  status?: number;
  requestId?: string;
  raw?: unknown;
}

/** Base class for every error thrown by the SDK. */
export class CurvetError extends Error {
  readonly status?: number;
  readonly requestId?: string;
  readonly raw?: unknown;

  constructor(message: string, opts: CurvetErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.status = opts.status;
    this.requestId = opts.requestId;
    this.raw = opts.raw;
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
/** 404 — job or workflow not found. */
export class NotFoundError extends CurvetError {}
/** 5xx — upstream/server error (retried automatically). */
export class APIError extends CurvetError {}
/** Network failure or timeout before a response was received. */
export class ConnectionError extends CurvetError {}

/** 402 — not enough credits to complete the request. */
export class InsufficientBalanceError extends CurvetError {
  required?: number;
  available?: number;
}

/** 429 — hourly request limit or daily cost cap exceeded. */
export class RateLimitError extends CurvetError {
  kind?: "rate" | "cost";
  limit?: number;
  used?: number;
  resetsAt?: Date;
  retryAfterMs?: number;
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

interface HeaderBag {
  get(name: string): string | null;
}

/** Map an HTTP status + JSON error body to the right typed error. */
export function errorFromResponse(
  status: number,
  body: unknown,
  requestId?: string,
  headers?: HeaderBag,
): CurvetError {
  const b = (body ?? {}) as Record<string, any>;
  const message =
    typeof b.error === "string" ? b.error : `HTTP ${status}`;
  const base: CurvetErrorOptions = { status, requestId, raw: body };

  switch (status) {
    case 400:
      return new BadRequestError(message, base);
    case 401:
      return new AuthError(message, base);
    case 402: {
      const e = new InsufficientBalanceError(message, base);
      e.required = b.required;
      e.available = b.available;
      return e;
    }
    case 403:
      return new PermissionError(message, base);
    case 404:
      return new NotFoundError(message, base);
    case 429: {
      const e = new RateLimitError(message, base);
      const info = b.rateLimitInfo ?? b.costCapInfo;
      e.kind = b.costCapInfo ? "cost" : "rate";
      if (info) {
        e.limit = info.limit;
        e.used = info.used;
        if (info.resetsAt) e.resetsAt = new Date(info.resetsAt);
      }
      const retryAfter = headers?.get?.("retry-after");
      if (info?.resetsIn != null) e.retryAfterMs = Number(info.resetsIn) * 1000;
      else if (retryAfter) e.retryAfterMs = Number(retryAfter) * 1000;
      else if (e.resetsAt) e.retryAfterMs = Math.max(0, e.resetsAt.getTime() - Date.now());
      return e;
    }
    default:
      return new APIError(message, base);
  }
}
