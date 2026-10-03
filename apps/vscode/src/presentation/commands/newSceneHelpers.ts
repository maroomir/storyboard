// NOTE: Moved to @storyboard/story-model so the CLI's `scene create` shares the same numbering
// and slug rules. Re-exported here to keep existing imports and tests stable.
export {
  computeNextSceneOrderFromSceneFileNames,
  formatSceneOrderPrefix,
  validateSceneSlugInput,
} from '@storyboard/story-model';
