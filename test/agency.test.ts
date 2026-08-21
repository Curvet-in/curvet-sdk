import { describe, it, expect } from "vitest";
import { Curvet, pauseFromEvent, type AgencyEvent } from "../src";
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
