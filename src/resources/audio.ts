import type { HttpClient } from "../core/http";
import type { JobDefaults } from "./jobs";
import type { AudioGenerateParams } from "../types/job";
import { MediaResource } from "./media";

/** Audio generation (async). `curvet.audio.generate(...)` auto-polls to completion. */
export class Audio extends MediaResource<AudioGenerateParams> {
  constructor(client: HttpClient, defaults: JobDefaults) {
    super(client, defaults, "/audio");
  }
}
