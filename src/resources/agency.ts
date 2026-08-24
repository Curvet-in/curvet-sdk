import type { HttpClient, HttpClientOptions } from "../core/http";
import type { RequestOptions } from "../types/common";
import { CurvetError } from "../core/errors";

/**
 * Agency 2 — multi-agent runs, streamed.
 *
 * Needs a CLI token carrying the `agency:run` scope (`curvet login --scope
 * agency:run`). It is not granted by default: it is the only scope that spends
 * money on its own and the only one that reaches tools which can email and
 * message on the user's behalf.
 *
 * `run()` is an async iterator of typed events rather than a callback soup,
 * because a run is a conversation, not a request: it emits token deltas, a tool
 * timeline, and pauses that need an answer before it will continue. A `for await`
 * loop reads in the order things happened and can break out to abort.
 *
 * Deliberately free of any rendering. A terminal UI, a desktop app and a test
 * harness all consume the same iterator.
 */

// ---- events ----------------------------------------------------------------

/**
 * Every event type the run stream emits. Listed exhaustively because a client
 * that silently ignores an unknown event is a client that misses the pause it
 * was supposed to answer.
 */
export type AgencyEventType =
  | "run_start"
  | "agent_start"
  | "agent_delta"
  | "agent_end"
  | "agent_retry"
  | "tool_call"
  | "tool_result"
  | "status"
  | "qa_decision"
  | "plan_proposed"
  | "plan_resolved"
  | "human_input"
  | "confirm_action"
  | "confirm_resolved"
  | "deliverable"
  | "cost_update"
  | "ephemeral"
  | "text"
  | "error"
  | "run_end"
  /** The run wants a tool executed on THIS machine. See ClientToolCall. */
  | "client_tool_call"
  /** How that call ended, including whether the result ever reached the run. */
  | "client_tool_result";

export interface AgencyEvent {
  type: AgencyEventType | string;
  /** The agent node this came from, when it came from one. */
  nodeId?: string;
  /** Correlates a tool_call with its tool_result, and a pause with its answer. */
  callId?: string;
  agentId?: string;
  agentName?: string;
  tool?: string;
  input?: Record<string, unknown>;
  summary?: string;
  ok?: boolean;
  text?: string;
  message?: string;
  prompt?: string;
  plan?: string;
  steps?: { agent: string; task: string }[];
  decision?: string;
  deliverable?: AgencyDeliverable;
  costUsd?: number;
  creditsBilled?: number;
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
  /** Set on `error` when retrying could plausibly work. */
  retryable?: boolean;
  [key: string]: unknown;
}

export interface AgencyDeliverable {
  title?: string;
  kind?: string;
  language?: string;
  content?: string;
  url?: string;
  agentId?: string;
  nodeId?: string;
}

/**
 * A point where the run has stopped and is waiting for a person.
 *
 * Two kinds, and they resume on DIFFERENT keys — a difference that is invisible
 * from the event stream and will silently hang a client that gets it wrong:
 *
 *   ask_user       emits `human_input` and resumes on its **nodeId**
 *   plan / confirm emit `plan_proposed` / `confirm_action` and resume on **callId**
 *
 * `key` is already the right one. Pass it to `resume()` and do not derive your own.
 */
export interface AgencyPause {
  kind: "ask_user" | "plan" | "confirm";
  /** What to send back as `callId` when resuming. See above. */
  key: string;
  /** The question, plan text or action summary to show the person. */
  prompt: string;
  /** Suggested answers, when the tool offered any. */
  options?: string[];
  /** Present for `kind: "plan"`. */
  steps?: { agent: string; task: string }[];
  /** Present for `kind: "confirm"` — why this action needs approval. */
  warning?: string;
  raw: AgencyEvent;
}

/** Classify a pause, or return null if this event is not one. */
export function pauseFromEvent(e: AgencyEvent): AgencyPause | null {
  if (e.type === "human_input") {
    // ask_user keys its waiter on nodeId (agency/tools.js), while every other
    // pause keys on callId. Getting this wrong hangs the run until it times out.
    const key = String(e.nodeId ?? e.callId ?? "");
    if (!key) return null;
    return {
      kind: "ask_user",
      key,
      prompt: String(e.prompt ?? ""),
      options: Array.isArray(e.options) ? (e.options as string[]) : undefined,
      raw: e,
    };
  }
  if (e.type === "plan_proposed") {
    const key = String(e.callId ?? "");
    if (!key) return null;
    return { kind: "plan", key, prompt: String(e.plan ?? ""), steps: e.steps, raw: e };
  }
  if (e.type === "confirm_action") {
    const key = String(e.callId ?? "");
    if (!key) return null;
    return {
      kind: "confirm",
      key,
      prompt: String(e.prompt ?? e.summary ?? ""),
      warning: e.warning ? String(e.warning) : undefined,
      raw: e,
    };
  }
  return null;
}

