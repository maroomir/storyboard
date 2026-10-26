import type { HostAdapters } from '#engine/application/engineServices';
import {
  backgroundCardPath,
  characterCardPath,
  getStoryboardProjectPaths,
  joinStoryPath,
  serializeCard,
  type StoryboardCard,
  type StoryUri,
} from '@storyboard/story-model';

import { applyStoryCardChanges, type StoryCardTarget } from './buildStoryCardsUseCase';
import type { CompletedStoryScene } from './completeStoryScenesUseCase';

export interface ApplyStoryCardTargetsResult {
  readonly writtenIds: readonly string[];
  readonly needsIdNames: readonly string[];
}

export interface ApplyCompletedScenesResult {
  readonly writtenFileNames: readonly string[];
  readonly skippedFileNames: readonly string[];
}

export class ApplyStoryProposals {
  public constructor(private readonly host: HostAdapters) {}

  public async applyCardTargets(
    workspaceRoot: StoryUri,
    targets: readonly StoryCardTarget[],
  ): Promise<ApplyStoryCardTargetsResult> {
    const writtenIds: string[] = [];
    const needsIdNames: string[] = [];

    for (const target of targets) {
      if (target.isNew && target.requiresIdConfirmation) {
        needsIdNames.push(target.card.name);
        continue;
      }

      const card: StoryboardCard = applyStoryCardChanges(
        target,
        target.changes.map((change) => change.proposal),
      );
      const uri: StoryUri =
        card.type === 'character'
          ? characterCardPath(workspaceRoot, card.id)
          : backgroundCardPath(workspaceRoot, card.id);

      await this.host.fileSystem.writeFile(uri, new TextEncoder().encode(serializeCard(card)));
      writtenIds.push(card.id);
    }

    return { writtenIds, needsIdNames };
  }

  public async applyCompletedScenes(
    workspaceRoot: StoryUri,
    scenes: readonly CompletedStoryScene[],
  ): Promise<ApplyCompletedScenesResult> {
    const { fileSystem } = this.host;
    const { sceneDirectory } = getStoryboardProjectPaths(workspaceRoot);
    const writtenFileNames: string[] = [];
    const skippedFileNames: string[] = [];

    await fileSystem.createDirectory(sceneDirectory);

    for (const scene of scenes) {
      const uri: StoryUri = joinStoryPath(sceneDirectory, scene.fileName);

      if (await fileSystem.exists(uri)) {
        skippedFileNames.push(scene.fileName);
        continue;
      }

      await fileSystem.writeFile(uri, new TextEncoder().encode(scene.content));
      writtenFileNames.push(scene.fileName);
    }

    return { writtenFileNames, skippedFileNames };
  }
}
