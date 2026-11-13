# Changelog

All notable changes to `@curvet/sdk` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

- Every POST now sends an `Idempotency-Key` header: one UUID per call, re-sent
  on every retry of that call, so a retried call that finished on the server is
  answered with its first reply instead of being run and charged again. Pass
  your own with `options.idempotencyKey` (or an `Idempotency-Key` header) to make
  a call safe to repeat across processes.
- After a POST times out, or the server answers `409 idempotency_key_in_use`
  (the first attempt is still running), the SDK keeps asking with the same key,
  honouring `Retry-After`, for up to `idempotencyWaitMs` (new option, default
  120000; 0 turns it off; the caller's `signal` stops it) instead of spending
  `maxRetries` on it. A call slightly slower than `timeout` now returns its
  result instead of failing after it was charged.
- Every error a POST throws carries `err.idempotencyKey`, and replies with a
  `metadata` block carry `metadata.idempotencyKey`: retry with it to get the
  result of a call that completed after the SDK gave up.
- Not every repeat can be answered with the first reply. A reply that was
  streamed, is over 1 MB, comes from embeddings, or belongs to an account whose
  content settings do not allow storing replies is not kept: a repeat gets
  `409 idempotency_key_not_replayable` (not run or charged again, and the reply
  cannot be fetched again). A failed call frees its key, so a repeat runs again;
  a failed SYNCHRONOUS workflow run is the exception to "charged once" — its
  earlier steps stay charged and a repeat runs (and charges) the whole workflow
  again. Use `workflows.submit` / `runAndPoll` where that matters.
- Errors read the request id from `x-curvet-request-id`, which is what the
  server sends; `x-request-id` is the fallback. Previously `err.requestId` was
  empty for most errors.

### Types and errors match the server

The server now publishes a machine-readable description of its API
(`openapi.json`, built from the JSON Schemas of what the routes return). The
SDK's hand-written types had drifted from it; this brings them in line. Nothing
exported is removed or renamed, and no call throws where it returned before.

- **Errors carry what the server sent.** Every thrown error now has `code`,
  `type`, `retryable`, and — for a model or provider failure — `provider`,
  `model`, `providerStatus` and the structured `stepError`; `jobId` on a failed
  media job; `requestId` also from the body; `retryAfterMs` from `Retry-After`
  (or the StepError's `retryAfterSec`) on any error, not only 429s. Both error
  envelopes are read: the playground's `{ success: false, error, … }` and the
  OpenAI-style `{ error: { message, type, code, … } }`.
- **New error classes** for statuses that had none: `ConflictError` (409),
  `GoneError` (410, model retired), `PayloadTooLargeError` (413),
  `UnprocessableEntityError` (422, content policy / key mismatch) and
  `FailedDependencyError` (424). Each extends `APIError`, which those statuses
  mapped to before, so `instanceof APIError` still holds for them. `APIError`'s
  docs no longer claim it is only 5xx.
- `InsufficientBalanceError.requiredCredits` (402 on `/audio`).
  `RateLimitError` reads the credit budget refusal (`kind: "budget"`, with
  `scope` and `period`) and the reset time the server sends now (`resetsAt`);
  `resetsIn`, which older servers sent, is still read.
- **Retries follow the server.** When an error body says `retryable`, the SDK
  retries exactly when it is true (waiting what `Retry-After` says, capped at
  30 s). A `503 provider_unavailable` — our account at the provider — is no
  longer retried pointlessly. When the body does not say, the old rule stands
  (429 and 5xx).
- **Chat.** Request: `allowFallbacks`, `responseFormat`, `topP`, `stop`, `seed`,
  `frequencyPenalty`, `presencePenalty`, `reasoningEffort`, `imageUrl`,
  `images`, and message `content` as an array of text and image blocks
  (`ChatContentMessage`, `ChatContentPart`). Reply: `finishReason`,
  `usage.promptTokens` / `completionTokens` / `totalTokens` / `billing`
  (`ChatUsage`). The `maxTokens` doc no longer says it defaults to 1000: without
  it a token-billed call gets the provider's own limit.
- **Image.** `image` (a source URL or `data:` URI) and `files` (uploaded as
  multipart).
- **Media and jobs.** `JobStatus` gains `"queued"` (not terminal: polling
  continues). A media job carries `outputMetadata` (the provider's duration,
  resolution, … — previously dropped), `thumbnailUrl`, `stepError`,
  `faultKind`, `faultRetryable`, `type`, `model`, `pollCount`, `createdAt`,
  `updatedAt`, and on a 202 `message`, `statusUrl` and `estimatedWaitTime`;
  `usage.parts` (`MediaUsage`) for audio spoken in parts. A `JobFailedError`
  carries the job's `stepError`, `code`, `retryable`, `provider` and `model`.
- **A finished media reply whose URL is null** (the job ended without an
  output) is now `status: "completed"` with no `mediaUrl`, instead of
  `"processing"` — `generate()` no longer polls the job once more to find out.
- **Models.** `ModelInfo` gains `aliases`, `group`, `baseModel`,
  `maxOutputTokens`, `unavailableReason`, `healthStatus`, `dims`,
  `supportsDimensions`, `maxInputTokens`; `ModelPricing.billing` gains
  `"flat_per_request"` (what the server sends; `"flat"` stays in the union),
  plus `tiers` and `minimum_per_request`; `ModelCapability` gains `"music"` and
  `"embedding"`, `ModelType` gains `"embedding"`. New types for the
  OpenAI-style model list: `OpenAIModelList`, `OpenAIModel`,
  `OpenRouterPricing`, `CurvetPricing`.
- **Balance.** `breakdown` gains `walletUSD`, `pointsAsUSD`, `earnedCredits`,
  `creditModel`, `creditLimit` and `creditLimitRemaining`.
  `personalSpendable` is deprecated: the server never sends it.
- **Analytics.** The result now carries the reply's `app` (`{ name, appKey }`),
  which was dropped. The flat `totalRequests` / `totalCost` /
  `requestsByModel` / `requestsByCategory` fields are documented as never
  returned (kept, deprecated).
- **Workflows.** `WorkflowRunResult` is typed (`runId`, `outputs`, `fullState`,
  `nodeStateById`, `nodeErrors`). **Check `success`:** a synchronous run in
  which a step failed but the run finished comes back with `success: false` —
  `run()` returns it, as before, rather than throwing. Run status gains
  `"waiting"` (parked at a Review step) with `waitingOn`, and `executionTime`;
  `submit()` returns `statusUrl`.
- A contract test (`test/contract.test.ts`) checks the SDK against a copy of
  the server's `openapi.json`: a field the server documents and the SDK drops,
  or does not declare, fails it.

### Corrected types you may notice

These types claimed something the server does not guarantee. Code that relied
on the wrong claim may need a guard when it next compiles; nothing changes at
runtime unless stated.

- `ChatResponse.metadata.requestId` and `ImageResponse.metadata.requestId` are
  optional: the server can omit them.
- `WorkflowSummary.title` (and so `WorkflowDetail.title`) is optional: a
  workflow saved without a title has none.
- `JobCost.estimated` and `JobCost.reserved` are required (the server always
  sends them), `JobCost.actual` can be null (until the job settles), and
  `MediaJob.eta` can be null. Only code that builds its own `JobCost` objects
  can notice the first.
- `AnalyticsOverview.avgCostPerRequest`, `AnalyticsBreakdownRow.avgCostPerRequest`
  and `AnalyticsBreakdownRow.category` can be null.
- `JobStatus`, `WorkflowRunStatus` and `RateLimitError.kind` have new members
  (`"queued"`, `"waiting"`, `"budget"`); an exhaustive `switch` over them will
  ask for the new case. At runtime, a budget refusal now reads
  `kind: "budget"` (it read `"rate"` before), and the cost cap's
  `RateLimitError.used` is a number as typed (it was the server's string, e.g.
  `"10.0000"`).
- `ChatCreateParams.messages` items may be a `ChatContentMessage`, whose
  `content` is a string or an array of blocks. `ChatMessage` itself is
  unchanged; only code that reads `.content` back out of its own
  `ChatCreateParams` object as a string needs a guard.
- `PollOptions.onProgress` receives `undefined`, not `null`, for an unknown ETA
  (its type always said `string | undefined`).
- Not narrowed in this release: `ChatResponse.response` stays `string`,
  although the server sends null when the model answered with no text. Making
  it `string | null` would stop `res.response.trim()` compiling everywhere; it
  is documented on the field instead.

## 0.13.0

- `agency` now addresses the server with whichever credential the client holds:
  a CLI token under `x-cli-token`, or — when there is no CLI token — the app key
  under `x-app-key`. Previously it always sent `x-cli-token`, so a client built
  with only an `appKey` sent an empty header and every agency call 401'd.

  Both need the `agency:run` scope: a CLI token from
  `curvet login --scope agency:run`, an app key from the console's agent-access
  toggle. A CLI token wins when both are present — it identifies the person who
  signed in, while an app key may be shared by everyone using the app it ships
  inside.

## 0.9.0

### Added

- **`auth` — device-code authentication**, the credential path for everything a
  session used to gate. `auth.deviceCode()` starts a login, `auth.pollForToken()`
  waits for the human to approve while honouring the server's polling interval
  (including a widened one after `slow_down`), and `auth.whoami()` reports who a
  token belongs to and what it may do.
  - `DeviceFlowPending` carries the RFC 8628 code, with `isPending` separating
    "keep waiting" from "give up", so callers branch on state rather than
    parsing a message.
  - `auth.devices()` and `auth.logout({ all })` manage the tokens themselves.
- **`apps` — app and key management.** `list`, `retrieve`, `create`, `update`,
  `delete`, `rotateKeys`, `secret`. Requires a CLI token: an app key
  authenticates an *app*, and letting one mint or rotate another would make
  revoking it meaningless.
- **`cliToken` client option** (or `CURVET_CLI_TOKEN`). It is also an alternative
  to `enterpriseKey` for `enterprise.*` — the two reach the same routes by
  different mounts, and the client picks the right one, preferring an explicit
  enterprise key when both are present.
- New types: `CliScope`, `DeviceCodeResult`, `DeviceTokenResult`, `CliDevice`,
  `WhoAmI`, `DeveloperApp`, `CreateAppParams`, `UpdateAppParams`,
  `AppRateLimits`, `RotatedKeys`.

## 0.8.0

Published as 0.8.0, not 0.7.0: the 0.7.0 release was tagged but its publish
failed, so that version number never reached npm. There is no 0.7.0 to install.

### Added

- **Model catalogue flags.** `ModelInfo` now declares what the gateway has been
  returning all along: `capability` (`"generation" | "transcription"`),
  `available`, `comingSoon`, `endpoint`, `surface`, and `pricing` (per-million
  token rates, null for flat-rate modalities).
- `models.list({ capability })` — filter the catalogue by what a model *does*.
  This is the fix for a real footgun: `ali-qwen3-asr-flash`, `whisper-large-v3`,
  `elevenlabs-scribe` and `voxtral-mini-3b-2507` are all `type: "audio"` but are
  speech-to-**text**. They take a file on `voice.stt()`, not a prompt on
  `audio.generate()`, and until now nothing in the catalogue said so. Use
  `list({ type: "audio", capability: "generation" })` to pick a TTS model.
- `models.list({ include: "all" })` — the full catalogue including coming-soon
  and dashboard-only entries, flagged rather than filtered. The default stays
  `"runnable"`: only models this key can call right now.
- New types: `ModelCapability`, `ModelSurface`, `ModelPricing`, `ModelsInclude`,
  `AnalyticsOverview`, `AnalyticsBreakdownRow`.
- `SttResult.requestId` / `.status`, and `SttParams.model` typed as `ModelId`.
- `MediaJob.cost` is typed (`JobCost`) instead of `unknown`. It is the only cost
  a poller ever sees: a job from `generate()` carries `usage` in credits, while
  the same job read back through `jobs.retrieve()` carries `cost` in USD and no
  usage at all.

### Fixed

- **`AnalyticsResult` matched no deployment.** It declared a flat
  `{ totalRequests, totalCost, requestsByModel, requestsByCategory }`; the API
  returns `{ overview, modelBreakdown, categoryBreakdown, statusBreakdown,
  errorBreakdown }` with per-model cost and latency. The real shape is now
  declared, with the flat keys retained (deprecated) for older deployments.
- The model cache was a single slot shared by every query, so a
  `list({ include: "all" })` and a plain `list()` could serve each other's
  results. It is now keyed by `include`.

Live contract canaries covering both drifts were added to the integration suite
(`CURVET_TEST_APP_KEY=… npm test`), since neither would have been caught by a
type-level test.


## 0.6.0

### Added

- `workflows.list(params?)` — list the workflows a key can run, most recently
  updated first. Supports `limit` (clamped server-side to 1–100) and `q` title
  search. Returns summaries without the node graph.
- `workflows.retrieve(id)` — one workflow plus **the input keys it accepts**,
  derived server-side from the node graph by the same rules the runner applies.
  Use these to build the `inputs` object for `run`/`submit` instead of guessing
  at key names — each carries `name`, `type`, `required`, and the `aliases` the
  runner will also accept.
- New types: `WorkflowSummary`, `WorkflowDetail`, `WorkflowInput`,
  `WorkflowListParams`.

Requires the backend from darkapp-haven 0.51.10 or later.


## [0.5.0] - 2026-08-17

### Added
- **Direct org-pool spending** for members who shouldn't need an allotment of
  their own — an org admin, or a teacher whose usage bills to the school:
  - `enterprise.members.setPoolAccess(uid, true | false | null)` — grant, revoke,
    or (with `null`) restore the role default, where admins draw the pool and
    plain members don't.
  - `EnterpriseMember.drawsFromPool` (the stored setting, `null` = inherited) and
    `drawsFromPoolEffective` (what actually applies).
- `BalanceInfo.breakdown` now declares the enterprise/pool fields it already
  returned: `enterpriseCredits`, `enterpriseSpendable`, `drawsFromPool`,
  `orgPoolCredits`, `orgPoolSpendable`.

### Changed
- `EnterpriseMember.used` and `.cap` now cover **all** company spend — a member's
  own allotment and their pool draw share one monthly budget, so pool access is
  not an unlimited budget. Values are unchanged for members without pool access.

### Notes
- Requires the matching backend (`PATCH /api/v1/enterprise/members/:uid/pool-access`).
  Against an older backend that call returns `404`; everything else is unaffected.
- Spend order is own allotment → org pool → personal credits, so allotted credits
  are never stranded while the pool drains.

## [0.4.1] - 2026-07-09

### Changed
- The client accepts an app key **or** an enterprise key — neither is required
  when the other is present. It throws only when both are missing.
- README: documented the enterprise resource and the two auth modes.

## [0.4.0] - 2026-07-09

### Added
- **Enterprise admin API** (`curvet.enterprise.*`), org-scoped and authenticated
  with a new Enterprise API key (`x-enterprise-key`), separate from the
  playground app key:
  - `invites.create` / `list` / `revoke` — single-use invite links carrying a
    per-member credit allotment.
  - `members.list` / `assignCredits` / `setLimit` / `setRole` / `remove`.
  - `overview()` — pool balance, seats, and per-member usage.
- `enterpriseKey` client option (falls back to `CURVET_ENTERPRISE_KEY`).
- `HttpClient`: configurable auth header name.

## [0.3.0] - 2026-06-27

### Added
- **Pollable workflow runs** for long workflows (video/audio/3D nodes) — no more
  one long-lived HTTP call:
  - `workflows.submit(id, params)` — start a run, returns a `runId` immediately.
  - `workflows.runs.retrieve(runId)` — live status: `currentNode`, `progress`,
    per-node history, and the final `result`.
  - `workflows.runAndPoll(id, params, { onProgress })` — submit + auto-poll to
    completion (mirrors `video.generate`).
- `WorkflowRunFailedError` and `WorkflowRunTimeoutError` (both carry `runId`).
- `examples/pollable-workflow.ts`.

### Notes
- `workflows.run()` (synchronous) is unchanged.
- Requires the matching backend (media-node execution + pollable run endpoints).

## [0.2.1] - 2026-06-20

### Added
- Additional resources: `audio.generate`/`submit`, `threeD.generate`/`submit`,
  `analytics.get`, `workflows.run` (JSON or multipart file inputs), `food.*`
  (list/search/recommendations), and `voice.stt`.
- `FormData` (multipart) support in the HTTP layer for file uploads.

## [0.1.0] - 2026-06-19

### Added
- Initial release. One typed client over the Curvet Playground API:
  `chat.create`, `image.generate`, `video.generate`/`submit` with **async
  auto-polling**, `jobs.retrieve`, `models.list`, `balance.get`.
- Typed error taxonomy (`AuthError`, `InsufficientBalanceError`, `RateLimitError`,
  `JobFailedError`, …) and automatic retry/backoff on 429/5xx.
- Live model catalog (never hardcoded). Ships ESM + CJS + type declarations.

[0.5.0]: https://github.com/Curvet-in/curvet-sdk/releases/tag/v0.5.0
[0.4.1]: https://github.com/Curvet-in/curvet-sdk/releases/tag/v0.4.1
[0.4.0]: https://github.com/Curvet-in/curvet-sdk/releases/tag/v0.4.0
[0.3.0]: https://github.com/Curvet-in/curvet-sdk/releases/tag/v0.3.0
[0.2.1]: https://github.com/Curvet-in/curvet-sdk/releases/tag/v0.2.1
[0.1.0]: https://github.com/Curvet-in/curvet-sdk/releases/tag/v0.1.0