// ---- client-side tools -----------------------------------------------------

/**
 * What a tool call DOES, so a client can render and gate it by category rather
 * than by matching on every name it might ever see. These are the tool kinds
 * from the Agent Client Protocol (`@agentclientprotocol/sdk`).
 */
export type ClientToolKind = "read" | "search" | "edit" | "delete" | "move" | "execute" | "fetch" | "think" | "other";

/**
 * The run has asked this machine to execute a tool, and is now SUSPENDED waiting
 * for the answer. Execute it, then call `toolResult()` with the same `toolCallId`.
 *
 * If you do not answer, the run does not proceed on a guess: the tool fails and
 * the model is told plainly that nothing was read. That is deliberate — a model
 * told a file was read when it was not will reason, edit and report against
 * contents that never existed. It also means a slow answer costs the run, so
 * answer even when the answer is a refusal.
 */
export interface ClientToolCall {
  /** Pass this back as `callId`. */
  toolCallId: string;
  name: string;
  kind: ClientToolKind;
  /** One line describing the call, ready to show a person: "Read src/index.ts". */
  title: string;
  /** The tool's arguments, exactly as the model produced them. Validate before use. */
  rawInput: Record<string, unknown>;
  nodeId?: string;
  raw: AgencyEvent;
}

/** Read a `client_tool_call` off the stream, or null if this is any other event. */
export function clientToolCallFromEvent(e: AgencyEvent): ClientToolCall | null {
  if (e.type !== "client_tool_call") return null;
  const toolCallId = String(e.toolCallId ?? e.callId ?? "");
  const name = String(e.name ?? e.tool ?? "");
  if (!toolCallId || !name) return null;
  return {
    toolCallId,
    name,
    kind: (e.kind as ClientToolKind) ?? "other",
    title: String(e.title ?? name),
    rawInput: (e.rawInput ?? e.input ?? {}) as Record<string, unknown>,
    nodeId: e.nodeId,
    raw: e,
  };
}

/** What a client executed, or why it did not. */
export interface ClientToolResultParams {
  /** The `toolCallId` from the call being answered. */
  callId: string;
  ok: boolean;
  /** The tool's output. Ignored when `ok` is false. */
  content?: string;
  /** Why it failed — shown to the model, so say something it can act on. */
  error?: string;
  /**
   * Whether `content` was cut short. Declare it: a silently truncated file read
   * produces confident wrong edits, and the model will narrow its request
   * instead of retrying the same one if it knows.
   */
  truncated?: boolean;
}

// ---- params ----------------------------------------------------------------

/**
 * A file handed to a run.
 *
 * Two forms, and they are not interchangeable:
 *
 *   • `id`      — a parked upload from `attach()`. The bytes stay on the server
 *                 and how they reach the model is decided at RUN time, against
 *                 the model actually chosen. An Anthropic orchestrator gets the
 *                 real document as a content block and sees layout, tables and
 *                 charts; anything else falls back to extracted text.
 *   • `content` — text you have already extracted yourself. Simpler, and lossy
 *                 in exactly the way the parked path exists to avoid: the model
 *                 reads your transcription instead of the page.
 *
 * Prefer `id` for anything that is not already text. A PDF, an image or a
 * spreadsheet pasted in as `content` is a transcription, and a photo cannot be
 * one at all.
 */
export interface AgencyAttachment {
  /** The name the model sees. Extensions matter — the server classifies on them. */
  name: string;
  /** Parked-upload id from `attach()`. */
  id?: string;
  /** Already-extracted text, as an alternative to `id`. */
  content?: string;
}

/** What `attach()` hands back. Pass `{ id, name }` to `run()`. */
export interface AgencyParkedFile {
  id: string;
  name: string;
  type: string;
  size: number;
}

export interface AgencyAttachParams {
  /** The bytes. A Node `Buffer` is a `Uint8Array`, so it works as-is. */
  data: Uint8Array | ArrayBuffer | Blob;
  /** File name, with its extension — see AgencyAttachment.name. */
  name: string;
  /** MIME type. Inferred from the extension when omitted. */
  type?: string;
  /**
   * Groups the file with a conversation so later turns can re-read it. Use the
   * same `sessionId` you pass to `run()`; without one the file is an orphan and
   * is swept after a day.
   */
  sessionId?: string;
  signal?: AbortSignal;
}

