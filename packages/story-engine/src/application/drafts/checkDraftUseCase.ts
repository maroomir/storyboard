import type { ContinuityIssue, GrammarIssue } from '@storyboard/story-ai';
import {
  analyzeSlop,
  buildNarrativeContext,
  buildSceneContext,
  formatBibleFactLines,
  getStoryboardProjectPaths,
  readSceneFile,
  sceneContextPaths,
  scenePath,
  type NarrativeContext,
  type SceneContext,
  type SceneContextWorkspacePaths,
  type SceneFile,
  type SlopFinding,
  type StoryboardProjectPaths,
  type StoryUri,
  type UsageAttribution,
} from '@storyboard/story-model';

import type { AiGateway } from '#engine/application/ai/aiGateway';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { IStoryboardLogger } from '#engine/ports/logger';
import { runUseCase, type IUseCase, type UseCaseFailure } from '#engine/application/useCase';

export type DraftCheckKind = 'grammar' | 'continuity' | 'slop';

export const draftCheckKinds: readonly [DraftCheckKind, ...DraftCheckKind[]] = [
  'grammar',
  'continuity',
  'slop',
];

export interface CheckDraftRequest {
  readonly workspaceRoot: StoryUri;
  readonly sceneStem: string;
  readonly kind: DraftCheckKind;
  readonly text: string;
}

export type CheckDraftResult =
  | { readonly ok: true; readonly kind: 'grammar'; readonly issues: readonly GrammarIssue[] }
  | {
      readonly ok: true;
      readonly kind: 'continuity';
      readonly issues: readonly ContinuityIssue[];
      readonly hasFacts: boolean;
    }
  | { readonly ok: true; readonly kind: 'slop'; readonly findings: readonly SlopFinding[] }
  | UseCaseFailure;

export interface CheckDraftUseCaseDependencies {
  readonly aiGateway: AiGateway;
  readonly fileSystem: IFileSystem;
  readonly logger: IStoryboardLogger;
}

export class CheckDraftUseCase implements IUseCase<CheckDraftRequest, CheckDraftResult> {
  public constructor(private readonly deps: CheckDraftUseCaseDependencies) {}

  public async execute(request: CheckDraftRequest): Promise<CheckDraftResult> {
    return await runUseCase<CheckDraftResult>(
      this.deps.logger,
      `Draft ${request.kind} check failed`,
      () => this.check(request),
    );
  }

  private async check(request: CheckDraftRequest): Promise<CheckDraftResult> {
    const { aiGateway } = this.deps;
    const attribution: UsageAttribution = { primary: { kind: 'scene', id: request.sceneStem } };

    switch (request.kind) {
      case 'slop':
        return { ok: true, kind: 'slop', findings: analyzeSlop(request.text) };

      case 'grammar': {
        const issues: GrammarIssue[] = await aiGateway
          .createService(request.workspaceRoot)
          .checkGrammar(request.text, {
            providerId: aiGateway.getTaskProvider('grammarCheck'),
            attribution,
          });
        return { ok: true, kind: 'grammar', issues };
      }

      case 'continuity': {
        const factLines: readonly string[] = await this.loadCanonFactLines(
          request.workspaceRoot,
          request.sceneStem,
        );

        if (factLines.length === 0) {
          return { ok: true, kind: 'continuity', issues: [], hasFacts: false };
        }

        const issues: ContinuityIssue[] = await aiGateway
          .createService(request.workspaceRoot)
          .checkContinuity(request.text, factLines, {
            providerId: aiGateway.getTaskProvider('continuityCheck'),
            attribution,
          });
        return { ok: true, kind: 'continuity', issues, hasFacts: true };
      }
    }
  }

  private async loadCanonFactLines(
    workspaceRoot: StoryUri,
    sceneStem: string,
  ): Promise<readonly string[]> {
    const { fileSystem } = this.deps;
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    const scene: SceneFile = await readSceneFile(
      scenePath(workspaceRoot, sceneStem),
      fileSystem,
      `${sceneStem}.card`,
    );
    const contextPaths: SceneContextWorkspacePaths = sceneContextPaths(paths);
    const context: SceneContext = await buildSceneContext(contextPaths, scene, fileSystem);
    const narrative: NarrativeContext = await buildNarrativeContext(
      contextPaths,
      context,
      fileSystem,
    );

    return formatBibleFactLines(context, narrative.bibleFacts);
  }
}
