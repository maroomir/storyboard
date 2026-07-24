import { STORYBOARD_RELATIVE_PATHS, draftRelativePath, type StoryboardCard } from '@storyboard/story-format';

import type { MutateGate } from '../workspace/mutateGate';
import type { MutateOutcome, WorkspacePlan } from '../workspace/workspaceChanges';
import type { CardSummary, ReadFile, SceneSummary, WorkspaceStore } from '../workspace/workspaceStore';
import { planCardListUpdate, planCardRename, type CardListField } from './cardEditor';

export type CardKind = 'character' | 'background';

// The single access facade for story content, and the only caller of the mutate gate. Every
// authored write goes editor.plan(...) -> gate.apply(...) here, so validation and the freshness
// guard can never be bypassed by a new command handler.
export class ContentService {
  public constructor(
    private readonly store: WorkspaceStore,
    private readonly gate: MutateGate,
  ) {}

  public listCards(): Promise<CardSummary[]> {
    return this.store.listCards();
  }

  public listScenes(): Promise<SceneSummary[]> {
    return this.store.listScenes();
  }

  public readCard(kind: CardKind, id: string): Promise<ReadFile<StoryboardCard>> {
    return this.store.readCard(kind, id);
  }

  public async renameCard(kind: CardKind, id: string, name: string): Promise<MutateOutcome> {
    const current = await this.store.readCard(kind, id);
    return this.applyPlan(planCardRename(current, name));
  }

  public async updateCardList(
    kind: CardKind,
    id: string,
    field: CardListField,
    values: readonly string[],
  ): Promise<MutateOutcome> {
    const current = await this.store.readCard(kind, id);
    return this.applyPlan(planCardListUpdate(current, field, values));
  }

  // Generated drafts are gitignored, so a regenerate cannot be undone with git. The previous
  // version is archived under `.draft/<scene>/` first — the same convention the extension uses.
  public async writeDraft(sceneStem: string, body: string): Promise<MutateOutcome> {
    const relativePath = draftRelativePath(sceneStem);
    const existing = await this.store.readDraft(sceneStem);

    const writes = [{ relativePath, content: body, baselineHash: existing?.contentHash }];

    if (existing !== undefined && existing.value !== body) {
      writes.unshift({
        relativePath: await this.nextDraftHistoryPath(sceneStem),
        content: existing.value,
        baselineHash: undefined,
      });
    }

    return this.gate.apply({ writes }, `storygram: generate ${relativePath}`);
  }

  private async nextDraftHistoryPath(sceneStem: string): Promise<string> {
    const directory = `${STORYBOARD_RELATIVE_PATHS.draftHistoryDirectory}/${sceneStem}`;
    const existing = await this.store.listDirectoryNames(directory);
    const revision = String(existing.length + 1).padStart(2, '0');

    return `${directory}/${this.stamp()}-rev-${revision}.md`;
  }

  private stamp(): string {
    const now = new Date();
    const pad = (value: number): string => String(value).padStart(2, '0');
    return [
      now.getFullYear(),
      pad(now.getMonth() + 1),
      pad(now.getDate()),
      pad(now.getHours()),
      pad(now.getMinutes()),
    ].join('-');
  }

  private applyPlan(plan: WorkspacePlan): Promise<MutateOutcome> {
    return this.gate.apply(plan.changes, plan.commitMessage);
  }
}
