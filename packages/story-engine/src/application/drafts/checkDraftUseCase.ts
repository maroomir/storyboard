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
  type SlopFinding,
  type StoryUri,
} from '@storyboard/story-model';

import type { AiGateway } from '#engine/application/ai/aiGateway';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { IStoryboardLogger } from '#engine/ports/logger';
import { runUseCase, type IUseCase, type UseCaseFailure } from '#engine/application/useCase';

export const draftCheckKinds = ['grammar', 'continuity', 'slop'] as const;

export type DraftCheckKind = (typeof draftCheckKinds)[number];

export interface CheckDraftRequest {
  readonly workspaceRoot: StoryUri;
  readonly sceneStem: string;
  readonly kind: DraftCheckKind;
  // The text to check, as the host holds it: the saved draft's body for the CLI, the editor's
  // unsaved buffer for the extension. Offsets in the findings are offsets into this text.
  readonly text: string;
}

export type CheckDraftResult =
  | { readonly ok: true; readonly kind: 'grammar'; readonly issues: readonly GrammarIssue[] }
  | {
      readonly ok: true;
      readonly kind: 'continuity';
      readonly issues: readonly ContinuityIssue[];
      // No canon fact applies to this scene, so nothing was sent to the model.
      readonly hasFacts: boolean;
    }
  | { readonly ok: true; readonly kind: 'slop'; readonly findings: readonly SlopFinding[] }
  | UseCaseFailure;

export interface CheckDraftUseCaseDependencies {
  readonly aiGateway: AiGateway;
  readonly fileSystem: IFileSystem;
  readonly logger: IStoryboardLogger;
}

// The three draft checks every host runs: grammar and continuity through the task's provider,
// slop deterministically. Continuity is checked against the canon facts the scene's context
// selects, so the same scene gets the same facts in the editor and the terminal.
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
    const attribution = { primary: { kind: 'scene' as const, id: request.sceneStem } };

    switch (request.kind) {
      case 'slop':
        return { ok: true, kind: 'slop', findings: analyzeSlop(request.text) };

      case 'grammar': {
        const issues = await aiGateway
          .createService(request.workspaceRoot)
          .checkGrammar(request.text, {
            providerId: aiGateway.getTaskProvider('grammarCheck'),
            attribution,
          });
        return { ok: true, kind: 'grammar', issues };
      }

      case 'continuity': {
        const factLines = await this.loadCanonFactLines(request.workspaceRoot, request.sceneStem);

        if (factLines.length === 0) {
          return { ok: true, kind: 'continuity', issues: [], hasFacts: false };
        }

        const issues = await aiGateway
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
    const paths = getStoryboardProjectPaths(workspaceRoot);
    const scene = await readSceneFile(
      scenePath(workspaceRoot, sceneStem),
      fileSystem,
      `${sceneStem}.card`,
    );
    const contextPaths = sceneContextPaths(paths);
    const context = await buildSceneContext(contextPaths, scene, fileSystem);
    const narrative = await buildNarrativeContext(contextPaths, context, fileSystem);

    return formatBibleFactLines(context, narrative.bibleFacts);
  }
}
