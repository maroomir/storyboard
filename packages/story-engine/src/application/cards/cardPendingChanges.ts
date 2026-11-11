import {
  mergeStatements,
  parseStudioSession,
  readPendingHeader,
  readPendingStatements,
  replacePendingHeader,
  replacePendingStatements,
  type PendingHeaderChange,
  serializeStudioSession,
  type Statement,
  type StatementMergeResult,
  type StoryUri,
  type StudioChatTurn,
  type StudioEntity,
  type StudioProposalTurn,
  type StudioSession,
} from '@storyboard/story-model';

import type {
  StudioProposalApplier,
  StudioProposalApplyResult,
} from '#engine/application/studio/studioProposalApplier';
import type { ElementBundle } from '#engine/persistence/bundles/elementBundleRepository';
import type { WorkspaceCards } from '#engine/persistence/bundles/workspaceCards';
import { SessionStore, type SessionRecord } from '#engine/persistence/cache/sessionStore';
import type { WorkspaceCaches } from '#engine/persistence/cache/workspaceCaches';
import { countPendingProposals } from '#engine/persistence/repositories/studioSessionRepository';

export interface CardPendingChangesDependencies {
  readonly cards: WorkspaceCards;
  readonly caches: WorkspaceCaches;
  readonly applier: StudioProposalApplier;
}

export interface PendingCardChange {
  readonly sessionId: string;
  readonly origin: SessionRecord['kind'];
  readonly summary: string;
  readonly statements: readonly Statement[];
}

export interface PendingCardChanges {
  readonly slug: string;
  readonly path: string;
  readonly changes: readonly PendingCardChange[];
}

export interface CardPendingApplyReport {
  readonly applied: number;
  readonly heldByAuthor: readonly Statement[];
  readonly failures: readonly string[];
}

export type CardPendingResult<TReport> =
  | { readonly ok: true; readonly report: TReport }
  | { readonly ok: false; readonly kind: 'missing'; readonly message: string };

interface PendingSession {
  readonly record: SessionRecord;
  readonly studio?: StudioSession;
  readonly statements: readonly Statement[];
  readonly header?: PendingHeaderChange;
}

function isPendingProposal(turn: StudioChatTurn): turn is StudioProposalTurn {
  return turn.role === 'assistant' && turn.kind === 'proposal' && turn.status === 'pending';
}

function readStudio(record: SessionRecord): StudioSession | undefined {
  if (record.kind !== 'studio') {
    return undefined;
  }

  try {
    return parseStudioSession(JSON.stringify(record.data));
  } catch {
    return undefined;
  }
}

function describeChange(session: PendingSession): readonly PendingCardChange[] {
  const proposals: readonly PendingCardChange[] = (session.studio?.turns ?? [])
    .filter(isPendingProposal)
    .map((turn) => ({
      sessionId: session.record.id,
      origin: session.record.kind,
      summary: turn.summary,
      statements: [],
    }));
  const headerKeys: readonly string[] = Object.keys(session.header ?? {});
  const lineCount: number = session.statements.length + headerKeys.length;
  const statements: readonly PendingCardChange[] =
    lineCount === 0
      ? []
      : [
          {
            sessionId: session.record.id,
            origin: session.record.kind,
            summary: `${lineCount}줄`,
            statements: session.statements,
          },
        ];

  return [...proposals, ...statements];
}

export interface PendingCardSummary {
  readonly slug: string;
  readonly name: string;
  readonly changeCount: number;
  readonly origins: readonly SessionRecord['kind'][];
}

export interface CardSessionSummary {
  readonly id: string;
  readonly kind: SessionRecord['kind'];
  readonly title: string;
  readonly openedAt: string;
  readonly updatedAt: string;
  readonly pendingCount: number;
}

function titleOfSession(record: SessionRecord): string {
  const data: unknown = record.data;
  const fields: Readonly<Record<string, unknown>> =
    typeof data === 'object' && data !== null ? (data as Readonly<Record<string, unknown>>) : {};
  const named: unknown = record.kind === 'absorb' ? fields.location : fields.title;

  return typeof named === 'string' && named.length > 0 ? named : record.kind;
}

