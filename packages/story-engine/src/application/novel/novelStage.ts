import type { NovelStageName } from '@storyboard/story-model';
import type { NovelPipelineResult } from './novelPipelineContract';
import type { NovelRun } from './novelRun';

export interface INovelStage {
  readonly id: NovelStageName;
  run(run: NovelRun): Promise<NovelPipelineResult | undefined>;
}
