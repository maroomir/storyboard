import {
  STORYBOARD_RELATIVE_PATHS,
  canonicalizeCardText,
  convertLegacySceneText,
  draftRelativePath,
  type StoryboardCard,
} from '@storyboard/story-format';

import type { MutateGate } from '@/workspace/mutateGate';
import type {
  MutateOutcome,
  WorkspaceDeletion,
  WorkspacePlan,
  WorkspaceWrite,
} from '@/workspace/workspaceChanges';
import { hashContent } from '@/workspace/workspaceStore';
import type {
  CardSummary,
  ReadFile,
  SceneSummary,
  WorkspaceStore,
} from '@/workspace/workspaceStore';
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

  public async listUnformattedCardIds(): Promise<string[]> {
    return (await this.collectFormattingWrites()).ids;
  }

  // Rewrites every card that is not already in canonical form, as one commit of its own, so a
  // later content edit produces a diff of just that edit. Returns undefined when nothing needs it.
  public async normalizeCardFormatting(): Promise<
    { readonly outcome: MutateOutcome; readonly ids: readonly string[] } | undefined
  > {
    const { writes, ids } = await this.collectFormattingWrites();

    if (writes.length === 0) {
      return undefined;
    }

    return {
      outcome: await this.gate.apply({ writes }, 'storyboard-bot: normalize card formatting'),
      ids,
    };
  }

  private async collectFormattingWrites(): Promise<{
    writes: WorkspaceWrite[];
    ids: string[];
  }> {
    const writes: WorkspaceWrite[] = [];
    const ids: string[] = [];

    for (const card of await this.store.listCards()) {
      const raw = await this.store.readText(card.relativePath);
      const canonical = canonicalizeCardText(raw);

      if (!canonical.changed) {
        continue;
      }

      writes.push({
        relativePath: card.relativePath,
        content: canonical.text,
        baselineHash: hashContent(raw),
      });
      ids.push(card.id);
    }

    return { writes, ids };
  }

  public listLegacySceneTexts(): Promise<string[]> {
    return this.store.listLegacySceneTextFileNames();
  }

  // Converts every legacy scene text into a scene card and removes the original, as one commit.
  // Deterministic only — the freshness guard refuses when Desktop touched a scene mid-migration.
  public async migrateLegacyScenes(): Promise<
    | {
        readonly outcome: MutateOutcome;
        readonly stems: readonly string[];
        readonly failures: readonly string[];
      }
    | undefined
  > {
    const legacyFileNames = await this.store.listLegacySceneTextFileNames();

    if (legacyFileNames.length === 0) {
      return undefined;
    }

    const writes: WorkspaceWrite[] = [];
    const deletions: WorkspaceDeletion[] = [];
    const stems: string[] = [];
    const failures: string[] = [];

    for (const legacyFileName of legacyFileNames) {
      const relativePath = `${STORYBOARD_RELATIVE_PATHS.sceneDirectory}/${legacyFileName}`;

      try {
        const raw = await this.store.readText(relativePath);
        const conversion = convertLegacySceneText(raw, legacyFileName);

        writes.push({
          relativePath: `${STORYBOARD_RELATIVE_PATHS.sceneDirectory}/${conversion.fileName}`,
          content: conversion.text,
          baselineHash: undefined,
        });
        deletions.push({ relativePath, baselineHash: hashContent(raw) });
        stems.push(conversion.stem);
      } catch {
        failures.push(legacyFileName);
      }
    }

    if (writes.length === 0) {
      return { outcome: { status: 'no-op' }, stems, failures };
    }

    return {
      outcome: await this.gate.apply(
        { writes, deletions },
        'storyboard-bot: migrate scenes to card format',
      ),
      stems,
      failures,
    };
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

    return this.gate.apply({ writes }, `storyboard-bot: generate ${relativePath}`);
  }

  // Tracked generated outputs (synopsis.md, chapters.yaml) commit with the enqueue-time baseline,
  // so a Desktop edit that lands while the job runs wins and the job reports a conflict.
  public writeTracked(
    relativePath: string,
    body: string,
    baselineHash: string | undefined,
    commitMessage: string,
  ): Promise<MutateOutcome> {
    return this.gate.apply(
      { writes: [{ relativePath, content: body, baselineHash }] },
      commitMessage,
    );
  }

  // Gitignored artifacts (manuscript/) overwrite in place: they are always reproducible from the
  // tracked inputs, so last-writer-wins is acceptable and no commit is attempted.
  public async writeArtifact(relativePath: string, body: string): Promise<MutateOutcome> {
    const current = await this.tryReadText(relativePath);
    return this.gate.apply(
      { writes: [{ relativePath, content: body, baselineHash: current }] },
      `storyboard-bot: generate ${relativePath}`,
    );
  }

  private async tryReadText(relativePath: string): Promise<string | undefined> {
    try {
      const raw = await this.store.readText(relativePath);
      return hashContent(raw);
    } catch {
      return undefined;
    }
  }

  private async nextDraftHistoryPath(sceneStem: string): Promise<string> {
    const directory = `${STORYBOARD_RELATIVE_PATHS.draftHistoryDirectory}/${sceneStem}`;
    const existing = await this.store.listDirectoryNames(directory);
    // Count-based numbering would collide after a manual deletion; continue from the highest
    // revision actually present.
    const highestRevision = existing.reduce((highest, name) => {
      const match = /-rev-(\d+)\.md$/.exec(name);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0);
    const revision = String(highestRevision + 1).padStart(2, '0');

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
