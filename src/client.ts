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

export const DEFAULT_BASE_URL = "https://curvet.ai/api/v1/playground";

export interface CurvetOptions {
  /** Your app key. Falls back to the CURVET_APP_KEY env var. */
  appKey?: string;
  /**
   * Enterprise API key (org-scoped, admin-capable). Falls back to the
   * CURVET_ENTERPRISE_KEY env var. Required to use `curvet.enterprise.*`.
   */
  enterpriseKey?: string;
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
  /** Enterprise admin API (requires an Enterprise API key). */
  readonly enterprise: Enterprise;

  constructor(options: CurvetOptions = {}) {
    const appKey = options.appKey ?? envKey();
    const enterpriseKey = options.enterpriseKey ?? envEnterpriseKey();
    if (!appKey && !enterpriseKey) {
      throw new CurvetError(
        "Missing credentials. Pass { appKey } (or CURVET_APP_KEY) for the playground, " +
          "or { enterpriseKey } (or CURVET_ENTERPRISE_KEY) for the enterprise API.",
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
    // Enterprise resources authenticate with the Enterprise API key.
    const enterpriseClient = new HttpClient({
      ...shared,
      appKey: enterpriseKey ?? "",
      authHeaderName: "x-enterprise-key",
      baseURL: `${v1Base}/enterprise`,
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
  }
}

function envKey(): string | undefined {
  return typeof process !== "undefined" ? process.env?.CURVET_APP_KEY : undefined;
}

function envEnterpriseKey(): string | undefined {
  return typeof process !== "undefined" ? process.env?.CURVET_ENTERPRISE_KEY : undefined;
}

function defaultFetch(): FetchLike | undefined {
  const f = (globalThis as { fetch?: unknown }).fetch;
  return typeof f === "function" ? (f.bind(globalThis) as FetchLike) : undefined;
}
