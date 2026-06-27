# Changelog

All notable changes to `@curvet/sdk` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.3.0]: https://github.com/Curvet-in/curvet-sdk/releases/tag/v0.3.0
[0.2.1]: https://github.com/Curvet-in/curvet-sdk/releases/tag/v0.2.1
[0.1.0]: https://github.com/Curvet-in/curvet-sdk/releases/tag/v0.1.0
