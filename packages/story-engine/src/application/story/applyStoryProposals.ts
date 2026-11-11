import type { HostAdapters } from '#engine/application/engineServices';
import {
  getStoryboardProjectPaths,
  joinStoryPath,
  type StatementSource,
  type StoryboardCard,
  type StoryUri,
} from '@storyboard/story-model';

import { applyStoryCardChanges, type StoryCardTarget } from '#engine/application/story/buildStoryCardsUseCase';
import type { CompletedStoryScene } from '#engine/application/story/completeStoryScenesUseCase';

export interface ApplyStoryCardTargetsResult {
  readonly writtenIds: readonly string[];
  readonly needsIdNames: readonly string[];
}

export interface ApplyCompletedScenesResult {
  readonly writtenFileNames: readonly string[];
  readonly skippedFileNames: readonly string[];
}

const studioSource: StatementSource = { origin: 'studio' };

export class ApplyStoryProposals {
  public constructor(private readonly host: HostAdapters) {}

  public async applyCardTargets(
    workspaceRoot: StoryUri,
    targets: readonly StoryCardTarget[],
  ): Promise<ApplyStoryCardTargetsResult> {
    const writtenIds: string[] = [];
    const needsIdNames: string[] = [];
    const cardsToWrite: StoryboardCard[] = [];

    for (const target of targets) {
      if (target.isNew && target.requiresIdConfirmation) {
        needsIdNames.push(target.card.name);
        continue;
      }

      const card: StoryboardCard = applyStoryCardChanges(
        target,
        target.changes.map((change) => change.proposal),
      );
      cardsToWrite.push(card);
      writtenIds.push(card.id);
    }

    await this.host.cards.writeCards(workspaceRoot, cardsToWrite, studioSource);

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
