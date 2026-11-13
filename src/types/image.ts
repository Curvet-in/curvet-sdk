import type { ModelId } from "./models";
import type { Usage } from "./common";

export interface ImageGenerateParams {
  model: ModelId;
  prompt: string;
  /**
   * Output dimensions as "<width>x<height>" (default "1024x1024").
   * Note: the API uses a single `size` field, NOT separate width/height.
   * Gemini models ignore it.
   */
  size?: string;
  /**
   * A source image to edit or build on, as an https URL or a `data:` URI. Read
   * by the `ali-*` image models (edit) and `muse-image-1.0`.
   */
  image?: string;
  /**
   * Source images to upload (sent as multipart/form-data). At most 10, each at
   * most 25 MB (a `PayloadTooLargeError`, code `upload_too_large`, otherwise).
   * Give each an image MIME type — a `File`, or
   * `new Blob([bytes], { type: "image/png" })`: the server picks files out by
   * type. `qwen-image-edit` reads the first; `muse-image-1.0` reads them all.
   */
  files?: Blob[];
}

export interface ImageResponse {
  success: boolean;
  /**
   * A public URL on Curvet's CDN; the provider's own URL when it answered with
   * one; a `data:image/png;base64` URI for a Gemini image that could not be
   * stored; for `ali-*` models the provider's temporary (about 24 h) URL when
   * re-hosting failed.
   */
  imageUrl: string;
  usage: Usage;
  metadata: {
    model: string;
    latencyMs: number;
    /** The charge's id. The server can omit it; older SDK versions typed it as always present. */
    requestId?: string;
    /** The `Idempotency-Key` the call was sent with. */
    idempotencyKey?: string;
  };
}
