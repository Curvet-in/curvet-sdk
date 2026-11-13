/**
 * Contract test: the SDK against the server's own description of its API.
 *
 * WHERE THE FIXTURE COMES FROM
 *   test/fixtures/openapi.json is a verbatim copy of the server's generated
 *   OpenAPI file, documentation/api/openapi.json in the Curvet server repo. The
 *   server builds it with backend/scripts/buildOpenApi.js from the JSON Schemas
 *   in backend/api/v1/schemas/, which are written from what the routes return.
 *   Do not edit the copy by hand.
 *
 * HOW TO REFRESH IT
 *   Copy the server's documentation/api/openapi.json over
 *   test/fixtures/openapi.json, then run `npx vitest run test/contract.test.ts`.
 *   A failure names the field. Add it to a sample below (the sample must still
 *   validate), then to the SDK's type and — where the SDK rebuilds the reply
 *   (src/core/normalize.ts, the workflow / analytics / error code) — to the
 *   code that copies it across.
 *
 * WHAT IT CHECKS
 *   For every reply the SDK reads:
 *   1. each sample validates against the server's schema for that route and status;
 *   2. together, the samples fill in every property the schemas document, so a
 *      field the server adds fails here until a sample carries it;
 *   3. fed through the SDK's own method (a mocked fetch answers with the
 *      sample), every value in the sample comes out where the SDK maps it —
 *      a documented field the SDK drops fails;
 *   4. the type that method returns declares each of those fields (an index
 *      signature does not count), optional where the server may omit it and
 *      nullable where it may send null.
 *   For the requests the SDK sends, the params type declares every documented
 *   field. Every schema in the file is either checked here or listed as one this
 *   SDK does not use, and every /playground route's success replies are checked.
 *
 * No JSON Schema validator is installed in this repo (there is no ajv), so the
 * samples are written by hand from the schemas' own descriptions and examples,
 * and support/jsonSchema.ts validates them: it implements the keywords the file
 * uses and throws on any other. The type checks use the TypeScript compiler API
 * (support/sdkTypes.ts) on support/contractTypes.ts.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Curvet } from "../src";
import { mockFetch } from "./helpers";
import {
  makeValidator,
  documentedPaths,
  schemaProperties,
  markCovered,
  type Schema,
  type DocumentedPath,
} from "./support/jsonSchema";
import { loadSdkTypes, type SdkTypes } from "./support/sdkTypes";

const spec = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/openapi.json", import.meta.url)), "utf8"),
);
const v = makeValidator(spec);
const component = (name: string): Schema => {
  const s = spec.components.schemas[name];
  if (!s) throw new Error(`openapi.json has no component "${name}"`);
  return s;
};

// ---------------------------------------------------------------------------
// How a reply's fields reach what the SDK returns.

interface Rule {
  /** Dotted path in the server's reply (the rule also covers everything under it). */
  from: string;
  /**
   * Where the SDK puts it: a dotted path in what the method returns ("" = the
   * whole result), or null when the SDK leaves it only in `raw` (say why).
   */
  to: string | null;
  reason?: string;
  /** The SDK reads null as undefined here (an absent URL): no nullable check; a null sample comes out undefined. */
  nullAsUndefined?: boolean;
  /** The SDK converts the value: compare with this, and skip the nullable/optional checks. */
  same?: (sent: unknown, got: unknown) => boolean;
  /** The SDK types this node as an open record: check the node, not the fields under it. */
  open?: boolean;
  /** The SDK's type knowingly differs from the schema's optional/nullable flags here (say why). */
  typeNote?: string;
}

interface ReplyCase {
  name: string;
  /** The route and status this sample answers. */
  route: [method: string, path: string, status: string];
  /** The component schema of the sample; the route must answer it for that status. */
  schema: string;
  sample: unknown;
  headers?: Record<string, string>;
  /** What the SDK hands back for it: the method's result, or the error it throws. Absent for a type-only check. */
  run?: (curvet: Curvet) => Promise<unknown>;
  /** The export of support/contractTypes.ts that describes `run`'s result. */
  type: string;
  rules?: Rule[];
}

const SUCCESS: Rule = {
  from: "success",
  to: null,
  reason: "always true on a 2xx (an error throws instead); kept in `raw`",
};
const ERROR_SUCCESS: Rule = { from: "success", to: null, reason: "always false on an error; kept in `err.raw`" };
const ERROR_TEXT: Rule = { from: "error", to: "message" };
/** How the OpenAI-style envelope's fields reach the error. */
const OPENAI_ERROR: Rule[] = [
  { from: "error", to: null, reason: "the envelope; its fields are mapped below" },
  { from: "error.message", to: "message" },
  { from: "error.type", to: "type" },
  { from: "error.code", to: "code", nullAsUndefined: true },
  { from: "error.param", to: "param", nullAsUndefined: true },
  { from: "error.provider", to: "provider", nullAsUndefined: true },
  { from: "error.model", to: "model", nullAsUndefined: true },
  { from: "error.provider_status", to: "providerStatus", nullAsUndefined: true },
  { from: "error.retryable", to: "retryable" },
  { from: "error.request_id", to: "requestId", nullAsUndefined: true },
];
/** What a key's own 429 sends besides its body: the limit, what is left, whose, its period, and Retry-After. */
const LIMIT_HEADERS = (limit: string, scope: string, period: string, retryAfter: string) => ({
  "retry-after": retryAfter,
  "x-curvet-limit": limit,
  "x-curvet-limit-remaining": "0",
  "x-curvet-limit-scope": scope,
  "x-curvet-limit-period": period,
});
/** The finished media reply's `mediaUrl` (the same URL as its own key); a null one reads as undefined. */
const MEDIA_URL: Rule = { from: "mediaUrl", to: "mediaUrl", nullAsUndefined: true };
const NODES_EXECUTED: Rule = {
  from: "nodesExecuted",
  to: "nodesExecuted",
  typeNote:
    "WorkflowRunNode.nodeId stays required: the server's WorkflowRun model requires it, though the schema leaves it optional",
};

const thrown = async (p: Promise<unknown>): Promise<unknown> => {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected the SDK to throw");
};
const sameDate = (sent: unknown, got: unknown) =>
  got instanceof Date && got.getTime() === new Date(String(sent)).getTime();
const sameNumber = (sent: unknown, got: unknown) => typeof got === "number" && got === Number(sent);

const CHAT = { model: "gpt-4o-mini", messages: [{ role: "user" as const, content: "hi" }] };
const MEDIA = { model: "wan-2.2", prompt: "a calm ocean wave at sunset" };

// ---------------------------------------------------------------------------
// Samples, written from the schemas' descriptions and examples.

const JOB_ID = "6741a1b2c3d4e5f6a7b8c9d0";
const RUN_ID = "run_8f2c1e7a";

