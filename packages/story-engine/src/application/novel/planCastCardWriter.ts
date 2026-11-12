import {
  createEmptyCharacter,
  emptyOutlineSynopsis,
  findUncastCharacters,
  toOutlineBrief,
} from '@storyboard/story-model';
import type {
  ChapterPlan,
  OutlineCharacterDraft,
  OutlineSynopsis,
  StoryboardProject,
  StoryUri,
} from '@storyboard/story-model';
import type { ICardWriterRepository } from '#engine/application/cards/cardRepositories';
import type { NovelAiService } from '#engine/application/novel/novelPipelineContract';
import type { INovelOutlineRepository } from '#engine/application/novel/novelPipelinePorts';

export interface PlanCastCardReport {
  readonly writtenCount: number;
  readonly missingIds: readonly string[];
  readonly unusableIds: readonly string[];
}

export interface PlanCastCardWriterDependencies {
  readonly novelOutline: INovelOutlineRepository;
  readonly cardWriter: ICardWriterRepository;
}

export interface WritePlanCastRequest {
  readonly workspaceRoot: StoryUri;
  readonly project: StoryboardProject;
  readonly plan: ChapterPlan;
  readonly aiService: NovelAiService;
}

export class PlanCastCardWriter {
  public constructor(private readonly dependencies: PlanCastCardWriterDependencies) {}

  public async writeMissingCards(request: WritePlanCastRequest): Promise<PlanCastCardReport> {
    const { workspaceRoot, project, plan, aiService } = request;
    const { novelOutline, cardWriter } = this.dependencies;
    const existingIds: Set<string> = new Set(
      (await novelOutline.loadCharacterBriefs(workspaceRoot)).map((brief) => brief.id),
    );
    const { cast, unusableIds } = findUncastCharacters(plan, existingIds);

    if (cast.length === 0) {
      return { writtenCount: 0, missingIds: [], unusableIds };
    }

    const synopsis: OutlineSynopsis =
      (await novelOutline.loadSynopsis(workspaceRoot)) ?? emptyOutlineSynopsis();
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
      if (await cardWriter.exists(workspaceRoot, 'character', draft.id)) {
        continue;
      }

      await cardWriter.write(workspaceRoot, {
        ...createEmptyCharacter(draft.id, draft.name),
        ...(draft.role === undefined ? {} : { role: draft.role }),
        description: [...draft.description],
      });
      writtenCount += 1;
    }

    return { writtenCount, missingIds, unusableIds };
  }
}
