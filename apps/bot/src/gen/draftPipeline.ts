import { draftRelativePath } from '@storyboard/story-format';

import type { ContentService } from '@/content/contentService';
import type { MutateOutcome } from '@/workspace/workspaceChanges';
import type { WorkspaceStore } from '@/workspace/workspaceStore';
import type { IPipeline, PipelineContext } from './pipelineRunner';
import type { GenJob, PipelineResult } from './types';

export type DraftGenerationOutcome =
  | { readonly status: 'written'; readonly outcome: MutateOutcome | undefined }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly errorMessage: string };

export interface DraftGenerator {
  // Generates the scene's draft and writes it through the content service. Injected so the
  // pipeline stays testable without a provider.
  generate(sceneStem: string, isCancelled: () => boolean): Promise<DraftGenerationOutcome>;
}

export interface DraftPipelineOptions {
  readonly store: WorkspaceStore;
  readonly content: ContentService;
  readonly generator: DraftGenerator;
}

// `draft/` is gitignored, so a regenerated draft cannot be recovered from history. Previous versions
// are archived under `.draft/<scene>/` first, matching the extension's keepHistory convention.
export class DraftPipeline implements IPipeline {
  public constructor(private readonly options: DraftPipelineOptions) {}

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
      // The scene may have been renamed or deleted in Desktop while the job waited in the queue.
      return {
        success: false,
        failureReason: 'provider_error',
        errorMessage: `씬을 찾을 수 없습니다: ${sceneStem}`,
      };
    }

    await context.reportStage('초안 생성');
    const generated = await this.options.generator.generate(sceneStem, context.isCancelled);

    if (generated.status === 'cancelled' || context.isCancelled()) {
      return { success: false, failureReason: 'cancelled' };
    }

    if (generated.status === 'failed') {
      return {
        success: false,
        failureReason: 'provider_error',
        errorMessage: generated.errorMessage,
      };
    }

    const outcome = generated.outcome;

    if (outcome !== undefined && (outcome.status === 'blocked' || outcome.status === 'stale')) {
      return {
        success: false,
        failureReason: outcome.status === 'stale' ? 'workspace_conflict' : 'provider_error',
        errorMessage: describeFailure(outcome),
      };
    }

    context.log('저장', `${draftRelativePath(sceneStem)} 저장 완료`);
    return { success: true, resultRef: draftRelativePath(sceneStem) };
  }
}

function describeFailure(outcome: MutateOutcome): string {
  if (outcome.status === 'blocked') {
    return outcome.detail;
  }
  if (outcome.status === 'stale') {
    const files = outcome.files.map((file) => file.relativePath).join(', ');
    const preserved =
      outcome.preservedPath === undefined
        ? ''
        : ` 생성된 초안은 ${outcome.preservedPath}에 보관했습니다.`;
    return `작업 중 ${files}이(가) 바뀌어 저장하지 않았습니다.${preserved}`;
  }
  return '알 수 없는 실패';
}
