/**
 * The shapes the contract test checks, each taken from the SDK method that
 * returns it (so the check follows the method's real return type), plus the
 * request and error types. Read by the TypeScript compiler in sdkTypes.ts;
 * never imported at runtime.
 */
import type { Curvet } from "../../src";

type Out<F extends (...args: any[]) => any> = Awaited<ReturnType<F>>;

export type ChatReply = Out<Curvet["chat"]["create"]>;
export type ImageReply = Out<Curvet["image"]["generate"]>;
/** video / audio / threeD share one normaliser. */
export type MediaSubmitReply = Out<Curvet["video"]["submit"]>;
export type JobReply = Out<Curvet["jobs"]["retrieve"]>;
export interface ModelsReply {
  models: Out<Curvet["models"]["list"]>;
  rateLimits: Out<Curvet["models"]["rateLimits"]>;
}
export interface BalanceReply {
  balance: Out<Curvet["balance"]["get"]>;
}
export type AnalyticsReply = Out<Curvet["analytics"]["get"]>;
export type WorkflowRunReply = Out<Curvet["workflows"]["run"]>;
export type WorkflowSubmitReply = Out<Curvet["workflows"]["submit"]>;
export type WorkflowRunStatusReply = Out<Curvet["workflows"]["runs"]["retrieve"]>;
export interface WorkflowListReply {
  workflows: Out<Curvet["workflows"]["list"]>;
}
export interface WorkflowDetailReply {
  workflow: Out<Curvet["workflows"]["retrieve"]>;
}

export type {
  CurvetError,
  InsufficientBalanceError,
  RateLimitError,
  ChatCreateParams,
  ImageGenerateParams,
  VideoGenerateParams,
  AudioGenerateParams,
  ThreeDGenerateParams,
  WorkflowRunParams,
  OpenAIModelList,
} from "../../src";
