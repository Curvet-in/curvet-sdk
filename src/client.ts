import { HttpClient } from "./core/http";
import { CurvetError } from "./core/errors";
import type { FetchLike } from "./types/common";
import { Chat } from "./resources/chat";
import { Images } from "./resources/image";
import { Video } from "./resources/video";
import { Audio } from "./resources/audio";
import { ThreeD } from "./resources/threeD";
import { Jobs } from "./resources/jobs";
import { Models } from "./resources/models";
import { Balance } from "./resources/balance";
import { Analytics } from "./resources/analytics";
import { Workflows } from "./resources/workflows";
import { Food } from "./resources/food";
import { Voice } from "./resources/voice";
import { Enterprise } from "./resources/enterprise";
import { CliAuth } from "./resources/cliAuth";
import { Apps } from "./resources/apps";
import { Agency } from "./resources/agency";

export const DEFAULT_BASE_URL = "https://curvet.ai/api/v1/playground";

export interface CurvetOptions {
  /** Your app key. Falls back to the CURVET_APP_KEY env var. */
  appKey?: string;
  /**
   * Enterprise API key (org-scoped, admin-capable). Falls back to the
   * CURVET_ENTERPRISE_KEY env var. Required to use `curvet.enterprise.*`.
   */
  enterpriseKey?: string;
  /**
   * CLI token from `curvet login` (see `auth.deviceCode`). Falls back to the
   * CURVET_CLI_TOKEN env var. Required to use `curvet.apps.*`, and an
   * alternative to `enterpriseKey` for `curvet.enterprise.*`.
   */
  cliToken?: string;
  /** Override the playground base URL (defaults to production). */
  baseURL?: string;
  /** Per-request timeout in ms (default 60000). */
  timeout?: number;
  /** Max automatic retries for 429/5xx and network errors (default 2). */
  maxRetries?: number;
  /** Inject a fetch implementation (defaults to global fetch on Node 18+). */
  fetch?: FetchLike;
  /** Default poll interval for async media jobs, in ms (default 2500). */
  defaultPollIntervalMs?: number;
  /** Default poll timeout for async media jobs, in ms (default 180000). */
  defaultPollTimeoutMs?: number;
}

/**
 * The Curvet client. One instance per app key.
 *
 * ```ts
 * const curvet = new Curvet({ appKey: process.env.CURVET_APP_KEY });
 * const { response } = await curvet.chat.create({
 *   model: "gpt-4o-mini",
 *   messages: [{ role: "user", content: "hi" }],
 * });
 * ```
 */
export class Curvet {
  readonly chat: Chat;
  readonly image: Images;
  readonly video: Video;
  readonly audio: Audio;
  readonly threeD: ThreeD;
  readonly jobs: Jobs;
  readonly models: Models;
  readonly balance: Balance;
  readonly analytics: Analytics;
  readonly workflows: Workflows;
  readonly food: Food;
  readonly voice: Voice;
  /** Enterprise admin API (requires an Enterprise API key, or `enterprise:admin`). */
  readonly enterprise: Enterprise;
  /** `curvet login` — device-code authentication and its tokens. */
  readonly auth: CliAuth;
  /** App and key management (requires a CLI token). */
  readonly apps: Apps;
  /**
   * Agency 2 runs. Needs the `agency:run` scope on whichever credential is used —
   * a CLI token (`curvet login --scope agency:run`, not requested by default) or
   * an app key with agent access turned on in the console. A CLI token wins when
   * both are present.
   */
  readonly agency: Agency;

