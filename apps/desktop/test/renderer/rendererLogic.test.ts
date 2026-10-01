import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DraftAutosave, type AutosaveState } from '@/renderer/lib/draftAutosave';
import { budgetProgress, stageRail } from '@/renderer/lib/runView';
import { composeSceneStem } from '@/renderer/lib/sceneRename';
import { replaceSelection } from '@/renderer/lib/selectionEdit';
import { initialWizardForm, isStepComplete, lengthHint } from '@/renderer/lib/wizardForm';
import type { RunSnapshot } from '@/shared/dto';

const idleRun: RunSnapshot = {
  status: 'idle',
  completedStages: [],
  log: [],
  spentUsd: 0,
  spentTokens: 0,
  hasUnpricedUsage: false,
  budgetUsd: 0,
  projectSpentUsd: 0,
};

describe('DraftAutosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('saves once after typing pauses, with the latest text', async () => {
    const saved: string[] = [];
    const states: AutosaveState[] = [];
    const autosave = new DraftAutosave('처음', async (body) => void saved.push(body), (state) => states.push(state), 1000);

    autosave.change('처음 한');
    autosave.change('처음 한 줄');
    await vi.advanceTimersByTimeAsync(999);
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(saved).toEqual(['처음 한 줄']);
    expect(states).toEqual(['dirty', 'saving', 'saved']);
  });

  it('tells its own save coming back from a change made elsewhere', async () => {
    const autosave = new DraftAutosave('원고', async () => undefined, () => undefined, 10);

    autosave.change('고친 원고');
    await autosave.flush();

    expect(autosave.classifyDiskChange('고친 원고')).toBe('echo');
    expect(autosave.classifyDiskChange('CLI 가 고친 원고')).toBe('reload');
    autosave.change('덜 저장된 편집');
    expect(autosave.classifyDiskChange('CLI 가 고친 원고')).toBe('conflict');
  });

  it('stays dirty when a save fails, so the edit is not lost', async () => {
    const autosave = new DraftAutosave('원고', async () => Promise.reject(new Error('disk full')), () => undefined, 10);

    autosave.change('편집');
    await expect(autosave.flush()).rejects.toThrow('disk full');

    expect(autosave.state).toBe('dirty');
  });
});

describe('replaceSelection', () => {
  it('replaces the selected text in place', () => {
    expect(replaceSelection('가나다라', { start: 1, end: 3 }, '나다', 'NA-DA')).toBe('가NA-DA라');
  });

  it('finds the original again when the body moved, and refuses when it is ambiguous or gone', () => {
    expect(replaceSelection('앞에 추가. 가나다라', { start: 1, end: 3 }, '나다', 'X')).toBe('앞에 추가. 가X라');
    expect(replaceSelection('나다 그리고 나다', { start: 20, end: 22 }, '나다', 'X')).toBeUndefined();
    expect(replaceSelection('전부 새로 씀', { start: 0, end: 2 }, '나다', 'X')).toBeUndefined();
  });
});

describe('stageRail', () => {
  it('marks finished and current stages of a running novel', () => {
    const rail = stageRail({ ...idleRun, status: 'running', kind: 'novel', currentStage: 'chapters', completedStages: ['outline', 'seeds'] });

    expect(rail.map((item) => item.state)).toEqual(['done', 'done', 'current', 'waiting', 'waiting', 'waiting', 'waiting']);
  });

  it('shows what a stopped run finished while idle', () => {
    const rail = stageRail({ ...idleRun, resumable: { mode: 'auto', completedStages: ['outline'] } });

    expect(rail[0]?.state).toBe('done');
    expect(rail[1]?.state).toBe('waiting');
  });

  it('reports no budget progress without a budget', () => {
    expect(budgetProgress(idleRun)).toBeUndefined();
    expect(budgetProgress({ ...idleRun, budgetUsd: 4, spentUsd: 1 })).toBe(0.25);
    expect(budgetProgress({ ...idleRun, budgetUsd: 4, spentUsd: 9 })).toBe(1);
  });
});

describe('wizard form', () => {
  it('asks for every field of a step before moving on', () => {
    expect(isStepComplete('story', initialWizardForm)).toBe(false);
    expect(isStepComplete('story', { ...initialWizardForm, title: '제목', genre: '장르', audience: '독자' })).toBe(true);
    expect(isStepComplete('concept', { ...initialWizardForm, concept: '   ' })).toBe(false);
  });

  it('turns the length choices into a per-scene size', () => {
    expect(lengthHint({ ...initialWizardForm, chapterCount: 10, scenesPerChapter: 3, targetWordCount: 90_000 })).toEqual({
      scenes: 30,
      perScene: 3000,
    });
  });
});

describe('composeSceneStem', () => {
  it('keeps at least the digits the scene had', () => {
    expect(composeSceneStem('4', 'night-market', 2)).toBe('04-night-market');
    expect(composeSceneStem(' 120 ', 'night-market', 2)).toBe('120-night-market');
  });

  it('refuses a number or a name the file name cannot hold', () => {
    expect(composeSceneStem('0', 'night-market', 2)).toBeUndefined();
    expect(composeSceneStem('3.5', 'night-market', 2)).toBeUndefined();
    expect(composeSceneStem('3', '야시장', 2)).toBeUndefined();
    expect(composeSceneStem('3', '', 2)).toBeUndefined();
  });
});
