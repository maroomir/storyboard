import { storyStateSectionLabels, type StoryState, type StoryStateSection } from './storyState';

// NOTE: 연속성 검사는 캐넌 사실만 기준으로 삼아, 앞 씬이 확립한 사실·이미 공개된 정보와의 모순은
// 잡지 못했다. 원장에서 검사 가능한 항목만 사실 줄로 바꿔 같은 기준에 넣는다. 모티프는 위반이
// 아니라 권고라 제외한다.
const checkableSections: readonly StoryStateSection[] = ['facts', 'relations', 'revealed'];

export function storyStateFactLines(state: StoryState): string[] {
  return checkableSections.flatMap((section) =>
    state.entries
      .filter((entry) => entry.section === section)
      .map((entry) => `${storyStateSectionLabels[section]} — ${entry.text}`),
  );
}