/** A StepError with every field filled in (it is shared by error bodies and failed jobs). */
const STEP_ERROR = {
  v: 1,
  code: "provider_busy",
  title: "The provider is busy",
  scope: "provider",
  retryable: true,
  actions: ["retry_later", "switch_model"],
  message: "The model's provider is busy right now. Try again in a minute, or pick another model.",
  providerMessage: "Too many requests, please slow down.",
  model: "wan-2.2",
  modelName: "WAN 2.2",
  servedModel: "wan-2.2",
  provider: "deepinfra",
  providerStatus: 429,
  refundedCredits: 9,
  retryAfterSec: 30,
  suggestedModels: ["seedance-1-lite"],
  faultKind: "throttled",
  ref: JOB_ID,
};

const replyCases: ReplyCase[] = [
  // ---- chat ---------------------------------------------------------------
  {
    name: "chat 200",
    route: ["post", "/playground/chat", "200"],
    schema: "PlaygroundChatResponse",
    sample: {
      success: true,
      response: "A vector database stores embeddings and finds the nearest ones fast.",
      finishReason: "stop",
      usage: {
        promptTokens: 21,
        completionTokens: 14,
        totalTokens: 35,
        cost: 0.0003,
        credits: 0.03,
        billing: "metered",
        remainingBalance: 12.5,
        remainingPoints: 40,
        remainingCredits: 1290,
      },
      // Asked with allowFallbacks; another model answered.
      metadata: { model: "claude-sonnet-4-6", servedModel: "gpt-4o", latencyMs: 812, requestId: JOB_ID },
    },
    run: (c) => c.chat.create(CHAT),
    type: "ChatReply",
    rules: [
      {
        from: "response",
        to: "response",
        typeNote:
          "the server can send null; the type stays `string` so existing `res.response.trim()` keeps compiling (documented on the field)",
      },
    ],
  },
  // ---- image --------------------------------------------------------------
  {
    name: "image 200",
    route: ["post", "/playground/image", "200"],
    schema: "PlaygroundImageResponse",
    sample: {
      success: true,
      imageUrl: "https://cdn.curvet.ai/images/6741a1b2.png",
      usage: { cost: 0.01, credits: 1, remainingBalance: 12.49, remainingPoints: 40, remainingCredits: null },
      metadata: { model: "flux-2-klein-4b", latencyMs: 4120, requestId: JOB_ID },
    },
    run: (c) => c.image.generate({ model: "flux-2-klein-4b", prompt: "a red cube" }),
    type: "ImageReply",
  },
  // ---- media: finished within the server's wait (200) -----------------------
  {
    name: "video 200",
    route: ["post", "/playground/video", "200"],
    schema: "PlaygroundVideoResponse",
    sample: {
      success: true,
      videoUrl: "https://cdn.curvet.ai/video/6741a1b2.mp4",
      mediaUrl: "https://cdn.curvet.ai/video/6741a1b2.mp4",
      metadata: { model: "wan-2.2", jobId: JOB_ID, latencyMs: 24210 },
      usage: { cost: 0.09, credits: 9, remainingBalance: 12.31, remainingCredits: 1231 },
      outputMetadata: { duration: 5, resolution: "720p", format: "mp4" },
    },
    run: (c) => c.video.submit(MEDIA),
    type: "MediaSubmitReply",
    rules: [
      SUCCESS,
      MEDIA_URL,
      { from: "videoUrl", to: "mediaUrl", nullAsUndefined: true },
      {
        from: "metadata",
        to: "metadata",
        open: true,
        reason: "MediaJob.metadata is an open record: the call's facts here, the provider's on a job",
      },
    ],
  },
  {
    name: "audio 200, spoken in parts",
    route: ["post", "/playground/audio", "200"],
    schema: "PlaygroundAudioResponse",
    sample: {
      success: true,
      audioUrl: "https://cdn.curvet.ai/audio/6741a1b2.mp3",
      mediaUrl: "https://cdn.curvet.ai/audio/6741a1b2.mp3",
      metadata: { model: "ali-qwen3-tts-flash", jobId: JOB_ID, latencyMs: 9120 },
      usage: { cost: 0.03, credits: 3, parts: 3, remainingBalance: 12.28, remainingCredits: 1228 },
      outputMetadata: { format: "mp3", durationSec: 41.2 },
    },
    run: (c) => c.audio.submit({ model: "ali-qwen3-tts-flash", prompt: "Hello there" }),
    type: "MediaSubmitReply",
    rules: [
      SUCCESS,
      MEDIA_URL,
      { from: "audioUrl", to: "mediaUrl", nullAsUndefined: true },
      { from: "metadata", to: "metadata", open: true, reason: "see video 200" },
    ],
  },
  {
    name: "3d 200",
    route: ["post", "/playground/3d", "200"],
    schema: "Playground3dResponse",
    sample: {
      success: true,
      modelUrl: "https://cdn.curvet.ai/3d/6741a1b2.glb",
      mediaUrl: "https://cdn.curvet.ai/3d/6741a1b2.glb",
      metadata: { model: "meshy-3d", jobId: JOB_ID, latencyMs: 27400 },
      usage: { cost: 0.2, credits: 20, remainingBalance: 12.08, remainingCredits: 1208 },
      outputMetadata: { format: "glb", polycount: 30000 },
    },
    run: (c) => c.threeD.submit({ model: "meshy-3d", prompt: "a ceramic mug" }),
    type: "MediaSubmitReply",
    rules: [
      SUCCESS,
      MEDIA_URL,
      { from: "modelUrl", to: "mediaUrl", nullAsUndefined: true },
      { from: "metadata", to: "metadata", open: true, reason: "see video 200" },
    ],
  },
  {
    name: "3d 200, finished without an output URL",
    route: ["post", "/playground/3d", "200"],
    schema: "Playground3dResponse",
    sample: {
      success: true,
      modelUrl: null,
      mediaUrl: null,
      metadata: { model: "meshy-3d", jobId: JOB_ID, latencyMs: 28900 },
      usage: { cost: 0.2, credits: 20, remainingBalance: 12.08, remainingCredits: 1208 },
    },
    run: (c) => c.threeD.submit({ model: "meshy-3d", prompt: "a ceramic mug" }),
    type: "MediaSubmitReply",
    rules: [
      SUCCESS,
      MEDIA_URL,
      { from: "modelUrl", to: "mediaUrl", nullAsUndefined: true },
      { from: "metadata", to: "metadata", open: true, reason: "see video 200" },
    ],
  },
  // ---- media: still running after the server's wait (202) -------------------
  {
    name: "video 202",
    route: ["post", "/playground/video", "202"],
    schema: "PlaygroundMediaJobAccepted",
    sample: {
      success: true,
      message: "Video is being generated",
      jobId: JOB_ID,
      statusUrl: `/api/v1/playground/jobs/${JOB_ID}`,
      estimatedWaitTime: "1-3 minutes",
    },
    run: (c) => c.video.submit(MEDIA),
    type: "MediaSubmitReply",
    rules: [SUCCESS],
  },
  {
    name: "audio 202",
    route: ["post", "/playground/audio", "202"],
    schema: "PlaygroundMediaJobAccepted",
    sample: {
      success: true,
      message: "Audio is being generated",
      jobId: JOB_ID,
      statusUrl: `/api/v1/playground/jobs/${JOB_ID}`,
      estimatedWaitTime: "10-30 seconds",
    },
    run: (c) => c.audio.submit({ model: "ali-qwen3-tts-flash", prompt: "A long chapter…" }),
    type: "MediaSubmitReply",
    rules: [SUCCESS],
  },
  {
    name: "3d 202",
    route: ["post", "/playground/3d", "202"],
    schema: "PlaygroundMediaJobAccepted",
    sample: {
      success: true,
      message: "3D model is being generated",
      jobId: JOB_ID,
      statusUrl: `/api/v1/playground/jobs/${JOB_ID}`,
      estimatedWaitTime: "1-2 minutes",
    },
    run: (c) => c.threeD.submit({ model: "meshy-3d", prompt: "a ceramic mug" }),
    type: "MediaSubmitReply",
    rules: [SUCCESS],
  },
  // ---- jobs ---------------------------------------------------------------
  {
    name: "job completed",
    route: ["get", "/playground/jobs/{jobId}", "200"],
    schema: "PlaygroundJobResponse",
    sample: {
      success: true,
      jobId: JOB_ID,
      status: "completed",
      type: "video",
      model: "wan-2.2",
      progress: 100,
      output: {
        mediaUrl: "https://cdn.curvet.ai/video/6741a1b2.mp4",
        thumbnailUrl: "https://cdn.curvet.ai/video/6741a1b2.jpg",
        metadata: { duration: 5, resolution: "720p" },
      },
      error: null,
      cost: { estimated: 0.09, actual: 0.09, reserved: 0.09 },
      eta: null,
      pollCount: 7,
      createdAt: "2026-11-13T10:00:00.000Z",
      updatedAt: "2026-11-13T10:01:12.000Z",
    },
    run: (c) => c.jobs.retrieve(JOB_ID),
    type: "JobReply",
    rules: [
      SUCCESS,
      { from: "output", to: null, reason: "flattened into mediaUrl / thumbnailUrl / outputMetadata" },
      { from: "output.mediaUrl", to: "mediaUrl", nullAsUndefined: true },
      { from: "output.thumbnailUrl", to: "thumbnailUrl" },
      { from: "output.metadata", to: "outputMetadata" },
    ],
  },
  {
    name: "job failed",
    route: ["get", "/playground/jobs/{jobId}", "200"],
    schema: "PlaygroundJobResponse",
    sample: {
      success: true,
      jobId: JOB_ID,
      status: "failed",
      type: "video",
      model: "wan-2.2",
      progress: 0,
      output: null,
      error: STEP_ERROR.message,
      faultKind: "throttled",
      faultRetryable: true,
      stepError: STEP_ERROR,
      cost: { estimated: 0.09, actual: null, reserved: 0 },
      eta: "2026-11-13T10:03:00.000Z",
      pollCount: 3,
      createdAt: "2026-11-13T10:00:00.000Z",
      updatedAt: "2026-11-13T10:00:41.000Z",
    },
    run: (c) => c.jobs.retrieve(JOB_ID),
    type: "JobReply",
    rules: [
      SUCCESS,
      { from: "output", to: null, reason: "flattened into mediaUrl / thumbnailUrl / outputMetadata" },
    ],
  },
  // ---- models -------------------------------------------------------------
  {
    name: "models 200",
    route: ["get", "/playground/models", "200"],
    schema: "PlaygroundModelsResponse",
    sample: {
      success: true,
      models: [
        {
          id: "claude-sonnet-4-6",
          name: "Claude Sonnet 4.6",
          aliases: ["anthropic/claude-sonnet-4.6"],
          cost: 0.03,
          type: "chat",
          provider: "anthropic",
          credits: 3,
          supportsVision: true,
          capability: "generation",
          maxOutputTokens: 64000,
          pricing: {
            meter: "tokens",
            unit: "credits_per_million_tokens",
            input: 300,
            output: 1500,
            billing: "metered",
            cached_input: 30,
            tiers: [{ min_prompt_tokens: 200000, input: 600, output: 2250 }],
          },
          available: true,
          comingSoon: false,
          endpoint: "POST /api/v1/playground/chat",
          surface: "api",
          unavailableReason: null,
          healthStatus: "healthy",
        },
        {
          id: "ft:gpt-4o-mini:acme:support-v2",
          name: "support-v2",
          aliases: [],
          group: "mine",
          cost: 0.01,
          type: "chat",
          provider: "openai",
          credits: 1,
          baseModel: "gpt-4o-mini",
          supportsVision: false,
          capability: "generation",
          pricing: null,
          available: true,
          comingSoon: false,
          endpoint: "POST /api/v1/playground/chat",
          surface: "api",
          unavailableReason: null,
          healthStatus: "unknown",
        },
        {
          id: "text-embedding-3-small",
          name: "Text Embedding 3 Small",
          aliases: ["openai/text-embedding-3-small"],
          cost: 0.0001,
          type: "embedding",
          provider: "openai",
          credits: 0.01,
          supportsVision: false,
          capability: "embedding",
          pricing: {
            meter: "tokens",
            unit: "credits_per_million_tokens",
            input: 2,
            output: 0,
            billing: "metered",
            minimum_per_request: 0.01,
          },
          available: false,
          comingSoon: false,
          endpoint: "POST /api/v1/embeddings",
          surface: null,
          unavailableReason: "provider_unhealthy",
          healthStatus: "down",
          dims: 1536,
          supportsDimensions: true,
          maxInputTokens: 8191,
        },
      ],
      rateLimits: { enabled: true, requestsPerHour: 100, costCapPerDay: 10 },
    },
    run: async (c) => ({
      models: await c.models.list({ include: "all" }),
      rateLimits: await c.models.rateLimits({ include: "all" }),
    }),
    type: "ModelsReply",
    rules: [SUCCESS],
  },
  // ---- balance ------------------------------------------------------------
  {
    name: "balance, shared-pool member",
    route: ["get", "/playground/balance", "200"],
    schema: "PlaygroundBalanceResponse",
    sample: {
      success: true,
      balance: {
        walletBalance: 120,
        totalPoints: 300,
        totalAvailableUSD: 123,
        breakdown: {
          walletUSD: 120,
          pointsAsUSD: 3,
          walletCredits: 12000,
          earnedCredits: 300,
          totalCredits: 12300,
          enterpriseCredits: 0,
          orgPoolCredits: 11500,
          personalCredits: 500,
          organizationLimit: 20000,
          monthlyUsed: 800,
          isEnterprise: true,
          creditModel: "shared",
        },
      },
    },
    run: async (c) => ({ balance: await c.balance.get() }),
    type: "BalanceReply",
    rules: [SUCCESS],
  },
  {
    name: "balance, per-member allocation",
    route: ["get", "/playground/balance", "200"],
    schema: "PlaygroundBalanceResponse",
    sample: {
      success: true,
      balance: {
        walletBalance: 5,
        totalPoints: 0,
        totalAvailableUSD: 25,
        breakdown: {
          walletUSD: 5,
          pointsAsUSD: 0,
          walletCredits: 500,
          earnedCredits: 0,
          totalCredits: 2500,
          enterpriseCredits: 2000,
          orgPoolCredits: 50000,
          monthlyUsed: 1000,
          isEnterprise: true,
          enterpriseSpendable: 1500,
          creditLimit: 3000,
          creditLimitRemaining: null,
          drawsFromPool: true,
          orgPoolSpendable: 2000,
        },
      },
    },
    run: async (c) => ({ balance: await c.balance.get() }),
    type: "BalanceReply",
    rules: [SUCCESS],
  },
  // ---- analytics ----------------------------------------------------------
  {
    name: "analytics 200",
    route: ["get", "/playground/analytics", "200"],
    schema: "PlaygroundAnalyticsResponse",
    sample: {
      success: true,
      analytics: {
        overview: { _id: null, totalCost: 1.23, totalRequests: 42, avgCostPerRequest: null, avgLatency: 950 },
        modelBreakdown: [
          { _id: "gpt-4o-mini", totalCost: 0.8, requestCount: 30, avgLatency: 700, category: "chat" },
          { _id: null, totalCost: 0.1, requestCount: 2, avgLatency: null, category: null },
        ],
        categoryBreakdown: [{ _id: "chat", totalCost: 0.9, requestCount: 32, avgCostPerRequest: 0.028 }],
        statusBreakdown: [{ _id: "completed", count: 40 }],
        errorBreakdown: [{ _id: "provider_busy", count: 2 }],
      },
      app: { name: "Support bot", appKey: "app_1234abcd" },
    },
    run: (c) => c.analytics.get({ startDate: "2026-11-01" }),
    type: "AnalyticsReply",
    rules: [SUCCESS, { from: "analytics", to: "" }],
  },
  // ---- workflows ----------------------------------------------------------
  {
    name: "workflow run 200 with a failed step",
    route: ["post", "/playground/workflows/{id}/run", "200"],
    schema: "PlaygroundWorkflowRunResponse",
    sample: {
      success: false,
      runId: RUN_ID,
      outputs: { summary: "Three tickets about refunds; one about login." },
      fullState: { Input: "Summarise this week's tickets", Summarise: "Three tickets…", Translate: null },
      nodeStateById: { n1: "Summarise this week's tickets", n2: "Three tickets…", n3: null },
      nodeErrors: { n3: "The provider is busy" },
    },
    run: (c) => c.workflows.run("wf_1", { inputs: { input: "Summarise this week's tickets" } }),
    type: "WorkflowRunReply",
  },
  {
    name: "workflow run 202",
    route: ["post", "/playground/workflows/{id}/run", "202"],
    schema: "PlaygroundWorkflowRunAccepted",
    sample: {
      success: true,
      runId: RUN_ID,
      status: "running",
      statusUrl: `/api/v1/playground/workflows/runs/${RUN_ID}`,
    },
    run: (c) => c.workflows.submit("wf_1", { inputs: {} }),
    type: "WorkflowSubmitReply",
    rules: [SUCCESS],
  },
  {
    name: "workflow run status, waiting at a Review step",
    route: ["get", "/playground/workflows/runs/{runId}", "200"],
    schema: "PlaygroundWorkflowRunStatus",
    sample: {
      success: true,
      runId: RUN_ID,
      status: "waiting",
      progress: 50,
      totalNodes: 4,
      completedNodeCount: 2,
      currentNode: { id: "n3", label: "Review", type: "review" },
      waitingOn: {
        nodeId: "n3",
        nodeLabel: "Review",
        kind: "review",
        since: "2026-11-13T10:02:00.000Z",
        preview: "Draft reply: thanks for writing in…",
      },
      nodesExecuted: [
        { nodeId: "n1", nodeLabel: "Input", nodeType: "input", status: "completed", executionTime: 3 },
        { nodeId: "n2", nodeLabel: "Draft", nodeType: "chat", status: "completed", executionTime: 2140 },
      ],
      startTime: "2026-11-13T10:01:57.000Z",
    },
    run: (c) => c.workflows.runs.retrieve(RUN_ID),
    type: "WorkflowRunStatusReply",
    rules: [SUCCESS, NODES_EXECUTED],
  },
  {
    name: "workflow run status, completed",
    route: ["get", "/playground/workflows/runs/{runId}", "200"],
    schema: "PlaygroundWorkflowRunStatus",
    sample: {
      success: true,
      runId: RUN_ID,
      status: "completed",
      progress: 100,
      totalNodes: 2,
      completedNodeCount: 2,
      currentNode: null,
      nodesExecuted: [{ nodeId: "n1", nodeLabel: "Input", nodeType: "input", status: "skipped", executionTime: 0 }],
      result: { outputs: { output: "done" }, fullState: {}, byNodeId: {}, skipped: [] },
      startTime: "2026-11-13T10:01:57.000Z",
      endTime: "2026-11-13T10:02:30.000Z",
      executionTime: 33000,
    },
    run: (c) => c.workflows.runs.retrieve(RUN_ID),
    type: "WorkflowRunStatusReply",
    rules: [SUCCESS, NODES_EXECUTED],
  },
  {
    name: "workflow run status, failed",
    route: ["get", "/playground/workflows/runs/{runId}", "200"],
    schema: "PlaygroundWorkflowRunStatus",
    sample: {
      success: true,
      runId: RUN_ID,
      status: "failed",
      progress: 50,
      totalNodes: 2,
      completedNodeCount: 1,
      currentNode: null,
      nodesExecuted: [{ nodeId: "n2", nodeLabel: "Draft", nodeType: "chat", status: "failed", executionTime: 812 }],
      error: "Draft: the provider is busy",
      startTime: "2026-11-13T10:01:57.000Z",
      endTime: "2026-11-13T10:02:01.000Z",
      executionTime: 4000,
    },
    run: (c) => c.workflows.runs.retrieve(RUN_ID),
    type: "WorkflowRunStatusReply",
    rules: [SUCCESS, NODES_EXECUTED],
  },
  {
    name: "workflow list",
    route: ["get", "/playground/workflows", "200"],
    schema: "PlaygroundWorkflowList",
    sample: {
      success: true,
      workflows: [
        {
          id: "wf_1",
          title: "Weekly ticket digest",
          description: null,
          nodeCount: 4,
          tags: ["support"],
          status: "active",
          createdAt: "2026-10-01T09:00:00.000Z",
          updatedAt: "2026-11-12T17:30:00.000Z",
        },
      ],
    },
    run: async (c) => ({ workflows: await c.workflows.list() }),
    type: "WorkflowListReply",
    rules: [SUCCESS],
  },
  {
    name: "workflow detail",
    route: ["get", "/playground/workflows/{id}", "200"],
    schema: "PlaygroundWorkflowDetail",
    sample: {
      success: true,
      workflow: {
        id: "wf_1",
        title: "Weekly ticket digest",
        description: "Summarises the week's tickets.",
        nodeCount: 4,
        tags: [],
        status: "active",
        createdAt: "2026-10-01T09:00:00.000Z",
        updatedAt: "2026-11-12T17:30:00.000Z",
        inputs: [
          { name: "input", type: "text", required: false, nodeId: "n1", nodeLabel: "Input", aliases: ["text"] },
          { name: "audio", type: "audio", required: true, nodeId: null, nodeLabel: null, aliases: [] },
        ],
      },
    },
    run: async (c) => ({ workflow: await c.workflows.retrieve("wf_1") }),
    type: "WorkflowDetailReply",
    rules: [SUCCESS],
  },
  // ---- errors: every thrown error carries what the server sent -------------
  {
    name: "error: a media job failed at the provider",
    route: ["post", "/playground/video", "502"],
    schema: "PlaygroundErrorResponse",
    sample: {
      success: false,
      error: "The provider is having trouble. Try again, or pick another model.",
      code: "provider_down",
      type: "api_error",
      retryable: true,
      stepError: {
        v: 1,
        code: "provider_down",
        title: "The provider is having trouble",
        scope: "provider",
        retryable: true,
        actions: ["retry", "switch_model"],
        message: "The provider is having trouble. Try again, or pick another model.",
        model: "wan-2.2",
        provider: "deepinfra",
        providerStatus: 500,
        retryAfterSec: 20,
        ref: JOB_ID,
      },
      requestId: "cvreq_01HZX",
      jobId: JOB_ID,
    },
    headers: { "x-curvet-request-id": "cvreq_01HZX", "retry-after": "20" },
    run: (c) => thrown(c.video.submit(MEDIA)),
    type: "CurvetError",
    rules: [ERROR_SUCCESS, ERROR_TEXT],
  },
  {
    name: "error: 3D prompt over the model's limit",
    route: ["post", "/playground/3d", "400"],
    schema: "PlaygroundErrorResponse",
    sample: {
      success: false,
      error: "Prompt too long",
      code: "PROMPT_TOO_LONG",
      message:
        "This prompt is 1,200 characters; Meshy 3D accepts up to 600. Describe the one object to build — its shape, materials and colours — not a whole scene.",
      promptLength: 1200,
      maxPromptLength: 600,
    },
    run: (c) => thrown(c.threeD.submit({ model: "meshy-3d", prompt: "x".repeat(1200) })),
    type: "CurvetError",
    rules: [
      ERROR_SUCCESS,
      ERROR_TEXT,
      { from: "message", to: null, reason: "PROMPT_TOO_LONG's longer sentence; `err.message` is `error`; in `err.raw`" },
      { from: "promptLength", to: null, reason: "PROMPT_TOO_LONG detail; in `err.raw`" },
      { from: "maxPromptLength", to: null, reason: "PROMPT_TOO_LONG detail; in `err.raw`" },
    ],
  },
  {
    name: "error: 402 on /audio",
    route: ["post", "/playground/audio", "402"],
    schema: "PlaygroundErrorResponse",
    sample: { success: false, error: "Insufficient balance", required: 0.06, requiredCredits: 6, available: 0.02 },
    run: (c) => thrown(c.audio.submit({ model: "ali-qwen3-tts-flash", prompt: "Hello" })),
    type: "InsufficientBalanceError",
    rules: [ERROR_SUCCESS, ERROR_TEXT],
  },
  {
    name: "error: hourly request limit",
    route: ["post", "/playground/chat", "429"],
    schema: "PlaygroundErrorResponse",
    sample: {
      success: false,
      error: "Rate limit exceeded. Maximum 100 requests per hour.",
      code: "rate_limit_exceeded",
      type: "rate_limit_error",
      retryable: true,
      requestId: "cvreq_01HZA",
      rateLimitInfo: { limit: 100, used: 101, resetsAt: "2026-11-13T11:00:00.000Z" },
    },
    headers: LIMIT_HEADERS("100", "key", "hour", "1800"),
    run: (c) => thrown(c.chat.create(CHAT)),
    type: "RateLimitError",
    rules: [
      ERROR_SUCCESS,
      ERROR_TEXT,
      { from: "rateLimitInfo", to: null, reason: "flattened into limit / used / resetsAt" },
      { from: "rateLimitInfo.limit", to: "limit" },
      { from: "rateLimitInfo.used", to: "used" },
      { from: "rateLimitInfo.resetsAt", to: "resetsAt", same: sameDate },
    ],
  },
  {
    name: "error: daily cost cap",
    route: ["post", "/playground/chat", "429"],
    schema: "PlaygroundErrorResponse",
    sample: {
      success: false,
      error: "Daily cost cap exceeded. Maximum $10 per day.",
      code: "daily_cost_cap_exceeded",
      type: "rate_limit_error",
      retryable: true,
      requestId: "cvreq_01HZB",
      costCapInfo: { limit: 10, used: "10.0000", resetsAt: "2026-11-14T00:00:00.000Z" },
    },
    headers: LIMIT_HEADERS("10", "platform", "day", "50400"),
    run: (c) => thrown(c.chat.create(CHAT)),
    type: "RateLimitError",
    rules: [
      ERROR_SUCCESS,
      ERROR_TEXT,
      { from: "costCapInfo", to: null, reason: "flattened into limit / used / resetsAt" },
      { from: "costCapInfo.limit", to: "limit" },
      { from: "costCapInfo.used", to: "used", same: sameNumber },
      { from: "costCapInfo.resetsAt", to: "resetsAt", same: sameDate },
    ],
  },
  {
    name: "error: credit budget",
    route: ["post", "/playground/chat", "429"],
    schema: "PlaygroundErrorResponse",
    sample: {
      success: false,
      error: "This key's monthly budget is used up.",
      code: "budget_exhausted",
      type: "rate_limit_error",
      retryable: true,
      requestId: "cvreq_01HZC",
      budgetInfo: { scope: "key", period: "month", limit: 5000, used: 5000, resetsAt: "2026-12-01T00:00:00.000Z" },
    },
    headers: LIMIT_HEADERS("5000", "key", "month", "1512000"),
    run: (c) => thrown(c.chat.create(CHAT)),
    type: "RateLimitError",
    rules: [
      ERROR_SUCCESS,
      ERROR_TEXT,
      { from: "budgetInfo", to: null, reason: "flattened into scope / period / limit / used / resetsAt" },
      { from: "budgetInfo.scope", to: "scope" },
      { from: "budgetInfo.period", to: "period" },
      { from: "budgetInfo.limit", to: "limit" },
      { from: "budgetInfo.used", to: "used" },
      { from: "budgetInfo.resetsAt", to: "resetsAt", same: sameDate },
    ],
  },
  {
    name: "error: the server's per-IP limit",
    route: ["get", "/playground/balance", "429"],
    schema: "PlaygroundErrorResponse",
    sample: {
      success: false,
      error: "Too many requests from this IP, please try again later.",
      code: "ip_rate_limited",
      type: "rate_limit_error",
      retryable: true,
      requestId: "cvreq_01HZD",
      message: "Too many requests from this IP, please try again later.",
      retryAfter: 42,
    },
    headers: { "x-curvet-request-id": "cvreq_01HZD" },
    run: (c) => thrown(c.balance.get()),
    type: "RateLimitError",
    rules: [
      ERROR_SUCCESS,
      ERROR_TEXT,
      { from: "message", to: null, reason: "the text the server always carried beside `error`; in `err.raw`" },
      // No Retry-After header in this sample, so the body's own value is what the SDK reads.
      { from: "retryAfter", to: "retryAfterMs", same: (sent, got) => got === Number(sent) * 1000 },
    ],
  },
  {
    name: "error: an Idempotency-Key refusal",
    route: ["post", "/playground/chat", "409"],
    schema: "PlaygroundErrorResponse",
    sample: {
      success: false,
      error: "That request finished, but its reply was not kept, so it cannot be returned again.",
      code: "idempotency_key_not_replayable",
      type: "invalid_request_error",
      retryable: false,
    },
    run: (c) => thrown(c.chat.create(CHAT)),
    type: "CurvetError",
    rules: [ERROR_SUCCESS, ERROR_TEXT],
  },
  {
    name: "error: a body over the server's size limit",
    route: ["post", "/playground/chat", "413"],
    schema: "PlaygroundErrorResponse",
    sample: {
      success: false,
      error: "Something went wrong!",
      code: "body_too_large",
      type: "invalid_request_error",
      retryable: false,
      message: "Internal server error",
    },
    run: (c) => thrown(c.chat.create(CHAT)),
    type: "CurvetError",
    rules: [
      ERROR_SUCCESS,
      ERROR_TEXT,
      { from: "message", to: null, reason: "the text the server always carried beside `error`; in `err.raw`" },
    ],
  },
  {
    name: "error: a synchronous workflow run stopped on a step",
    route: ["post", "/playground/workflows/{id}/run", "402"],
    schema: "PlaygroundErrorResponse",
    sample: {
      success: false,
      error: "Not enough credits to run this step. Top up and try again.",
      code: "insufficient_credits",
      type: "insufficient_quota",
      retryable: false,
      stepError: {
        v: 1,
        code: "insufficient_credits",
        title: "Not enough credits",
        scope: "wallet",
        retryable: false,
        actions: ["top_up"],
        message: "Not enough credits to run this step. Top up and try again.",
        model: "wan-2.2",
      },
      requestId: "cvreq_01HZE",
      runId: RUN_ID,
    },
    run: (c) => thrown(c.workflows.run("wf_1", { inputs: {} })),
    type: "CurvetError",
    rules: [ERROR_SUCCESS, ERROR_TEXT],
  },
  {
    // The SDK calls no OpenAI-style route, but its error mapping reads that
    // envelope too, and this is where `provider` / `model` / `provider_status`
    // sit at the top of the error.
    name: "error: the OpenAI-style envelope",
    route: ["post", "/chat/completions", "502"],
    schema: "OpenAIErrorResponse",
    sample: {
      error: {
        message: "The provider is having trouble. Try again, or pick another model.",
        type: "api_error",
        code: "provider_down",
        param: null,
        provider: "openai",
        model: "gpt-4o-mini",
        provider_status: 500,
        retryable: true,
        request_id: "cvreq_01HZY",
      },
    },
    run: (c) => thrown(c.chat.create(CHAT)),
    type: "CurvetError",
    rules: OPENAI_ERROR,
  },
  {
    name: "error: the OpenAI-style envelope, a key's budget",
    route: ["post", "/chat/completions", "429"],
    schema: "OpenAIErrorResponse",
    sample: {
      error: {
        message: "This key's monthly budget is used up.",
        type: "rate_limit_error",
        code: "budget_exhausted",
        param: null,
        retryable: true,
        request_id: "cvreq_01HZZ",
        limit: {
          kind: "budget",
          limit: 5000,
          used: 5000,
          resets_at: "2026-12-01T00:00:00.000Z",
          scope: "key",
          period: "month",
        },
      },
    },
    headers: LIMIT_HEADERS("5000", "key", "month", "1512000"),
    run: (c) => thrown(c.chat.create(CHAT)),
    type: "RateLimitError",
    rules: [
      ...OPENAI_ERROR,
      { from: "error.limit", to: null, reason: "flattened into kind / limit / used / resetsAt / scope / period" },
      {
        from: "error.limit.kind",
        to: "kind",
        same: (sent, got) =>
          got === ({ requests_per_hour: "rate", cost_per_day: "cost", budget: "budget" } as Record<string, string>)[String(sent)],
      },
      { from: "error.limit.limit", to: "limit" },
      { from: "error.limit.used", to: "used", same: sameNumber },
      { from: "error.limit.resets_at", to: "resetsAt", same: sameDate },
      { from: "error.limit.scope", to: "scope" },
      { from: "error.limit.period", to: "period" },
    ],
  },
  // ---- type only: no SDK method reads it --------------------------------------
  {
    name: "OpenAI-style model list (types only)",
    route: ["get", "/models", "200"],
    schema: "OpenAIModelList",
    sample: {
      object: "list",
      data: [
        {
          id: "claude-sonnet-4-6",
          object: "model",
          created: 1700000000,
          owned_by: "anthropic",
          aliases: ["anthropic/claude-sonnet-4.6"],
          x_curvet_pricing: {
            meter: "tokens",
            unit: "credits_per_million_tokens",
            input: 300,
            output: 1500,
            billing: "flat_per_request",
          },
          pricing: {
            prompt: "0.000003",
            completion: "0.000015",
            request: "0",
            image: "0",
            input_cache_read: "0.0000003",
            input_cache_write: "0.00000375",
          },
          context_length: 200000,
          max_output_tokens: 64000,
          architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
        },
        {
          id: "text-embedding-3-small",
          object: "model",
          created: 1700000000,
          owned_by: "openai",
          aliases: [],
          context_length: 8191,
          dimensions: 1536,
          architecture: { input_modalities: ["text"], output_modalities: ["embeddings"] },
        },
      ],
    },
    type: "OpenAIModelList",
  },
];

