import {
  deriveStudioSessionTitle,
  parseStudioSession,
  serializeStudioSession,
  studioSessionVersion,
  type StoryUri,
  type StudioChatTurn,
  type StudioEntity,
  type StudioSession,
  type StudioSessionSaveRequestPayload,
  type StudioSessionSnapshot,
  type StudioSessionSummary,
} from '@storyboard/story-model';

import type { WorkspaceCards } from '#engine/persistence/bundles/workspaceCards';
import type { WorkspaceScenes } from '#engine/persistence/bundles/workspaceScenes';
import { SessionStore, type SessionRecord } from '#engine/persistence/cache/sessionStore';
import type { WorkspaceCaches } from '#engine/persistence/cache/workspaceCaches';

export interface IStudioSessionRepository {
  save(workspaceRoot: StoryUri, input: StudioSessionSaveRequestPayload): Promise<void>;
  list(workspaceRoot: StoryUri, entity: StudioEntity): Promise<readonly StudioSessionSummary[]>;
  load(
    workspaceRoot: StoryUri,
    entity: StudioEntity,
    id: string,
  ): Promise<StudioSessionSnapshot | undefined>;
  loadLatest(
    workspaceRoot: StoryUri,
    entity: StudioEntity,
  ): Promise<StudioSessionSnapshot | undefined>;
}

export interface StudioSessionRepositoryDependencies {
  readonly caches: WorkspaceCaches;
  readonly cards: WorkspaceCards;
  readonly scenes: WorkspaceScenes;
}

const projectSessionElementId: string = 'project';

export function countPendingProposals(turns: readonly StudioChatTurn[]): number {
  return turns.filter(
    (turn) => turn.role === 'assistant' && turn.kind === 'proposal' && turn.status === 'pending',
  ).length;
}

function readStudioSession(record: SessionRecord): StudioSession | undefined {
  if (record.kind !== 'studio') {
    return undefined;
  }

  try {
    return parseStudioSession(JSON.stringify(record.data));
  } catch {
    return undefined;
  }
}

function toSummary(session: StudioSession): StudioSessionSummary {
  return {
    id: session.id,
    title: session.title,
    updatedAt: session.updatedAt,
    turnCount: session.turns.length,
    hasAppliedChanges: session.hasAppliedChanges,
  };
}

function toSnapshot(session: StudioSession): StudioSessionSnapshot {
  return {
    id: session.id,
    entity: session.entity,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    title: session.title,
    hasAppliedChanges: session.hasAppliedChanges,
    turns: [...session.turns],
  };
}

function newestFirst(left: StudioSession, right: StudioSession): number {
  return right.updatedAt.localeCompare(left.updatedAt);
}

export class StudioSessionRepository implements IStudioSessionRepository {
  public constructor(private readonly dependencies: StudioSessionRepositoryDependencies) {}

  public async save(
    workspaceRoot: StoryUri,
    input: StudioSessionSaveRequestPayload,
  ): Promise<void> {
    const elementId: string | undefined = await this.resolveElementId(workspaceRoot, input.entity);
    if (elementId === undefined) {
      return;
    }

    const session: StudioSession = {
      version: studioSessionVersion,
      id: input.id,
      entity: input.entity,
      createdAt: input.createdAt,
      updatedAt: new Date().toISOString(),
      title: deriveStudioSessionTitle(input.turns),
      hasAppliedChanges: input.hasAppliedChanges,
      turns: [...input.turns],
    };

    (await this.store(workspaceRoot)).save({
      id: session.id,
      kind: 'studio',
      elementId,
      openedAt: session.createdAt,
      pendingCount: countPendingProposals(session.turns),
      data: JSON.parse(serializeStudioSession(session)),
    });
  }

  public async list(
    workspaceRoot: StoryUri,
    entity: StudioEntity,
  ): Promise<readonly StudioSessionSummary[]> {
    return (await this.readAll(workspaceRoot, entity)).map(toSummary);
  }

  public async load(
    workspaceRoot: StoryUri,
    entity: StudioEntity,
    id: string,
  ): Promise<StudioSessionSnapshot | undefined> {
    const session: StudioSession | undefined = (await this.readAll(workspaceRoot, entity)).find(
      (candidate) => candidate.id === id,
    );

    return session === undefined ? undefined : toSnapshot(session);
  }

  public async loadLatest(
    workspaceRoot: StoryUri,
    entity: StudioEntity,
  ): Promise<StudioSessionSnapshot | undefined> {
    const latest: StudioSession | undefined = (await this.readAll(workspaceRoot, entity))[0];

    return latest === undefined ? undefined : toSnapshot(latest);
  }

  public async listSessions(
    workspaceRoot: StoryUri,
    entity: StudioEntity,
  ): Promise<readonly StudioSession[]> {
    return await this.readAll(workspaceRoot, entity);
  }

  private async readAll(
    workspaceRoot: StoryUri,
    entity: StudioEntity,
  ): Promise<readonly StudioSession[]> {
    const elementId: string | undefined = await this.resolveElementId(workspaceRoot, entity);
    if (elementId === undefined) {
      return [];
    }

    return (await this.store(workspaceRoot))
      .listForElement(elementId)
      .flatMap((record): StudioSession[] => {
        const session: StudioSession | undefined = readStudioSession(record);
        return session === undefined ? [] : [session];
      })
      .sort(newestFirst);
  }

  private async resolveElementId(
    workspaceRoot: StoryUri,
    entity: StudioEntity,
  ): Promise<string | undefined> {
    if (entity.kind === 'project') {
      return projectSessionElementId;
    }

    if (entity.kind === 'scene') {
      return (await this.dependencies.scenes.find(workspaceRoot, entity.key))?.content.header.id;
    }

    return (await this.dependencies.cards.loadRoster(workspaceRoot, [entity.kind])).lookup.idOf(
      entity.kind,
      entity.key,
    );
  }

  private async store(workspaceRoot: StoryUri): Promise<SessionStore> {
    return new SessionStore(await this.dependencies.caches.open(workspaceRoot));
  }
}
