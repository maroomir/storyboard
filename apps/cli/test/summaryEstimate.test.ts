import { describe, expect, it } from 'vitest';

import { countSummariesToRebuild } from '@storyboard/story-app';
import { NodeUri, type SceneListItem } from '@storyboard/story-model';

import { describeMissingChapterSummaries } from '@/commands/workspaceInput';

function scene(order: number, status: SceneListItem['status']): SceneListItem {
  return { order, status } as SceneListItem;
}

describe('chapter summary estimate (A8)', () => {
  const root = NodeUri.file('/work');

  it('asks for the chapters before the last scene a draft is still needed for, and nothing when every draft is current', async () => {
    const asked: (number | undefined)[] = [];
    const manuscripts = {
      listMissingChapterSummaries: async (_root: unknown, before?: number): Promise<string[]> => {
        asked.push(before);
        return before === undefined ? ['1장', '2장', '3장'] : ['1장'];
      },
    } as never;

    expect(await countSummariesToRebuild(manuscripts, root, [scene(1, 'ready'), scene(2, 'ready')])).toBe(0);
    expect(asked).toEqual([]);

    expect(await countSummariesToRebuild(manuscripts, root, [scene(1, 'ready'), scene(4, 'stale'), scene(3, 'missing')])).toBe(1);
    expect(asked).toEqual([4]);
  });

  it('names the rebuild in the estimate the way the contract says', () => {
    expect(describeMissingChapterSummaries({ chapterSummaries: { missing: 3 } } as never)).toEqual([
      '장 요약 다시 만들기 3장 (캐시에 없음)',
    ]);
    expect(describeMissingChapterSummaries({ chapterSummaries: { missing: 0 } } as never)).toEqual([]);
  });
});
