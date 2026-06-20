import type { ModelId } from "./models";
import type { Usage } from "./common";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatCreateParams {
  model: ModelId;
  messages: ChatMessage[];
  /** Creativity control (default 0.7). */
  temperature?: number;
  /** Maximum response tokens (default 1000). */
  maxTokens?: number;
}

export interface ChatResponse {
  success: boolean;
  response: string;
  usage: Usage;
  metadata: {
    model: string;
    latencyMs: number;
    requestId: string;
  };
}
