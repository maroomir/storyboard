import type { NovelStageName } from '@storyboard/story-model';
import type { NovelPipelineResult } from '#engine/application/novel/novelPipelineContract';
import type { NovelRun } from '#engine/application/novel/novelRun';

export interface INovelStage {
  readonly id: NovelStageName;
  run(run: NovelRun): Promise<NovelPipelineResult | undefined>;
}
