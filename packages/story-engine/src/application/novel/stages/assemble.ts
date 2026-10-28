import type { NovelStageName } from '@storyboard/story-model';
import type { AssembleManuscriptResult } from '#engine/application/manuscript/assembleManuscriptUseCase';
import type { INovelStage } from '#engine/application/novel/novelStage';
import type { NovelPipelineResult } from '#engine/application/novel/novelPipelineContract';
import type { NovelRun } from '#engine/application/novel/novelRun';

export class AssembleStage implements INovelStage {
  public readonly id: NovelStageName = 'assemble';

  public async run(run: NovelRun): Promise<NovelPipelineResult | undefined> {
    await run.runStageOnce('assemble', '원고 조립 중…', () => this.assemble(run));
    return undefined;
  }

  private async assemble(run: NovelRun): Promise<void> {
    const assemblyResult: AssembleManuscriptResult =
      await run.services.collaborators.assembleManuscriptUseCase.execute({
        workspaceRoot: run.options.workspaceUri,
      });
    if (!assemblyResult.ok) {
      throw new Error(
        assemblyResult.kind === 'failed'
          ? assemblyResult.message
          : `원고를 조립할 수 없습니다: ${assemblyResult.kind}`,
      );
    }
  }
}
