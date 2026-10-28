import {
  createEmptyCharacter,
  emptyOutlineSynopsis,
  findUncastCharacters,
  toOutlineBrief,
} from '@storyboard/story-model';
import type {
  ChapterPlan,
  NovelStageName,
  OutlineCharacterDraft,
  OutlineSynopsis,
} from '@storyboard/story-model';
import type { ICardWriterRepository } from '#engine/application/cards/cardRepositories';
import type { INovelStage } from '#engine/application/novel/novelStage';
import type {
  NovelAiService,
  NovelPipelineResult,
} from '#engine/application/novel/novelPipelineContract';
import type { INovelOutlineRepository } from '#engine/application/novel/novelPipelinePorts';
import type { NovelRun } from '#engine/application/novel/novelRun';

export interface CharactersStageReport {
  readonly writtenCount: number;
  readonly missingIds: readonly string[];
  readonly unusableIds: readonly string[];
}

export class CharactersStage implements INovelStage {
  public readonly id: NovelStageName = 'characters';

  public async run(run: NovelRun): Promise<NovelPipelineResult | undefined> {
    const { options } = run;
    const plan: ChapterPlan = await run.chapterPlan();

    await run.runStageOnce('characters', '인물 카드 확인 중…', async () => {
      const report: CharactersStageReport = await this.writeMissingCards(run, plan);

      if (report.writtenCount > 0) {
        options.onProgress('characters', `인물 카드 ${report.writtenCount}장을 만들었습니다.`);
      }
      if (report.missingIds.length > 0) {
        options.onProgress(
          'characters',
          `모델이 카드를 돌려주지 않은 인물이 있습니다: ${report.missingIds.join(', ')}. 카드를 직접 만들어 주세요.`,
        );
      }
      if (report.unusableIds.length > 0) {
        options.onProgress(
          'characters',
          `카드 이름이 될 수 없는 인물 id 라 카드를 만들지 않았습니다: ${report.unusableIds.join(', ')}. outline/chapters.yaml 의 id 를 영소문자로 고쳐 주세요.`,
        );
      }
    });

    return await run.checkpoint();
  }

  private async writeMissingCards(
    run: NovelRun,
    plan: ChapterPlan,
  ): Promise<CharactersStageReport> {
    const { workspaceUri, project } = run.options;
    const aiService: NovelAiService = run.newAiService();
    const outlineRepository: INovelOutlineRepository = run.services.repositories.novelOutline;
    const cardWriter: ICardWriterRepository = run.services.repositories.cardWriter;
    const existingIds: Set<string> = new Set(
      (await outlineRepository.loadCharacterBriefs(workspaceUri)).map((brief) => brief.id),
    );
    const { cast, unusableIds } = findUncastCharacters(plan, existingIds);

    if (cast.length === 0) {
      return { writtenCount: 0, missingIds: [], unusableIds };
    }

    const synopsis: OutlineSynopsis =
      (await outlineRepository.loadSynopsis(workspaceUri)) ?? emptyOutlineSynopsis();
    const drafts: OutlineCharacterDraft[] = await aiService.generateOutlineCharacters(
      toOutlineBrief(project),
      synopsis,
      cast,
    );
    const draftedIds: Set<string> = new Set(drafts.map((draft) => draft.id));
    const missingIds: string[] = cast
      .map((member) => member.id)
      .filter((id) => !draftedIds.has(id));

    if (missingIds.length === cast.length) {
      throw new Error(`인물 카드를 하나도 만들지 못했습니다: ${missingIds.join(', ')}`);
    }

    let writtenCount: number = 0;

    for (const draft of drafts) {
      if (await cardWriter.exists(workspaceUri, 'character', draft.id)) {
        continue;
      }

      await cardWriter.write(workspaceUri, {
        ...createEmptyCharacter(draft.id, draft.name),
        ...(draft.role === undefined ? {} : { role: draft.role }),
        description: [...draft.description],
      });
      writtenCount += 1;
    }

    return { writtenCount, missingIds, unusableIds };
  }
}
