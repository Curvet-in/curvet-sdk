import { describe, it, expect } from "vitest";
import { Curvet, WorkflowRunFailedError, WorkflowRunTimeoutError } from "../src";
import { mockFetch } from "./helpers";

describe("workflows.run (sync)", () => {
  it("POSTs JSON inputs and returns the result", async () => {
    const fetch = mockFetch(() => ({ status: 200, body: { success: true, outputs: { out: "hi" } } }));
    const curvet = new Curvet({ appKey: "k", fetch });
    const res = await curvet.workflows.run("wf1", { inputs: { topic: "ai" } });
    expect(res.success).toBe(true);
    const call = fetch.calls[0];
    expect(call.url).toBe("https://curvet.ai/api/v1/playground/workflows/wf1/run");
    expect(JSON.parse(call.init.body).inputs).toEqual({ topic: "ai" });
    expect(JSON.parse(call.init.body).async).toBeUndefined();
  });
});

describe("workflows.submit (async)", () => {
  it("sends async:true and returns a runId", async () => {
    const fetch = mockFetch(() => ({
      status: 202,
      body: { success: true, runId: "run_1", status: "running" },
    }));
    const curvet = new Curvet({ appKey: "k", fetch });
    const r = await curvet.workflows.submit("wf1", { inputs: { a: 1 } });
    expect(r.runId).toBe("run_1");
    expect(r.status).toBe("running");
    expect(JSON.parse(fetch.calls[0].init.body).async).toBe(true);
  });
});

describe("workflows.runs.retrieve", () => {
  it("GETs the run status and normalizes it", async () => {
    const fetch = mockFetch(() => ({
      status: 200,
      body: {
        success: true,
        runId: "run_1",
        status: "running",
        progress: 50,
        currentNode: { id: "n2", label: "Generate", type: "actionNode" },
      },
    }));
    const curvet = new Curvet({ appKey: "k", fetch });
    const run = await curvet.workflows.runs.retrieve("run_1");
    expect(run.status).toBe("running");
    expect(run.progress).toBe(50);
    expect(run.currentNode?.label).toBe("Generate");
    expect(fetch.calls[0].url).toBe("https://curvet.ai/api/v1/playground/workflows/runs/run_1");
  });
});

describe("workflows.runAndPoll", () => {
  it("submits, polls running -> completed, reports progress, returns result", async () => {
    let polls = 0;
    const fetch = mockFetch((url) => {
      if (url.endsWith("/run")) return { status: 202, body: { success: true, runId: "run_x", status: "running" } };
      polls++;
      if (polls < 2) {
        return { status: 200, body: { runId: "run_x", status: "running", progress: 40, currentNode: { id: "n1", label: "Chat" } } };
      }
      return { status: 200, body: { runId: "run_x", status: "completed", progress: 100, result: { outputs: { video: "https://cdn/x.mp4" } } } };
    });
    const curvet = new Curvet({ appKey: "k", fetch });
    const seen: number[] = [];
    const run = await curvet.workflows.runAndPoll(
      "wf1",
      { inputs: {} },
      { pollIntervalMs: 1, onProgress: (r) => seen.push(r.progress ?? 0) },
    );
    expect(run.status).toBe("completed");
    expect((run.result as any).outputs.video).toBe("https://cdn/x.mp4");
    expect(seen).toContain(100);
  });

  it("throws WorkflowRunFailedError on failed status", async () => {
    const fetch = mockFetch((url) => {
      if (url.endsWith("/run")) return { status: 202, body: { success: true, runId: "run_f", status: "running" } };
      return { status: 200, body: { runId: "run_f", status: "failed", error: "node blew up" } };
    });
    const curvet = new Curvet({ appKey: "k", fetch });
    const err = await curvet.workflows.runAndPoll("wf1", {}, { pollIntervalMs: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(WorkflowRunFailedError);
    expect(err.runId).toBe("run_f");
    expect(err.message).toContain("node blew up");
  });

  it("throws WorkflowRunTimeoutError when it never finishes", async () => {
    const fetch = mockFetch((url) => {
      if (url.endsWith("/run")) return { status: 202, body: { success: true, runId: "run_t", status: "running" } };
      return { status: 200, body: { runId: "run_t", status: "running", progress: 10 } };
    });
    const curvet = new Curvet({ appKey: "k", fetch });
    const err = await curvet.workflows
      .runAndPoll("wf1", {}, { pollIntervalMs: 1, pollTimeoutMs: 15 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(WorkflowRunTimeoutError);
    expect(err.runId).toBe("run_t");
  });
});
