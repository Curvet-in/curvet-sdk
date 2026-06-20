import type { HttpClient } from "../core/http";
import type { ChatCreateParams, ChatResponse } from "../types/chat";
import type { RequestOptions } from "../types/common";

export class Chat {
  constructor(private client: HttpClient) {}

  /** Create a chat completion. Synchronous — resolves with the model's reply. */
  create(params: ChatCreateParams, options?: RequestOptions): Promise<ChatResponse> {
    return this.client.request<ChatResponse>({
      method: "POST",
      path: "/chat",
      body: params,
      options,
    });
  }
}
