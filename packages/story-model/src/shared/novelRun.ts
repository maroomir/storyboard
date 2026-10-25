// The stage and mode names of a novel run. They live in the contract floor because every host's UI
// draws the stage rail and the mode picker from them, and a browser bundle may only reach `shared`.
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
