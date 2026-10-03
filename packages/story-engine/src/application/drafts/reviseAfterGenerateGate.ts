import type { StoryUri } from '@storyboard/story-model';
import type { IStoryboardLogger } from '#engine/ports/logger';
import { draftPath, getStoryboardProjectPaths } from '#engine/paths/projectPaths';
import { recordRevisionEntry } from '#engine/persistence/revisionPlanRecorder';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { IWorkspaceLocator } from '#engine/ports/workspaceLocator';
import type { ConfigBridge } from '@storyboard/story-ai';
import { parseSceneFileName } from '@storyboard/story-model';
import type { ReviseDraftUseCase, ReviseDraftWorkflowResult } from './reviseDraftUseCase';

export type ReviseGateHooks = {
  readonly onProgress?: (message: string) => void;
  readonly shouldCancel?: () => boolean;
};

export type ReviseAfterGenerateHooks = ReviseGateHooks & {
  readonly onWillRun?: () => void;
};

export interface ReviseAfterGenerateGateDependencies {
  readonly fileSystem: IFileSystem;
  readonly workspaceLocator: IWorkspaceLocator;
  readonly configBridge: ConfigBridge;
  readonly logger: IStoryboardLogger;
  readonly reviseDraftUseCase: ReviseDraftUseCase;
}

export class ReviseAfterGenerateGate {
  public constructor(private readonly deps: ReviseAfterGenerateGateDependencies) {}

  public async maybeRunAfterGenerate(
    sceneUri: StoryUri,
    hooks: ReviseAfterGenerateHooks = {},
  ): Promise<ReviseDraftWorkflowResult | undefined> {
    if (!this.deps.configBridge.isReviseAfterGenerateEnabled() || hooks.shouldCancel?.()) {
      return undefined;
    }

    const folder = this.deps.workspaceLocator.folderFor(sceneUri);
    const sceneStem = parseSceneFileName(sceneUri.path.split('/').at(-1) ?? '')?.stem;

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
    const paths = getStoryboardProjectPaths(workspaceUri);
    const draftUri = draftPath(workspaceUri, sceneStem);

    if (!(await this.deps.fileSystem.exists(draftUri))) {
      return undefined;
    }

    const result = await this.deps.reviseDraftUseCase.execute({
      workspaceUri,
      paths,
      draftUri,
      sceneStem,
      maxIterations: this.deps.configBridge.getReviseMaxIterations(),
      maxCompressionPercent: this.deps.configBridge.getMaxCompressionPercent(),
      reviseScoreThreshold: this.deps.configBridge.getReviseScoreThreshold(),
      onProgress: hooks.onProgress,
      shouldCancel: hooks.shouldCancel,
    });

    try {
      await recordRevisionEntry(this.deps.fileSystem, paths, {
        sceneStem,
        checkedAt: new Date().toISOString(),
        revisionCount: result.revisionCount,
        remainingBlocking: result.remainingBlocking,
        instructions: result.instructions,
        preservedOriginal: result.preservedOriginal,
        rejection: result.rejection,
      });
    } catch (error) {
      this.deps.logger.warn(
        `revision-plan.yaml 기록에 실패했습니다: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return result;
  }
}
