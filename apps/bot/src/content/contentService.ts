import type { StoryboardCard } from '@storyboard/story-format';

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

  private applyPlan(plan: WorkspacePlan): Promise<MutateOutcome> {
    return this.gate.apply(plan.changes, plan.commitMessage);
  }
}
