import { describe, expect, it } from 'vitest';

import {
  emptyInterviewAxesFile,
  interviewAxesFileSchema,
  interviewWorkingModelRelativePath,
  interviewWorkingModelSchema,
  type InterviewAxesFile,
  type InterviewWorkingModel,
} from '@storyboard/story-model';

const axes: InterviewAxesFile = {
  version: 1,
  character: {
    generatedAt: '2026-11-02T00:00:00.000Z',
    contractHash: 'sha256:abc',
    axes: [
      {
        id: 'affection',
        label: '호감 표출',
        values: [
          { id: 'direct', label: '직접' },
          { id: 'indirect', label: '우회' },
          { id: 'deny', label: '부정' },
        ],
      },
    ],
  },
};

const workingModel: InterviewWorkingModel = {
  version: 1,
  cardId: 'hana',
  cardType: 'character',
  cardHash: 'sha256:def',
  summary: '하나는 몰릴 때 먼저 참는다.',
  tallies: { affection: { indirect: 3 } },
  records: [
    {
      id: 'q1',
      sessionId: '20261102-0045',
      askedAt: '2026-11-02T00:45:00.000Z',
      source: { kind: 'beat', sceneStem: '12-night-tavern', beatIndex: 2 },
      axisId: 'affection',
      situation: '준이 하나의 손을 잡으려다 멈춘다',
      question: '하나는 어떻게 받는가?',
      options: [
        { valueId: 'direct', text: '손을 먼저 잡는다', isExploration: false },
        { valueId: 'indirect', text: '컵을 건넨다', isExploration: false },
        { valueId: 'deny', text: '손을 뺀다', isExploration: true },
      ],
      answer: { kind: 'written', text: '웃어 버린다', valueId: 'laugh-off', isNewValue: true },
      isConfirmed: true,
    },
    {
      id: 'q2',
      sessionId: '20261102-0045',
      askedAt: '2026-11-02T00:47:00.000Z',
      source: { kind: 'offBeat' },
      axisId: 'affection',
      situation: '준이 다른 사람과 웃고 있다',
      question: '하나는?',
      options: [],
      isConfirmed: false,
    },
  ],
  writtenStreak: 1,
  distilledThrough: 0,
};

describe('interview cache schemas', () => {
  it('reads back what it would write', () => {
    expect(interviewAxesFileSchema.parse(JSON.parse(JSON.stringify(axes)))).toEqual(axes);
    expect(interviewWorkingModelSchema.parse(JSON.parse(JSON.stringify(workingModel)))).toEqual(workingModel);
    expect(interviewAxesFileSchema.parse(emptyInterviewAxesFile)).toEqual({ version: 1 });
  });

  it('rejects a working model of another version or an unknown answer kind', () => {
    expect(interviewWorkingModelSchema.safeParse({ ...workingModel, version: 2 }).success).toBe(false);
    expect(
      interviewWorkingModelSchema.safeParse({
        ...workingModel,
        records: [{ ...workingModel.records[0], answer: { kind: 'guessed' } }],
      }).success,
    ).toBe(false);
  });

  it('keeps one working model file per card under the interview cache', () => {
    expect(interviewWorkingModelRelativePath('hana')).toBe('.storyboard/cache/interviews/cards/hana.json');
  });
});
