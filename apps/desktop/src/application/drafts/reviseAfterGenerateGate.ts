import type * as vscode from 'vscode';

import type { StoryboardLogger } from '../../infrastructure/vscode/logger';
import { draftPath, getStoryboardProjectPaths } from '../../infrastructure/vscode/pathConventions';
import { recordRevisionEntry } from '../../infrastructure/persistence/revisionPlanRecorder';
import { uriExists } from '../../infrastructure/vscode/workspace';
import { resolveWorkspaceFolder } from '../../infrastructure/vscode/workspaceFolder';
import type { ConfigBridge } from '../../infrastructure/settings/ConfigBridge';
import { parseSceneFileName } from '@storyboard/story-format';
import type { ReviseDraftUseCase, ReviseDraftWorkflowResult } from './reviseDraftUseCase';

export type ReviseGateHooks = {
  readonly onProgress?: (message: string) => void;
  readonly shouldCancel?: () => boolean;
};

export type ReviseAfterGenerateHooks = ReviseGateHooks & {
  readonly onWillRun?: () => void;
};

export class ReviseAfterGenerateGate {
  public constructor(
    private readonly configBridge: ConfigBridge,
    private readonly logger: StoryboardLogger,
    private readonly reviseDraftUseCase: ReviseDraftUseCase,
  ) {}

  public async maybeRunAfterGenerate(
    sceneUri: vscode.Uri,
    hooks: ReviseAfterGenerateHooks = {},
  ): Promise<ReviseDraftWorkflowResult | undefined> {
    if (!this.configBridge.isReviseAfterGenerateEnabled() || hooks.shouldCancel?.()) {
      return undefined;
    }

    const folder = resolveWorkspaceFolder(sceneUri);
    const sceneStem = parseSceneFileName(sceneUri.path.split('/').at(-1) ?? '')?.stem;

    if (!folder || !sceneStem) {
      return undefined;
    }

    hooks.onWillRun?.();
    return await this.runForScene(folder.uri, sceneStem, hooks);
  }

  public async runForScene(
    workspaceUri: vscode.Uri,
    sceneStem: string,
    hooks: ReviseGateHooks = {},
  ): Promise<ReviseDraftWorkflowResult | undefined> {
    const paths = getStoryboardProjectPaths(workspaceUri);
    const draftUri = draftPath(workspaceUri, sceneStem);

    if (!(await uriExists(draftUri))) {
      return undefined;
    }

    const result = await this.reviseDraftUseCase.execute({
      workspaceUri,
      paths,
      draftUri,
      sceneStem,
      maxIterations: this.configBridge.getReviseMaxIterations(),
      maxCompressionPercent: this.configBridge.getMaxCompressionPercent(),
      reviseScoreThreshold: this.configBridge.getReviseScoreThreshold(),
      onProgress: hooks.onProgress,
      shouldCancel: hooks.shouldCancel,
    });

    try {
      await recordRevisionEntry(paths, {
        sceneStem,
        checkedAt: new Date().toISOString(),
        revisionCount: result.revisionCount,
        remainingBlocking: result.remainingBlocking,
        instructions: result.instructions,
        preservedOriginal: result.preservedOriginal,
        rejection: result.rejection,
      });
    } catch (error) {
      this.logger.warn(
        `revision-plan.yaml 기록에 실패했습니다: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return result;
  }
}
