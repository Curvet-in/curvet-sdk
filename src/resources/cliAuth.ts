import type { HttpClient } from "../core/http";
import type { RequestOptions } from "../types/common";

/** What a CLI token may do. See documentation/CLI_DEVICE_LOGIN.md. */
export type CliScope = "apps:read" | "apps:write" | "apps:keys" | "enterprise:admin";

export interface DeviceCodeParams {
  /** Shown on the approval page so the human recognises their own machine. */
  deviceName?: string;
  scopes?: CliScope[];
}

export interface DeviceCodeResult {
  deviceCode: string;
  /** The short code a human reads: `BCDF-GHJK`. */
  userCode: string;
  requestedScopes: CliScope[];
  verificationUri: string;
  /** Same page with the code prefilled — what to open in a browser. */
  verificationUriComplete: string;
  expiresIn: number;
  /** Seconds to wait between polls. Widened by the server if you poll faster. */
  interval: number;
}

export interface DeviceTokenResult {
  token: string;
  tokenId: string;
  scopes: CliScope[];
  expiresAt: string;
  /** True when this login landed on a device's existing row rather than a new one. */
  reusedDevice: boolean;
  /** Set only when this login created the account's first app. */
  defaultApp: { appId: string; name: string; appKey: string } | null;
}

export interface CliDevice {
  id: string;
  tokenPreview: string;
  deviceName: string;
  scopes: CliScope[];
  lastUsedAt: string | null;
  rotatedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface WhoAmI {
  user: { uid: string; email: string; displayName?: string };
  scopes: CliScope[];
  device: CliDevice;
  allScopes: CliScope[];
}

/**
 * Raised while polling, carrying the flow's state so a caller can act on it
 * rather than parse a message. `authorization_pending` and `slow_down` are
 * normal and mean "keep waiting"; the rest are terminal.
 */
export class DeviceFlowPending extends Error {
  readonly code: string;
  readonly interval?: number;
  constructor(code: string, message: string, interval?: number) {
    super(message);
    this.name = "DeviceFlowPending";
    this.code = code;
    this.interval = interval;
  }
  /**
   * Whether polling should continue.
   *
   * `rate_limited` counts as pending: a login that is mid-flight should back off
   * and keep waiting, not abandon a code the user is about to approve. The
   * server tells us how fast to go via `interval`; being told "too fast" is a
   * reason to slow down, not to give up.
   */
  get isPending(): boolean {
    return (
      this.code === "authorization_pending" ||
      this.code === "slow_down" ||
      this.code === "rate_limited"
    );
  }
}

export interface PollOptions {
  /** Give up after this long (default: the code's own 10-minute lifetime). */
  timeoutMs?: number;
  /** Called once per poll, so a CLI can keep a spinner honest. */
  onPoll?: (elapsedMs: number) => void;
  signal?: AbortSignal;
}

/**
 * `curvet login`, as a library call.
 *
 * The device flow exists because a CLI has no browser and cannot hold a Firebase
 * session, yet everything that manages a credential — creating an app, rotating
 * a key, minting an enterprise key — is gated on being a signed-in human.
 *
 * ```ts
 * const start = await curvet.auth.deviceCode({ deviceName: "my-laptop" });
 * console.log("Open", start.verificationUriComplete, "and enter", start.userCode);
 * const { token } = await curvet.auth.pollForToken(start);
 * ```
 */
export class CliAuth {
  constructor(
    private client: HttpClient,
    /** Authenticated with the CLI token, for the routes that need one. */
    private tokenClient: HttpClient,
  ) {}

  /** Start a login. Needs no credentials — nothing is granted until approved. */
  async deviceCode(
    params: DeviceCodeParams = {},
    options?: RequestOptions,
  ): Promise<DeviceCodeResult> {
    return this.client.request<DeviceCodeResult>({
      method: "POST",
      path: "/auth/cli/device/code",
      body: { deviceName: params.deviceName, scopes: params.scopes },
      options,
    });
  }

