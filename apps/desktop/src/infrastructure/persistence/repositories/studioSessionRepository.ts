import * as vscode from 'vscode';

import {
  deriveStudioSessionTitle,
  parseStudioSession,
  selectSessionsToPrune,
  serializeStudioSession,
  studioSessionVersion,
  type StudioSession,
} from '../../../domain/files/studioSession';
import type {
  StudioChatTurn,
  StudioEntity,
  StudioSessionSnapshot,
  StudioSessionSummary,
} from '../../../shared/messaging';
import { studioSessionEntityDirectory } from '../../vscode/pathConventions';

export interface StudioSessionSaveInput {
  readonly id: string;
  readonly entity: StudioEntity;
  readonly createdAt: string;
  readonly hasAppliedChanges: boolean;
  readonly turns: readonly StudioChatTurn[];
}

export interface IStudioSessionRepository {
  save(workspaceRoot: vscode.Uri, input: StudioSessionSaveInput): Promise<void>;
  list(workspaceRoot: vscode.Uri, entity: StudioEntity): Promise<readonly StudioSessionSummary[]>;
  load(
    workspaceRoot: vscode.Uri,
    entity: StudioEntity,
    id: string,
  ): Promise<StudioSessionSnapshot | undefined>;
  loadLatest(
    workspaceRoot: vscode.Uri,
    entity: StudioEntity,
  ): Promise<StudioSessionSnapshot | undefined>;
}

// SECURITY: session ids arrive from the webview and are used as file names; reject anything
// that could escape the sessions directory.
const safeSessionIdPattern = /^[A-Za-z0-9-]+$/;

export class StudioSessionRepository implements IStudioSessionRepository {
  public async save(workspaceRoot: vscode.Uri, input: StudioSessionSaveInput): Promise<void> {
    const directory = studioSessionEntityDirectory(workspaceRoot, input.entity);

    if (!directory || !safeSessionIdPattern.test(input.id)) {
      return;
    }

    await vscode.workspace.fs.createDirectory(directory);

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

    await vscode.workspace.fs.writeFile(
      sessionFileUri(directory, input.id),
      new TextEncoder().encode(serializeStudioSession(session)),
    );

    await this.prune(directory);
  }

  public async list(
    workspaceRoot: vscode.Uri,
    entity: StudioEntity,
  ): Promise<readonly StudioSessionSummary[]> {
    const sessions = await this.readAll(studioSessionEntityDirectory(workspaceRoot, entity));

    return sessions
      .map(toSummary)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  public async load(
    workspaceRoot: vscode.Uri,
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
    workspaceRoot: vscode.Uri,
    entity: StudioEntity,
  ): Promise<StudioSessionSnapshot | undefined> {
    const sessions = [...(await this.readAll(studioSessionEntityDirectory(workspaceRoot, entity)))];

    const latest = sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];

    return latest ? toSnapshot(latest) : undefined;
  }

  private async prune(directory: vscode.Uri): Promise<void> {
    const sessions = await this.readAll(directory);
    const prunedIds = selectSessionsToPrune(sessions);

    await Promise.all(
      prunedIds.map((id) =>
        Promise.resolve(vscode.workspace.fs.delete(sessionFileUri(directory, id))).catch(
          () => undefined,
        ),
      ),
    );
  }

  private async readAll(directory: vscode.Uri | undefined): Promise<readonly StudioSession[]> {
    if (!directory) {
      return [];
    }

    let entries: [string, vscode.FileType][];

    try {
      entries = await vscode.workspace.fs.readDirectory(directory);
    } catch {
      return [];
    }

    const sessions = await Promise.all(
      entries
        .filter(([name]) => name.endsWith('.json'))
        .map(([name]) => this.readSession(vscode.Uri.joinPath(directory, name))),
    );

    return sessions.filter((session): session is StudioSession => session !== undefined);
  }

  private async readSession(uri: vscode.Uri): Promise<StudioSession | undefined> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return parseStudioSession(new TextDecoder().decode(bytes));
    } catch {
      return undefined;
    }
  }
}

function sessionFileUri(directory: vscode.Uri, id: string): vscode.Uri {
  return vscode.Uri.joinPath(directory, `${id}.json`);
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
