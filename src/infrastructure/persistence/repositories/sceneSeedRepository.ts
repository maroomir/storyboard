import * as vscode from 'vscode';

import type { ISceneSeedRepository } from '../../../application/novel/novelPipeline';
import { getStoryboardProjectPaths } from '../../../core/pathConventions';
import type { GeneratedSceneSeed } from '../../../core/sceneSeedFactory';

export class SceneSeedRepository implements ISceneSeedRepository {
  public async saveSeeds(
    workspaceRoot: vscode.Uri,
    seeds: readonly GeneratedSceneSeed[],
  ): Promise<void> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    await vscode.workspace.fs.createDirectory(paths.sceneDirectory);

    for (const seed of seeds) {
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(paths.sceneDirectory, seed.fileName),
        new TextEncoder().encode(seed.content),
      );
    }
  }
}
