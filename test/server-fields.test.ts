import { describe, it, expect } from "vitest";
import {
  Curvet,
  APIError,
  NotFoundError,
  ConflictError,
  GoneError,
  PayloadTooLargeError,
  UnprocessableEntityError,
  FailedDependencyError,
  RateLimitError,
  JobFailedError,
  InsufficientBalanceError,
  type ChatCreateParams,
  type ApiErrorCode,
  type CurvetErrorCode,
} from "../src";
import { mockFetch, type MockReply } from "./helpers";

const CHAT: ChatCreateParams = { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] };
const chatOk: MockReply = {
  status: 200,
  body: {
    success: true,
    response: "pong",
    finishReason: "stop",
    usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4, cost: 0.0001, credits: 0.01, billing: "metered" },
    metadata: { model: "gpt-4o-mini", latencyMs: 10 },
  },
};

const stepError = (code: string, retryable: boolean, extra: Record<string, unknown> = {}) => ({
  v: 1,
  code,
  title: code,
  scope: "provider",
  retryable,
  actions: ["switch_model"],
  message: `${code} happened`,
  ...extra,
});

/** A playground StepError refusal, as stepErrors.sendApiError writes it. */
const stepErrorReply = (status: number, code: string, retryable: boolean, extra: Record<string, unknown> = {}): MockReply => ({
  status,
  body: {
    success: false,
    error: `${code} happened`,
    code,
    type: "api_error",
    retryable,
    stepError: stepError(code, retryable, extra),
  },
});

