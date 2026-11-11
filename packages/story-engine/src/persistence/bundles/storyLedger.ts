import {
  composeStoryState,
  mainThreadId,
  splitStoryState,
  type LedgerSceneState,
  type SceneStoryState,
  type StoryLedgerLookup,
  type StoryState,
  type StoryUri,
} from '@storyboard/story-model';

import type { CardRoster, WorkspaceCards } from '#engine/persistence/bundles/workspaceCards';
import type {
  SceneRoster,
  SceneRosterEntry,
  WorkspaceScenes,
} from '#engine/persistence/bundles/workspaceScenes';

export interface StoryLedgerDependencies {
  readonly scenes: WorkspaceScenes;
  readonly cards: WorkspaceCards;
}

function threadOf(entry: SceneRosterEntry): string {
  return entry.entry?.thread ?? mainThreadId;
}

export class StoryLedger {
  public constructor(private readonly dependencies: StoryLedgerDependencies) {}

  public async read(workspaceRoot: StoryUri, threadId: string): Promise<StoryState> {
    const entries: readonly SceneRosterEntry[] = await this.listThreadScenes(workspaceRoot, threadId);
    const scenes: LedgerSceneState[] = [];
    for (const entry of entries) {
      const state: SceneStoryState | undefined = await this.dependencies.scenes.readState(
        workspaceRoot,
        entry.file.stem,
      );
      scenes.push({ order: entry.file.order, ...(state === undefined ? {} : { state }) });
    }

    return composeStoryState(scenes, await this.lookupOf(workspaceRoot));
  }

  public async write(workspaceRoot: StoryUri, threadId: string, state: StoryState): Promise<void> {
    const entries: readonly SceneRosterEntry[] = await this.listThreadScenes(workspaceRoot, threadId);
    const split: ReadonlyMap<number, SceneStoryState> = splitStoryState(
      state,
      entries.map((entry) => entry.file.order),
      await this.lookupOf(workspaceRoot),
    );

    for (const entry of entries) {
      await this.dependencies.scenes.writeState(
        workspaceRoot,
        entry.file.stem,
        split.get(entry.file.order),
      );
    }
  }

  private async listThreadScenes(
    workspaceRoot: StoryUri,
    threadId: string,
  ): Promise<readonly SceneRosterEntry[]> {
    const roster: SceneRoster = await this.dependencies.scenes.loadRoster(workspaceRoot);
    return roster.entries.filter((entry) => threadOf(entry) === threadId);
  }

  private async lookupOf(workspaceRoot: StoryUri): Promise<StoryLedgerLookup> {
    const cards: CardRoster = await this.dependencies.cards.loadRoster(workspaceRoot);
    return {
      characterSlugOf: (characterId) => cards.lookup.slugOf(characterId),
      characterIdOf: (characterSlug) => cards.lookup.idOf('character', characterSlug),
    };
  }
}
