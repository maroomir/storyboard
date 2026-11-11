import type { HostAdapters } from '#engine/application/engineServices';
import {
  parseSceneCard,
  parseSceneFileName,
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
    const writtenFileNames: string[] = [];
    const skippedFileNames: string[] = [];

    for (const scene of scenes) {
      const slug: string | undefined = parseSceneFileName(scene.fileName)?.slug;

      if (slug === undefined || (await this.host.scenes.find(workspaceRoot, slug)) !== undefined) {
        skippedFileNames.push(scene.fileName);
        continue;
      }

      await this.host.scenes.writeCard(workspaceRoot, parseSceneCard(scene.content), {
        source: studioSource,
        slug,
      });
      writtenFileNames.push(scene.fileName);
    }

    return { writtenFileNames, skippedFileNames };
  }
}
