import { SceneContextReader } from '#engine/persistence/sceneContextReader';
import {
  computeSceneInputHash,
  deriveSceneGrounding,
  sceneContextPaths,
  sceneNarrationHashInput,
} from '@storyboard/story-model';
import type {
  BibleFact,
  ProjectFormat,
  SceneContext,
  SceneContextWorkspacePaths,
  SceneFile,
  StoryboardProjectPaths,
  StoryUri,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { ChapterSummaryLedger } from '#engine/persistence/cache/chapterSummaryLedger';
import type { WorkspaceCards } from '#engine/persistence/bundles/workspaceCards';
import type { WorkspaceScenes } from '#engine/persistence/bundles/workspaceScenes';

export interface SceneInputHasherDependencies {
  readonly fileSystem: IFileSystem;
  readonly cards: WorkspaceCards;
  readonly scenes: WorkspaceScenes;
  readonly summaries: ChapterSummaryLedger;
}

export interface SceneInputHashSettings {
  readonly format: ProjectFormat;
  readonly sceneBreakJoiner: string | undefined;
}

export function memoizeFileReads(fileSystem: IFileSystem): IFileSystem {
  const reads: Map<string, Promise<Uint8Array<ArrayBufferLike>>> = new Map<
    string,
    Promise<Uint8Array>
  >();

  return {
    readFile: (uri: StoryUri): Promise<Uint8Array> => {
      const cached: Promise<Uint8Array<ArrayBufferLike>> | undefined = reads.get(uri.path);
      if (cached) {
        return cached;
      }

      const pending: Promise<Uint8Array> = fileSystem.readFile(uri);
      reads.set(uri.path, pending);
      return pending;
    },
    writeFile: (uri, content) => fileSystem.writeFile(uri, content),
    createDirectory: (uri) => fileSystem.createDirectory(uri),
    exists: (uri) => fileSystem.exists(uri),
    listFileNames: (uri) => fileSystem.listFileNames(uri),
    readDirectory: (uri) => fileSystem.readDirectory(uri),
    delete: (uri) => fileSystem.delete(uri),
    modifiedTime: (uri) => fileSystem.modifiedTime(uri),
    isRealPathInside: (uri, root) => fileSystem.isRealPathInside(uri, root),
  };
}

export class SceneInputHasher {
  public constructor(private readonly dependencies: SceneInputHasherDependencies) {}

  public async computeCurrent(
    paths: StoryboardProjectPaths,
    stem: string,
    settings: SceneInputHashSettings,
  ): Promise<string | undefined> {
    try {
      const scene: SceneFile | undefined = await this.dependencies.scenes.read(paths.workspaceRoot, stem);
      return scene === undefined ? undefined : await this.computeFor(paths, scene, settings);
    } catch {
      return undefined;
    }
  }

  private async computeFor(
    paths: StoryboardProjectPaths,
    scene: SceneFile,
    settings: SceneInputHashSettings,
  ): Promise<string> {
    const { fileSystem, cards, scenes, summaries } = this.dependencies;
    const reader: SceneContextReader = new SceneContextReader(fileSystem, cards, scenes, summaries);
    const ctxPaths: SceneContextWorkspacePaths = sceneContextPaths(paths);
    const context: SceneContext = await reader.build(ctxPaths, scene);
    const bibleFacts: readonly BibleFact[] = await reader.resolveBibleFacts(ctxPaths, context);

    return computeSceneInputHash({
      sceneBody: context.scene.body,
      characters: context.characters,
      background: context.background,
      format: settings.format,
      bibleFacts,
      sceneBreakJoiner: settings.sceneBreakJoiner,
      grounding: deriveSceneGrounding(context.scene, context.background),
      narration: sceneNarrationHashInput(context.scene),
    });
  }
}
