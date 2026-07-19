import { describe, expect, it } from 'vitest';

import { planStudioAction } from '@/presentation/providers/studioActions';
import type { StudioAction } from '@/shared/messaging';

describe('planStudioAction', () => {
  it('maps each action to its draft command and argument slots', () => {
    expect(planStudioAction('regenerate')).toEqual({
      command: 'storyboard.draft.regenerate',
      slots: ['scene'],
      requires: 'scene',
    });
    expect(planStudioAction('generate')).toEqual({
      command: 'storyboard.draft.generate',
      slots: ['scene'],
      requires: 'scene',
    });
    expect(planStudioAction('applyFormat')).toEqual({
      command: 'storyboard.draft.applyFormat',
      slots: ['scene'],
      requires: 'scene',
    });
    expect(planStudioAction('grammarCheck')).toEqual({
      command: 'storyboard.draft.grammarCheck',
      slots: ['draft'],
      requires: 'draft',
    });
    expect(planStudioAction('continuityCheck')).toEqual({
      command: 'storyboard.draft.continuityCheck',
      slots: ['draft'],
      requires: 'draft',
    });
    expect(planStudioAction('expand')).toEqual({
      command: 'storyboard.draft.expand',
      slots: ['draft', 'selection'],
      requires: 'draft',
    });
    expect(planStudioAction('augment')).toEqual({
      command: 'storyboard.draft.augment',
      slots: ['scene', 'draft'],
      requires: 'draft',
    });
    expect(planStudioAction('augmentSelection')).toEqual({
      command: 'storyboard.draft.augmentSelection',
      slots: ['scene', 'draft', 'selection'],
      requires: 'draft',
    });
    expect(planStudioAction('editSelection')).toEqual({
      command: 'storyboard.draft.editSelection',
      slots: ['scene', 'draft', 'selection', 'instruction'],
      requires: 'draft',
    });
    expect(planStudioAction('completeStory')).toEqual({
      command: 'storyboard.scene.completeStory',
      slots: [],
      requires: 'project',
    });
    expect(planStudioAction('buildCardsFromScenes')).toEqual({
      command: 'storyboard.cards.buildFromScenes',
      slots: [],
      requires: 'project',
    });
  });

  it('requires a draft target for selection and supplement actions', () => {
    const draftActions: readonly StudioAction[] = [
      'grammarCheck',
      'continuityCheck',
      'expand',
      'augment',
      'augmentSelection',
      'editSelection',
    ];

    for (const action of draftActions) {
      expect(planStudioAction(action).requires).toBe('draft');
    }
  });
});
