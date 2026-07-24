import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  STORYBOARD_RELATIVE_PATHS,
  buildSceneContext,
  type SceneContextWorkspaceFileSystem,
  type SceneContextWorkspacePaths,
} from '@storyboard/story-format';
import type { StoryboardAIService } from '@storyboard/story-ai';
import { runSceneGenerationPipeline } from '@storyboard/story-pipeline';

import type { WorkspaceStore } from '../workspace/workspaceStore';
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
  readonly aiService: StoryboardAIService;
  readonly onStage?: (stage: string, current: number, total: number) => void;
}

// Runs the very same staged pipeline the extension runs, assembled from the workspace on disk.
export class SceneDraftGenerator implements DraftGenerator {
  public constructor(private readonly options: SceneDraftGeneratorOptions) {}

  public async generate(sceneStem: string, isCancelled: () => boolean): Promise<string> {
    const scene = await this.options.store.readScene(sceneStem);
    const project = await this.options.store.readProject();

    const context = await buildSceneContext(
      createPaths(this.options.store.root),
      scene.value,
      createFileSystem(),
    );

    const result = await runSceneGenerationPipeline({
      context,
      aiService: this.options.aiService,
      format: project.value.format ?? 'novel',
      sceneStem,
      shouldCancel: isCancelled,
      onProgress: (stage, current, total) => this.options.onStage?.(stage, current, total),
    });

    return result.draftBody;
  }
}
