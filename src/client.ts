import { HttpClient } from "./core/http";
import { CurvetError } from "./core/errors";
import type { FetchLike } from "./types/common";
import { Chat } from "./resources/chat";
import { Images } from "./resources/image";
import { Video } from "./resources/video";
import { Jobs } from "./resources/jobs";
import { Models } from "./resources/models";
import { Balance } from "./resources/balance";

export const DEFAULT_BASE_URL = "https://curvet.ai/api/v1/playground";

export interface CurvetOptions {
  /** Your app key. Falls back to the CURVET_APP_KEY env var. */
  appKey?: string;
  /** Override the gateway base URL (defaults to production). */
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
  readonly jobs: Jobs;
  readonly models: Models;
  readonly balance: Balance;

  constructor(options: CurvetOptions = {}) {
    const appKey = options.appKey ?? envKey();
    if (!appKey) {
      throw new CurvetError(
        "Missing Curvet app key. Pass { appKey } or set the CURVET_APP_KEY environment variable.",
      );
    }
    const fetchImpl = options.fetch ?? defaultFetch();
    if (!fetchImpl) {
      throw new CurvetError(
        "No fetch implementation available. Use Node 18+ or pass { fetch }.",
      );
    }

    const client = new HttpClient({
      appKey,
      baseURL: options.baseURL ?? DEFAULT_BASE_URL,
      timeout: options.timeout ?? 60_000,
      maxRetries: options.maxRetries ?? 2,
      fetch: fetchImpl,
    });

    const jobDefaults = {
      pollIntervalMs: options.defaultPollIntervalMs ?? 2500,
      pollTimeoutMs: options.defaultPollTimeoutMs ?? 180_000,
    };

    this.chat = new Chat(client);
    this.image = new Images(client);
    this.jobs = new Jobs(client, jobDefaults);
    this.video = new Video(client, jobDefaults);
    this.models = new Models(client);
    this.balance = new Balance(client);
  }
}

function envKey(): string | undefined {
  return typeof process !== "undefined" ? process.env?.CURVET_APP_KEY : undefined;
}

function defaultFetch(): FetchLike | undefined {
  const f = (globalThis as { fetch?: unknown }).fetch;
  return typeof f === "function" ? (f.bind(globalThis) as FetchLike) : undefined;
}
