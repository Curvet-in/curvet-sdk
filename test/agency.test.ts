import { describe, it, expect } from "vitest";
import { Curvet, pauseFromEvent, clientToolCallFromEvent, type AgencyEvent } from "../src";
import { mockFetch, type MockFetch } from "./helpers";
import type { FetchResponse } from "../src/types/common";

/**
 * Agency run streaming.
 *
 * The cases that matter are the ones a hand-rolled SSE reader gets wrong:
 * a JSON payload split across two network chunks, keepalive frames, and the
 * two pause kinds that resume on different keys.
 */

/** A fetch that replies with an SSE body delivered in the given chunks. */
function sseFetch(chunks: string[], { status = 200, headers = {} as Record<string, string> } = {}) {
  const calls: Array<{ url: string; init: any }> = [];
  let cancelled = false;
  const fn = (async (url: string, init: any): Promise<FetchResponse> => {
    calls.push({ url, init });
    const encoder = new TextEncoder();
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i >= chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(chunks[i++]));
      },
      cancel() {
        cancelled = true;
      },
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (n: string) => headers[n] ?? headers[n.toLowerCase()] ?? null },
      text: async () => chunks.join(""),
      body,
    };
  }) as MockFetch & { wasCancelled: () => boolean };
  fn.calls = calls;
  fn.wasCancelled = () => cancelled;
  return fn;
}

const ev = (o: Record<string, unknown>) => `data: ${JSON.stringify(o)}\n\n`;

