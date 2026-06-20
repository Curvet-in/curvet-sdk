import type { HttpClient } from "../core/http";
import type { JobDefaults } from "./jobs";
import type { ThreeDGenerateParams } from "../types/job";
import { MediaResource } from "./media";

/** 3D model generation (async). `curvet.threeD.generate(...)` auto-polls to completion. */
export class ThreeD extends MediaResource<ThreeDGenerateParams> {
  constructor(client: HttpClient, defaults: JobDefaults) {
    super(client, defaults, "/3d");
  }
}
