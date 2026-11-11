import type { HostAdapters } from '#engine/application/engineServices';
import { randomUUID } from 'node:crypto';

import {
  replacePendingHeader,
  replacePendingStatements,
  parseSceneCard,
  parseSceneFileName,
  type StatementSource,
  type StoryboardCard,
  type StoryUri,
} from '@storyboard/story-model';

import { applyStoryCardChanges, type StoryCardTarget } from '#engine/application/story/buildStoryCardsUseCase';
import type { CompletedStoryScene } from '#engine/application/story/completeStoryScenesUseCase';
import type { ElementBundle } from '#engine/persistence/bundles/elementBundleRepository';
import type { PlannedCardChanges } from '#engine/persistence/bundles/workspaceCards';
import { SessionStore } from '#engine/persistence/cache/sessionStore';

export interface ApplyStoryCardTargetsResult {
  readonly writtenIds: readonly string[];
  readonly needsIdNames: readonly string[];
}

export interface ProposeStoryCardTargetsResult extends ApplyStoryCardTargetsResult {
  readonly proposedIds: readonly string[];
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

  public async proposeCardTargets(
    workspaceRoot: StoryUri,
    targets: readonly StoryCardTarget[],
  ): Promise<ProposeStoryCardTargetsResult> {
    const newTargets: readonly StoryCardTarget[] = targets.filter((target) => target.isNew);
    const written: ApplyStoryCardTargetsResult = await this.applyCardTargets(workspaceRoot, newTargets);
    const proposedIds: string[] = [];

    for (const target of targets.filter((item) => !item.isNew)) {
      const isProposed: boolean = await this.leavePending(workspaceRoot, target);
      if (isProposed) {
        proposedIds.push(target.card.id);
      }
    }

    return { ...written, proposedIds };
  }

  private async leavePending(workspaceRoot: StoryUri, target: StoryCardTarget): Promise<boolean> {
    const card: StoryboardCard = applyStoryCardChanges(
      target,
      target.changes.map((change) => change.proposal),
    );
    const bundle: ElementBundle | undefined = await this.host.cards.findBundleBySlug(
      workspaceRoot,
      card.id,
    );
    const planned: PlannedCardChanges = await this.host.cards.planCardChanges(workspaceRoot, card, {
      ...studioSource,
      command: 'card build',
    });
    const pendingCount: number = planned.statements.length + (planned.header === undefined ? 0 : 1);
    if (bundle === undefined || pendingCount === 0) {
      return false;
    }

    const proposedAt: string = new Date().toISOString();
    new SessionStore(await this.host.caches.open(workspaceRoot)).save({
      id: randomUUID(),
      kind: 'studio',
      elementId: bundle.header.id,
      openedAt: proposedAt,
      pendingCount,
      data: replacePendingHeader(
        replacePendingStatements({ title: 'card build' }, planned.statements),
        planned.header,
      ),
    });
    return true;
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
