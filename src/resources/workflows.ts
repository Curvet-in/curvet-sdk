import type { HttpClient } from "../core/http";
import type { RequestOptions } from "../types/common";

export interface WorkflowRunParams {
  /** Input values for the workflow. */
  inputs?: Record<string, unknown>;
  /** Optional file inputs, keyed by the workflow's file field name. */
  files?: Record<string, Blob>;
  /** Include the full execution state in the response (default true server-side). */
  includeFullState?: boolean;
}

export interface WorkflowRunResult {
  success: boolean;
  [key: string]: unknown;
}

export class Workflows {
  constructor(private client: HttpClient) {}

  /**
   * Execute a visual-builder workflow by id. Sends JSON when there are no file
   * inputs, multipart/form-data when files are provided. Not auto-retried (a
   * workflow run executes and may consume credits).
   */
  async run(
    id: string,
    params: WorkflowRunParams = {},
    options?: RequestOptions,
  ): Promise<WorkflowRunResult> {
    const reqOptions: RequestOptions = { ...options, maxRetries: options?.maxRetries ?? 0 };
    const hasFiles = params.files && Object.keys(params.files).length > 0;

    let body: unknown;
    if (hasFiles) {
      const form = new FormData();
      form.append("inputs", JSON.stringify(params.inputs ?? {}));
      if (params.includeFullState !== undefined) {
        form.append("includeFullState", String(params.includeFullState));
      }
      for (const [field, file] of Object.entries(params.files!)) {
        form.append(field, file);
      }
      body = form;
    } else {
      body = { inputs: params.inputs ?? {}, includeFullState: params.includeFullState };
    }

    return this.client.request<WorkflowRunResult>({
      method: "POST",
      path: `/workflows/${encodeURIComponent(id)}/run`,
      body,
      options: reqOptions,
    });
  }
}
