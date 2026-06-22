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

Get an **App Key** from the Curvet Developer Portal (with Playground API access enabled). Provide it directly or via the `CURVET_APP_KEY` environment variable.

```ts
const curvet = new Curvet({ appKey: "cvt_app_..." });
// or: export CURVET_APP_KEY=cvt_app_...  then  new Curvet()
```

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
```

### Image

```ts
const img = await curvet.image.generate({
  model: "flux-2-klein-4b",
  prompt: "An astronaut riding a unicorn on Mars, cinematic",
  size: "1024x1024", // single field — not width/height
});
console.log(img.imageUrl);
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

### Workflows

```ts
// JSON inputs:
const out = await curvet.workflows.run("workflowId", { inputs: { topic: "ai" } });

// With file inputs (multipart, handled for you):
await curvet.workflows.run("workflowId", {
  inputs: { caption: "hello" },
  files: { image: new Blob([bytes], { type: "image/png" }) },
});
```

### Food & speech-to-text

```ts
const dishes = await curvet.food.search("paneer", { limit: 5 });
const stt = await curvet.voice.stt({ audio: audioBytes, filename: "clip.wav" });
console.log(stt.text);
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
| `AuthError` | 401 — missing/invalid app key |
| `PermissionError` | 403 — app inactive, playground disabled, model/category not allowed |
| `BadRequestError` | 400 — invalid/unknown model or payload |
| `InsufficientBalanceError` | 402 — not enough credits (`.required`, `.available`) |
| `RateLimitError` | 429 — rate/cost cap (`.kind`, `.resetsAt`, `.retryAfterMs`) |
| `NotFoundError` | 404 — job/workflow not found |
| `APIError` | 5xx — upstream error |
| `ConnectionError` | network failure / timeout |
| `JobFailedError` | async media job failed (`.jobId`) |
| `JobTimeoutError` | async job exceeded poll timeout (`.jobId`) |

`429` and `5xx` (and pre-response network errors) are retried automatically with exponential backoff + jitter, respecting rate-limit resets. `4xx` are never retried.

## Configuration

```ts
new Curvet({
  appKey: "cvt_app_...",
  baseURL: "https://curvet.ai/api/v1/playground", // override for staging
  timeout: 60_000,            // per-request, ms
  maxRetries: 2,
  defaultPollIntervalMs: 2500, // async job polling
  defaultPollTimeoutMs: 180_000,
  fetch: customFetch,          // for Node < 18 / testing
});
```

Per-call overrides: every method accepts a final `options` arg (`{ signal, timeout, maxRetries }`; media methods also take `{ pollIntervalMs, pollTimeoutMs, onProgress }`).

## Development

```bash
npm install
npm run typecheck
npm test        # unit tests (mocked HTTP) — no network, no credits
npm run build   # ESM + CJS + d.ts via tsup

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

## License

MIT
