import {
  listThreadScenes,
  type SceneStoryState,
  type StoryStructure,
  type StructureSceneEntry,
} from '@storyboard/story-model';

import type {
  ElementIndexStore,
  IndexedElement,
} from '#engine/persistence/cache/elementIndexStore';
import type { SceneBundleFiles } from '#engine/persistence/bundles/sceneBundleFiles';

export interface LedgerSceneState {
  readonly sceneId: string;
  readonly scenePath: string;
  readonly state: SceneStoryState;
}

export interface ThreadLedgerReaderDependencies {
  readonly sceneFiles: SceneBundleFiles;
  readonly index: ElementIndexStore;
}

export interface ThreadLedgerRequest {
  readonly structure: StoryStructure;
  readonly threadId: string;
  readonly beforeSceneId?: string;
}

export class ThreadLedgerReader {
  public constructor(private readonly dependencies: ThreadLedgerReaderDependencies) {}

  public async readThread(request: ThreadLedgerRequest): Promise<readonly LedgerSceneState[]> {
    const ledger: LedgerSceneState[] = [];
    for (const entry of this.listScenesBefore(request)) {
      const scenePath: string | undefined = this.findScenePath(entry.scene);
      const state: SceneStoryState | undefined =
        scenePath === undefined
          ? undefined
          : await this.dependencies.sceneFiles.readState(scenePath);
      if (scenePath !== undefined && state !== undefined) {
        ledger.push({ sceneId: entry.scene, scenePath, state });
      }
    }

    return ledger;
  }

  private listScenesBefore(request: ThreadLedgerRequest): readonly StructureSceneEntry[] {
    const threadScenes: readonly StructureSceneEntry[] = listThreadScenes(
      request.structure,
      request.threadId,
    );
    const stopIndex: number = threadScenes.findIndex(
      (entry) => entry.scene === request.beforeSceneId,
    );

    return stopIndex === -1 ? threadScenes : threadScenes.slice(0, stopIndex);
  }

  private findScenePath(sceneId: string): string | undefined {
    const scene: IndexedElement | undefined = this.dependencies.index
      .findById(sceneId)
      .find((element) => element.kind === 'scene');

    return scene?.path;
  }
}
