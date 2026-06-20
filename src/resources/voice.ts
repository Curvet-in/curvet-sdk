import type { HttpClient } from "../core/http";
import type { RequestOptions } from "../types/common";

export interface SttParams {
  /** The audio to transcribe. */
  audio: Blob | Uint8Array | ArrayBuffer;
  /** File name for the upload (default "audio"). */
  filename?: string;
  provider?: "elevenlabs" | "deepinfra" | (string & {});
  /** ASR model id (provider-specific; optional). */
  model?: string;
  prompt?: string;
  /** ISO 639-1 language hint. */
  languageCode?: string;
  allowFallback?: boolean;
}

export interface SttResult {
  success: boolean;
  text: string;
  languageCode?: string;
  segments?: Array<{ start: number; end: number; text: string }>;
  provider?: string;
  creditsCharged?: number;
  creditsRemaining?: number;
  [key: string]: unknown;
}

/**
 * Public speech-to-text. Mounted as a sibling of the playground under
 * `/api/v1/voice`, so it uses the v1-root HTTP client. Multipart upload; not
 * auto-retried (it consumes credits).
 */
export class Voice {
  constructor(private client: HttpClient) {}

  async stt(params: SttParams, options?: RequestOptions): Promise<SttResult> {
    const form = new FormData();
    form.append("audio", toBlob(params.audio), params.filename ?? "audio");
    if (params.provider) form.append("provider", params.provider);
    if (params.model) form.append("model", params.model);
    if (params.prompt) form.append("prompt", params.prompt);
    if (params.languageCode) form.append("languageCode", params.languageCode);
    if (params.allowFallback !== undefined) {
      form.append("allowFallback", String(params.allowFallback));
    }

    const reqOptions: RequestOptions = {
      ...options,
      timeout: options?.timeout ?? 120_000,
      maxRetries: options?.maxRetries ?? 0,
    };
    return this.client.request<SttResult>({
      method: "POST",
      path: "/voice/stt/public",
      body: form,
      options: reqOptions,
    });
  }
}

function toBlob(audio: Blob | Uint8Array | ArrayBuffer): Blob {
  if (typeof Blob !== "undefined" && audio instanceof Blob) return audio;
  return new Blob([audio] as ConstructorParameters<typeof Blob>[0]);
}
