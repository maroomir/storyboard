// NOTE: Moved to @seedkernel/wasm so the bot's /scene command shares the same numbering
// and slug rules. Re-exported here to keep existing imports and tests stable.
export {
  computeNextSceneOrderFromSceneFileNames,
  formatSceneOrderPrefix,
  validateSceneSlugInput,
} from '@seedkernel/wasm';
