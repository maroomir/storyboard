import { narratorCardPath } from '@storyboard/story-model';
import type { NarratorCard, StoryUri } from '@storyboard/story-model';
import type {
  CreateNarratorCardResult,
  INarratorCardRepository,
  RemoveNarratorCardResult,
} from '#engine/application/cards/narratorCardRepository';
import type { WorkspaceCards } from '#engine/persistence/bundles/workspaceCards';

export class NarratorCardRepository implements INarratorCardRepository {
  public constructor(private readonly cards: WorkspaceCards) {}

  public async list(workspaceRoot: StoryUri): Promise<ReadonlyMap<string, NarratorCard>> {
    const narrators: readonly NarratorCard[] = (
      await this.cards.loadRoster(workspaceRoot, ['character', 'narrator'])
    ).narrators;

    return new Map(narrators.map((card) => [card.id, card]));
  }

  public async create(
    workspaceRoot: StoryUri,
    card: NarratorCard,
  ): Promise<CreateNarratorCardResult> {
    const uri: StoryUri = narratorCardPath(workspaceRoot, card.id);

    if (await this.cards.exists(workspaceRoot, 'narrator', card.id)) {
      return { ok: false, kind: 'exists', uri };
    }

    await this.cards.writeNarrator(workspaceRoot, card);
    return { ok: true, kind: 'created', uri };
  }

  public async remove(workspaceRoot: StoryUri, id: string): Promise<RemoveNarratorCardResult> {
    if (!(await this.cards.exists(workspaceRoot, 'narrator', id))) {
      return { ok: false, kind: 'missing' };
    }

    await this.cards.remove(workspaceRoot, 'narrator', id);
    return { ok: true, kind: 'removed' };
  }
}