  constructor(options: CurvetOptions = {}) {
    const appKey = options.appKey ?? envKey();
    const enterpriseKey = options.enterpriseKey ?? envEnterpriseKey();
    const cliToken = options.cliToken ?? envCliToken();
    if (!appKey && !enterpriseKey && !cliToken) {
      throw new CurvetError(
        "Missing credentials. Pass { appKey } (or CURVET_APP_KEY) for the playground, " +
          "{ enterpriseKey } (or CURVET_ENTERPRISE_KEY) for the enterprise API, " +
          "or { cliToken } (or CURVET_CLI_TOKEN) for app and key management.",
      );
    }
    const fetchImpl = options.fetch ?? defaultFetch();
    if (!fetchImpl) {
      throw new CurvetError(
        "No fetch implementation available. Use Node 18+ or pass { fetch }.",
      );
    }

    const playgroundBase = options.baseURL ?? DEFAULT_BASE_URL;
    // Sibling routes (food, voice, enterprise) live one level up at /api/v1/*.
    const v1Base = playgroundBase.replace(/\/playground\/?$/, "");

    const shared = {
      timeout: options.timeout ?? 60_000,
      maxRetries: options.maxRetries ?? 2,
      fetch: fetchImpl,
    };
    // Playground/v1 resources authenticate with the app key.
    const client = new HttpClient({ ...shared, appKey: appKey ?? "", baseURL: playgroundBase });
    const v1Client = new HttpClient({ ...shared, appKey: appKey ?? "", baseURL: v1Base });
    // Enterprise resources authenticate with the Enterprise API key — or, when
    // there isn't one, with a CLI token carrying `enterprise:admin`. The two
    // reach the same router by different mounts, so the base URL differs.
    const enterpriseViaCli = !enterpriseKey && !!cliToken;
    const enterpriseClient = new HttpClient({
      ...shared,
      appKey: (enterpriseViaCli ? cliToken : enterpriseKey) ?? "",
      authHeaderName: enterpriseViaCli ? "x-cli-token" : "x-enterprise-key",
      baseURL: enterpriseViaCli ? `${v1Base}/cli/enterprise` : `${v1Base}/enterprise`,
    });

    // App/key management, and the CLI token's own lifecycle.
    const cliClient = new HttpClient({
      ...shared,
      appKey: cliToken ?? "",
      authHeaderName: "x-cli-token",
      baseURL: `${v1Base}/developer`,
    });
    // The device endpoints are unauthenticated: nothing is granted until a human
    // approves, so there is no credential to send.
    const deviceClient = new HttpClient({
      ...shared,
      appKey: "",
      baseURL: v1Base,
    });
    const cliTokenClient = new HttpClient({
      ...shared,
      appKey: cliToken ?? "",
      authHeaderName: "x-cli-token",
      baseURL: v1Base,
    });

    const jobDefaults = {
      pollIntervalMs: options.defaultPollIntervalMs ?? 2500,
      pollTimeoutMs: options.defaultPollTimeoutMs ?? 180_000,
    };

    this.chat = new Chat(client);
    this.image = new Images(client);
    this.jobs = new Jobs(client, jobDefaults);
    this.video = new Video(client, jobDefaults);
    this.audio = new Audio(client, jobDefaults);
    this.threeD = new ThreeD(client, jobDefaults);
    this.models = new Models(client);
    this.balance = new Balance(client);
    this.analytics = new Analytics(client);
    this.workflows = new Workflows(client);
    this.food = new Food(v1Client);
    this.voice = new Voice(v1Client);
    this.enterprise = new Enterprise(enterpriseClient);
    this.auth = new CliAuth(deviceClient, cliTokenClient);
    this.apps = new Apps(cliClient);
    // Agency has its own mount (allowOnly-contained, see routes/api/cliAgency.js).
    // `run` streams SSE rather than returning JSON, so it needs the raw fetch and
    // credential alongside the ordinary JSON client the other calls use.
    const agencyBase = `${v1Base}/cli/agency`;
    // Either credential reaches agency, and the header has to name the one being
    // sent. The mount accepts both (middleware/cliAuth.js `authenticateCliOrAppKey`)
    // and holds both to the same `agency:run` scope — a CLI token gets it from
    // `curvet login --scope agency:run`, an app key from the console toggle.
    //
    // A CLI token wins when both are present: it identifies a person who signed
    // in on this machine, while an app key may be shared by everyone using the
    // app it ships inside.
    //
    // Sending the app key under `x-cli-token` would also authenticate, since the
    // server falls back after the token lookup misses — but it puts a lie on the
    // wire, and the next person reading a request log has to discover it.
    const agencyCredential = cliToken
      ? { appKey: cliToken, authHeaderName: "x-cli-token" as const }
      : { appKey: appKey ?? "", authHeaderName: "x-app-key" as const };
    this.agency = new Agency(
      new HttpClient({ ...shared, ...agencyCredential, baseURL: agencyBase }),
      { baseURL: agencyBase, ...agencyCredential, fetch: fetchImpl },
    );
  }
}

function envKey(): string | undefined {
  return typeof process !== "undefined" ? process.env?.CURVET_APP_KEY : undefined;
}

function envEnterpriseKey(): string | undefined {
  return typeof process !== "undefined" ? process.env?.CURVET_ENTERPRISE_KEY : undefined;
}

function envCliToken(): string | undefined {
  return typeof process !== "undefined" ? process.env?.CURVET_CLI_TOKEN : undefined;
}

function defaultFetch(): FetchLike | undefined {
  const f = (globalThis as { fetch?: unknown }).fetch;
  return typeof f === "function" ? (f.bind(globalThis) as FetchLike) : undefined;
}
