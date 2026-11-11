import {
  emptyInterviewAxesFile,
  interviewAxesFileSchema,
  interviewWorkingModelSchema,
  parseInterviewAxesFile,
  parseInterviewWorkingModel,
  replacePendingHeader,
  replacePendingStatements,
  type PendingHeaderChange,
  type InterviewAxesFile,
  type InterviewWorkingModel,
  type Statement,
  type StoryUri,
} from '@storyboard/story-model';

import type { IInterviewRepository } from '#engine/application/interviews/interviewRepository';
import type { CardRoster, WorkspaceCards } from '#engine/persistence/bundles/workspaceCards';
import { SessionStore, type SessionRecord } from '#engine/persistence/cache/sessionStore';
import type { WorkspaceCaches } from '#engine/persistence/cache/workspaceCaches';

export interface InterviewRepositoryDependencies {
  readonly caches: WorkspaceCaches;
  readonly cards: WorkspaceCards;
}

interface InterviewSessionData {
  readonly workingModel?: unknown;
  readonly pendingStatements?: readonly Statement[];
}

const axesSessionId: string = 'interview-axes';

export function describeInterviewSessionLocation(cardId: string): string {
  return `캐시 DB 의 ${cardId} 인터뷰 세션`;
}

function interviewSessionId(elementId: string): string {
  return `interview:${elementId}`;
}

function sessionDataOf(record: SessionRecord | undefined): InterviewSessionData {
  const data: unknown = record?.data;
  return typeof data === 'object' && data !== null ? (data as InterviewSessionData) : {};
}

export class InterviewRepository implements IInterviewRepository {
  public constructor(
    private readonly dependencies: InterviewRepositoryDependencies,
    private readonly now: () => Date = (): Date => new Date(),
  ) {}

  public async loadAxes(workspaceRoot: StoryUri): Promise<InterviewAxesFile> {
    const record: SessionRecord | undefined = (await this.store(workspaceRoot)).find(axesSessionId);

    return record === undefined
      ? emptyInterviewAxesFile
      : parseInterviewAxesFile(JSON.stringify(record.data));
  }

  public async saveAxes(workspaceRoot: StoryUri, file: InterviewAxesFile): Promise<void> {
    const store: SessionStore = await this.store(workspaceRoot);
    store.save({
      id: axesSessionId,
      kind: 'interview',
      openedAt: store.find(axesSessionId)?.openedAt ?? this.now().toISOString(),
      data: interviewAxesFileSchema.parse(file),
      pendingCount: 0,
    });
  }

  public async loadWorkingModel(
    workspaceRoot: StoryUri,
    cardId: string,
  ): Promise<InterviewWorkingModel | undefined> {
    const elementId: string | undefined = await this.resolveElementId(workspaceRoot, cardId);
    if (elementId === undefined) {
      return undefined;
    }

    const model: unknown = sessionDataOf(
      (await this.store(workspaceRoot)).find(interviewSessionId(elementId)),
    ).workingModel;
    return model === undefined ? undefined : parseInterviewWorkingModel(JSON.stringify(model));
  }

  public async saveWorkingModel(
    workspaceRoot: StoryUri,
    model: InterviewWorkingModel,
  ): Promise<void> {
    await this.updateCardSession(workspaceRoot, model.cardId, (data, record) => ({
      data: { ...data, workingModel: interviewWorkingModelSchema.parse(model) },
      pendingCount: record?.pendingCount ?? 0,
    }));
  }

  public async deleteWorkingModels(workspaceRoot: StoryUri): Promise<void> {
    const store: SessionStore = await this.store(workspaceRoot);

    for (const record of store.listByKind('interview')) {
      if (record.elementId === undefined) {
        continue;
      }

      const { workingModel: _workingModel, ...rest } = sessionDataOf(record);
      store.update(record.id, { data: rest, pendingCount: record.pendingCount });
    }
  }

  public async savePendingStatements(
    workspaceRoot: StoryUri,
    cardId: string,
    statements: readonly Statement[],
    header?: PendingHeaderChange,
  ): Promise<void> {
    await this.updateCardSession(workspaceRoot, cardId, (data) => ({
      data: replacePendingHeader(replacePendingStatements(data, statements), header),
      pendingCount: statements.length + (header === undefined ? 0 : 1),
    }));
  }

  private async updateCardSession(
    workspaceRoot: StoryUri,
    cardId: string,
    change: (
      data: InterviewSessionData,
      record: SessionRecord | undefined,
    ) => { readonly data: unknown; readonly pendingCount: number },
  ): Promise<void> {
    const elementId: string | undefined = await this.resolveElementId(workspaceRoot, cardId);
    if (elementId === undefined) {
      throw new Error(`인터뷰할 카드가 없습니다: ${cardId}`);
    }

    const store: SessionStore = await this.store(workspaceRoot);
    const id: string = interviewSessionId(elementId);
    const record: SessionRecord | undefined = store.find(id);
    const changed: { readonly data: unknown; readonly pendingCount: number } = change(
      sessionDataOf(record),
      record,
    );

    store.save({
      id,
      kind: 'interview',
      elementId,
      openedAt: record?.openedAt ?? this.now().toISOString(),
      data: changed.data,
      pendingCount: changed.pendingCount,
    });
  }

  private async resolveElementId(
    workspaceRoot: StoryUri,
    cardId: string,
  ): Promise<string | undefined> {
    const roster: CardRoster = await this.dependencies.cards.loadRoster(workspaceRoot, [
      'character',
      'background',
    ]);

    return roster.lookup.idOf('character', cardId) ?? roster.lookup.idOf('background', cardId);
  }

  private async store(workspaceRoot: StoryUri): Promise<SessionStore> {
    return new SessionStore(await this.dependencies.caches.open(workspaceRoot));
  }
}