/** Request bodies the SDK sends: its params type must declare every documented field. */
const requestCases: Array<{ schema: string; type: string; rules?: Rule[] }> = [
  {
    schema: "PlaygroundChatRequest",
    type: "ChatCreateParams",
    rules: ["max_tokens", "response_format", "top_p", "frequency_penalty", "presence_penalty", "reasoning_effort"].map((f) => ({
      from: f,
      to: null,
      reason: "OpenAI's snake_case spelling; the SDK sends the camelCase field",
    })),
  },
  { schema: "PlaygroundImageRequest", type: "ImageGenerateParams" },
  { schema: "PlaygroundVideoRequest", type: "VideoGenerateParams" },
  { schema: "PlaygroundAudioRequest", type: "AudioGenerateParams" },
  { schema: "Playground3dRequest", type: "ThreeDGenerateParams" },
  {
    schema: "PlaygroundWorkflowRunRequest",
    type: "WorkflowRunParams",
    rules: [{ from: "async", to: null, reason: "set by workflows.submit() / runAndPoll(), not a param" }],
  },
];

/**
 * Value lists the server documents, and the SDK union type that must name every
 * value — and still accept any other string, so a value added later compiles.
 */
const enumCases: Array<{ name: string; component?: string; values: () => unknown[]; type: string }> = [
  { name: "ApiErrorCode", component: "ApiErrorCode", values: () => component("ApiErrorCode").enum, type: "ApiErrorCode" },
  { name: "StepError.code", values: () => component("StepError").properties.code.enum, type: "StepErrorCode" },
  {
    name: "PlaygroundErrorResponse.type",
    values: () => component("PlaygroundErrorResponse").properties.type.enum,
    type: "CurvetErrorType",
  },
  { name: "OpenAIErrorObject.type", values: () => component("OpenAIErrorObject").properties.type.enum, type: "CurvetErrorType" },
  {
    name: "ChatReasoningEffort",
    component: "ChatReasoningEffort",
    values: () => v.branches(component("ChatReasoningEffort")).flatMap((b) => b.enum ?? []),
    type: "ChatReasoningEffort",
  },
];

