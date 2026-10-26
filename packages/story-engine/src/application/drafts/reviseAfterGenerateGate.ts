import type { HostAdapters } from '#engine/application/engineServices';
import type {
  StoryboardProjectPaths,
  StoryUri,
  StoryWorkspaceFolder,
} from '@storyboard/story-model';
import {
  draftPath,
  extractErrorMessage,
  getStoryboardProjectPaths,
  parseSceneFileName,
} from '@storyboard/story-model';
import { recordRevisionEntry } from '#engine/persistence/revisionPlanRecorder';
import type { ReviseDraftUseCase, ReviseDraftWorkflowResult } from './reviseDraftUseCase';

export type ReviseGateHooks = {
  readonly onProgress?: (message: string) => void;
  readonly shouldCancel?: () => boolean;
};

export type ReviseAfterGenerateHooks = ReviseGateHooks & {
  readonly onWillRun?: () => void;
};

export interface ReviseAfterGenerateGateCollaborators {
  readonly reviseDraftUseCase: ReviseDraftUseCase;
}

export class ReviseAfterGenerateGate {
  public constructor(
    private readonly host: HostAdapters,
    private readonly collaborators: ReviseAfterGenerateGateCollaborators,
  ) {}

  public async maybeRunAfterGenerate(
    sceneUri: StoryUri,
    hooks: ReviseAfterGenerateHooks = {},
  ): Promise<ReviseDraftWorkflowResult | undefined> {
    if (!this.host.configBridge.isReviseAfterGenerateEnabled() || hooks.shouldCancel?.()) {
      return undefined;
    }

    const folder: StoryWorkspaceFolder | undefined = this.host.workspaceLocator.folderFor(sceneUri);
    const sceneStem: string | undefined = parseSceneFileName(
      sceneUri.path.split('/').at(-1) ?? '',
    )?.stem;

    if (!folder || !sceneStem) {
      return undefined;
    }

    hooks.onWillRun?.();
    return await this.runForScene(folder.uri, sceneStem, hooks);
  }

  public async runForScene(
    workspaceUri: StoryUri,
    sceneStem: string,
    hooks: ReviseGateHooks = {},
  ): Promise<ReviseDraftWorkflowResult | undefined> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceUri);
    const draftUri: StoryUri = draftPath(workspaceUri, sceneStem);

    if (!(await this.host.fileSystem.exists(draftUri))) {
      return undefined;
    }

    const reviseResult: ReviseDraftWorkflowResult =
      await this.collaborators.reviseDraftUseCase.execute({
        workspaceUri,
        paths,
        draftUri,
        sceneStem,
        maxIterations: this.host.configBridge.getReviseMaxIterations(),
        maxCompressionPercent: this.host.configBridge.getMaxCompressionPercent(),
        reviseScoreThreshold: this.host.configBridge.getReviseScoreThreshold(),
        onProgress: hooks.onProgress,
        shouldCancel: hooks.shouldCancel,
      });

    try {
      await recordRevisionEntry(this.host.fileSystem, paths, {
        sceneStem,
        checkedAt: new Date().toISOString(),
        revisionCount: reviseResult.revisionCount,
        remainingBlocking: reviseResult.remainingBlocking,
        instructions: reviseResult.instructions,
        preservedOriginal: reviseResult.preservedOriginal,
        rejection: reviseResult.rejection,
      });
    } catch (error) {
      this.host.logger.warn(
        `revision-plan.yaml 기록에 실패했습니다: ${extractErrorMessage(error)}`,
      );
    }

    return reviseResult;
  }
}
