import type { NarratorCard, StoryUri } from '@storyboard/story-model';

export type CreateNarratorCardResult =
  | { readonly ok: true; readonly kind: 'created'; readonly uri: StoryUri }
  | { readonly ok: false; readonly kind: 'exists'; readonly uri: StoryUri };

export type RemoveNarratorCardResult =
  | { readonly ok: true; readonly kind: 'removed' }
  | { readonly ok: false; readonly kind: 'missing' };

// Named narrators, `narrator/<id>.card`. Most works have none, so an absent directory lists empty.
export interface INarratorCardRepository {
  list(workspaceRoot: StoryUri): Promise<ReadonlyMap<string, NarratorCard>>;
  create(workspaceRoot: StoryUri, card: NarratorCard): Promise<CreateNarratorCardResult>;
  remove(workspaceRoot: StoryUri, id: string): Promise<RemoveNarratorCardResult>;
}
