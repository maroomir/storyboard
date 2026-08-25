import * as vscode from 'vscode';

import type {
  BatchSceneList,
  ISceneBatchRepository,
} from '../../../application/drafts/generateAllDraftsUseCase';
import { getStoryboardProjectPaths, isHiddenSceneFileName } from '../../vscode/pathConventions';
import { hasStoryboardProject } from '../../vscode/workspace';
import { parseSceneFileName } from '@storyboard/story-format';

export class SceneBatchRepository implements ISceneBatchRepository {
  public async listStoryboardScenes(): Promise<BatchSceneList> {
    const scenes: vscode.Uri[] = [];
    let projectCount = 0;
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (!(await hasStoryboardProject(folder))) continue;
      projectCount += 1;
      scenes.push(
        ...(await this.listOrdered(getStoryboardProjectPaths(folder.uri).sceneDirectory)),
      );
    }
    return { projectCount, scenes };
  }

  private async listOrdered(sceneDirectory: vscode.Uri): Promise<vscode.Uri[]> {
    const entries = await vscode.workspace.fs.readDirectory(sceneDirectory);
    const items = entries
      .filter(
        ([name, type]) =>
          type === vscode.FileType.File && name.endsWith('.card') && !isHiddenSceneFileName(name),
      )
      .map(([name]) => ({ name, parts: parseSceneFileName(name) }))
      .filter(
        (
          item,
        ): item is { name: string; parts: NonNullable<ReturnType<typeof parseSceneFileName>> } =>
          item.parts !== undefined,
      )
      .sort(
        (left, right) =>
          left.parts.order - right.parts.order || left.name.localeCompare(right.name),
      );
    return items.map(({ name }) => vscode.Uri.joinPath(sceneDirectory, name));
  }
}