export class CardPendingChangesDesk {
  public constructor(private readonly dependencies: CardPendingChangesDependencies) {}

  public async listCards(workspaceRoot: StoryUri): Promise<readonly PendingCardSummary[]> {
    const elementIds: ReadonlySet<string> = new Set(
      (await this.store(workspaceRoot))
        .listWithPending()
        .flatMap((record) => (record.elementId === undefined ? [] : [record.elementId])),
    );
    const bundles: readonly ElementBundle[] = (
      await this.dependencies.cards.loadRoster(workspaceRoot)
    ).bundles.filter((bundle) => elementIds.has(bundle.header.id));
    const summaries: PendingCardSummary[] = [];

    for (const bundle of bundles) {
      const changes: readonly PendingCardChange[] = (
        await this.loadPendingSessions(workspaceRoot, bundle)
      ).flatMap(describeChange);
      summaries.push({
        slug: bundle.header.slug,
        name: 'name' in bundle.header ? String(bundle.header.name) : bundle.header.slug,
        changeCount: changes.length,
        origins: [...new Set(changes.map((change) => change.origin))],
      });
    }

    return summaries;
  }

  public async listHistory(
    workspaceRoot: StoryUri,
    slug: string,
  ): Promise<CardPendingResult<readonly CardSessionSummary[]>> {
    const bundle: ElementBundle | undefined = await this.dependencies.cards.findBundleBySlug(
      workspaceRoot,
      slug,
    );
    if (bundle === undefined) {
      return { ok: false, kind: 'missing', message: `카드가 없습니다: ${slug}` };
    }

    const report: readonly CardSessionSummary[] = (await this.store(workspaceRoot))
      .listForElement(bundle.header.id)
      .map((record) => ({
        id: record.id,
        kind: record.kind,
        title: titleOfSession(record),
        openedAt: record.openedAt,
        updatedAt: record.updatedAt,
        pendingCount: record.pendingCount,
      }));
    return { ok: true, report };
  }

  public async list(
    workspaceRoot: StoryUri,
    slug: string,
  ): Promise<CardPendingResult<PendingCardChanges>> {
    const bundle: ElementBundle | undefined = await this.dependencies.cards.findBundleBySlug(
      workspaceRoot,
      slug,
    );
    if (bundle === undefined) {
      return { ok: false, kind: 'missing', message: `카드가 없습니다: ${slug}` };
    }

    const sessions: readonly PendingSession[] = await this.loadPendingSessions(workspaceRoot, bundle);
    return {
      ok: true,
      report: { slug, path: bundle.path, changes: sessions.flatMap(describeChange) },
    };
  }

  public async apply(
    workspaceRoot: StoryUri,
    slug: string,
  ): Promise<CardPendingResult<CardPendingApplyReport>> {
    const bundle: ElementBundle | undefined = await this.dependencies.cards.findBundleBySlug(
      workspaceRoot,
      slug,
    );
    if (bundle === undefined) {
      return { ok: false, kind: 'missing', message: `카드가 없습니다: ${slug}` };
    }

    const store: SessionStore = await this.store(workspaceRoot);
    const report: { applied: number; heldByAuthor: Statement[]; failures: string[] } = {
      applied: 0,
      heldByAuthor: [],
      failures: [],
    };
    for (const session of await this.loadPendingSessions(workspaceRoot, bundle)) {
      await this.applyProposals(workspaceRoot, store, bundle, session, report);
      await this.applyStatements(workspaceRoot, store, slug, session, report);
    }

    return { ok: true, report };
  }

  public async discard(
    workspaceRoot: StoryUri,
    slug: string,
  ): Promise<CardPendingResult<{ readonly discarded: number }>> {
    const bundle: ElementBundle | undefined = await this.dependencies.cards.findBundleBySlug(
      workspaceRoot,
      slug,
    );
    if (bundle === undefined) {
      return { ok: false, kind: 'missing', message: `카드가 없습니다: ${slug}` };
    }

    const store: SessionStore = await this.store(workspaceRoot);
    let discarded: number = 0;
    for (const session of await this.loadPendingSessions(workspaceRoot, bundle)) {
      discarded += describeChange(session).length;
      this.settleSession(store, session, (turn) => ({ ...turn, status: 'rejected' }));
    }

    return { ok: true, report: { discarded } };
  }

