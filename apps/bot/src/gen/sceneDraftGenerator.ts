import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  STORYBOARD_RELATIVE_PATHS,
  buildNarrativeContext,
  buildSceneContext,
  formatBibleFactLines,
  type SceneContextWorkspaceFileSystem,
  type SceneContextWorkspacePaths,
} from '@storyboard/story-format';
import { buildStyleDirective, formatAugmentCards } from '@storyboard/story-ai';
import type { AiProviderRegistry, StoryboardAIService, UsageAttribution } from '@storyboard/story-ai';
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

// The scene-context helpers take opaque `unknown` locations so the extension can pass vscode.Uri.
// Headless, the location is simply an absolute path string.
function createPaths(root: string): SceneContextWorkspacePaths {
  const at = (relative: string): string => join(root, ...relative.split('/'));

  return {
    characterDirectory: at(STORYBOARD_RELATIVE_PATHS.characterDirectory),
    backgroundDirectory: at(STORYBOARD_RELATIVE_PATHS.backgroundDirectory),
    draftDirectory: at(STORYBOARD_RELATIVE_PATHS.draftDirectory),
    bibleCanon: at(STORYBOARD_RELATIVE_PATHS.bibleCanon),
    manuscriptSummary: join(at(STORYBOARD_RELATIVE_PATHS.manuscriptDirectory), 'SUMMARY.md'),
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
export class SceneDraftGenerator implements DraftGenerator {
  public constructor(private readonly options: SceneDraftGeneratorOptions) {}

  public async generate(sceneStem: string, isCancelled: () => boolean): Promise<string> {
    const { store, content, aiService, registry } = this.options;
    const scene = await store.readScene(sceneStem);
    const project = await store.readProject();

    const paths = createPaths(store.root);
    const fileSystem = createFileSystem();
    const context = await buildSceneContext(paths, scene.value, fileSystem);
    const narrative = await buildNarrativeContext(paths, context, fileSystem);

    const format = project.value.format ?? 'novel';
    const styleDirective = buildStyleDirective(
      project.value.setting,
      scene.value.frontmatter.relationStage,
      scene.value.frontmatter.targetWordCount,
    );

    const result = await runSceneGenerationPipeline({
      context,
      aiService,
      format,
      sceneStem,
      styleDirective,
      previousContext: narrative.prompt,
      personaStore: createPersonaMemoryStore(store, content, sceneStem),
      backgroundStore: createBackgroundMemoryStore(store, content, sceneStem),
      shouldCancel: isCancelled,
      onProgress: (stage, current, total) => this.options.onStage?.(stage, current, total),
    });

    if (!this.options.draftConfig.reviseAfterGenerate || isCancelled()) {
      return result.draftBody;
    }

    const attribution: UsageAttribution = { primary: { kind: 'scene', id: sceneStem } };
    const revised = await runReviseLoop({
      aiService,
      registry,
      attribution,
      ctx: {
        format,
        intent: scene.value.body,
        factLines: formatBibleFactLines(context, narrative.bibleFacts),
        characterNames: context.characters.map((character) => character.name),
        characterCards: formatAugmentCards(context.characters, undefined),
        styleConstraints: project.value.setting?.styleConstraints ?? [],
        qualityCriteria: project.value.setting?.qualityCriteria ?? [],
        styleDirective,
        characters: context.characters,
        targetLength: resolveSceneTargetLength(
          scene.value.frontmatter.targetWordCount,
          scene.value.body,
        ),
      },
      body: result.draftBody,
      maxIterations: this.options.draftConfig.reviseMaxIterations,
      reviseScoreThreshold: 0,
      maxCompressionPercent: 50,
      shouldCancel: isCancelled,
      onProgress: (message) => this.options.onStage?.(message, 0, 0),
    });

    return revised.body;
  }
}