/** Schemas this SDK does not use (and everything only they reference). */
const NOT_USED: Record<string, string> = {
  OpenAIChatCompletionRequest: "POST /chat/completions — this SDK calls /playground/chat",
  OpenAIChatCompletion: "POST /chat/completions",
  OpenAIChatCompletionChunk: "POST /chat/completions, streamed",
  OpenAIEmbeddingsRequest: "POST /embeddings — not called by this SDK",
  OpenAIEmbeddingsResponse: "POST /embeddings — not called by this SDK",
};

// ---------------------------------------------------------------------------
// Helpers

const ruleFor = (rules: Rule[] | undefined, path: Array<string | number>): Rule | undefined => {
  let best: Rule | undefined;
  for (const r of rules ?? []) {
    const parts = r.from.split(".");
    if (parts.length > path.length) continue;
    if (parts.every((p, i) => p === path[i]) && (!best || parts.length > best.from.split(".").length)) best = r;
  }
  return best;
};

/** Where the SDK puts `path`, or null when the rule keeps it only in raw. */
const mapPath = (rule: Rule | undefined, path: Array<string | number>): Array<string | number> | null => {
  if (!rule) return path;
  if (rule.to === null) return null;
  const rest = path.slice(rule.from.split(".").length);
  return [...rule.to.split(".").filter(Boolean), ...rest];
};

