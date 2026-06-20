import type { ModelId } from "./models";
import type { Usage } from "./common";

export interface ImageGenerateParams {
  model: ModelId;
  prompt: string;
  /**
   * Output dimensions as "<width>x<height>" (default "1024x1024").
   * Note: the API uses a single `size` field, NOT separate width/height.
   */
  size?: string;
}

export interface ImageResponse {
  success: boolean;
  imageUrl: string;
  usage: Usage;
  metadata: {
    model: string;
    latencyMs: number;
    requestId: string;
  };
}
