# @curvet/sdk

Official TypeScript SDK for the [Curvet](https://curvet.ai) Unified Playground API — chat, image, and video generation across multiple providers (OpenAI, Anthropic, Perplexity, DeepInfra) with **one API key and one balance**.

```ts
import { Curvet } from "@curvet/sdk";

const curvet = new Curvet({ appKey: process.env.CURVET_APP_KEY });

const { response } = await curvet.chat.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Write a tagline for a freelance marketplace." }],
});
console.log(response);
```

## Install

```bash
npm install @curvet/sdk
```

Requires Node 18+ (uses the built-in `fetch`). For older runtimes, pass a `fetch` implementation.

## Authentication

The client accepts **either or both** of two credentials:

- **App Key** (`x-app-key`) — for the Playground API (chat, image, video, audio, 3D, workflows, food, voice, balance, analytics). Get one from the Curvet Developer Portal with Playground access enabled. Env: `CURVET_APP_KEY`.
- **Enterprise API key** (`x-enterprise-key`) — an org-scoped admin key for the Enterprise API (`curvet.enterprise.*` — members, invites, per-member credits). Env: `CURVET_ENTERPRISE_KEY`.

Provide whichever you need — **app key only**, **enterprise key only**, or **both**:

```ts
// Playground only
const curvet = new Curvet({ appKey: "cvt_app_..." });

// Enterprise only
const curvet = new Curvet({ enterpriseKey: "cvent_ent_..." });

// Both — playground + enterprise from a single client
const curvet = new Curvet({ appKey: "cvt_app_...", enterpriseKey: "cvent_ent_..." });

// …or via env (CURVET_APP_KEY / CURVET_ENTERPRISE_KEY), then: new Curvet()
```

The constructor throws only if **neither** is provided. Each credential unlocks its own methods — `curvet.chat.*` / media / workflows need the app key; `curvet.enterprise.*` needs the enterprise key. Calling a family you didn't supply a key for returns `401`.

## Usage

### Chat

```ts
const res = await curvet.chat.create({
  model: "claude-sonnet-4-6",
  messages: [
    { role: "system", content: "You are concise." },
    { role: "user", content: "Explain vector databases in one sentence." },
  ],
  temperature: 0.7,
  maxTokens: 200,
});
console.log(res.response, res.usage.credits);
console.log(res.finishReason, res.usage.promptTokens, res.usage.completionTokens, res.usage.billing);
```

`finishReason` says why the answer stopped (`"length"` when it was cut at the
answer limit). Without `maxTokens`, a call billed per token gets the provider's
own limit (`maxOutputTokens` on the model) and any other call the model's
default. An empty `res.response` is a real, charged answer only when the request
explains it — `finishReason` `"length"` (the limit was reached before any text;
a reasoning model can spend a small `maxTokens` thinking) or `"stop"` on a
request with stop sequences; any other empty answer is a `502` error with
`code: "no_output"`, not charged. Guard with `res.response ?? ""` where it
matters. With `allowFallbacks`, `res.metadata.servedModel` names the model that
answered when it was not the one asked for, and `res.usage.remainingCredits`
(also on image and media) is what you can still spend.

The request also takes `allowFallbacks`, `responseFormat` (JSON mode), `topP`,
`stop`, `seed`, `frequencyPenalty`, `presencePenalty`, `reasoningEffort`, and
images for vision models — as `imageUrl` / `images`, or as content blocks:

```ts
await curvet.chat.create({
  model: "gpt-4o",
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "What is in this picture?" },
        { type: "image_url", image_url: { url: "https://example.com/cat.png" } },
      ],
    },
  ],
  responseFormat: { type: "json_object" },
});
```

A field the model's provider does not take is left out and named in the
`X-Curvet-Ignored-Params` response header.

### Image

```ts
const img = await curvet.image.generate({
  model: "flux-2-klein-4b",
  prompt: "An astronaut riding a unicorn on Mars, cinematic",
  size: "1024x1024", // single field — not width/height
});
console.log(img.imageUrl);
```

To edit or build on an image, pass `image` (an https URL or `data:` URI) or
upload `files` (sent as multipart; at most 10, 25 MB each; give each an image
MIME type):

```ts
await curvet.image.generate({
  model: "qwen-image-edit",
  prompt: "make the sky purple",
  files: [new Blob([bytes], { type: "image/png" })],
});
```

### Video (async, handled for you)

Video runs as a background job. `generate()` submits **and polls to completion** — you just `await` it:

```ts
const video = await curvet.video.generate(
  { model: "wan-2.2", prompt: "Neon Tokyo street in the rain", mode: "text_to_video" },
  { onProgress: (pct) => console.log(`${pct}%`) },
);
console.log(video.mediaUrl);
```

Prefer fire-and-forget? Submit and poll yourself:

```ts
const job = await curvet.video.submit({ model: "wan-2.2", prompt: "..." });
if (job.status !== "completed") {
  const done = await curvet.jobs.handle(job.jobId!).wait();
  console.log(done.mediaUrl);
}
// ...or check once later:
const status = await curvet.jobs.retrieve(job.jobId!);
```

A job read back with `jobs.retrieve()` is `queued`, `processing`, `completed` or
`failed`, and carries `cost` (`estimated`, `reserved`, and `actual` once
settled), `eta`, `type`, `model`, `thumbnailUrl`, `outputMetadata` (the
provider's duration, resolution, format, …) and, when it failed, `stepError`
(the structured reason). A submit that finished while the server waited carries
`usage` and `outputMetadata`; one still running carries `message`, `statusUrl`
and `estimatedWaitTime`. A job that finished without an output URL comes back
`completed` with no `mediaUrl`.

### Audio & 3D (async, same as video)

```ts
const audio = await curvet.audio.generate({ model: "fish-audio", prompt: "Hello there" });
const mesh = await curvet.threeD.generate({ model: "meshy-3d", prompt: "a ceramic mug" });
console.log(audio.mediaUrl, mesh.mediaUrl);
```

### Models, balance & analytics

```ts
const chatModels = await curvet.models.list({ type: "chat" });
const balance = await curvet.balance.get();
const analytics = await curvet.analytics.get({ startDate: "2026-01-01", endDate: "2026-02-01" });
```

`models.list()` returns only what this key can actually call right now. Each
entry carries `capability`, `available`, `comingSoon`, `endpoint`, `surface`,
`pricing`, `aliases`, `maxOutputTokens`, `healthStatus` and
`unavailableReason`, so you can tell what a model *does*, not just its modality.
Your own custom models carry `group: "mine"` and `baseModel`; embedding models
carry `dims`, `supportsDimensions` and `maxInputTokens`. `pricing.billing` is
`"metered"` when a call is billed on the token rates now, `"flat_per_request"`
when the flat per-call credit still applies. `models.rateLimits()` returns the
key's hourly request limit and daily cost cap, and `enabled: false` when
neither is enforced for it.

`capability` matters most for audio, where `type: "audio"` covers both
directions. A `"transcription"` model takes a file on `voice.stt()`; passing one
to `audio.generate()` fails:

```ts
const tts = await curvet.models.list({ type: "audio", capability: "generation" });
const asr = await curvet.models.list({ capability: "transcription" });
```

To see what's coming as well as what runs today:

```ts
const everything = await curvet.models.list({ include: "all" });
everything.filter((m) => m.comingSoon); // announced, not yet callable
```

`analytics.get()` returns an `overview` plus `modelBreakdown`,
`categoryBreakdown`, `statusBreakdown` and `errorBreakdown` — per-model cost,
request counts and mean latency — and the `app` they belong to:

```ts
const { overview, modelBreakdown } = await curvet.analytics.get();
console.log(overview?.totalRequests, overview?.totalCost);
for (const row of modelBreakdown ?? []) {
  console.log(row._id, row.requestCount, row.totalCost, row.avgLatency);
}
```

### Workflows

Find one without leaving your code — and learn what inputs it takes, rather than
guessing at key names and paying for a failed run to find out:

```ts
const workflows = await curvet.workflows.list({ q: "digest", limit: 10 });
// → [{ id, title, description, nodeCount, tags, updatedAt }, ...]

const wf = await curvet.workflows.retrieve(workflows[0].id);
for (const input of wf.inputs) {
  console.log(input.name, input.type, input.required ? "(required)" : "(optional)");
}
```

`inputs` is derived from the workflow's node graph by the same rules the runner
applies, so those names are exactly the keys `run`/`submit` will read.

```ts
// JSON inputs:
const out = await curvet.workflows.run("workflowId", { inputs: { topic: "ai" } });
if (!out.success) console.warn("some steps failed:", out.nodeErrors);
console.log(out.outputs);

// With file inputs (multipart, handled for you):
await curvet.workflows.run("workflowId", {
  inputs: { caption: "hello" },
  files: { image: new Blob([bytes], { type: "image/png" }) },
});
```

**Check `success`.** A run in which a step failed but the run still finished
comes back (HTTP 200) with `success: false` and the failures in `nodeErrors`:
`run()` returns it rather than throwing, because the other steps' outputs — and
charges — are real. A run that stopped altogether throws.

For long workflows (video/audio/3D nodes), use the **pollable** API — submit
and auto-poll to completion with live progress, instead of one long HTTP call.
A run parked at a Review step reports `status: "waiting"` (with `waitingOn`)
and `runAndPoll` keeps polling until it resumes or `pollTimeoutMs` passes:

```ts
const run = await curvet.workflows.runAndPoll(
  "workflowId",
  { inputs: { topic: "ai" } },
  { onProgress: (r) => console.log(r.status, r.progress + "%", r.currentNode?.label) },
);
console.log(run.result);

// Or fire-and-forget + poll yourself:
const { runId } = await curvet.workflows.submit("workflowId", { inputs: {} });
const status = await curvet.workflows.runs.retrieve(runId);
```

### Food & speech-to-text

```ts
const dishes = await curvet.food.search("paneer", { limit: 5 });
const stt = await curvet.voice.stt({ audio: audioBytes, filename: "clip.wav" });
console.log(stt.text);
```

Name a `model` to choose the engine — the provider is derived from it, so any
model with `capability: "transcription"` is enough:

```ts
const stt = await curvet.voice.stt({
  audio: audioBytes,
  filename: "clip.wav",
  model: "whisper-large-v3",
  languageCode: "en",
});
```

### Signing in (`curvet login`)

App and key management needs a **CLI token**, not an app key — an app key
authenticates an *app*, and letting one mint or rotate another would make
revoking it meaningless.

```ts
const curvet = new Curvet({ cliToken: "pending" }); // the device call needs no credential
const start = await curvet.auth.deviceCode({ deviceName: "my-laptop" });
console.log(`Open ${start.verificationUriComplete} and enter ${start.userCode}`);

const { token, scopes } = await curvet.auth.pollForToken(start);
// `token` is shown once — store it. Then:
const signedIn = new Curvet({ cliToken: token });
const apps = await signedIn.apps.list();
```

`pollForToken` honours the server's interval, including when it widens it. To
branch on the flow's state rather than a message, catch `DeviceFlowPending`:
`isPending` is true for `authorization_pending` and `slow_down`, false for
`access_denied` and `expired_token`.

```ts
const app = await signedIn.apps.create({
  name: "Nightly Digest",
  allowedModels: ["gpt-4o-mini"],
  rateLimits: { requestsPerHour: 250, costCapPerDay: 5 },
});
const { appKey, appSecret } = await signedIn.apps.rotateKeys(app._id);
```

A CLI token carrying `enterprise:admin` also drives `enterprise.*`, so an org
admin needs no separate enterprise key.

### Enterprise (admin)

For enterprise customers: manage your organization with an **enterprise key** — invite members, set per-member credit allotments funded from your org pool, and read your dashboard. Requires `enterpriseKey` (org-scoped; sent as `x-enterprise-key`).

```ts
const curvet = new Curvet({ enterpriseKey: process.env.CURVET_ENTERPRISE_KEY });

// Dashboard: pool balance, seats, per-member usage
const overview = await curvet.enterprise.overview();
console.log(overview.pool.balance, overview.memberCount);

// Invite a teammate — single-use link; the allotment is reserved from your
// pool when they sign up, and they see only their own credits (never the pool).
const { url } = await curvet.enterprise.invites.create({
  allottedCredits: 1000,
  role: "member",      // or "admin"
  expiresInDays: 30,
});
await curvet.enterprise.invites.list();
await curvet.enterprise.invites.revoke(inviteId);

// Members
const members = await curvet.enterprise.members.list();
await curvet.enterprise.members.assignCredits(uid, 500);  // +assign / −reclaim (from pool)
await curvet.enterprise.members.setLimit(uid, 2000);      // monthly cap (0 = uncapped)
await curvet.enterprise.members.setRole(uid, "admin");
await curvet.enterprise.members.remove(uid);              // reclaims their credits
```

Assigning more than the pool holds throws `InsufficientBalanceError` (`402`) — top up the pool and retry.

#### Spending straight from the pool

Some people shouldn't need an allotment at all — an org admin, or a teacher whose usage bills to the school. Those members draw the **shared pool** directly:

```ts
// Grant it (admins already have it by default)
await curvet.enterprise.members.setPoolAccess(uid, true);

// Revoke it — even for an admin
await curvet.enterprise.members.setPoolAccess(uid, false);

// Restore the role default: admins draw the pool, plain members don't
await curvet.enterprise.members.setPoolAccess(uid, null);
```

Two things worth knowing:

- **The monthly cap still applies.** It bounds *company* money as a whole, so a member's own allotment and their pool draw share one budget — pool access is not an unlimited budget. Set `setLimit(uid, 0)` for genuinely uncapped.
- **Their own allotment is spent first**, then the pool, then their personal credits. Allotted credits never sit stranded while the pool drains.

`members.list()` reports both the stored setting and what it resolves to:

```ts
const [m] = await curvet.enterprise.members.list();
m.drawsFromPool;           // true | false | null  ← null means "inherited"
m.drawsFromPoolEffective;  // boolean — what actually applies right now
m.used;                    // company credits spent this month (allotment + pool)
```

## Errors

Every failure throws a typed subclass of `CurvetError`:

```ts
import { InsufficientBalanceError, RateLimitError, AuthError } from "@curvet/sdk";

try {
  await curvet.image.generate({ model: "flux-2-klein-4b", prompt: "..." });
} catch (err) {
  if (err instanceof InsufficientBalanceError) {
    console.error(`Need ${err.required}, have ${err.available}`);
  } else if (err instanceof RateLimitError) {
    console.error(`Rate limited; resets at ${err.resetsAt}`);
  } else if (err instanceof AuthError) {
    console.error("Bad app key");
  } else {
    throw err;
  }
}
```

| Class | When |
|---|---|
| `AuthError` | 401 — missing/invalid app key or enterprise key |
| `PermissionError` | 403 — app inactive, playground disabled, model/category not allowed |
| `BadRequestError` | 400 — invalid/unknown model or payload |
| `InsufficientBalanceError` | 402 — not enough credits (`.required`, `.available`, `.requiredCredits`) |
| `RateLimitError` | 429 — request limit, cost cap, credit budget or a busy provider (`.kind`, `.resetsAt`, `.retryAfterMs`; `.scope` / `.period` for a budget) |
| `NotFoundError` | 404 — job/workflow not found, or a model that is not available |
| `ConflictError` | 409 — an `Idempotency-Key` refusal, or a custom model not ready |
| `GoneError` | 410 — the model is retired |
| `PayloadTooLargeError` | 413 — input or upload too large |
| `UnprocessableEntityError` | 422 — refused by content policy, or a key reused with a different request |
| `FailedDependencyError` | 424 — a connected app is needed, or a step it depends on failed |
| `APIError` | 5xx, and any other status without its own class. The 409/410/413/422/424 classes extend it, so code that caught those as `APIError` still does |
| `ConnectionError` | network failure / timeout |
| `JobFailedError` | async media job failed (`.jobId`) |
| `JobTimeoutError` | async job exceeded poll timeout (`.jobId`) |

Every error carries what the server sent with it:

| Field | What |
|---|---|
| `code` | the stable machine-readable reason. Current servers send one on every refusal (except some of the chat, image and media routes' own request checks): an `ApiErrorCode` for auth, policy, limits, lookups and the server itself (`invalid_api_key`, `model_not_allowed`, `rate_limit_exceeded`, `route_not_found`, …), a model/provider failure's code (`provider_busy`, `content_policy`, `no_output`, …), an `idempotency_key_*` code, `upload_too_large`, … The `ApiErrorCode` and `CurvetErrorCode` types list them, and accept any later code |
| `type` | OpenAI's error type for it (`invalid_request_error`, `authentication_error`, `permission_error`, `rate_limit_error`, `insufficient_quota`, `api_error`) |
| `retryable` | whether the server says the same request can succeed later |
| `provider`, `model`, `providerStatus` | for a model or provider failure: who failed, and the provider's own HTTP status |
| `stepError` | for a model or provider failure: the full structured error (`title`, `scope`, `actions`, `suggestedModels`, `refundedCredits`, …) |
| `jobId` | the media job that failed (`JobFailedError` too) |
| `runId` | the workflow run that failed (`workflows.run`, once the run was created) |
| `param` | the request field the refusal is about, when the server names one |
| `requestId` | the server's request id — quote it to support |
| `retryAfterMs` | how long the server asks you to wait (`Retry-After`, or a limit's reset) |
| `raw` | the error body exactly as sent |

A synchronous `workflows.run()` that stops on a failing step throws that step's error with its own status — an `InsufficientBalanceError` (402, `code: "insufficient_credits"`), an `APIError` (502 `provider_down`), … — carrying `runId`. A malformed workflow or run id is a `NotFoundError`.

```ts
try {
  await curvet.chat.create(params);
} catch (err) {
  if (err instanceof CurvetError && err.code === "content_policy") {
    console.error(err.stepError?.message); // the sentence to show
  }
}
```

Retries: when an error body says `retryable`, the SDK follows it — a `503 provider_unavailable` (our account at the provider) is not retried, a retryable answer is, waiting what `Retry-After` says (capped at 30 s). When the body does not say, `429` and `5xx` (and timeouts and pre-response network errors) are retried with exponential backoff + jitter, respecting rate-limit resets, and other `4xx` are not — except a `409 idempotency_key_in_use` (below).

### Idempotency

Every POST carries an `Idempotency-Key` (a UUID generated per call), and every retry of that call re-sends the same key. The server remembers a finished call for 24 hours: a repeat with the same key gets the first reply (with `Idempotent-Replayed: true`) instead of a second run and a second charge.

**A call slower than `timeout`.** A timeout on the SDK's side is retried like any other failure — at most `maxRetries` times (`maxRetries: 0` means one send) — with the same key. What the retry finds depends on the route:

- **Image, media and workflow runs** keep working on the server after the SDK hangs up. The retry gets `409 idempotency_key_in_use` while the first attempt finishes, and the SDK keeps asking with the same key — honouring `Retry-After` — for up to `idempotencyWaitMs` (default 120000), then returns the first attempt's result, charged once. A 70-second image with the default 60-second timeout (and the default `maxRetries: 2`) therefore returns its image. `idempotencyWaitMs: 0` turns that wait off; the caller's `signal` stops it at once.
- **Chat** (and embeddings) refund the call and free its key when the SDK hangs up, so a retry is a fresh call to the model, which can time out the same way. Give chat a `timeout` longer than the answers you expect rather than relying on retries.

**The key is handed back.** Every error a POST throws carries `err.idempotencyKey`, and replies with a `metadata` block carry `metadata.idempotencyKey`. If you give up on a call, retry it with that key: you get its result if it completed, rather than paying for it again.

```ts
try {
  await curvet.image.generate(params);
} catch (err) {
  if (err instanceof CurvetError && err.idempotencyKey) {
    await curvet.image.generate(params, { idempotencyKey: err.idempotencyKey });
  }
}
```

To make a call safe to repeat across processes or restarts, pass your own key:

```ts
await curvet.chat.create(params, { idempotencyKey: `order-${orderId}` });
```

What a repeat with the same key gets when the first call did not simply finish:

| First call | Repeat with the same key |
|---|---|
| still running | `409 idempotency_key_in_use` (the SDK waits and asks again) |
| failed (any 4xx/5xx), or a stream that failed and was refunded | runs again — a failed call is refunded or never charged (but see the workflow exception below) |
| finished, but its reply was **not kept**: streamed, over 1 MB, embeddings (vectors are never stored), or an account whose content settings do not allow storing replies — except a reply that only acknowledges work (a media job's `202` + `jobId`, an async run's `202` + `runId`), which is always kept and replayed | `409 idempotency_key_not_replayable` — not run or charged again, and the reply **cannot be fetched again**: for those calls a lost reply is lost |
| same key, different request | `422 idempotency_key_mismatch` |

**The exception to "charged once":** a synchronous workflow run (`workflows.run`) that fails part-way answers an error while the steps that ran before the failure stay charged. The failure frees the key, so a retry with the same key — yours, or the SDK asking again after a timeout — runs, and charges, the whole workflow again. Use `workflows.submit` / `runAndPoll` (the `runId` reply is kept and replayed) for workflows that must not run twice.

Errors carry the server's request id (`err.requestId`, from `x-curvet-request-id`) — quote it to support.

## Configuration

```ts
new Curvet({
  appKey: "cvt_app_...",
  enterpriseKey: "cvent_ent_...", // optional — enables curvet.enterprise.*
  baseURL: "https://curvet.ai/api/v1/playground", // override for staging
  timeout: 60_000,            // per-request, ms
  maxRetries: 2,
  idempotencyWaitMs: 120_000,  // on 409 idempotency_key_in_use, keep asking with the key this long
  defaultPollIntervalMs: 2500, // async job polling
  defaultPollTimeoutMs: 180_000,
  fetch: customFetch,          // for Node < 18 / testing
});
```

Per-call overrides: every method accepts a final `options` arg (`{ signal, timeout, maxRetries, headers, idempotencyKey, idempotencyWaitMs }`; media methods also take `{ pollIntervalMs, pollTimeoutMs, onProgress }`).

## Development

```bash
npm install
npm run typecheck
npm test        # unit tests (mocked HTTP) — no network, no credits
npm run build   # ESM + CJS + d.ts via tsup
```

`test/contract.test.ts` checks the SDK against the server's own API description,
copied to `test/fixtures/openapi.json`: every field the server documents for a
reply must survive the SDK's parsing and be declared on its types. When the
server's API changes, copy its `documentation/api/openapi.json` over the fixture
and run the test; a failure names the field to add.

```bash
# live contract test (spends a few credits):
CURVET_TEST_APP_KEY=cvt_app_xxx npm test
```

## Releasing

Publishing happens locally with the release script — no npm token, no CI.
`npm publish` prompts for your passkey/2FA, which you approve in the browser.

```bash
./scripts/release.sh            # publish the current package.json version
./scripts/release.sh patch      # bump patch, then publish  (0.2.0 -> 0.2.1)
./scripts/release.sh minor      # bump minor, then publish
./scripts/release.sh major      # bump major, then publish
```

The script validates (typecheck + tests + build) before bumping, tags the
version, publishes (you approve the passkey prompt), then pushes the tag and
commit to GitHub. The order is deliberate — if the publish is cancelled,
nothing is pushed; just re-run `npm publish && git push --follow-tags origin main`
to finish.

> A tokenless CI alternative using npm Trusted Publishing (OIDC) is also included
> at [`.github/workflows/publish.yml`](.github/workflows/publish.yml) for when
> GitHub Actions is available.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release notes.

## License

MIT
