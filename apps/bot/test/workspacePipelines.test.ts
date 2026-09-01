import { describe, expect, it, vi } from 'vitest';

import { OutlinePipeline, PlanPipeline } from '../src/gen/workspacePipelines';
import type { PipelineContext } from '../src/gen/pipelineRunner';
import type { GenJob } from '../src/gen/types';
import type { ContentService } from '../src/content/contentService';
import type { WorkspaceStore } from '../src/workspace/workspaceStore';

const job = { id: 1, options: {}, target: {} } as unknown as GenJob;

const context: PipelineContext = {
  isCancelled: () => false,
  log: () => undefined,
  reportStage: async () => undefined,
};

const synopsis = {
  logline: '한 줄',
  genrePromise: '약속',
  mainConflicts: ['갈등'],
  ending: '결말',
  theme: '주제',
  tone: '어조',
  styleRules: [],
};

const fullContract = {
  genre: '판타지',
  audience: '성인',
  pov: 'third-limited',
  targetWordCount: 120_000,
  tags: [],
  prohibitions: [],
};

function storeWith(setting: unknown): WorkspaceStore {
  return {
    readProject: async () => ({ value: { name: '작품', setting } }),
    readSynopsis: async () => ({ value: '# 시놉시스\n\n로그라인: 한 줄\n' }),
    listCards: async () => [],
  } as unknown as WorkspaceStore;
}

describe('outline generation refuses an unfilled contract', () => {
  it('names the missing fields instead of spending an AI call', async () => {
    const aiService = { generateOutlineSynopsis: vi.fn() };
    const content = { writeTracked: vi.fn() };

    const result = await new OutlinePipeline({
      store: storeWith({ tags: [], prohibitions: [] }),
      content: content as unknown as ContentService,
      aiService: aiService as never,
    }).run(job, context);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('장르, 독자층, 시점, 목표 분량');
    expect(aiService.generateOutlineSynopsis).not.toHaveBeenCalled();
    expect(content.writeTracked).not.toHaveBeenCalled();
  });

  it('proceeds once the contract is filled', async () => {
    const aiService = { generateOutlineSynopsis: vi.fn(async () => synopsis) };
    const content = { writeTracked: vi.fn(async () => ({ status: 'committed', paths: [] })) };

    const result = await new OutlinePipeline({
      store: storeWith(fullContract),
      content: content as unknown as ContentService,
      aiService: aiService as never,
    }).run(job, context);

    expect(result.success).toBe(true);
    expect(aiService.generateOutlineSynopsis).toHaveBeenCalledTimes(1);
  });
});

describe('chapter planning refuses an unfilled contract', () => {
  it('checks the contract even though the synopsis already exists', async () => {
    const aiService = { generateChapterPlan: vi.fn() };

    const result = await new PlanPipeline({
      store: storeWith({ genre: '판타지', tags: [], prohibitions: [] }),
      content: { writeTracked: vi.fn() } as unknown as ContentService,
      aiService: aiService as never,
    }).run(job, context);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('독자층, 시점, 목표 분량');
    expect(result.errorMessage).not.toContain('장르');
    expect(aiService.generateChapterPlan).not.toHaveBeenCalled();
  });
});