describe("retries follow the server's `retryable`", () => {
  it("a 429 whose Retry-After is longer than one sleep may last is not retried: the error comes back at once", async () => {
    let n = 0;
    const fetch = mockFetch(() => {
      n++;
      return {
        status: 429,
        headers: { "retry-after": "1800" },
        body: { success: false, error: "Hourly limit reached", code: "rate_limit_exceeded", type: "rate_limit_error", retryable: true },
      };
    });
    const started = Date.now();
    const err = await new Curvet({ appKey: "k", fetch, maxRetries: 2 }).chat.create(CHAT).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfterMs).toBe(1800000);
    expect(n).toBe(1);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("a 429 with a short Retry-After is still waited for and retried", async () => {
    let n = 0;
    const fetch = mockFetch(() =>
      ++n === 1
        ? { status: 429, headers: { "retry-after": "0" }, body: { success: false, error: "busy", code: "provider_busy", retryable: true } }
        : chatOk,
    );
    const res = await new Curvet({ appKey: "k", fetch, maxRetries: 2 }).chat.create(CHAT);
    expect(res.response).toBe("pong");
    expect(n).toBe(2);
  });

  it("a 503 the server marks not retryable (our account at the provider) is not retried", async () => {
    let n = 0;
    const fetch = mockFetch(() => {
      n++;
      return stepErrorReply(503, "provider_unavailable", false);
    });
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 3 });
    const err = await curvet.balance.get().catch((e) => e);
    expect(err).toBeInstanceOf(APIError);
    expect(err.retryable).toBe(false);
    expect(err.code).toBe("provider_unavailable");
    expect(n).toBe(1);
  });

  it("a 502 the server marks retryable is retried", async () => {
    let n = 0;
    const fetch = mockFetch(() =>
      ++n === 1 ? stepErrorReply(502, "provider_down", true) : { status: 200, body: { success: true, balance: { totalAvailableUSD: 1 } } },
    );
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 2 });
    expect((await curvet.balance.get()).totalAvailableUSD).toBe(1);
    expect(n).toBe(2);
  });

  it("a 4xx the server marks retryable is retried", async () => {
    let n = 0;
    const fetch = mockFetch(() =>
      ++n === 1 ? stepErrorReply(424, "upstream_failed", true) : { status: 200, body: { success: true, balance: { totalAvailableUSD: 2 } } },
    );
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 2 });
    expect((await curvet.balance.get()).totalAvailableUSD).toBe(2);
    expect(n).toBe(2);
  });

  it("without `retryable`, today's rule stands: a 5xx is retried, a 4xx is not", async () => {
    let n5 = 0;
    const five = mockFetch(() => (++n5 === 1 ? { status: 503, body: { success: false, error: "busy" } } : chatOk));
    await new Curvet({ appKey: "k", fetch: five, maxRetries: 2 }).chat.create(CHAT);
    expect(n5).toBe(2);

    let n4 = 0;
    const four = mockFetch(() => (n4++, { status: 422, body: { success: false, error: "no" } }));
    await new Curvet({ appKey: "k", fetch: four, maxRetries: 2 }).chat.create(CHAT).catch(() => undefined);
    expect(n4).toBe(1);
  });

  it("waits what Retry-After says (and carries it on the error)", async () => {
    const fetch = mockFetch(() => ({
      ...stepErrorReply(429, "provider_busy", true),
      headers: { "retry-after": "7" },
    }));
    const err = await new Curvet({ appKey: "k", fetch, maxRetries: 0 }).chat.create(CHAT).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfterMs).toBe(7000);

    let n = 0;
    const quick = mockFetch(() =>
      ++n === 1 ? { ...stepErrorReply(429, "provider_busy", true), headers: { "retry-after": "0" } } : chatOk,
    );
    const started = Date.now();
    await new Curvet({ appKey: "k", fetch: quick, maxRetries: 1 }).chat.create(CHAT);
    expect(n).toBe(2);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe("every thrown error carries what the server sent", () => {
  it("a playground StepError refusal: code, type, retryable, provider, model, providerStatus, stepError, jobId, requestId, retryAfterMs", async () => {
    const fetch = mockFetch(() => ({
      status: 502,
      body: {
        success: false,
        error: "The provider is having trouble.",
        code: "provider_down",
        type: "api_error",
        retryable: true,
        stepError: stepError("provider_down", true, { provider: "deepinfra", model: "wan-2.2", providerStatus: 500, retryAfterSec: 12 }),
        requestId: "cvreq_1",
        jobId: "job_9",
      },
    }));
    const err = await new Curvet({ appKey: "k", fetch }).video.submit({ model: "wan-2.2", prompt: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(APIError);
    expect(err.message).toBe("The provider is having trouble.");
    expect(err).toMatchObject({
      status: 502,
      code: "provider_down",
      type: "api_error",
      retryable: true,
      provider: "deepinfra",
      model: "wan-2.2",
      providerStatus: 500,
      jobId: "job_9",
      requestId: "cvreq_1",
      retryAfterMs: 12_000,
    });
    expect(err.stepError.code).toBe("provider_down");
  });

  it("the x-curvet-request-id header wins over the body's requestId", async () => {
    const fetch = mockFetch(() => ({
      ...stepErrorReply(504, "timeout", false),
      headers: { "x-curvet-request-id": "from-header" },
    }));
    const err = await new Curvet({ appKey: "k", fetch, maxRetries: 0 }).chat.create(CHAT).catch((e) => e);
    expect(err.requestId).toBe("from-header");
  });

  it("an error body without those fields leaves them unset", async () => {
    const fetch = mockFetch(() => ({ status: 400, body: { success: false, error: "Messages array is required" } }));
    const err = await new Curvet({ appKey: "k", fetch }).chat.create(CHAT).catch((e) => e);
    for (const k of ["code", "type", "retryable", "provider", "model", "providerStatus", "stepError", "jobId", "retryAfterMs"]) {
      expect(k in err, k).toBe(false);
    }
  });

  it("a budget 429 is kind 'budget', with its scope and period", async () => {
    const fetch = mockFetch(() => ({
      status: 429,
      body: {
        success: false,
        error: "Budget used up",
        budgetInfo: { scope: "org", period: "week", limit: 100, used: 100, resetsAt: "2030-01-01T00:00:00Z" },
      },
    }));
    const err = await new Curvet({ appKey: "k", fetch, maxRetries: 0 }).chat.create(CHAT).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err).toMatchObject({ kind: "budget", scope: "org", period: "week", limit: 100, used: 100 });
    expect(err.resetsAt).toBeInstanceOf(Date);
  });

  it("the cost cap's `used` (a string on the wire) is a number", async () => {
    const fetch = mockFetch(() => ({
      status: 429,
      body: { success: false, error: "cap", costCapInfo: { limit: 10, used: "10.0500", resetsAt: "2030-01-01T00:00:00Z" } },
    }));
    const err = await new Curvet({ appKey: "k", fetch, maxRetries: 0 }).chat.create(CHAT).catch((e) => e);
    expect(err.kind).toBe("cost");
    expect(err.used).toBe(10.05);
  });
});

describe("error classes for the statuses that had none", () => {
  const cases: Array<[number, Function]> = [
    [409, ConflictError],
    [410, GoneError],
    [413, PayloadTooLargeError],
    [422, UnprocessableEntityError],
    [424, FailedDependencyError],
  ];
  for (const [status, cls] of cases) {
    it(`${status} -> ${cls.name}, still an APIError`, async () => {
      const fetch = mockFetch(() => ({ status, body: { success: false, error: "no", code: "x", retryable: false } }));
      const err = await new Curvet({ appKey: "k", fetch }).balance.get().catch((e) => e);
      expect(err).toBeInstanceOf(cls);
      expect(err).toBeInstanceOf(APIError);
      expect(err.name).toBe(cls.name);
    });
  }

  it("existing statuses keep their class", async () => {
    const err404 = await new Curvet({ appKey: "k", fetch: mockFetch(() => ({ status: 404, body: { success: false, error: "x" } })) })
      .balance.get()
      .catch((e) => e);
    expect(err404).toBeInstanceOf(NotFoundError);
    const err500 = await new Curvet({
      appKey: "k",
      maxRetries: 0,
      fetch: mockFetch(() => ({ status: 500, body: { success: false, error: "x" } })),
    })
      .balance.get()
      .catch((e) => e);
    expect(err500.constructor).toBe(APIError);
  });
});

describe("media and jobs", () => {
  it("a 200 whose URL is null is finished: completed, no polling", async () => {
    const fetch = mockFetch(() => ({
      status: 200,
      body: {
        success: true,
        modelUrl: null,
        metadata: { model: "meshy-3d", jobId: "job_n", latencyMs: 5 },
        usage: { cost: 0.2, credits: 20, remainingBalance: 1 },
      },
    }));
    const res = await new Curvet({ appKey: "k", fetch }).threeD.generate({ model: "meshy-3d", prompt: "x" });
    expect(res.status).toBe("completed");
    expect(res.mediaUrl).toBeUndefined();
    expect(res.jobId).toBe("job_n");
    expect(fetch.calls).toHaveLength(1);
  });

  it("a queued job is polled until it finishes", async () => {
    const states = ["queued", "processing", "completed"];
    let i = 0;
    const fetch = mockFetch((url) => {
      if (url.endsWith("/video")) return { status: 202, body: { success: true, jobId: "job_q" } };
      const status = states[Math.min(i++, 2)];
      return {
        status: 200,
        body: { success: true, jobId: "job_q", status, output: status === "completed" ? { mediaUrl: "https://cdn/q.mp4" } : null },
      };
    });
    const res = await new Curvet({ appKey: "k", fetch, defaultPollIntervalMs: 1 }).video.generate({ model: "wan-2.2", prompt: "x" });
    expect(res.status).toBe("completed");
    expect(res.mediaUrl).toBe("https://cdn/q.mp4");
    expect(i).toBe(3);
  });

  it("a failed job's error carries its StepError", async () => {
    const fetch = mockFetch((url) => {
      if (url.endsWith("/video")) return { status: 202, body: { success: true, jobId: "job_f" } };
      return {
        status: 200,
        body: {
          success: true,
          jobId: "job_f",
          status: "failed",
          error: "The provider is busy",
          faultKind: "throttled",
          faultRetryable: true,
          stepError: stepError("provider_busy", true, { provider: "deepinfra", model: "wan-2.2", providerStatus: 429 }),
        },
      };
    });
    const err = await new Curvet({ appKey: "k", fetch, defaultPollIntervalMs: 1 })
      .video.generate({ model: "wan-2.2", prompt: "x" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(JobFailedError);
    expect(err).toMatchObject({
      jobId: "job_f",
      code: "provider_busy",
      retryable: true,
      provider: "deepinfra",
      model: "wan-2.2",
      providerStatus: 429,
    });
  });

  it("a failed job without a StepError falls back to faultRetryable", async () => {
    const fetch = mockFetch(() => ({
      status: 200,
      body: { success: true, jobId: "job_o", status: "failed", error: "boom", faultKind: "provider_error", faultRetryable: false, stepError: null },
    }));
    const err = await new Curvet({ appKey: "k", fetch }).jobs.handle("job_o").wait().catch((e) => e);
    expect(err).toBeInstanceOf(JobFailedError);
    expect(err.retryable).toBe(false);
    expect(err.code).toBeUndefined();
  });
});

describe("analytics, workflows, image", () => {
  it("analytics.get() keeps the `app` the reply carries", async () => {
    const fetch = mockFetch(() => ({
      status: 200,
      body: { success: true, analytics: { overview: { totalRequests: 1 } }, app: { name: "Bot", appKey: null } },
    }));
    const a = await new Curvet({ appKey: "k", fetch }).analytics.get();
    expect(a.app).toEqual({ name: "Bot", appKey: null });
    expect(a.overview?.totalRequests).toBe(1);
  });

  it("workflows.run() returns (does not throw) a finished run whose step failed, with success:false", async () => {
    const fetch = mockFetch(() => ({
      status: 200,
      body: { success: false, runId: "r1", outputs: { output: null }, nodeStateById: {}, nodeErrors: { n2: "boom" } },
    }));
    const res = await new Curvet({ appKey: "k", fetch }).workflows.run("wf1");
    expect(res.success).toBe(false);
    expect(res.nodeErrors).toEqual({ n2: "boom" });
  });

  it("runAndPoll keeps polling a run that is waiting at a Review step", async () => {
    let polls = 0;
    const fetch = mockFetch((url) => {
      if (url.endsWith("/run")) return { status: 202, body: { success: true, runId: "r2", status: "running" } };
      polls++;
      return polls < 3
        ? { status: 200, body: { success: true, runId: "r2", status: "waiting", waitingOn: { nodeId: "n3", kind: "review" } } }
        : { status: 200, body: { success: true, runId: "r2", status: "completed", result: { outputs: {} }, executionTime: 900 } };
    });
    const seen: string[] = [];
    const run = await new Curvet({ appKey: "k", fetch }).workflows.runAndPoll("wf1", {}, {
      pollIntervalMs: 1,
      onProgress: (r) => seen.push(r.status + (r.waitingOn ? `@${r.waitingOn.nodeId}` : "")),
    });
    expect(run.status).toBe("completed");
    expect(run.executionTime).toBe(900);
    expect(seen).toEqual(["waiting@n3", "waiting@n3", "completed"]);
  });

  it("image.generate sends multipart when files are given, JSON otherwise", async () => {
    const fetch = mockFetch(() => ({
      status: 200,
      body: { success: true, imageUrl: "https://cdn/i.png", usage: { cost: 0.01, credits: 1 }, metadata: { model: "m", latencyMs: 1 } },
    }));
    const curvet = new Curvet({ appKey: "k", fetch });
    await curvet.image.generate({
      model: "qwen-image-edit",
      prompt: "make it blue",
      size: "1024x1024",
      files: [new Blob(["png"], { type: "image/png" })],
    });
    const form = fetch.calls[0].init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("model")).toBe("qwen-image-edit");
    expect(form.get("size")).toBe("1024x1024");
    expect(form.getAll("files")).toHaveLength(1);
    expect(fetch.calls[0].init.headers["content-type"]).toBeUndefined();

    await curvet.image.generate({ model: "muse-image-1.0", prompt: "a cat", image: "https://cdn/src.png" });
    expect(JSON.parse(fetch.calls[1].init.body)).toEqual({ model: "muse-image-1.0", prompt: "a cat", image: "https://cdn/src.png" });
  });

  it("chat.create sends the new params and content blocks as given", async () => {
    const fetch = mockFetch(() => chatOk);
    const res = await new Curvet({ appKey: "k", fetch }).chat.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "Answer in JSON." },
        {
          role: "user",
          content: [
            { type: "text", text: "What is in this picture?" },
            { type: "image_url", image_url: { url: "https://cdn/p.png" } },
          ],
        },
      ],
      allowFallbacks: true,
      responseFormat: { type: "json_object" },
      topP: 0.9,
      stop: ["\n\n"],
      seed: 42,
      frequencyPenalty: 0.1,
      presencePenalty: null,
      reasoningEffort: "low",
      images: ["data:image/png;base64,AAAA"],
    });
    const body = JSON.parse(fetch.calls[0].init.body);
    expect(body).toMatchObject({ allowFallbacks: true, responseFormat: { type: "json_object" }, topP: 0.9, seed: 42 });
    expect(body.messages[1].content[1].image_url.url).toBe("https://cdn/p.png");
    expect(res.finishReason).toBe("stop");
    expect(res.usage.totalTokens).toBe(4);
  });
});

