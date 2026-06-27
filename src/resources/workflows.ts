import type { HttpClient } from "../core/http";
import type { RequestOptions } from "../types/common";
import { pollUntil, PollTimeoutError } from "../core/poll";
import {
  CurvetError,
  WorkflowRunFailedError,
  WorkflowRunTimeoutError,
} from "../core/errors";

export interface WorkflowRunParams {
  /** Input values for the workflow. */
  inputs?: Record<string, unknown>;
  /** Optional file inputs, keyed by the workflow's file field name. */
  files?: Record<string, Blob>;
  /** Include the full execution state in the response (default true server-side). */
  includeFullState?: boolean;
}

/** Result of a synchronous `run()` call. */
export interface WorkflowRunResult {
  success: boolean;
  [key: string]: unknown;
}

export type WorkflowRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "stopped";

export interface WorkflowRunNode {
  nodeId: string;
  nodeLabel?: string;
  nodeType?: string;
  status?: string;
  executionTime?: number;
}

/** Normalized status of an async (pollable) workflow run. */
export interface WorkflowRun {
  runId: string;
  status: WorkflowRunStatus;
  progress?: number;
  totalNodes?: number;
  completedNodeCount?: number;
  /** The node currently executing (null when finished/queued). */
  currentNode?: { id: string; label?: string; type?: string } | null;
  nodesExecuted?: WorkflowRunNode[];
  /** Final outputs (present once completed). */
  result?: unknown;
  error?: string | null;
  startTime?: string;
  endTime?: string;
  /** Raw, unnormalized response body. */
  raw: unknown;
}

export interface WorkflowSubmitResult {
  runId: string;
  status: WorkflowRunStatus;
  raw: unknown;
}

export interface WorkflowPollOptions {
  /** Poll interval in ms (default 2500). */
  pollIntervalMs?: number;
  /** Total poll timeout in ms before throwing WorkflowRunTimeoutError (default 300000). */
  pollTimeoutMs?: number;
  signal?: AbortSignal;
  /** Called on each poll tick with the latest run status (current node, progress). */
  onProgress?: (run: WorkflowRun) => void;
}

function normalizeRun(body: unknown): WorkflowRun {
  const b = (body ?? {}) as Record<string, any>;
  return {
    runId: b.runId,
    status: b.status,
    progress: b.progress,
    totalNodes: b.totalNodes,
    completedNodeCount: b.completedNodeCount,
    currentNode: b.currentNode ?? null,
    nodesExecuted: b.nodesExecuted,
    result: b.result,
    error: b.error ?? null,
    startTime: b.startTime,
    endTime: b.endTime,
    raw: body,
  };
}

function buildBody(params: WorkflowRunParams, extra: Record<string, unknown> = {}) {
  const hasFiles = params.files && Object.keys(params.files).length > 0;
  if (hasFiles) {
    const form = new FormData();
    form.append("inputs", JSON.stringify(params.inputs ?? {}));
    if (params.includeFullState !== undefined) {
      form.append("includeFullState", String(params.includeFullState));
    }
    for (const [k, v] of Object.entries(extra)) form.append(k, String(v));
    for (const [field, file] of Object.entries(params.files!)) {
      form.append(field, file);
    }
    return form;
  }
  return {
    inputs: params.inputs ?? {},
    includeFullState: params.includeFullState,
    ...extra,
  };
}

/** Retrieve async workflow-run status. */
export class WorkflowRuns {
  constructor(private client: HttpClient) {}

  /** Fetch the current status of an async run once (no polling). */
  async retrieve(runId: string, options?: RequestOptions): Promise<WorkflowRun> {
    const body = await this.client.request({
      method: "GET",
      path: `/workflows/runs/${encodeURIComponent(runId)}`,
      options,
    });
    return normalizeRun(body);
  }
}

export class Workflows {
  readonly runs: WorkflowRuns;

  constructor(private client: HttpClient) {
    this.runs = new WorkflowRuns(client);
  }

  /**
   * Execute a workflow synchronously (blocks until it finishes). Best for short
   * workflows; for long ones (video/audio/3D nodes) prefer `runAndPoll`.
   * Sends JSON, or multipart/form-data when file inputs are provided.
   */
  async run(
    id: string,
    params: WorkflowRunParams = {},
    options?: RequestOptions,
  ): Promise<WorkflowRunResult> {
    const reqOptions: RequestOptions = { ...options, maxRetries: options?.maxRetries ?? 0 };
    return this.client.request<WorkflowRunResult>({
      method: "POST",
      path: `/workflows/${encodeURIComponent(id)}/run`,
      body: buildBody(params),
      options: reqOptions,
    });
  }

  /**
   * Submit a workflow in async (pollable) mode — returns immediately with a
   * runId. Poll `runs.retrieve(runId)` for status, or use `runAndPoll`.
   */
  async submit(
    id: string,
    params: WorkflowRunParams = {},
    options?: RequestOptions,
  ): Promise<WorkflowSubmitResult> {
    const reqOptions: RequestOptions = { ...options, maxRetries: options?.maxRetries ?? 0 };
    const res = await this.client.request<Record<string, any>>({
      method: "POST",
      path: `/workflows/${encodeURIComponent(id)}/run`,
      body: buildBody(params, { async: true }),
      options: reqOptions,
    });
    return { runId: res?.runId, status: res?.status ?? "running", raw: res };
  }

  /**
   * Submit and poll to completion. Resolves with the completed run (including
   * `result`), reporting progress via `onProgress`. Throws WorkflowRunFailedError
   * on failure, WorkflowRunTimeoutError on timeout.
   */
  async runAndPoll(
    id: string,
    params: WorkflowRunParams = {},
    opts: RequestOptions & WorkflowPollOptions = {},
  ): Promise<WorkflowRun> {
    const submitted = await this.submit(id, params, opts);
    if (!submitted.runId) {
      throw new CurvetError("Workflow submit did not return a runId", {
        raw: submitted.raw,
      });
    }

    const intervalMs = opts.pollIntervalMs ?? 2500;
    const timeoutMs = opts.pollTimeoutMs ?? 300_000;

    let run: WorkflowRun;
    try {
      run = await pollUntil(
        () => this.runs.retrieve(submitted.runId, { signal: opts.signal }),
        {
          intervalMs,
          timeoutMs,
          signal: opts.signal,
          isTerminal: (r) =>
            r.status === "completed" || r.status === "failed" || r.status === "stopped",
          onTick: (r) => opts.onProgress?.(r),
        },
      );
    } catch (e) {
      if (e instanceof PollTimeoutError) {
        throw new WorkflowRunTimeoutError(
          `Workflow run ${submitted.runId} did not finish within ${timeoutMs}ms`,
          submitted.runId,
        );
      }
      throw e;
    }

    if (run.status === "failed" || run.status === "stopped") {
      throw new WorkflowRunFailedError(
        run.error || `Workflow run ${submitted.runId} ${run.status}`,
        submitted.runId,
        { raw: run.raw },
      );
    }
    return run;
  }
}