export interface AgencyRunParams {
  /** What to do. This is the user's request, verbatim. */
  task: string;
  /** Extra input the task refers to (a pasted document, a spreadsheet). */
  input?: string;
  /** Orchestrator model id. Omit to let the server choose. */
  modelId?: string;
  /** Prior turns, so a follow-up has context. Bounded server-side to the last 6. */
  history?: { role: "user" | "assistant"; content: string }[];
  /** Groups follow-up turns into one conversation. */
  sessionId?: string;
  /**
   * Tools this client can execute on the user's machine, BY NAME — for example
   * `["read_file", "list_dir", "grep"]`.
   *
   * Names only: the server owns the schemas and descriptions, so a client can
   * neither shadow a server-side tool nor write its own text into the model's
   * context. Names the server does not know are dropped, so declaring a tool a
   * newer client supports costs that one tool rather than the whole run.
   *
   * Declaring a tool is a promise to execute it. The run suspends on every call
   * and fails the tool if nobody answers.
   */
  clientTools?: string[];
  /**
   * Files this run may read — at most 5, and see `AgencyAttachment` for which of
   * its two forms to use.
   *
   * Bounded server-side rather than here: extra files past the fifth are dropped
   * and inlined `content` is cut at 100KB each, silently, so send what you mean
   * to send.
   */
  attachments?: AgencyAttachment[];
  signal?: AbortSignal;
}

export type AgencyDecision = "approve" | "edit" | "cancel";

export interface AgencyResumeParams {
  /** The pause's `key` — see AgencyPause. */
  callId: string;
  /** Defaults to "approve". Ignored for an `ask_user` answer. */
  decision?: AgencyDecision;
  /** The answer text for `ask_user`, or a note alongside a plan decision. */
  note?: string;
  /** Replacement steps, for `decision: "edit"`. */
  steps?: { agent: string; task: string }[];
}

export interface AgencyResumeResult {
  ok: boolean;
  /**
   * How far the server can vouch for this.
   *
   * `"resolved"` — a waiting step received it, in this process.
   * `"published"` — handed to the run queue. The server does not know whether a
   *   waiter existed: the run may have timed out, aborted, or be on another node.
   *
   * Production runs queued, so `"published"` is the normal answer. Treat it as
   * *sent*, not *delivered* — for a plan decision that is fine, since an
   * unreceived one simply times out.
   */
  delivery?: "resolved" | "published";
  aborted?: boolean;
}

export interface AgencyRunSummary {
  runId: string;
  task: string;
  status?: string;
  summary?: string;
  costUsd?: number;
  agentCount?: number;
  deliverableCount?: number;
  durationMs?: number;
  sessionId?: string;
  createdAt?: string;
}

/** A finished run, replayed from history. */
export interface AgencyRunDetail extends AgencyRunSummary {
  events?: AgencyEvent[];
  deliverables?: AgencyDeliverable[];
}

// ---- attachments ------------------------------------------------------------

/** Matches the server's multer limit; see AgencyAttachParams. */
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/**
 * Only the types the server actually classifies, and nothing else.
 *
 * A wrong guess is worse than none: an unknown type falls back to the file
 * extension server-side and still works, whereas a confidently wrong MIME type
 * routes a PDF down the image path. So this maps what agency/attachmentExtract
 * recognises and leaves everything else to the extension.
 */
const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  xltx: "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
};

function guessMimeType(name: string): string | undefined {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext];
}

function toBlob(data: AgencyAttachParams["data"], type?: string): Blob {
  if (typeof Blob !== "undefined" && data instanceof Blob) return data;
  if (data instanceof ArrayBuffer) return new Blob([data], type ? { type } : undefined);
  if (ArrayBuffer.isView(data)) {
    // Respect the view's window. A Node Buffer is very often a slice of a larger
    // pooled ArrayBuffer, so handing the whole buffer over uploads the pool.
    const view = data as Uint8Array;
    const copy = new Uint8Array(view.byteLength);
    copy.set(view);
    return new Blob([copy], type ? { type } : undefined);
  }
  throw new CurvetError("agency.attach needs the file's bytes as a Uint8Array, ArrayBuffer or Blob.");
}

