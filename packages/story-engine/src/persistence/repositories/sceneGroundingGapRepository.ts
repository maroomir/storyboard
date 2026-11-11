import {
  parseSceneGroundingGapFields,
  type SceneGroundingFieldKey,
  type SceneGroundingGap,
  type StoryUri,
} from '@storyboard/story-model';

import { FindingStore, type Finding, type FindingKind } from '#engine/persistence/cache/findingStore';
import type { WorkspaceCaches } from '#engine/persistence/cache/workspaceCaches';
import type { ISceneGroundingGapRepository } from '#engine/application/drafts/draftRepositories';

const groundingGapKind: FindingKind = 'grounding-gap';

export class SceneGroundingGapRepository implements ISceneGroundingGapRepository {
  public constructor(private readonly caches: WorkspaceCaches) {}

  public async read(
    workspaceRoot: StoryUri,
    sceneStem: string,
  ): Promise<SceneGroundingGap | undefined> {
    const finding: Finding | undefined = (await this.openStore(workspaceRoot)).find(
      groundingGapKind,
      sceneStem,
    );
    const fields: readonly SceneGroundingFieldKey[] | undefined =
      finding === undefined ? undefined : parseSceneGroundingGapFields(finding.data);

    return finding?.inputHash === undefined || fields === undefined
      ? undefined
      : { inputKey: finding.inputHash, fields };
  }

  public async write(
    workspaceRoot: StoryUri,
    sceneStem: string,
    gap: SceneGroundingGap | undefined,
  ): Promise<void> {
    const store: FindingStore = await this.openStore(workspaceRoot);

    if (gap === undefined) {
      store.remove(groundingGapKind, sceneStem);
      return;
    }

    store.record({
      kind: groundingGapKind,
      subject: sceneStem,
      inputHash: gap.inputKey,
      data: gap.fields,
    });
  }

  private async openStore(workspaceRoot: StoryUri): Promise<FindingStore> {
    return new FindingStore(await this.caches.open(workspaceRoot));
  }
}