  /**
   * Exchange an approved device code for a token. Throws {@link DeviceFlowPending}
   * while the human has not answered yet — most callers want {@link pollForToken}.
   */
  async deviceToken(
    deviceCode: string,
    params: { expiresInDays?: number } = {},
    options?: RequestOptions,
  ): Promise<DeviceTokenResult> {
    try {
      return await this.client.request<DeviceTokenResult>({
        method: "POST",
        path: "/auth/cli/device/token",
        body: { deviceCode, expiresInDays: params.expiresInDays },
        // The flow's own 400s are states, not failures; do not retry them.
        options: { ...options, maxRetries: 0 },
      });
    } catch (err) {
      throw asDeviceFlowError(err);
    }
  }

  /**
   * Poll until the human approves, honouring the server's `interval` — including
   * when it widens it after a `slow_down`, which is the whole point of returning
   * one.
   */
  async pollForToken(
    start: Pick<DeviceCodeResult, "deviceCode" | "interval" | "expiresIn">,
    params: { expiresInDays?: number } = {},
    options: PollOptions = {},
  ): Promise<DeviceTokenResult> {
    const deadline = Date.now() + (options.timeoutMs ?? start.expiresIn * 1000);
    // `?? 5`, not `|| 5`: an interval of 0 means "as fast as you are allowed",
    // which floors to 1s, not "unspecified", which defaults to 5.
    let interval = Math.max(1, start.interval ?? 5);
    const startedAt = Date.now();

    for (;;) {
      if (options.signal?.aborted) throw new DeviceFlowPending("aborted", "Login cancelled");
      if (Date.now() >= deadline) {
        throw new DeviceFlowPending("expired_token", "The login request expired before it was approved.");
      }
      await sleep(interval * 1000, options.signal);
      options.onPoll?.(Date.now() - startedAt);

      try {
        return await this.deviceToken(start.deviceCode, params);
      } catch (err) {
        if (!(err instanceof DeviceFlowPending) || !err.isPending) throw err;
        if (err.interval) interval = err.interval;
      }
    }
  }

  /**
   * Who this token belongs to and what it may do.
   *
   * This is what makes re-login cheap: a token that still answers means there is
   * nothing to do, so `curvet login` can stop before starting a device flow.
   */
  async whoami(options?: RequestOptions): Promise<WhoAmI> {
    return this.tokenClient.request<WhoAmI>({
      method: "GET",
      path: "/auth/cli/whoami",
      options,
    });
  }

  /** Every machine currently logged in as this user. */
  async devices(options?: RequestOptions): Promise<CliDevice[]> {
    const body = await this.tokenClient.request<{ devices: CliDevice[] }>({
      method: "GET",
      path: "/auth/cli/devices",
      options,
    });
    return body.devices;
  }

  /** Revoke this token, or every token for the user. */
  async logout(params: { all?: boolean } = {}, options?: RequestOptions): Promise<number> {
    const body = await this.tokenClient.request<{ revoked: number }>({
      method: "POST",
      path: "/auth/cli/logout",
      body: { all: params.all === true },
      options,
    });
    return body.revoked;
  }
}

/**
 * The device endpoints answer 400 with an RFC 8628 error code for states that
 * are not failures. Surface the code rather than the HTTP status.
 */
function asDeviceFlowError(err: unknown): unknown {
  const status = (err as { status?: number })?.status;
  const body = (err as { raw?: Record<string, unknown> })?.raw;

  // A 429 mid-login is not a failure, it is a "wait longer". Back off hard
  // rather than dropping a code the user may be seconds from approving.
  if (status === 429) {
    return new DeviceFlowPending("rate_limited", "Polling too fast; backing off.", 30);
  }

  const code = typeof body?.error === "string" ? body.error : undefined;
  if (!code) return err;
  return new DeviceFlowPending(
    code,
    typeof body?.error_description === "string" ? body.error_description : code,
    typeof body?.interval === "number" ? body.interval : undefined,
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DeviceFlowPending("aborted", "Login cancelled"));
      },
      { once: true },
    );
  });
}
