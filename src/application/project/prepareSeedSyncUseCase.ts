import {
  buildSeedWritePlan,
  computeSeedDeletionCandidates,
  listSeedPlanContentConflictRelativePaths,
  type SeedFileWriteEntry,
} from '../../infrastructure/seedcoat/seedImport';
import type { DecodedSeedContent } from '../../infrastructure/seedcoat/projectAdapter';

export type PrepareSeedSyncRequest = {
  readonly existingContentByRelativePath: ReadonlyMap<string, string | undefined>;
  readonly existingRelativePaths: readonly string[];
  readonly seed: DecodedSeedContent;
};

export type PreparedSeedSync = {
  readonly contentConflicts: readonly string[];
  readonly deletions: readonly string[];
  readonly plan: readonly SeedFileWriteEntry[];
};

export class PrepareSeedSyncUseCase {
  public execute(request: PrepareSeedSyncRequest): PreparedSeedSync {
    const plan = buildSeedWritePlan(request.seed);

    return {
      plan,
      deletions: computeSeedDeletionCandidates(request.existingRelativePaths, request.seed),
      contentConflicts: listSeedPlanContentConflictRelativePaths(
        plan,
        request.existingContentByRelativePath,
      ),
    };
  }
}