async function collect(it: AsyncGenerator<AgencyEvent, void, void>): Promise<AgencyEvent[]> {
  const out: AgencyEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe("agency.run", () => {
  it("streams typed events from the CLI agency mount", async () => {
    const fetch = sseFetch([
      ev({ type: "run_start", runId: "run_1" }),
      ev({ type: "agent_delta", text: "hel" }),
      ev({ type: "agent_delta", text: "lo" }),
      ev({ type: "run_end", summary: "done", costUsd: 0.02 }),
    ]);
    const curvet = new Curvet({ cliToken: "cvt_cli_x", fetch });
    const events = await collect(curvet.agency.run({ task: "hi" }));

    expect(events.map((e) => e.type)).toEqual(["run_start", "agent_delta", "agent_delta", "run_end"]);
    expect(events.filter((e) => e.type === "agent_delta").map((e) => e.text).join("")).toBe("hello");

    // The contained mount, not /api/agency, and the CLI token as its own header.
    expect(fetch.calls[0].url).toBe("https://curvet.ai/api/v1/cli/agency/run");
    expect(fetch.calls[0].init.headers["x-cli-token"]).toBe("cvt_cli_x");
    expect(JSON.parse(fetch.calls[0].init.body).task).toBe("hi");
    // The abort signal must not be serialised into the request body.
    expect(JSON.parse(fetch.calls[0].init.body).signal).toBeUndefined();
  });

  it("reassembles an event split across network chunks", async () => {
    // The failure this prevents: parsing per-chunk drops exactly the LARGE events —
    // a deliverable, a long tool result — because those are the ones that get cut.
    const whole = ev({ type: "deliverable", deliverable: { title: "Report", content: "x".repeat(200) } });
    const cut = Math.floor(whole.length / 2);
    const fetch = sseFetch([whole.slice(0, cut), whole.slice(cut), ev({ type: "run_end" })]);
    const curvet = new Curvet({ cliToken: "t", fetch });
    const events = await collect(curvet.agency.run({ task: "report" }));

    expect(events.map((e) => e.type)).toEqual(["deliverable", "run_end"]);
    expect(events[0].deliverable?.content).toHaveLength(200);
  });

  it("ignores keepalive comments and blank frames", async () => {
    // A long tool phase goes quiet, so the server sends `:` frames to stop a proxy
    // timing the connection out. They are not events.
    const fetch = sseFetch([":keepalive\n\n", "\n", ev({ type: "status", message: "working" }), ": ping\n\n", ev({ type: "run_end" })]);
    const curvet = new Curvet({ cliToken: "t", fetch });
    const events = await collect(curvet.agency.run({ task: "x" }));
    expect(events.map((e) => e.type)).toEqual(["status", "run_end"]);
  });

  it("drops the worker's internal __end__ marker", async () => {
    const fetch = sseFetch([ev({ type: "run_end" }), ev({ type: "__end__" })]);
    const curvet = new Curvet({ cliToken: "t", fetch });
    const events = await collect(curvet.agency.run({ task: "x" }));
    expect(events.map((e) => e.type)).toEqual(["run_end"]);
  });

  it("yields the run id from the header before any event", async () => {
    // So a caller can abort even if the stream dies before run_start arrives.
    const fetch = sseFetch([ev({ type: "run_start" })], { headers: { "x-run-id": "run_42" } });
    const curvet = new Curvet({ cliToken: "t", fetch });
    const events = await collect(curvet.agency.run({ task: "x" }));
    expect(events[0]).toMatchObject({ type: "run_id", runId: "run_42" });
  });

  it("breaking out of the loop cancels the stream, which aborts the run", async () => {
    const fetch = sseFetch([ev({ type: "agent_delta", text: "a" }), ev({ type: "agent_delta", text: "b" })]);
    const curvet = new Curvet({ cliToken: "t", fetch });
    for await (const e of curvet.agency.run({ task: "x" })) {
      if (e.type === "agent_delta") break;
    }
    expect(fetch.wasCancelled()).toBe(true);
  });

  it("surfaces a refusal as an error carrying the server's reason", async () => {
    // The 403 a token without agency:run gets. It must not look like an empty run.
    const fetch = sseFetch([JSON.stringify({ error: "This CLI token is missing the agency:run scope." })], {
      status: 403,
    });
    const curvet = new Curvet({ cliToken: "t", fetch });
    await expect(collect(curvet.agency.run({ task: "x" }))).rejects.toThrow(/agency:run/);
  });

  it("refuses an empty task before opening a connection", async () => {
    const fetch = sseFetch([]);
    const curvet = new Curvet({ cliToken: "t", fetch });
    await expect(collect(curvet.agency.run({ task: "   " }))).rejects.toThrow(/task/i);
    expect(fetch.calls).toHaveLength(0);
  });
});

describe("attachments", () => {
  it("carries attachments through to the run body", async () => {
    const fetch = sseFetch([ev({ type: "run_end" })]);
    const curvet = new Curvet({ cliToken: "t", fetch });
    await collect(
      curvet.agency.run({
        task: "what is the total?",
        attachments: [{ id: "f_1", name: "invoice.pdf" }, { name: "notes.txt", content: "hello" }],
      }),
    );
    expect(JSON.parse(fetch.calls[0].init.body).attachments).toEqual([
      { id: "f_1", name: "invoice.pdf" },
      { name: "notes.txt", content: "hello" },
    ]);
  });

  it("uploads a file as multipart and returns its parked id", async () => {
    const fetch = mockFetch(() => ({ status: 200, body: { id: "f_9", name: "invoice.pdf", type: "application/pdf", size: 4 } }));
    const curvet = new Curvet({ cliToken: "t", fetch });

    const parked = await curvet.agency.attach({
      data: new Uint8Array([1, 2, 3, 4]),
      name: "invoice.pdf",
      sessionId: "s_1",
    });
    expect(parked.id).toBe("f_9");

    const { url, init } = fetch.calls[0];
    expect(url).toContain("/attach");
    expect(init.method).toBe("POST");
    // Multipart, and specifically NOT base64 JSON: a 50MB file inlined as base64
    // costs ~200MB of server memory to parse and exceeds the global json limit.
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    const file = form.get("file") as File;
    expect(file).toBeTruthy();
    expect(file.size).toBe(4);
    // The field name is the server's contract (multer `.single("file")`), and the
    // filename is what the server classifies the file by.
    expect(file.name).toBe("invoice.pdf");
    expect(form.get("sessionId")).toBe("s_1");
    // No hand-set content-type: the boundary has to come from fetch.
    const headers = init.headers as Record<string, string>;
    expect(Object.keys(headers).find((h) => h.toLowerCase() === "content-type")).toBeUndefined();
  });

  it("infers the media type from the extension, and only for types the server knows", async () => {
    // A confidently wrong MIME type is worse than none — an unknown type falls back
    // to the extension server-side and still works, a wrong one routes a PDF down
    // the image path.
    const fetch = mockFetch(() => ({ status: 200, body: { id: "f", name: "n", type: "t", size: 1 } }));
    const curvet = new Curvet({ cliToken: "t", fetch });

    await curvet.agency.attach({ data: new Uint8Array([1]), name: "photo.JPEG" });
    expect(((fetch.calls[0].init.body as FormData).get("file") as File).type).toBe("image/jpeg");

    await curvet.agency.attach({ data: new Uint8Array([1]), name: "model.blend" });
    expect(((fetch.calls[1].init.body as FormData).get("file") as File).type).toBe("");

    await curvet.agency.attach({ data: new Uint8Array([1]), name: "x.png", type: "application/pdf" });
    expect(((fetch.calls[2].init.body as FormData).get("file") as File).type).toBe("application/pdf");
  });

  it("uploads only the bytes of a pooled Buffer view", async () => {
    // A Node Buffer is very often a window onto a larger shared pool. Passing
    // `view.buffer` straight to Blob uploads the whole pool — other files' bytes
    // included — and the size is silently wrong.
    const pool = new Uint8Array([9, 9, 9, 1, 2, 3, 9, 9]);
    const view = pool.subarray(3, 6);
    const fetch = mockFetch(() => ({ status: 200, body: { id: "f", name: "n", type: "t", size: 3 } }));
    const curvet = new Curvet({ cliToken: "t", fetch });

    await curvet.agency.attach({ data: view, name: "three.bin" });
    const file = (fetch.calls[0].init.body as FormData).get("file") as File;
    expect(file.size).toBe(3);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("refuses locally what the server would refuse anyway", async () => {
    const fetch = mockFetch(() => ({ status: 200, body: {} }));
    const curvet = new Curvet({ cliToken: "t", fetch });

    await expect(curvet.agency.attach({ data: new Uint8Array([1]), name: "  " })).rejects.toThrow(/file name/);
    await expect(curvet.agency.attach({ data: new Uint8Array(), name: "empty.pdf" })).rejects.toThrow(/no bytes/);
    // Failing after uploading 50MB to be told no is a minute of the user's life.
    await expect(
      curvet.agency.attach({ data: new Uint8Array(51 * 1024 * 1024), name: "huge.pdf" }),
    ).rejects.toThrow(/over the 50MB limit/);
    expect(fetch.calls.length).toBe(0);
  });
});

describe("pauseFromEvent", () => {
  it("keys an ask_user pause on nodeId, not callId", async () => {
    // The trap. ask_user registers its waiter under nodeId while every other pause
    // uses callId, so resuming with the callId hangs the run until it times out.
    const pause = pauseFromEvent({ type: "human_input", nodeId: "node-7", callId: "call-1", prompt: "Which repo?" });
    expect(pause).not.toBeNull();
    expect(pause!.kind).toBe("ask_user");
    expect(pause!.key).toBe("node-7");
    expect(pause!.prompt).toBe("Which repo?");
  });

  it("keys a plan and a confirmation on callId", () => {
    const plan = pauseFromEvent({ type: "plan_proposed", callId: "c1", nodeId: "n1", plan: "Do X", steps: [{ agent: "a", task: "t" }] });
    expect(plan!.kind).toBe("plan");
    expect(plan!.key).toBe("c1");
    expect(plan!.steps).toHaveLength(1);

    const confirm = pauseFromEvent({ type: "confirm_action", callId: "c2", nodeId: "n2", summary: "Send email to x@y.z", warning: "outward" });
    expect(confirm!.kind).toBe("confirm");
    expect(confirm!.key).toBe("c2");
    expect(confirm!.warning).toBe("outward");
  });

  it("returns null for ordinary events", () => {
    for (const type of ["agent_delta", "tool_call", "run_end", "status"]) {
      expect(pauseFromEvent({ type })).toBeNull();
    }
  });

  it("returns null when there is no key to resume on", () => {
    // Better to render nothing than to POST a resume that can never match.
    expect(pauseFromEvent({ type: "human_input", prompt: "?" })).toBeNull();
    expect(pauseFromEvent({ type: "plan_proposed", plan: "x" })).toBeNull();
  });
});

describe("client-side tools", () => {
  it("declares tools by name on the run", async () => {
    const fetch = sseFetch([ev({ type: "run_end" })]);
    const curvet = new Curvet({ cliToken: "t", fetch });
    await collect(curvet.agency.run({ task: "read it", clientTools: ["read_file", "grep"] }));
    expect(JSON.parse(fetch.calls[0].init.body).clientTools).toEqual(["read_file", "grep"]);
  });

  it("reads a call off the stream with its ACP kind and a title to show a person", () => {
    const call = clientToolCallFromEvent({
      type: "client_tool_call",
      toolCallId: "toolu_01",
      name: "read_file",
      kind: "read",
      title: "Read src/index.ts",
      rawInput: { path: "src/index.ts" },
      nodeId: "n1",
    });
    expect(call).not.toBeNull();
    expect(call!.toolCallId).toBe("toolu_01");
    expect(call!.kind).toBe("read");
    expect(call!.title).toBe("Read src/index.ts");
    expect(call!.rawInput).toEqual({ path: "src/index.ts" });
  });

  it("returns null for every other event", () => {
    for (const type of ["agent_delta", "tool_call", "human_input", "run_end", "client_tool_result"]) {
      expect(clientToolCallFromEvent({ type })).toBeNull();
    }
  });

  it("returns null when there is nothing to answer with", () => {
    // Better to render nothing than to POST a result that can never match a call.
    expect(clientToolCallFromEvent({ type: "client_tool_call", name: "read_file" })).toBeNull();
    expect(clientToolCallFromEvent({ type: "client_tool_call", toolCallId: "c1" })).toBeNull();
  });

  it("defaults an unknown kind to other rather than dropping the call", () => {
    // A server that adds a tool kind this SDK predates must not make the call
    // unanswerable — an unanswered call costs the run its timeout.
    const call = clientToolCallFromEvent({ type: "client_tool_call", toolCallId: "c1", name: "future_tool" });
    expect(call!.kind).toBe("other");
  });

  it("posts a result to the tool-result route, not to resume", async () => {
    // Different routes because they have opposite failure policies: an unanswered
    // resume auto-approves, an unanswered tool result must never become success.
    const fetch = mockFetch(() => ({ status: 200, body: { ok: true, delivery: "published" } }));
    const curvet = new Curvet({ cliToken: "t", fetch });
    const res = await curvet.agency.toolResult("run_1", { callId: "toolu_01", ok: true, content: "hi" });
    expect(res.delivery).toBe("published");
    expect(fetch.calls[0].url).toBe("https://curvet.ai/api/v1/cli/agency/run/run_1/tool-result");
    const body = JSON.parse(fetch.calls[0].init.body);
    expect(body).toMatchObject({ callId: "toolu_01", ok: true, content: "hi", truncated: false });
  });

  it("sends a refusal as a failure with a reason the model can act on", async () => {
    const fetch = mockFetch(() => ({ status: 200, body: { ok: true } }));
    const curvet = new Curvet({ cliToken: "t", fetch });
    await curvet.agency.toolResult("run_1", { callId: "c1", ok: false, error: "denied: secret file" });
    const body = JSON.parse(fetch.calls[0].init.body);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("denied: secret file");
  });

  it("carries the truncation flag through", async () => {
    const fetch = mockFetch(() => ({ status: 200, body: { ok: true } }));
    const curvet = new Curvet({ cliToken: "t", fetch });
    await curvet.agency.toolResult("run_1", { callId: "c1", ok: true, content: "head", truncated: true });
    expect(JSON.parse(fetch.calls[0].init.body).truncated).toBe(true);
  });
});

describe("agency.resume / abort", () => {
  it("posts the pause key as callId and reports the delivery guarantee", async () => {
    const fetch = mockFetch(() => ({ status: 200, body: { ok: true, delivery: "published" } }));
    const curvet = new Curvet({ cliToken: "t", fetch });
    const res = await curvet.agency.resume("run_1", { callId: "node-7", note: "the api repo" });

    expect(res.delivery).toBe("published");
    expect(fetch.calls[0].url).toBe("https://curvet.ai/api/v1/cli/agency/run/run_1/resume");
    const body = JSON.parse(fetch.calls[0].init.body);
    expect(body.callId).toBe("node-7");
    expect(body.note).toBe("the api repo");
    expect(body.decision).toBe("approve"); // the server's own default, sent explicitly
  });

  it("passes an edited plan through", async () => {
    const fetch = mockFetch(() => ({ status: 200, body: { ok: true } }));
    const curvet = new Curvet({ cliToken: "t", fetch });
    await curvet.agency.resume("run_1", {
      callId: "c1",
      decision: "edit",
      steps: [{ agent: "writer", task: "shorter" }],
    });
    const body = JSON.parse(fetch.calls[0].init.body);
    expect(body.decision).toBe("edit");
    expect(body.steps).toEqual([{ agent: "writer", task: "shorter" }]);
  });

  it("abort posts {abort:true} to the same route", async () => {
    const fetch = mockFetch(() => ({ status: 200, body: { ok: true, aborted: true } }));
    const curvet = new Curvet({ cliToken: "t", fetch });
    const res = await curvet.agency.abort("run_1");
    expect(res.aborted).toBe(true);
    expect(JSON.parse(fetch.calls[0].init.body).abort).toBe(true);
  });

  it("url-encodes the run id", async () => {
    const fetch = mockFetch(() => ({ status: 200, body: { ok: true } }));
    const curvet = new Curvet({ cliToken: "t", fetch });
    await curvet.agency.abort("run/../evil");
    expect(fetch.calls[0].url).toContain("run%2F..%2Fevil");
  });
});

describe("agency history", () => {
  it("lists runs from either response shape", async () => {
    for (const body of [{ runs: [{ runId: "r1", task: "t" }] }, [{ runId: "r1", task: "t" }]]) {
      const fetch = mockFetch(() => ({ status: 200, body }));
      const curvet = new Curvet({ cliToken: "t", fetch });
      const runs = await curvet.agency.list();
      expect(runs).toHaveLength(1);
      expect(runs[0].runId).toBe("r1");
    }
  });

  it("retrieves one run, unwrapping the envelope when there is one", async () => {
    const fetch = mockFetch(() => ({
      status: 200,
      body: { run: { runId: "r1", task: "t", events: [{ type: "run_end" }] } },
    }));
    const curvet = new Curvet({ cliToken: "t", fetch });
    const run = await curvet.agency.retrieve("r1");
    expect(run.runId).toBe("r1");
    expect(run.events).toHaveLength(1);
  });
});
