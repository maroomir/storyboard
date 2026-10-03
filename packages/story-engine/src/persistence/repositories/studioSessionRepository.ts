import { joinStoryPath, type StoryUri } from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import { listDirectoryFileNames } from '#engine/persistence/directoryFiles';
import {
  deriveStudioSessionTitle,
  parseStudioSession,
  selectSessionsToPrune,
  serializeStudioSession,
  studioSessionVersion,
  type StudioSession,
} from '#engine/domain/files/studioSession';
import type {
  StudioChatTurn,
  StudioEntity,
  StudioSessionSnapshot,
  StudioSessionSummary,
} from '#engine/shared/messaging/studio';
import { studioSessionEntityDirectory } from '#engine/paths/projectPaths';

export interface StudioSessionSaveInput {
  readonly id: string;
  readonly entity: StudioEntity;
  readonly createdAt: string;
  readonly hasAppliedChanges: boolean;
  readonly turns: readonly StudioChatTurn[];
}

export interface IStudioSessionRepository {
  save(workspaceRoot: StoryUri, input: StudioSessionSaveInput): Promise<void>;
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

// SECURITY: session ids arrive from the webview and are used as file names; reject anything
// that could escape the sessions directory.
const safeSessionIdPattern = /^[A-Za-z0-9-]+$/;

export class StudioSessionRepository implements IStudioSessionRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async save(workspaceRoot: StoryUri, input: StudioSessionSaveInput): Promise<void> {
    const directory = studioSessionEntityDirectory(workspaceRoot, input.entity);

    if (!directory || !safeSessionIdPattern.test(input.id)) {
      return;
    }

    await this.fileSystem.createDirectory(directory);

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

    await this.fileSystem.writeFile(
      sessionFileUri(directory, input.id),
      new TextEncoder().encode(serializeStudioSession(session)),
    );

    await this.prune(directory);
  }

  public async list(
    workspaceRoot: StoryUri,
    entity: StudioEntity,
  ): Promise<readonly StudioSessionSummary[]> {
    const sessions = await this.readAll(studioSessionEntityDirectory(workspaceRoot, entity));

    return sessions
      .map(toSummary)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  public async load(
    workspaceRoot: StoryUri,
    entity: StudioEntity,
    id: string,
  ): Promise<StudioSessionSnapshot | undefined> {
    const directory = studioSessionEntityDirectory(workspaceRoot, entity);

    if (!directory || !safeSessionIdPattern.test(id)) {
      return undefined;
    }

    const session = await this.readSession(sessionFileUri(directory, id));

    return session ? toSnapshot(session) : undefined;
  }

  public async loadLatest(
    workspaceRoot: StoryUri,
    entity: StudioEntity,
  ): Promise<StudioSessionSnapshot | undefined> {
    const sessions = [...(await this.readAll(studioSessionEntityDirectory(workspaceRoot, entity)))];

    const latest = sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];

    return latest ? toSnapshot(latest) : undefined;
  }

  private async prune(directory: StoryUri): Promise<void> {
    const sessions = await this.readAll(directory);
    const prunedIds = selectSessionsToPrune(sessions);

    await Promise.all(
      prunedIds.map((id) =>
        Promise.resolve(this.fileSystem.delete(sessionFileUri(directory, id))).catch(
          () => undefined,
        ),
      ),
    );
  }

  private async readAll(directory: StoryUri | undefined): Promise<readonly StudioSession[]> {
    if (!directory) {
      return [];
    }

    const names = await listDirectoryFileNames(this.fileSystem, directory, (name) =>
      name.endsWith('.json'),
    );
    const sessions = await Promise.all(
      names.map((name) => this.readSession(joinStoryPath(directory, name))),
    );

    return sessions.filter((session): session is StudioSession => session !== undefined);
  }

  private async readSession(uri: StoryUri): Promise<StudioSession | undefined> {
    try {
      const bytes = await this.fileSystem.readFile(uri);
      return parseStudioSession(new TextDecoder().decode(bytes));
    } catch {
      return undefined;
    }
  }
}

function sessionFileUri(directory: StoryUri, id: string): StoryUri {
  return joinStoryPath(directory, `${id}.json`);
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
