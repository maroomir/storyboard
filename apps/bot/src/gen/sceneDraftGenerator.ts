import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { storyboardRelativePaths } from '@seedkernel/wasm';
import { buildNarrativeContext, buildSceneContext, formatBibleFactLines, type SceneContextWorkspaceFileSystem, type SceneContextWorkspacePaths } from '../../../desktop/src/domain/sceneContext';
import { buildStyleDirective, formatAugmentCards } from '@storyboard/story-ai';
import type {
  AiProviderRegistry,
  StoryboardAIService,
  UsageAttribution,
} from '@storyboard/story-ai';
import {
  resolveSceneTargetLength,
  runReviseLoop,
  runSceneGenerationPipeline,
} from '@storyboard/story-pipeline';

import type { DraftConfig } from '../config/config';
import type { ContentService } from '../content/contentService';
import type { WorkspaceStore } from '../workspace/workspaceStore';
import { createBackgroundMemoryStore, createPersonaMemoryStore } from './cardMemoryStores';
import type { DraftGenerator } from './draftPipeline';
import type { DraftReviser, DraftRevisionReport } from './reviewPipeline';

// The scene-context helpers take opaque `unknown` locations so the extension can pass vscode.Uri.
// Headless, the location is simply an absolute path string.
function createPaths(root: string): SceneContextWorkspacePaths {
  const at = (relative: string): string => join(root, ...relative.split('/'));

  return {
    characterDirectory: at(storyboardRelativePaths().characterDirectory),
    backgroundDirectory: at(storyboardRelativePaths().backgroundDirectory),
    draftDirectory: at(storyboardRelativePaths().draftDirectory),
    bibleCanon: at(storyboardRelativePaths().bibleCanon),
    manuscriptSummary: join(at(storyboardRelativePaths().manuscriptDirectory), 'SUMMARY.md'),
    joinPath: (base, ...segments) => join(String(base), ...segments),
  };
}

function createFileSystem(): SceneContextWorkspaceFileSystem {
  return {
    readFile: async (uri) => new Uint8Array(await readFile(String(uri))),
    writeFile: () => {
      // Context building is read-only; writes go through the mutate gate, never here.
      throw new Error('scene context must not write');
    },
    readDirectory: async (uri) => {
      const entries = await readdir(String(uri), { withFileTypes: true });
      return entries.map((entry): [string, { type: 'file' | 'directory' }] => [
        entry.name,
        { type: entry.isDirectory() ? 'directory' : 'file' },
      ]);
    },
  };
}

export interface SceneDraftGeneratorOptions {
  readonly store: WorkspaceStore;
  readonly content: ContentService;
  readonly aiService: StoryboardAIService;
  readonly registry: AiProviderRegistry;
  readonly draftConfig: DraftConfig;
  readonly onStage?: (stage: string, current: number, total: number) => void;
}

// Runs the very same staged pipeline the extension runs, assembled from the workspace on disk, and
// finishes with the shared review→revise loop (decision #31) before the body is written.
export class SceneDraftGenerator implements DraftGenerator, DraftReviser {
  public constructor(private readonly options: SceneDraftGeneratorOptions) {}

  public async generate(sceneStem: string, isCancelled: () => boolean): Promise<string> {
    const { store, content, aiService } = this.options;
    const assembled = await this.assembleSceneContext(sceneStem);

    const result = await runSceneGenerationPipeline({
      context: assembled.context,
      aiService,
      format: assembled.format,
      sceneStem,
      styleDirective: assembled.styleDirective,
      previousContext: assembled.narrative.prompt,
      personaStore: createPersonaMemoryStore(store, content, sceneStem),
      backgroundStore: createBackgroundMemoryStore(store, content, sceneStem),
      shouldCancel: isCancelled,
      onProgress: (stage, current, total) => this.options.onStage?.(stage, current, total),
    });

    if (!this.options.draftConfig.reviseAfterGenerate || isCancelled()) {
      return result.draftBody;
    }

    const revised = await this.runSharedReviseLoop(
      sceneStem,
      result.draftBody,
      assembled,
      isCancelled,
    );
    return revised.body;
  }

  // The /review command: runs the same review→revise loop over the draft that already exists,
  // without regenerating it (UC-06).
  public async revise(
    sceneStem: string,
    draftBody: string,
    isCancelled: () => boolean,
  ): Promise<DraftRevisionReport> {
    const assembled = await this.assembleSceneContext(sceneStem);
    const revised = await this.runSharedReviseLoop(sceneStem, draftBody, assembled, isCancelled);

    return {
      body: revised.body,
      passed: revised.passed,
      revisionCount: revised.revisionCount,
      remainingBlocking: revised.remainingBlocking,
      cancelled: revised.cancelled,
    };
  }

  private async assembleSceneContext(sceneStem: string): Promise<AssembledSceneContext> {
    const { store } = this.options;
    const scene = await store.readScene(sceneStem);
    const project = await store.readProject();

    const paths = createPaths(store.root);
    const fileSystem = createFileSystem();
    const context = await buildSceneContext(paths, scene.value, fileSystem);
    const narrative = await buildNarrativeContext(paths, context, fileSystem);

    return {
      scene: scene.value,
      project: project.value,
      context,
      narrative,
      format: project.value.format ?? 'novel',
      styleDirective: buildStyleDirective(
        project.value.setting,
        scene.value.frontmatter.relationStage,
        scene.value.frontmatter.targetWordCount,
      ),
    };
  }

  private runSharedReviseLoop(
    sceneStem: string,
    body: string,
    assembled: AssembledSceneContext,
    isCancelled: () => boolean,
  ): ReturnType<typeof runReviseLoop> {
    const { aiService, registry } = this.options;
    const attribution: UsageAttribution = { primary: { kind: 'scene', id: sceneStem } };

    return runReviseLoop({
      aiService,
      registry,
      attribution,
      ctx: {
        format: assembled.format,
        intent: assembled.scene.body,
        factLines: formatBibleFactLines(assembled.context, assembled.narrative.bibleFacts),
        characterNames: assembled.context.characters.map((character) => character.name),
        characterCards: formatAugmentCards(assembled.context.characters, undefined),
        styleConstraints: assembled.project.setting?.styleConstraints ?? [],
        qualityCriteria: assembled.project.setting?.qualityCriteria ?? [],
        styleDirective: assembled.styleDirective,
        characters: assembled.context.characters,
        targetLength: resolveSceneTargetLength(
          assembled.scene.frontmatter.targetWordCount,
          assembled.scene.body,
        ),
      },
      body,
      maxIterations: this.options.draftConfig.reviseMaxIterations,
      reviseScoreThreshold: 0,
      maxCompressionPercent: 50,
      shouldCancel: isCancelled,
      onProgress: (message) => this.options.onStage?.(message, 0, 0),
    });
  }
}

interface AssembledSceneContext {
  readonly scene: Awaited<ReturnType<WorkspaceStore['readScene']>>['value'];
  readonly project: Awaited<ReturnType<WorkspaceStore['readProject']>>['value'];
  readonly context: Awaited<ReturnType<typeof buildSceneContext>>;
  readonly narrative: Awaited<ReturnType<typeof buildNarrativeContext>>;
  readonly format: NonNullable<
    Awaited<ReturnType<WorkspaceStore['readProject']>>['value']['format']
  >;
  readonly styleDirective: ReturnType<typeof buildStyleDirective>;
}
