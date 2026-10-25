export type NovelRunMode = 'auto' | 'outline-approval' | 'chapter-approval' | 'review-approval';

export const novelRunModes: readonly [NovelRunMode, ...NovelRunMode[]] = [
  'auto',
  'outline-approval',
  'chapter-approval',
  'review-approval',
];

export type NovelStageName =
  | 'outline'
  | 'characters'
  | 'seeds'
  | 'chapters'
  | 'assemble'
  | 'review'
  | 'revise-from-review'
  | 'summaries';

export const novelStageNames: readonly [NovelStageName, ...NovelStageName[]] = [
  'outline',
  'characters',
  'seeds',
  'chapters',
  'assemble',
  'review',
  'revise-from-review',
  'summaries',
];
