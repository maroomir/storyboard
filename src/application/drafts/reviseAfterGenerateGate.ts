import * as vscode from 'vscode';

import type { StoryboardLogger } from '../../infrastructure/vscode/logger';
import { draftPath, getStoryboardProjectPaths } from '../../infrastructure/vscode/pathConventions';
import { recordRevisionEntry } from '../../infrastructure/persistence/revisionPlanRecorder';
import { uriExists } from '../../infrastructure/vscode/workspace';
import type { ConfigBridge } from '../../infrastructure/settings/ConfigBridge';
import { parseSceneFileName } from '../../shared/scene';
import type { ReviseDraftUseCase, ReviseDraftWorkflowResult } from './reviseDraftUseCase';

const DEFAULT_MAX_ITERATIONS = 2;
const MIN_MAX_ITERATIONS = 1;
const MAX_MAX_ITERATIONS = 5;

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
  ): Promise<void> {
    if (!this.configBridge.isReviseAfterGenerateEnabled() || hooks.shouldCancel?.()) {
      return;
    }

    const folder = vscode.workspace.getWorkspaceFolder(sceneUri);
    const sceneStem = parseSceneFileName(sceneUri.path.split('/').at(-1) ?? '')?.stem;

    if (!folder || !sceneStem) {
      return;
    }

    hooks.onWillRun?.();
    await this.runForScene(folder.uri, sceneStem, hooks);
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
      maxIterations: resolveReviseMaxIterations(),
      reviseScoreThreshold: resolveReviseScoreThreshold(),
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
      });
    } catch (error) {
      this.logger.warn(
        `revision-plan.yaml 기록에 실패했습니다: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return result;
  }
}

export function resolveReviseMaxIterations(): number {
  const configured = vscode.workspace
    .getConfiguration('storyboard')
    .get<number>('draft.reviseMaxIterations', DEFAULT_MAX_ITERATIONS);
  const value = Math.floor(Number.isFinite(configured) ? configured : DEFAULT_MAX_ITERATIONS);

  return Math.min(MAX_MAX_ITERATIONS, Math.max(MIN_MAX_ITERATIONS, value));
}

function resolveReviseScoreThreshold(): number {
  const configured = vscode.workspace
    .getConfiguration('storyboard')
    .get<number>('draft.reviseScoreThreshold', 0);
  const value = Math.floor(Number.isFinite(configured) ? configured : 0);

  return Math.min(100, Math.max(0, value));
}