describe("what current servers add", () => {
  it("a 429 without limit details (a busy provider) is kind 'rate'", async () => {
    const fetch = mockFetch(() => stepErrorReply(429, "provider_busy", true));
    const err = await new Curvet({ appKey: "k", fetch, maxRetries: 0 }).chat.create(CHAT).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.kind).toBe("rate");
    expect(err.limit).toBeUndefined();
  });

  it("a key's limit names its kind by code when the details are missing", async () => {
    const fetch = mockFetch(() => ({
      status: 429,
      body: { success: false, error: "Budget used up", code: "budget_exhausted", type: "rate_limit_error", retryable: true },
      headers: { "retry-after": "5" },
    }));
    const err = await new Curvet({ appKey: "k", fetch, maxRetries: 0 }).chat.create(CHAT).catch((e) => e);
    expect(err.kind).toBe("budget");
    expect(err.retryAfterMs).toBe(5000);
  });

  it("the OpenAI-style envelope's `param` and `limit` reach the error", async () => {
    const bad = mockFetch(() => ({
      status: 400,
      body: { error: { message: "dimensions is too large", type: "invalid_request_error", code: "bad_request", param: "dimensions" } },
    }));
    const e1 = await new Curvet({ appKey: "k", fetch: bad }).chat.create(CHAT).catch((e) => e);
    expect(e1.param).toBe("dimensions");
    expect(e1.code).toBe("bad_request");

    const capped = mockFetch(() => ({
      status: 429,
      body: {
        error: {
          message: "Daily cost cap exceeded.",
          type: "rate_limit_error",
          code: "daily_cost_cap_exceeded",
          param: null,
          retryable: true,
          request_id: "cvreq_9",
          limit: { kind: "cost_per_day", limit: 10, used: "10.0000", resets_at: "2030-01-01T00:00:00Z" },
        },
      },
    }));
    const e2 = await new Curvet({ appKey: "k", fetch: capped, maxRetries: 0 }).chat.create(CHAT).catch((e) => e);
    expect(e2).toMatchObject({ kind: "cost", limit: 10, used: 10, requestId: "cvreq_9", retryable: true });
    expect(e2.resetsAt).toBeInstanceOf(Date);
    expect("param" in e2).toBe(false);
  });

  it("a synchronous workflow run that stopped on a step throws that step's error, with the runId", async () => {
    const fetch = mockFetch(() => ({
      status: 402,
      body: {
        success: false,
        error: "Not enough credits",
        code: "insufficient_credits",
        type: "insufficient_quota",
        retryable: false,
        stepError: stepError("insufficient_credits", false),
        runId: "run_7",
      },
    }));
    const err = await new Curvet({ appKey: "k", fetch }).workflows.run("wf1").catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientBalanceError);
    expect(err).toMatchObject({ code: "insufficient_credits", runId: "run_7", retryable: false });
  });

  it("a finished media reply that names only `mediaUrl` is completed", async () => {
    const fetch = mockFetch(() => ({
      status: 200,
      body: { success: true, mediaUrl: "https://cdn/v.mp4", metadata: { model: "m", jobId: "j", latencyMs: 1 } },
    }));
    const res = await new Curvet({ appKey: "k", fetch }).video.submit({ model: "m", prompt: "x" });
    expect(res.status).toBe("completed");
    expect(res.mediaUrl).toBe("https://cdn/v.mp4");
  });

  it("the error-code types take the documented codes and any later one", () => {
    const known: ApiErrorCode = "invalid_api_key";
    const later: ApiErrorCode = "a_code_added_next_year";
    const any: CurvetErrorCode[] = [known, later, "provider_busy", "idempotency_key_in_use", "PROMPT_TOO_LONG"];
    expect(any).toHaveLength(5);
  });
});
