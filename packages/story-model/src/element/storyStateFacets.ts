import type { FacetQualifierRule } from '#model/element/facet';

export type StoryStateFacetId = 'event' | 'relationShift' | 'reveal' | 'motif' | 'fact';

export interface StoryStateFacetRow {
  readonly id: StoryStateFacetId;
  readonly label: string;
  readonly about: FacetQualifierRule;
}

export const storyStateFacetRows: readonly StoryStateFacetRow[] = [
  { id: 'event', label: '확정 사실', about: 'forbidden' },
  { id: 'relationShift', label: '관계·말투 변화', about: 'optional' },
  { id: 'reveal', label: '공개된 정보', about: 'forbidden' },
  { id: 'motif', label: '살아 있는 모티프', about: 'forbidden' },
  { id: 'fact', label: '사실', about: 'optional' },
];

export function isStoryStateFacetId(value: string): value is StoryStateFacetId {
  return storyStateFacetRows.some((row) => row.id === value);
}