const get = (obj: unknown, path: Array<string | number>): unknown =>
  path.reduce<any>((node, key) => (node == null ? undefined : node[key]), obj);

/** Every leaf of a JSON value (primitives, null, and empty objects/arrays) with its path. */
function leaves(value: unknown, path: Array<string | number> = []): Array<[Array<string | number>, unknown]> {
  if (Array.isArray(value)) {
    return value.length ? value.flatMap((item, i) => leaves(item, [...path, i])) : [[path, value]];
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    return entries.length ? entries.flatMap(([k, item]) => leaves(item, [...path, k])) : [[path, value]];
  }
  return [[path, value]];
}

/** Every path in a JSON value, objects and arrays included, in schema form ("[]" for array items). */
function samplePaths(value: unknown, path: string[] = [], out = new Set<string>()): Set<string> {
  if (path.length) out.add(path.join("."));
  if (Array.isArray(value)) for (const item of value) samplePaths(item, [...path, "[]"], out);
  else if (value && typeof value === "object") {
    for (const [k, item] of Object.entries(value)) samplePaths(item, [...path, k], out);
  }
  return out;
}

/** The component names `schema` refers to, transitively. */
function referenced(schema: unknown, out = new Set<string>()): Set<string> {
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    for (const [k, val] of Object.entries(node)) {
      if (k === "$ref" && typeof val === "string" && val.startsWith("#/components/schemas/")) {
        const name = val.slice("#/components/schemas/".length);
        if (!out.has(name)) {
          out.add(name);
          walk(component(name));
        }
      } else walk(val);
    }
  };
  walk(schema);
  return out;
}

