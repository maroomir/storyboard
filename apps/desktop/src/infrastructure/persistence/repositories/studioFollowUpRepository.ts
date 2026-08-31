import * as vscode from 'vscode';

import {
  addFollowUps,
  parseStudioFollowUps,
  removeFollowUp,
  resolveFollowUpsFor,
  selectFollowUpsFor,
  serializeStudioFollowUps,
  type StudioFollowUp,
} from '@storyboard/story-engine';
import type { StudioEntity } from '@storyboard/story-engine';
import { getStoryboardProjectPaths } from '../../vscode/pathConventions';

export interface IStudioFollowUpRepository {
  list(workspaceRoot: vscode.Uri, target: StudioEntity): Promise<readonly StudioFollowUp[]>;
  add(workspaceRoot: vscode.Uri, added: readonly StudioFollowUp[]): Promise<void>;
  resolveFor(workspaceRoot: vscode.Uri, target: StudioEntity): Promise<void>;
  dismiss(workspaceRoot: vscode.Uri, id: string): Promise<void>;
}

export class StudioFollowUpRepository implements IStudioFollowUpRepository {
  public async list(
    workspaceRoot: vscode.Uri,
    target: StudioEntity,
  ): Promise<readonly StudioFollowUp[]> {
    return selectFollowUpsFor(await this.readAll(workspaceRoot), target);
  }

  public async add(workspaceRoot: vscode.Uri, added: readonly StudioFollowUp[]): Promise<void> {
    if (added.length === 0) {
      return;
    }

    await this.write(workspaceRoot, addFollowUps(await this.readAll(workspaceRoot), added));
  }

  public async resolveFor(workspaceRoot: vscode.Uri, target: StudioEntity): Promise<void> {
    const existing = await this.readAll(workspaceRoot);
    const remaining = resolveFollowUpsFor(existing, target);

    if (remaining.length !== existing.length) {
      await this.write(workspaceRoot, remaining);
    }
  }

  public async dismiss(workspaceRoot: vscode.Uri, id: string): Promise<void> {
    const existing = await this.readAll(workspaceRoot);
    const remaining = removeFollowUp(existing, id);

    if (remaining.length !== existing.length) {
      await this.write(workspaceRoot, remaining);
    }
  }

  private async readAll(workspaceRoot: vscode.Uri): Promise<readonly StudioFollowUp[]> {
    try {
      const bytes = await vscode.workspace.fs.readFile(followUpFileUri(workspaceRoot));
      return parseStudioFollowUps(new TextDecoder().decode(bytes));
    } catch {
      return [];
    }
  }

  private async write(
    workspaceRoot: vscode.Uri,
    followUps: readonly StudioFollowUp[],
  ): Promise<void> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    await vscode.workspace.fs.createDirectory(paths.cacheDirectory);

    await vscode.workspace.fs.writeFile(
      followUpFileUri(workspaceRoot),
      new TextEncoder().encode(serializeStudioFollowUps(followUps)),
    );
  }
}

function followUpFileUri(workspaceRoot: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(
    getStoryboardProjectPaths(workspaceRoot).cacheDirectory,
    'studio-followups.json',
  );
}
