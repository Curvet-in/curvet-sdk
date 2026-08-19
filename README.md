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

// With file inputs (multipart, handled for you):
await curvet.workflows.run("workflowId", {
  inputs: { caption: "hello" },
  files: { image: new Blob([bytes], { type: "image/png" }) },
});
```

For long workflows (video/audio/3D nodes), use the **pollable** API — submit
and auto-poll to completion with live progress, instead of one long HTTP call:

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
  enterpriseKey: "cvent_ent_...", // optional — enables curvet.enterprise.*
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

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release notes.

## License

MIT
