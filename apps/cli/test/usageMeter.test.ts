import { isRunBudgetExceeded, summarizeUsageByStage, UsageMeter } from '@storyboard/story-engine';
import type { UsageRecord } from '@storyboard/story-model';
import { NodeUri } from '@storyboard/story-model';
import { describe, expect, it, vi } from 'vitest';

const workspaceRoot = NodeUri.file('/ws');

function usage(costUsd: number | undefined, tokens = 100): UsageRecord {
  return {
    taskName: 'sceneDraft',
    providerId: 'claude',
    usage: { inputTokens: tokens, outputTokens: 0 },
    ...(costUsd === undefined ? {} : { costUsd }),
    attribution: {},
  };
}

describe('UsageMeter', () => {
  it('counts what a session spends and still hands every record to the host sink', async () => {
    const hostSink = { record: vi.fn(async () => undefined) };
    const meter = new UsageMeter();
    const sink = meter.wrap(hostSink);
    const session = meter.startSession();

    await sink.record(workspaceRoot, usage(0.4));
    await sink.record(workspaceRoot, usage(0.35));

    expect(session.reading().costUsd).toBeCloseTo(0.75);
    expect(session.reading().tokens).toBe(200);
    expect(hostSink.record).toHaveBeenCalledTimes(2);
  });

  it('stops counting once the session stops, and a later session starts from zero', async () => {
    const meter = new UsageMeter();
    const sink = meter.wrap({ record: async () => undefined });
    const first = meter.startSession();

    await sink.record(workspaceRoot, usage(1));
    first.stop();
    await sink.record(workspaceRoot, usage(1));
    const second = meter.startSession();

    expect(first.reading().costUsd).toBe(1);
    expect(second.reading().costUsd).toBe(0);
  });

  it('reports each change to the session listener', async () => {
    const meter = new UsageMeter();
    const sink = meter.wrap({ record: async () => undefined });
    const readings: number[] = [];
    meter.startSession((reading) => readings.push(reading.costUsd));

    await sink.record(workspaceRoot, usage(0.5));
    await sink.record(workspaceRoot, usage(undefined));

    expect(readings).toEqual([0.5, 0.5]);
  });
});

describe('isRunBudgetExceeded', () => {
  it('treats 0 as no limit and stops at or past the limit', () => {
    const spent = { costUsd: 5, tokens: 1, hasUnpricedUsage: false };

    expect(isRunBudgetExceeded(spent, 0)).toBe(false);
    expect(isRunBudgetExceeded(spent, 6)).toBe(false);
    expect(isRunBudgetExceeded(spent, 5)).toBe(true);
  });
});

describe('summarizeUsageByStage', () => {
  it('adds the calls of one stage and task together, in the order they first ran', () => {
    const rows = summarizeUsageByStage([
      { ...usage(0.1, 10), stage: 'draftSkeleton' },
      { ...usage(0.2, 20), stage: 'expandSection', taskName: 'sceneSectionExpansion' },
      { ...usage(0.3, 30), stage: 'draftSkeleton' },
    ]);

    expect(rows).toEqual([
      { stage: 'draftSkeleton', task: 'sceneDraft', calls: 2, inputTokens: 40, outputTokens: 0, cacheReadInputTokens: 0, costUsd: 0.4 },
      { stage: 'expandSection', task: 'sceneSectionExpansion', calls: 1, inputTokens: 20, outputTokens: 0, cacheReadInputTokens: 0, costUsd: 0.2 },
    ]);
  });

  it('leaves the cost out when one call of the group has no price', () => {
    const rows = summarizeUsageByStage([
      { ...usage(0.1), stage: 'expandSection' },
      { ...usage(undefined), stage: 'expandSection' },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('costUsd');
  });

  it('keeps a call made outside any stage in a row without one', async () => {
    const meter = new UsageMeter();
    const sink = meter.wrap({ record: async () => undefined });
    const session = meter.startSession();

    await sink.record(workspaceRoot, usage(0.1));

    expect(summarizeUsageByStage(session.records())).toEqual([
      { task: 'sceneDraft', calls: 1, inputTokens: 100, outputTokens: 0, cacheReadInputTokens: 0, costUsd: 0.1 },
    ]);
  });
});