  private async applyProposals(
    workspaceRoot: StoryUri,
    store: SessionStore,
    bundle: ElementBundle,
    session: PendingSession,
    report: { applied: number; failures: string[] },
  ): Promise<void> {
    if (session.studio === undefined) {
      return;
    }

    const entity: StudioEntity = session.studio.entity;
    const results: Map<string, StudioProposalApplyResult> = new Map();
    for (const turn of session.studio.turns.filter(isPendingProposal)) {
      const result: StudioProposalApplyResult = await this.dependencies.applier.apply(
        workspaceRoot,
        { ...entity, key: bundle.header.slug },
        turn,
      );
      results.set(turn.id, result);
      if (result.status === 'applied') {
        report.applied += 1;
      } else {
        report.failures.push(result.message);
      }
    }

    this.settleSession(store, session, (turn) => {
      const result: StudioProposalApplyResult | undefined = results.get(turn.id);
      return result === undefined
        ? turn
        : {
            ...turn,
            status: result.status,
            ...(result.status === 'failed' ? { errorMessage: result.message } : {}),
          };
    });
  }

  private async applyStatements(
    workspaceRoot: StoryUri,
    store: SessionStore,
    slug: string,
    session: PendingSession,
    report: { applied: number; heldByAuthor: Statement[] },
  ): Promise<void> {
    if (session.statements.length === 0 && session.header === undefined) {
      return;
    }

    const current: ElementBundle | undefined = await this.dependencies.cards.findBundleBySlug(
      workspaceRoot,
      slug,
    );
    if (current === undefined) {
      return;
    }

    const merged: StatementMergeResult = mergeStatements(current.statements, session.statements);
    await this.dependencies.cards.rewriteBundle(workspaceRoot, current, {
      header: { ...current.header, ...(session.header ?? {}) } as ElementBundle['header'],
      statements: merged.statements,
    });
    report.applied +=
      merged.added.length + merged.replaced.length + Object.keys(session.header ?? {}).length;
    report.heldByAuthor.push(...merged.heldByAuthor);
    this.clearStatements(store, session);
  }

  private settleSession(
    store: SessionStore,
    session: PendingSession,
    settle: (turn: StudioProposalTurn) => StudioChatTurn,
  ): void {
    if (session.studio === undefined) {
      this.clearStatements(store, session);
      return;
    }

    const turns: StudioChatTurn[] = session.studio.turns.map((turn) =>
      isPendingProposal(turn) ? settle(turn) : turn,
    );
    const hasAppliedChanges: boolean =
      session.studio.hasAppliedChanges ||
      turns.some((turn) => turn.role === 'assistant' && turn.kind === 'proposal' && turn.status === 'applied');
    const settled: StudioSession = { ...session.studio, turns, hasAppliedChanges };

    store.update(session.record.id, {
      data: JSON.parse(serializeStudioSession(settled)),
      pendingCount: countPendingProposals(turns),
    });
  }

  private clearStatements(store: SessionStore, session: PendingSession): void {
    store.update(session.record.id, {
      data: replacePendingHeader(replacePendingStatements(session.record.data, []), undefined),
      pendingCount: 0,
    });
  }

  private async loadPendingSessions(
    workspaceRoot: StoryUri,
    bundle: ElementBundle,
  ): Promise<readonly PendingSession[]> {
    return (await this.store(workspaceRoot))
      .listForElement(bundle.header.id)
      .filter((record) => record.pendingCount > 0)
      .map((record) => {
        const studio: StudioSession | undefined = readStudio(record);
        const header: PendingHeaderChange | undefined = readPendingHeader(record.data);
        return {
          record,
          ...(studio === undefined ? {} : { studio }),
          statements: readPendingStatements(record.data),
          ...(header === undefined ? {} : { header }),
        };
      });
  }

  private async store(workspaceRoot: StoryUri): Promise<SessionStore> {
    return new SessionStore(await this.dependencies.caches.open(workspaceRoot));
  }
}
