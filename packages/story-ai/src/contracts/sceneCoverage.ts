// NOTE: The implementation lives in the weeding diagnostics engine (@weeding/wasm); this module
// keeps the story-ai contract surface stable for existing importers.
export { coerceSceneCoverage, summarizeSceneCoverage } from '@weeding/wasm';
export type { CoverageStatus, SceneCoverageIssue, SceneCoverageReport } from '@weeding/wasm';

export const coverageStatuses = ['missing', 'out-of-order'] as const;