/** The component names a route answers with for a status (directly or in an anyOf). */
const routeComponents = (method: string, path: string, status: string): string[] => {
  const op = spec.paths?.[path]?.[method];
  const schema = op?.responses?.[status]?.content?.["application/json"]?.schema;
  if (!schema) return [];
  const refs = [schema, ...(schema.anyOf ?? [])].map((s: Schema) => s.$ref).filter(Boolean);
  return refs.map((r: string) => r.slice("#/components/schemas/".length));
};

const clientFor = (c: ReplyCase) =>
  new Curvet({
    appKey: "k",
    fetch: mockFetch(() => ({ status: Number(c.route[2]), body: c.sample, headers: c.headers })),
    maxRetries: 0,
    idempotencyWaitMs: 0,
  });

const show = (p: Array<string | number>) => p.join(".") || "(root)";

/** Every value in the case's sample that does not come out of the SDK where its rules say it should. */
function dropped(c: ReplyCase, out: unknown): string[] {
  const problems: string[] = [];
  for (const [path, sent] of leaves(c.sample)) {
    const rule = ruleFor(c.rules, path);
    const to = mapPath(rule, path);
    if (to === null) continue;
    const got = get(out, to);
    const at = `${show(path)} → ${show(to)}`;
    if (rule?.same) {
      if (!rule.same(sent, got)) problems.push(`${at}: sent ${JSON.stringify(sent)}, got ${String(got)}`);
    } else if (rule?.nullAsUndefined && sent === null) {
      if (got !== undefined && got !== null) problems.push(`${at}: sent null, got ${JSON.stringify(got)}`);
    } else if (JSON.stringify(got) !== JSON.stringify(sent)) {
      problems.push(`${at}: sent ${JSON.stringify(sent)}, got ${JSON.stringify(got)}`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------

describe("the SDK against the server's openapi.json", () => {
  let types: SdkTypes;
  beforeAll(() => {
    types = loadSdkTypes(fileURLToPath(new URL("./support/contractTypes.ts", import.meta.url)));
  }, 60_000);

  describe("samples", () => {
    for (const c of replyCases) {
      it(`${c.name}: is what ${c.route[0].toUpperCase()} ${c.route[1]} answers with ${c.route[2]}, and validates`, () => {
        expect(routeComponents(...c.route)).toContain(c.schema);
        expect(v.validate(component(c.schema), c.sample)).toEqual([]);
      });
    }

    it("together fill in every property the reply schemas document", () => {
      const documented = new Map<Schema, { component: string; props: Set<string> }>();
      for (const c of replyCases) {
        for (const [owner, props] of schemaProperties(v, component(c.schema))) {
          const entry = documented.get(owner) ?? { component: c.schema, props: new Set<string>() };
          for (const p of props) entry.props.add(p);
          documented.set(owner, entry);
        }
      }
      const covered = new Map<Schema, Set<string>>();
      for (const c of replyCases) markCovered(v, component(c.schema), c.sample, covered);
      const missing: string[] = [];
      for (const [owner, { component: name, props }] of documented) {
        for (const p of props) {
          if (!covered.get(owner)?.has(p)) missing.push(`${owner.title ?? name}: "${p}"`);
        }
      }
      expect(missing, "add these documented fields to a sample above").toEqual([]);
    });
  });

  describe("replies through the SDK: no documented field is dropped", () => {
    for (const c of replyCases.filter((x) => x.run)) {
      it(c.name, async () => {
        const out = await c.run!(clientFor(c));
        expect(dropped(c, out), "fields the SDK drops or changes").toEqual([]);
      });
    }

    it("would catch a dropped field", async () => {
      const c = replyCases.find((x) => x.name === "job failed")!;
      const out = (await c.run!(clientFor(c))) as Record<string, unknown>;
      delete out.stepError;
      expect(dropped(c, out).some((p) => p.startsWith("stepError.code"))).toBe(true);
    });
  });

  describe("types declare every documented field", () => {
    const check = (
      typeName: string,
      docs: DocumentedPath[],
      rules: Rule[] | undefined,
      flags: boolean,
    ): string[] => {
      const problems: string[] = [];
      for (const d of docs) {
        const rule = ruleFor(rules, d.path);
        const to = mapPath(rule, d.path);
        if (to === null) continue;
        if (rule?.open && d.path.length > rule.from.split(".").length) continue;
        const info = types.property(typeName, to.map(String));
        const at = `${d.path.join(".")} → ${typeName}.${show(to)}`;
        if (!info.found) {
          problems.push(`${at}: not declared (missing at ${info.missingAt})`);
          continue;
        }
        if (!flags || rule?.same || rule?.nullAsUndefined || rule?.typeNote) continue;
        if (d.nullable && !info.nullable) problems.push(`${at}: the server can send null; the type does not allow it`);
        if (!d.required && !info.optional) problems.push(`${at}: the server can omit it; the type says it is always there`);
      }
      return problems;
    };

    for (const c of replyCases) {
      it(`${c.name} → ${c.type}`, () => {
        // Each sample's own fields, so an error class is checked for the fields
        // of its status; the coverage test above makes sure every documented
        // field is in some sample.
        const present = samplePaths(c.sample);
        const docs = documentedPaths(v, component(c.schema)).filter((d) => present.has(d.path.join(".")));
        expect(check(c.type, docs, c.rules, true)).toEqual([]);
      });
    }

    for (const r of requestCases) {
      it(`${r.schema} → ${r.type}`, () => {
        expect(check(r.type, documentedPaths(v, component(r.schema)), r.rules, false)).toEqual([]);
      });
    }

    it("would catch an undeclared, a wrongly required or a non-nullable field", () => {
      const doc = (path: string[], required: boolean, nullable: boolean) => ({ path, required, nullable });
      // A field MediaJob does not declare.
      expect(check("JobReply", [doc(["notAField"], false, false)], undefined, true)[0]).toMatch(/not declared/);
      // MediaJob.status is required; a schema that may omit it must fail.
      expect(check("JobReply", [doc(["status"], false, false)], undefined, true)[0]).toMatch(/omit/);
      // MediaJob.progress does not allow null.
      expect(check("JobReply", [doc(["progress"], false, true)], undefined, true)[0]).toMatch(/null/);
      // BalanceInfo.breakdown has an index signature; that does not count as declaring a field.
      expect(check("BalanceReply", [doc(["balance", "breakdown", "notAField"], false, false)], undefined, true)[0]).toMatch(
        /not declared/,
      );
    });
  });

  describe("value lists: the SDK's unions name every documented value, and stay open", () => {
    for (const e of enumCases) {
      it(`${e.name} → ${e.type}`, () => {
        const values = e.values().filter((x): x is string => typeof x === "string");
        expect(values.length).toBeGreaterThan(0);
        const named = types.literals(e.type);
        expect(values.filter((x) => !named.includes(x)), `add these to ${e.type}`).toEqual([]);
        expect(types.acceptsAnyString(e.type), `${e.type} must also accept any string`).toBe(true);
      });
    }

    it("would catch a missing value or a closed union", () => {
      expect(types.literals("ApiErrorCode")).not.toContain("definitely_not_a_code");
      expect(types.acceptsAnyString("JobStatus")).toBe(false);
    });
  });

  describe("nothing in the file goes unchecked", () => {
    it("every schema is checked here or listed as not used by this SDK", () => {
      const all = Object.keys(spec.components.schemas);
      const checked = new Set<string>();
      const named = [
        ...replyCases.map((c) => c.schema),
        ...requestCases.map((r) => r.schema),
        ...enumCases.flatMap((e) => (e.component ? [e.component] : [])),
      ];
      for (const name of named) {
        checked.add(name);
        referenced(component(name), checked);
      }
      const unused = new Set<string>();
      for (const name of Object.keys(NOT_USED)) {
        expect(all, `NOT_USED names a schema the file no longer has`).toContain(name);
        unused.add(name);
        referenced(component(name), unused);
      }
      expect(all.filter((n) => !checked.has(n) && !unused.has(n))).toEqual([]);
    });

    it("every success reply of a /playground route has a sample", () => {
      const missing: string[] = [];
      for (const [path, ops] of Object.entries<any>(spec.paths)) {
        if (!path.startsWith("/playground/")) continue;
        for (const [method, op] of Object.entries<any>(ops)) {
          for (const status of Object.keys(op.responses ?? {})) {
            if (!status.startsWith("2")) continue;
            const has = replyCases.some(
              (c) => c.route[0] === method && c.route[1] === path && c.route[2] === status,
            );
            if (!has) missing.push(`${method.toUpperCase()} ${path} ${status}`);
          }
        }
      }
      expect(missing).toEqual([]);
    });

    it("the validator is not vacuous", () => {
      const job = replyCases.find((c) => c.name === "job completed")!.sample as object;
      expect(v.validate(component("PlaygroundChatResponse"), { success: true })).not.toEqual([]);
      expect(v.validate(component("PlaygroundJobResponse"), { ...job, status: "paused" })).not.toEqual([]);
      expect(v.validate(component("PlaygroundJobResponse"), { ...job, surprise: 1 })).not.toEqual([]);
      expect(() => v.validate({ format: "date-time" }, "x")).toThrow(/not implemented/);
    });
  });
});
