// The stage and mode names of a novel run. They live in the contract floor because every host's UI
// draws the stage rail and the mode picker from them, and a browser bundle may only reach `shared`.
export const novelRunModes = [
  'auto',
  'outline-approval',
  'chapter-approval',
  'review-approval',
] as const;
export type NovelRunMode = (typeof novelRunModes)[number];

export const novelStageNames = [
  'outline',
  'seeds',
  'chapters',
  'assemble',
  'review',
  'revise-from-review',
  'summaries',
] as const;
export type NovelStageName = (typeof novelStageNames)[number];