// ---- resource --------------------------------------------------------------

export class Agency {
  constructor(
    private client: HttpClient,
    private streamOpts: Pick<HttpClientOptions, "baseURL" | "appKey" | "authHeaderName" | "fetch">,
  ) {}

  /**
   * Start a run and stream it.
   *
   * ```ts
   * for await (const e of curvet.agency.run({ task: "summarise my week" })) {
   *   if (e.type === "agent_delta") process.stdout.write(e.text ?? "");
   * }
   * ```
   *
   * The iterator ends when the run ends. Breaking out of the loop closes the
   * connection, which aborts the run server-side — that is `req.on("close")` on
   * the other end, and it is the intended way to cancel.
   *
   * A run can pause. Check each event with `pauseFromEvent()`; when one comes
   * back, answer it with `resume()` — from the same loop is fine, the stream
   * stays open and continues once the run is unblocked.
   */
  async *run(params: AgencyRunParams): AsyncGenerator<AgencyEvent, void, void> {
    const { signal, ...body } = params;
    if (!String(params.task ?? "").trim()) {
      throw new CurvetError("agency.run needs a task.");
    }

    const res = await this.streamOpts.fetch(`${this.streamOpts.baseURL}/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        [this.streamOpts.authHeaderName ?? "x-cli-token"]: this.streamOpts.appKey,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(text);
      } catch {
        /* not JSON — the raw text is the best message available */
      }
      throw new CurvetError(
        String(parsed.error ?? parsed.message ?? text.slice(0, 300) ?? "Agency run failed"),
        { status: res.status, raw: parsed },
      );
    }

    // The run id arrives in a header before the first event, so a caller can
    // resume or abort even if the stream dies before run_start.
    const runId = res.headers.get("x-run-id") ?? undefined;
    if (runId) yield { type: "run_id", runId } as AgencyEvent;

    yield* readSse(res.body, (line) => {
      // The worker's terminal marker. It exists so the server can close a stream
      // that missed run_end; a consumer has nothing to do with it.
      if (line.type === "__end__") return null;
      return line;
    });
  }

  /**
   * Answer a pause, or steer a plan.
   *
   * `callId` must be the pause's `key`, which is NOT always its `callId` field —
   * see AgencyPause.
   */
  async resume(
    runId: string,
    params: AgencyResumeParams,
    options?: RequestOptions,
  ): Promise<AgencyResumeResult> {
    return this.client.request<AgencyResumeResult>({
      method: "POST",
      path: `/run/${encodeURIComponent(runId)}/resume`,
      body: {
        callId: params.callId,
        decision: params.decision ?? "approve",
        note: params.note,
        steps: params.steps,
      },
      options,
    });
  }

  /**
   * Stop a run.
   *
   * Closing the stream does this too. Call it explicitly when you are not
   * holding the stream — cancelling from another process, say.
   */
  async abort(runId: string, options?: RequestOptions): Promise<AgencyResumeResult> {
    return this.client.request<AgencyResumeResult>({
      method: "POST",
      path: `/run/${encodeURIComponent(runId)}/resume`,
      body: { abort: true },
      options,
    });
  }

  /**
   * Answer a `client_tool_call` — the result of running one of this client's
   * tools on the user's machine.
   *
   * ```ts
   * const call = clientToolCallFromEvent(event);
   * if (call) {
   *   const out = await runLocally(call);           // your executor
   *   await curvet.agency.toolResult(runId, { callId: call.toolCallId, ...out });
   * }
   * ```
   *
   * Answer even when the answer is no. `{ok: false, error: "..."}` lets the model
   * adapt — try another path, ask the user — where silence just costs the run its
   * timeout and tells it nothing it can act on.
   *
   * `delivery` reports how far the server can vouch for this: `"resolved"` means a
   * waiting call received it, `"published"` means it was handed to the run queue
   * without the server learning whether anything was still waiting. Production
   * runs queued, so `"published"` is the normal answer. Either way the run's own
   * timeout is what makes an undelivered result safe — it fails the tool rather
   * than inventing an answer.
   */
  async toolResult(
    runId: string,
    params: ClientToolResultParams,
    options?: RequestOptions,
  ): Promise<AgencyResumeResult> {
    return this.client.request<AgencyResumeResult>({
      method: "POST",
      path: `/run/${encodeURIComponent(runId)}/tool-result`,
      body: {
        callId: params.callId,
        ok: params.ok === true,
        content: params.content ?? "",
        error: params.error,
        truncated: params.truncated === true,
      },
      options,
    });
  }

  /**
   * Park a file so a run can refer to it, and get back an id for
   * `run({ attachments })`.
   *
   * Returns as soon as the bytes are stored — durable storage and any text
   * extraction happen behind the response, so a scanned PDF does not make you
   * wait minutes before you can ask about it.
   *
   * ```ts
   * const file = await curvet.agency.attach({
   *   data: await fs.readFile("invoice.pdf"),
   *   name: "invoice.pdf",
   *   sessionId,
   * });
   * for await (const e of curvet.agency.run({
   *   task: "what is the total?",
   *   attachments: [{ id: file.id, name: file.name }],
   *   sessionId,
   * })) { ... }
   * ```
   *
   * A parked file lives for about an hour in the hot store and for the life of
   * the conversation in durable storage. Re-attach rather than assuming an id
   * from a previous session still resolves.
   */
  async attach(params: AgencyAttachParams, options?: RequestOptions): Promise<AgencyParkedFile> {
    const name = String(params.name ?? "").trim();
    if (!name) {
      // The name is not cosmetic: the server classifies PDFs, images and
      // spreadsheets by extension, so an unnamed file is an unreadable one.
      throw new CurvetError("agency.attach needs a file name, with its extension.");
    }

    const blob = toBlob(params.data, params.type ?? guessMimeType(name));
    if (blob.size === 0) {
      throw new CurvetError(`agency.attach was given no bytes for "${name}".`);
    }
    if (blob.size > MAX_ATTACHMENT_BYTES) {
      // Checked here as well as on the server so an oversized file fails in a
      // moment rather than after uploading 50MB to be told no.
      throw new CurvetError(
        `"${name}" is ${Math.round(blob.size / 1024 / 1024)}MB, over the ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB limit.`,
      );
    }

    const form = new FormData();
    // The field name is the server's contract (multer `.single("file")`).
    form.append("file", blob, name);
    if (params.sessionId) form.append("sessionId", params.sessionId);

    return this.client.request<AgencyParkedFile>({
      method: "POST",
      path: "/attach",
      body: form,
      options: { ...options, signal: params.signal ?? options?.signal },
    });
  }

  /** Past runs, newest first. */
  async list(options?: RequestOptions): Promise<AgencyRunSummary[]> {
    const body = await this.client.request<{ runs?: AgencyRunSummary[] } | AgencyRunSummary[]>({
      method: "GET",
      path: "/runs",
      options,
    });
    return Array.isArray(body) ? body : (body.runs ?? []);
  }

  /**
   * One finished run, with the events it recorded.
   *
   * This is a replay, not a live attach: the stream exists only on the request
   * that starts a run. `agent_delta` and `cost_update` are not persisted, so a
   * replay shows the tool timeline and the outcome, not the token-by-token text.
   */
  async retrieve(runId: string, options?: RequestOptions): Promise<AgencyRunDetail> {
    const body = await this.client.request<{ run?: AgencyRunDetail } & AgencyRunDetail>({
      method: "GET",
      path: `/runs/${encodeURIComponent(runId)}`,
      options,
    });
    return (body.run ?? body) as AgencyRunDetail;
  }

  /** What this server has enabled — models, flags, which tools are live. */
  async status(options?: RequestOptions): Promise<Record<string, unknown>> {
    return this.client.request<Record<string, unknown>>({
      method: "GET",
      path: "/status",
      options,
    });
  }
}

// ---- SSE ---------------------------------------------------------------------

/**
 * Parse an SSE body into events.
 *
 * Split on the line boundary and keep the remainder: a JSON payload is routinely
 * cut across two network chunks, and parsing per-chunk drops exactly the large
 * events (a deliverable, a long tool result) that matter most.
 */
async function* readSse(
  body: ReadableStream<Uint8Array>,
  map: (e: AgencyEvent) => AgencyEvent | null,
): AsyncGenerator<AgencyEvent, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        // `:` frames are keepalive comments — the server sends them so a long
        // tool phase does not trip a proxy's read timeout.
        if (!trimmed || trimmed.startsWith(":")) continue;
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let event: AgencyEvent;
        try {
          event = JSON.parse(payload) as AgencyEvent;
        } catch {
          continue;
        }
        const mapped = map(event);
        if (mapped) yield mapped;
      }
    }
  } finally {
    // Releasing the reader closes the connection, which the server reads as a
    // disconnect and turns into an abort. That is what makes `break` cancel a run.
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
  }
}
