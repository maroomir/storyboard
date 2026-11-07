import type { HostAdapters, WorkspaceRepositories } from '#engine/application/engineServices';
import {
  chooseUpcomingScenes,
  collectBeatSituations,
  listCardAnsweredAxisIds,
  listOpenAxes,
  otherPlaceTokens,
} from '#engine/application/interviews/interviewCoverage';
import {
  resolveInterviewTuning,
  type InterviewTuning,
} from '#engine/application/interviews/interviewTuning';
import {
  getStoryboardProjectPaths,
  interviewWorkingModelRelativePath,
  scenePath,
  type BibleSubjectKind,
  type InterviewAxesFile,
  type InterviewBeatSituation,
  type InterviewCardCoverage,
  type InterviewUnreadableWorkingModel,
  type InterviewWorkingModel,
  type SceneFile,
  type SceneListItem,
  type StoryboardCard,
  type StoryUri,
} from '@storyboard/story-model';

export interface DescribeInterviewCoverageRequest {
  readonly workspaceRoot: StoryUri;
  readonly sceneStems?: readonly string[];
}

interface LoadedWorkingModel {
  readonly model?: InterviewWorkingModel;
  readonly unreadable?: InterviewUnreadableWorkingModel;
}

export class DescribeInterviewCoverageUseCase {
  public constructor(
    private readonly host: HostAdapters,
    private readonly repositories: WorkspaceRepositories,
  ) {}

  public async execute(request: DescribeInterviewCoverageRequest): Promise<InterviewCardCoverage[]> {
    const tuning: InterviewTuning = resolveInterviewTuning(
      this.host.configBridge.getSceneGenerationTuning(),
    );
    const scenes: SceneFile[] = await this.loadUpcomingScenes(request, tuning);
    if (scenes.length === 0) {
      return [];
    }

    const axesFile: InterviewAxesFile = await this.repositories.interviews.loadAxes(request.workspaceRoot);
    const cards: StoryboardCard[] = await this.loadCards(request.workspaceRoot);
    const backgrounds: StoryboardCard[] = cards.filter((card) => card.type !== 'character');

    const coverage: InterviewCardCoverage[] = [];

    for (const card of cards) {
      const entry: InterviewCardCoverage | undefined = await this.describeCard(
        request.workspaceRoot,
        card,
        scenes,
        axesFile,
        tuning,
        card.type === 'character' ? new Set<string>() : otherPlaceTokens(card, backgrounds),
      );
      if (entry !== undefined) {
        coverage.push(entry);
      }
    }

    return coverage;
  }

  private async loadCards(workspaceRoot: StoryUri): Promise<StoryboardCard[]> {
    const cards: StoryboardCard[] = [];

    for (const cardType of ['character', 'background'] as const) {
      for (const summary of await this.repositories.cardSidebar.list(workspaceRoot, cardType)) {
        const card: StoryboardCard | undefined = await this.repositories.noteAbsorb.loadCard(
          workspaceRoot,
          cardType,
          summary.id,
        );
        if (card !== undefined) {
          cards.push(card);
        }
      }
    }

    return cards;
  }

  private async describeCard(
    workspaceRoot: StoryUri,
    card: StoryboardCard,
    scenes: readonly SceneFile[],
    axesFile: InterviewAxesFile,
    tuning: InterviewTuning,
    placeTokensOfOthers: ReadonlySet<string>,
  ): Promise<InterviewCardCoverage | undefined> {
    const cardType: BibleSubjectKind = card.type === 'character' ? 'character' : 'background';
    const situations: InterviewBeatSituation[] = collectBeatSituations(card, scenes, {
      otherPlaceTokens: placeTokensOfOthers,
    });
    if (situations.length === 0) {
      return undefined;
    }

    const loaded: LoadedWorkingModel = await this.loadWorkingModel(workspaceRoot, card.id);
    const model: InterviewWorkingModel | undefined = loaded.model;

    return {
      cardId: card.id,
      cardType,
      name: card.name,
      hasWorkingModel: model !== undefined && model.records.length > 0,
      openAxes: listOpenAxes(
        axesFile[cardType]?.axes ?? [],
        model?.tallies ?? {},
        tuning.distillMinimumWeight,
        situations,
        listCardAnsweredAxisIds(model, card),
      ),
      upcomingSceneStems: [...new Set(situations.map((situation) => situation.sceneStem))],
      ...(loaded.unreadable === undefined ? {} : { unreadableWorkingModel: loaded.unreadable }),
    };
  }

  private async loadWorkingModel(workspaceRoot: StoryUri, cardId: string): Promise<LoadedWorkingModel> {
    try {
      return { model: await this.repositories.interviews.loadWorkingModel(workspaceRoot, cardId) };
    } catch (error) {
      return {
        unreadable: {
          relativePath: interviewWorkingModelRelativePath(cardId),
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private async loadUpcomingScenes(
    request: DescribeInterviewCoverageRequest,
    tuning: InterviewTuning,
  ): Promise<SceneFile[]> {
    const hasScenes: boolean = await this.host.fileSystem.exists(
      getStoryboardProjectPaths(request.workspaceRoot).sceneDirectory,
    );
    if (!hasScenes) {
      return [];
    }

    const listed: SceneListItem[] = await this.repositories.sceneSidebar.list(request.workspaceRoot);
    const chosen: SceneListItem[] = chooseUpcomingScenes(listed, tuning.upcomingScenes, request.sceneStems);
    const scenes: SceneFile[] = [];

    for (const item of chosen) {
      try {
        scenes.push(
          await this.repositories.scenes.read(
            scenePath(request.workspaceRoot, item.stem),
            `${item.stem}.card`,
          ),
        );
      } catch {
        continue;
      }
    }

    return scenes;
  }
}
