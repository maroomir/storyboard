import {
  selectStoryStateEntries,
  storyStateSectionLabels,
  type StoryState,
  type StoryStateSection,
} from '#model/format/storyState';

const checkableSections: readonly StoryStateSection[] = ['facts', 'relations', 'revealed'];

export function storyStateFactLines(
  state: StoryState,
  beforeSceneOrder?: number,
  sceneText?: string,
): string[] {
  return checkableSections.flatMap((section) =>
    selectStoryStateEntries(state, section, beforeSceneOrder, sceneText).map(
      (entry) => `${storyStateSectionLabels[section]} — ${entry.text}`,
    ),
  );
}
