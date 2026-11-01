import type { HostAdapters, WorkspaceRepositories } from '#engine/application/engineServices';
import {
  chooseUpcomingScenes,
  collectBeatSituations,
  listOpenAxes,
} from '#engine/application/interviews/interviewCoverage';
import {
  resolveInterviewTuning,
  type InterviewTuning,
} from '#engine/application/interviews/interviewTuning';
import {
  scenePath,
  type BibleSubjectKind,
  type InterviewAxesFile,
  type InterviewBeatSituation,
  type InterviewCardCoverage,
  type InterviewWorkingModel,
  type SceneFile,
  type SceneListItem,
  type SidebarCardSummary,
  type StoryboardCard,
  type StoryUri,
} from '@storyboard/story-model';

export interface DescribeInterviewCoverageRequest {
  readonly workspaceRoot: StoryUri;
  readonly sceneStems?: readonly string[];
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
    const coverage: InterviewCardCoverage[] = [];

    for (const cardType of ['character', 'background'] as const) {
      for (const summary of await this.repositories.cardSidebar.list(request.workspaceRoot, cardType)) {
        const entry: InterviewCardCoverage | undefined = await this.describeCard(
          request.workspaceRoot,
          cardType,
          summary,
          scenes,
          axesFile,
          tuning,
        );
        if (entry !== undefined) {
          coverage.push(entry);
        }
      }
    }

    return coverage;
  }

  private async describeCard(
    workspaceRoot: StoryUri,
    cardType: BibleSubjectKind,
    summary: SidebarCardSummary,
    scenes: readonly SceneFile[],
    axesFile: InterviewAxesFile,
    tuning: InterviewTuning,
  ): Promise<InterviewCardCoverage | undefined> {
    const card: StoryboardCard | undefined = await this.repositories.noteAbsorb.loadCard(
      workspaceRoot,
      cardType,
      summary.id,
    );
    if (card === undefined) {
      return undefined;
    }

    const situations: InterviewBeatSituation[] = collectBeatSituations(card, scenes);
    if (situations.length === 0) {
      return undefined;
    }

    const model: InterviewWorkingModel | undefined = await this.repositories.interviews.loadWorkingModel(
      workspaceRoot,
      card.id,
    );

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
      ),
      upcomingSceneStems: [...new Set(situations.map((situation) => situation.sceneStem))],
    };
  }

  private async loadUpcomingScenes(
    request: DescribeInterviewCoverageRequest,
    tuning: InterviewTuning,
  ): Promise<SceneFile[]> {
    const listed: SceneListItem[] = await this.repositories.sceneSidebar.list(request.workspaceRoot);
    const chosen: SceneListItem[] = chooseUpcomingScenes(listed, tuning.upcomingScenes, request.sceneStems);
    const scenes: SceneFile[] = [];

    for (const item of chosen) {
      scenes.push(
        await this.repositories.scenes.read(
          scenePath(request.workspaceRoot, item.stem),
          `${item.stem}.card`,
        ),
      );
    }

    return scenes;
  }
}
