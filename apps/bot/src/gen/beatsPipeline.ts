import { sceneRelativePath } from '@storyboard/story-format';

import type { WorkspaceStore } from '@/workspace/workspaceStore';
import type { IPipeline, PipelineContext } from './pipelineRunner';
import type { GenJob, PipelineResult } from './types';

export type BeatsExpansionOutcome =
  | { readonly status: 'written'; readonly beatCount: number }
  | { readonly status: 'kept'; readonly beatCount: number }
  | { readonly status: 'failed'; readonly errorMessage: string };

export interface BeatsExpander {
  // Proposes the scene's beats and writes them to the card through the mutate gate. Injected so
  // the pipeline stays testable without a provider.
  expandBeats(sceneStem: string, force: boolean): Promise<BeatsExpansionOutcome>;
}

export interface BeatsPipelineOptions {
  readonly store: WorkspaceStore;
  readonly expander: BeatsExpander;
}

export class BeatsPipeline implements IPipeline {
  public constructor(private readonly options: BeatsPipelineOptions) {}

  public async run(job: GenJob, context: PipelineContext): Promise<PipelineResult> {
    const sceneStem = typeof job.target.scene === 'string' ? job.target.scene : '';
    if (sceneStem.length === 0) {
      return {
        success: false,
        failureReason: 'provider_error',
        errorMessage: '씬이 지정되지 않았습니다.',
      };
    }

    await context.reportStage('씬 확인');
    const scenes = await this.options.store.listScenes();
    if (!scenes.some((scene) => scene.stem === sceneStem)) {
      return {
        success: false,
        failureReason: 'provider_error',
        errorMessage: `씬을 찾을 수 없습니다: ${sceneStem}`,
      };
    }

    await context.reportStage('비트 전개');
    const expanded = await this.options.expander.expandBeats(
      sceneStem,
      job.options['force'] === true,
    );

    if (context.isCancelled()) {
      return { success: false, failureReason: 'cancelled' };
    }

    if (expanded.status === 'failed') {
      return {
        success: false,
        failureReason: 'provider_error',
        errorMessage: expanded.errorMessage,
      };
    }

    const relativePath = sceneRelativePath(sceneStem);
    context.log(
      '저장',
      expanded.status === 'kept'
        ? `이미 비트 ${expanded.beatCount}개가 있어 그대로 둡니다 (force 로 다시 뽑습니다)`
        : `${relativePath} 에 비트 ${expanded.beatCount}개 저장 완료`,
    );
    return { success: true, resultRef: relativePath };
  }
}
