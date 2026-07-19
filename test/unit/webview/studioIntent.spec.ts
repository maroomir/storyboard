import { describe, expect, it } from 'vitest';

import { availableStudioActions, interpretStudioInstruction } from '@webview/lib/studioIntent';
import type { StudioTarget } from '@webview/lib/types';

const noneTarget: StudioTarget = { kind: 'none', hasSelection: false };
const projectTarget: StudioTarget = { kind: 'project', label: 'story', hasSelection: false };

const sceneWithDraft: StudioTarget = {
  kind: 'scene',
  label: '01-intro.txt',
  sceneUri: 'file:///scene/01-intro.txt',
  draftUri: 'file:///draft/01-intro.md',
  hasSelection: false,
  draftExists: true,
};

const sceneWithoutDraft: StudioTarget = {
  ...sceneWithDraft,
  draftExists: false,
};

const draftTarget: StudioTarget = {
  kind: 'draft',
  label: '01-intro.md',
  sceneUri: 'file:///scene/01-intro.txt',
  draftUri: 'file:///draft/01-intro.md',
  hasSelection: false,
};

const draftWithSelection: StudioTarget = {
  ...draftTarget,
  hasSelection: true,
};

describe('availableStudioActions', () => {
  it('returns nothing without a target', () => {
    expect(availableStudioActions(noneTarget)).toEqual([]);
  });

  it('offers regenerate and format when a scene has a draft', () => {
    expect(availableStudioActions(sceneWithDraft)).toEqual([
      'completeStory',
      'buildCardsFromScenes',
      'regenerate',
      'applyFormat',
    ]);
  });

  it('offers only generate when a scene has no draft', () => {
    expect(availableStudioActions(sceneWithoutDraft)).toEqual([
      'completeStory',
      'buildCardsFromScenes',
      'generate',
    ]);
  });

  it('offers whole-draft actions for a draft target', () => {
    expect(availableStudioActions(draftTarget)).toEqual([
      'completeStory',
      'buildCardsFromScenes',
      'regenerate',
      'grammarCheck',
      'continuityCheck',
      'augment',
    ]);
  });

  it('adds selection actions when the draft has a selection', () => {
    expect(availableStudioActions(draftWithSelection)).toEqual([
      'completeStory',
      'buildCardsFromScenes',
      'regenerate',
      'grammarCheck',
      'continuityCheck',
      'augment',
      'expand',
      'augmentSelection',
    ]);
  });

  it('offers project actions without an open scene or draft', () => {
    expect(availableStudioActions(projectTarget)).toEqual([
      'completeStory',
      'buildCardsFromScenes',
    ]);
  });

  it('omits regenerate when the draft has no linked scene', () => {
    expect(availableStudioActions({ ...draftTarget, sceneUri: undefined })).toEqual([
      'completeStory',
      'buildCardsFromScenes',
      'grammarCheck',
      'continuityCheck',
      'augment',
    ]);
  });
});

describe('interpretStudioInstruction', () => {
  it('asks to open a target when none is active', () => {
    expect(interpretStudioInstruction('문법 봐줘', noneTarget)).toEqual({
      kind: 'clarify',
      reason: 'no-target',
      suggestions: [],
    });
  });

  it('maps scene regenerate intent to regenerate when a draft exists', () => {
    expect(interpretStudioInstruction('다시 생성해줘', sceneWithDraft)).toEqual({
      kind: 'action',
      action: 'regenerate',
    });
  });

  it('maps project story and card requests to the project actions', () => {
    expect(interpretStudioInstruction('이야기 완결해줘', projectTarget)).toEqual({
      kind: 'action',
      action: 'completeStory',
    });
    expect(interpretStudioInstruction('씬에서 카드 구성해줘', projectTarget)).toEqual({
      kind: 'action',
      action: 'buildCardsFromScenes',
    });
  });

  it('maps scene generate intent to generate when no draft exists', () => {
    expect(interpretStudioInstruction('초안 생성', sceneWithoutDraft)).toEqual({
      kind: 'action',
      action: 'generate',
    });
  });

  it('treats scene regenerate wording as generate when no draft exists', () => {
    expect(interpretStudioInstruction('재생성', sceneWithoutDraft)).toEqual({
      kind: 'action',
      action: 'generate',
    });
  });

  it('maps scene format intent to applyFormat when a draft exists', () => {
    expect(interpretStudioInstruction('형식 적용', sceneWithDraft)).toEqual({
      kind: 'action',
      action: 'applyFormat',
    });
  });

  it('asks to generate a draft before formatting a draftless scene', () => {
    expect(interpretStudioInstruction('포맷 맞춰줘', sceneWithoutDraft)).toEqual({
      kind: 'clarify',
      reason: 'needs-draft',
      suggestions: ['completeStory', 'buildCardsFromScenes', 'generate'],
    });
  });

  it('maps grammar wording to grammarCheck on a draft', () => {
    expect(interpretStudioInstruction('맞춤법 검사해줘', draftTarget)).toEqual({
      kind: 'action',
      action: 'grammarCheck',
    });
  });

  it('maps continuity wording to continuityCheck on a draft', () => {
    expect(interpretStudioInstruction('연속성 확인', draftTarget)).toEqual({
      kind: 'action',
      action: 'continuityCheck',
    });
  });

  it('maps augment wording to whole-draft augment', () => {
    expect(interpretStudioInstruction('카드로 보충해줘', draftTarget)).toEqual({
      kind: 'action',
      action: 'augment',
    });
  });

  it('maps augment + selection wording to augmentSelection when text is selected', () => {
    expect(interpretStudioInstruction('선택 영역만 보충', draftWithSelection)).toEqual({
      kind: 'action',
      action: 'augmentSelection',
    });
  });

  it('asks for a selection when augmenting a selection without one', () => {
    expect(interpretStudioInstruction('선택 영역 보충', draftTarget)).toEqual({
      kind: 'clarify',
      reason: 'needs-selection',
      suggestions: availableStudioActions(draftTarget),
    });
  });

  it('maps expand wording to expand when text is selected', () => {
    expect(interpretStudioInstruction('더 길게 늘려줘', draftWithSelection)).toEqual({
      kind: 'action',
      action: 'expand',
    });
  });

  it('asks for a selection when expanding without one', () => {
    expect(interpretStudioInstruction('확장', draftTarget)).toEqual({
      kind: 'clarify',
      reason: 'needs-selection',
      suggestions: availableStudioActions(draftTarget),
    });
  });

  it('routes a free-form instruction with a selection to editSelection', () => {
    expect(interpretStudioInstruction('더 긴장감 있게 고쳐줘', draftWithSelection)).toEqual({
      kind: 'action',
      action: 'editSelection',
      instruction: '더 긴장감 있게 고쳐줘',
    });
  });

  it('preserves the original casing of the edit instruction', () => {
    expect(interpretStudioInstruction('Make it tense', draftWithSelection)).toEqual({
      kind: 'action',
      action: 'editSelection',
      instruction: 'Make it tense',
    });
  });

  it('asks for a selection when a free-form edit has no selection', () => {
    expect(interpretStudioInstruction('짧게 줄여줘', draftTarget)).toEqual({
      kind: 'clarify',
      reason: 'needs-selection',
      suggestions: availableStudioActions(draftTarget),
    });
  });
});
