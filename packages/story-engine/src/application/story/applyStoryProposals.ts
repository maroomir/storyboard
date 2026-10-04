import {
  backgroundCardPath,
  characterCardPath,
  getStoryboardProjectPaths,
  joinStoryPath,
  serializeCard,
  type StoryUri,
} from '@storyboard/story-model';

import type { IFileSystem } from '#engine/ports/fileSystem';
import { applyStoryCardChanges, type StoryCardTarget } from './buildStoryCardsUseCase';
import type { CompletedStoryScene } from './completeStoryScenesUseCase';

export interface ApplyStoryCardTargetsResult {
  readonly writtenIds: readonly string[];
  // New cards whose name yields no id. An editor asks a person; an unattended caller reports
  // the names instead of filing them under a guessed id.
  readonly needsIdNames: readonly string[];
}

export interface ApplyCompletedScenesResult {
  readonly writtenFileNames: readonly string[];
  // Completion scenes are appended after the last number; one that would replace an existing
  // file is left alone, or the scene already written there would be lost.
  readonly skippedFileNames: readonly string[];
}

export interface ApplyStoryProposalsDependencies {
  readonly fileSystem: IFileSystem;
}

// The write half of `card build` and `scene complete`: every change the proposal holds, applied
// without a review step. A host that reviews first (the editor) picks its own subset instead.
export class ApplyStoryProposals {
  public constructor(private readonly deps: ApplyStoryProposalsDependencies) {}

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

      const card = applyStoryCardChanges(
        target,
        target.changes.map((change) => change.proposal),
      );
      const uri =
        card.type === 'character'
          ? characterCardPath(workspaceRoot, card.id)
          : backgroundCardPath(workspaceRoot, card.id);

      await this.deps.fileSystem.writeFile(uri, new TextEncoder().encode(serializeCard(card)));
      writtenIds.push(card.id);
    }

    return { writtenIds, needsIdNames };
  }

  public async applyCompletedScenes(
    workspaceRoot: StoryUri,
    scenes: readonly CompletedStoryScene[],
  ): Promise<ApplyCompletedScenesResult> {
    const { fileSystem } = this.deps;
    const { sceneDirectory } = getStoryboardProjectPaths(workspaceRoot);
    const writtenFileNames: string[] = [];
    const skippedFileNames: string[] = [];

    await fileSystem.createDirectory(sceneDirectory);

    for (const scene of scenes) {
      const uri = joinStoryPath(sceneDirectory, scene.fileName);

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
