import type * as vscode from 'vscode';

import type { AiGateway } from '../ai/aiGateway';
import type { StoryboardLogger } from '../../infrastructure/vscode/logger';
import { getStoryboardProjectPaths } from '../../infrastructure/vscode/pathConventions';
import {
  buildNarrativeContext,
  buildSceneContext,
  formatBibleFactLines,
  type SceneContext,
} from '../../domain/sceneContext';
import {
  sceneContextFileSystem,
  sceneContextPaths,
  vscodeFsAdapter,
} from '../../infrastructure/vscode/workspaceFsAdapters';
import { readProjectJson } from '../../infrastructure/persistence/projectJson';
import { readSceneFile, SceneParseError } from '../../domain/files/scene';
import {
  formatAugmentCards,
  type DraftAugmentScope,
} from '../../infrastructure/ai/prompts/draftAugment';
import type { BibleFact } from '../../shared/bible';
import type { ProjectFormat } from '../../shared/project';

type AugmentContextResult =
  | {
      readonly bibleFacts: readonly BibleFact[];
      readonly format: ProjectFormat;
      readonly ok: true;
      readonly sceneContext: SceneContext;
    }
  | { readonly message: string; readonly ok: false };

export type AugmentDraftRequest = {
  readonly draftSceneStem: string;
  readonly instruction?: string;
  readonly sceneUri: vscode.Uri;
  readonly scope: DraftAugmentScope;
  readonly target: string;
  readonly workspaceRoot: vscode.Uri;
};

export type AugmentDraftResult =
  | { readonly kind: 'augmented'; readonly ok: true; readonly text: string }
  | { readonly kind: 'empty'; readonly ok: false }
  | { readonly kind: 'failed'; readonly message: string; readonly ok: false };

export class AugmentDraftUseCase {
  public constructor(
    private readonly aiGateway: AiGateway,
    private readonly logger: StoryboardLogger,
  ) {}

  public async execute(request: AugmentDraftRequest): Promise<AugmentDraftResult> {
    const context = await this.loadContext(request.sceneUri, request.workspaceRoot);

    if (!context.ok) {
      return { kind: 'failed', message: context.message, ok: false };
    }

    try {
      const text = await this.aiGateway.createService(request.workspaceRoot).augmentDraft(
        {
          target: request.target,
          scope: request.scope,
          format: context.format,
          cards: formatAugmentCards(
            context.sceneContext.characters,
            context.sceneContext.background,
          ),
          facts: formatBibleFactLines(context.sceneContext, context.bibleFacts),
          intent: context.sceneContext.scene.body,
          instruction: request.instruction,
        },
        {
          providerId: this.aiGateway.getTaskProvider('draftAugment'),
          attribution: { primary: { kind: 'scene', id: request.draftSceneStem } },
        },
      );

      return text.trim().length === 0
        ? { kind: 'empty', ok: false }
        : { kind: 'augmented', ok: true, text };
    } catch (error) {
      this.logger.error('Augment draft failed', error);

      return {
        kind: 'failed',
        message: error instanceof Error ? error.message : String(error),
        ok: false,
      };
    }
  }

  private async loadContext(
    sceneUri: vscode.Uri,
    workspaceRoot: vscode.Uri,
  ): Promise<AugmentContextResult> {
    const fileName = sceneUri.path.split('/').pop() ?? '';

    let scene;
    try {
      scene = await readSceneFile(sceneUri, vscodeFsAdapter, fileName);
    } catch (error) {
      return error instanceof SceneParseError
        ? { message: `연결된 씬 파일을 읽을 수 없습니다: ${error.message}`, ok: false }
        : { message: '연결된 씬 파일을 찾을 수 없습니다.', ok: false };
    }

    const paths = getStoryboardProjectPaths(workspaceRoot);
    let project;
    try {
      project = await readProjectJson(paths.projectJson);
    } catch {
      return { message: 'project.json을 읽을 수 없습니다.', ok: false };
    }

    const contextPaths = sceneContextPaths(paths);
    let sceneContext;
    try {
      sceneContext = await buildSceneContext(contextPaths, scene, sceneContextFileSystem);
    } catch {
      return { message: '씬 컨텍스트를 구성하지 못했습니다.', ok: false };
    }

    const narrativeContext = await buildNarrativeContext(
      contextPaths,
      sceneContext,
      sceneContextFileSystem,
    );

    return {
      bibleFacts: narrativeContext.bibleFacts,
      format: project.format,
      ok: true,
      sceneContext,
    };
  }
}
