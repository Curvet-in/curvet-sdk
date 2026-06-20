import type { HttpClient } from "../core/http";
import type { JobDefaults } from "./jobs";
import type { VideoGenerateParams } from "../types/job";
import { MediaResource } from "./media";

/** Video generation (async). `curvet.video.generate(...)` auto-polls to completion. */
export class Video extends MediaResource<VideoGenerateParams> {
  constructor(client: HttpClient, defaults: JobDefaults) {
    super(client, defaults, "/video");
  }
}
