import {
  computeBackgroundFactConflictKey,
  parseBackgroundFactConflictList,
  type BackgroundCard,
  type BackgroundFactConflict,
  type StoryUri,
} from '@storyboard/story-model';
import { promptResourceFingerprint } from '@storyboard/story-ai';

import { FindingStore, type Finding, type FindingKind } from '#engine/persistence/cache/findingStore';
import type { WorkspaceCaches } from '#engine/persistence/cache/workspaceCaches';
import type { IBackgroundFactConflictStore } from '#engine/pipeline/memoryStore';

const backgroundConflictKind: FindingKind = 'background-conflict';

export class BackgroundFactConflictStore implements IBackgroundFactConflictStore {
  private readonly promptFingerprint: string = promptResourceFingerprint('backgroundFactConflicts');

  public constructor(
    private readonly caches: WorkspaceCaches,
    private readonly workspaceRoot: StoryUri,
  ) {}

  public async load(card: BackgroundCard): Promise<readonly BackgroundFactConflict[] | undefined> {
    const finding: Finding | undefined = (await this.openStore()).findCurrent(
      backgroundConflictKind,
      card.id,
      computeBackgroundFactConflictKey(card, this.promptFingerprint),
    );

    return finding === undefined ? undefined : parseBackgroundFactConflictList(finding.data);
  }

  public async save(card: BackgroundCard, conflicts: readonly BackgroundFactConflict[]): Promise<void> {
    (await this.openStore()).record({
      kind: backgroundConflictKind,
      subject: card.id,
      inputHash: computeBackgroundFactConflictKey(card, this.promptFingerprint),
      data: conflicts,
    });
  }

  private async openStore(): Promise<FindingStore> {
    return new FindingStore(await this.caches.open(this.workspaceRoot));
  }
}
