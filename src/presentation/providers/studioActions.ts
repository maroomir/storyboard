import type { StudioAction } from '../../shared/messaging';

export type StudioArgSlot = 'scene' | 'draft' | 'selection' | 'instruction';

export interface StudioActionPlan {
  readonly command: string;
  readonly slots: readonly StudioArgSlot[];
  readonly requires: 'scene' | 'draft' | 'project';
}

export function planStudioAction(action: StudioAction): StudioActionPlan {
  switch (action) {
    case 'regenerate':
      return { command: 'storyboard.draft.regenerate', slots: ['scene'], requires: 'scene' };
    case 'generate':
      return { command: 'storyboard.draft.generate', slots: ['scene'], requires: 'scene' };
    case 'applyFormat':
      return { command: 'storyboard.draft.applyFormat', slots: ['scene'], requires: 'scene' };
    case 'grammarCheck':
      return { command: 'storyboard.draft.grammarCheck', slots: ['draft'], requires: 'draft' };
    case 'continuityCheck':
      return { command: 'storyboard.draft.continuityCheck', slots: ['draft'], requires: 'draft' };
    case 'expand':
      return {
        command: 'storyboard.draft.expand',
        slots: ['draft', 'selection'],
        requires: 'draft',
      };
    case 'augment':
      return { command: 'storyboard.draft.augment', slots: ['scene', 'draft'], requires: 'draft' };
    case 'augmentSelection':
      return {
        command: 'storyboard.draft.augmentSelection',
        slots: ['scene', 'draft', 'selection'],
        requires: 'draft',
      };
    case 'editSelection':
      return {
        command: 'storyboard.draft.editSelection',
        slots: ['scene', 'draft', 'selection', 'instruction'],
        requires: 'draft',
      };
    case 'completeStory':
      return { command: 'storyboard.scene.completeStory', slots: [], requires: 'project' };
    case 'buildCardsFromScenes':
      return { command: 'storyboard.cards.buildFromScenes', slots: [], requires: 'project' };
  }
}
