import { projectCardFacts, type StoryBible, type StoryUri } from '@storyboard/story-model';

import type { CardRoster, WorkspaceCards } from '#engine/persistence/bundles/workspaceCards';
import type { SceneRoster, WorkspaceScenes } from '#engine/persistence/bundles/workspaceScenes';

export interface CardFactReaderDependencies {
  readonly cards: WorkspaceCards;
  readonly scenes: WorkspaceScenes;
}

export class CardFactReader {
  public constructor(private readonly dependencies: CardFactReaderDependencies) {}

  public async readFacts(workspaceRoot: StoryUri): Promise<StoryBible> {
    const cards: CardRoster = await this.dependencies.cards.loadRoster(workspaceRoot);
    const scenes: SceneRoster = await this.dependencies.scenes.loadRoster(workspaceRoot);
    const orderBySceneId: ReadonlyMap<string, number> = new Map(
      scenes.entries.map((entry) => [entry.content.header.id, entry.file.order]),
    );

    return projectCardFacts(
      cards.bundles.map((bundle) => ({
        kind: bundle.kind,
        slug: bundle.header.slug,
        statements: bundle.statements,
      })),
      {
        sceneOrderOf: (sceneId) => orderBySceneId.get(sceneId),
        characterSlugOf: (characterId) => cards.lookup.slugOf(characterId),
      },
    );
  }

  public async readFactLines(workspaceRoot: StoryUri): Promise<string[]> {
    const facts: StoryBible = await this.readFacts(workspaceRoot);
    return facts.facts.map((fact) => `${fact.subject.id} — ${fact.key}: ${fact.value}`);
  }

  public async readStoryTimeline(workspaceRoot: StoryUri): Promise<ReadonlyMap<number, number>> {
    const scenes: SceneRoster = await this.dependencies.scenes.loadRoster(workspaceRoot);

    return new Map(
      scenes.entries.flatMap((entry): [number, number][] =>
        entry.entry?.storyTime === undefined ? [] : [[entry.file.order, entry.entry.storyTime]],
      ),
    );
  }
}
