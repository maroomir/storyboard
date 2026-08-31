import * as vscode from 'vscode';

import type { INovelRunStateRepository } from '../../../application/novel/novelPipeline';
import { getStoryboardProjectPaths } from '../../vscode/pathConventions';
import { uriExists } from '../../vscode/workspace';
import {
  readNovelRunState,
  writeNovelRunState,
  type NovelRunState,
  type NovelRunStateFileSystem,
} from '@storyboard/story-engine';
import { readProjectJson } from '../projectJson';
import type { StoryboardProject } from '@storyboard/story-format';

const VSCODE_FILE_SYSTEM: NovelRunStateFileSystem = {
  readFile: (uri): Thenable<Uint8Array> => vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri, content): Thenable<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content),
};

export class NovelRunStateRepository implements INovelRunStateRepository {
  public async readExisting(workspaceRoot: vscode.Uri): Promise<NovelRunState | undefined> {
    const { novelRunState } = getStoryboardProjectPaths(workspaceRoot);
    if (!(await uriExists(novelRunState))) {
      return undefined;
    }

    try {
      return await readNovelRunState(novelRunState, VSCODE_FILE_SYSTEM);
    } catch {
      return undefined;
    }
  }

  public async loadProject(workspaceRoot: vscode.Uri): Promise<StoryboardProject> {
    return await readProjectJson(getStoryboardProjectPaths(workspaceRoot).projectJson);
  }

  public async save(workspaceRoot: vscode.Uri, state: NovelRunState): Promise<void> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    await vscode.workspace.fs.createDirectory(paths.cacheDirectory);
    await writeNovelRunState(paths.novelRunState, VSCODE_FILE_SYSTEM, state);
  }
}
