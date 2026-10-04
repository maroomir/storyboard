import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SceneCardPreview } from '@/renderer/components/SceneCardPreview';
import { I18nProvider } from '@/renderer/lib/i18n';
import type { SceneNotes } from '@/shared/dto';

const notes: SceneNotes = {
  stem: '02-letter',
  title: '편지',
  thread: 'main',
  summary: '하나는 끝내 편지를 부치지 못한다.',
  beats: ['하나가 우체국 앞에서 망설인다.', '준이 편지를 대신 부친다.'],
  mood: '쓸쓸함',
  characters: [
    { id: 'hana', name: '하나' },
    { id: 'jun', name: '준' },
  ],
  background: { id: 'post-office', name: '항구 우체국' },
  facts: [],
  warnings: [],
  length: 0,
};

function renderPreview(sceneNotes: SceneNotes): void {
  render(
    <I18nProvider language="ko">
      <SceneCardPreview notes={sceneNotes} />
    </I18nProvider>,
  );
}

afterEach(cleanup);

describe('SceneCardPreview', () => {
  it('starts folded and names how many beats the card holds', () => {
    renderPreview(notes);

    const details = screen.getByText('카드 내용 보기 (비트 2)').closest('details');
    expect(details?.open).toBe(false);
  });

  it('shows the summary, every beat and who, where and how', () => {
    renderPreview(notes);

    expect(screen.getByText('하나는 끝내 편지를 부치지 못한다.')).toBeTruthy();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(notes.beats);
    expect(screen.getByText('하나, 준')).toBeTruthy();
    expect(screen.getByText('항구 우체국')).toBeTruthy();
    expect(screen.getByText('쓸쓸함')).toBeTruthy();
  });

  it('renders nothing for a card with nothing to show', () => {
    renderPreview({ ...notes, summary: undefined, beats: [], mood: undefined, characters: [], background: undefined });

    expect(screen.queryByText(/카드 내용 보기/)).toBeNull();
  });
});
