# Changelog

All notable changes to `@curvet/sdk` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
