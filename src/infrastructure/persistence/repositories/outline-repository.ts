import * as vscode from 'vscode';

import type { IOutlineRepository } from '../../../application/novel/generate-outline-use-case';
import { listCharacterBriefs } from '../../../core/characterBriefs';
import { getStoryboardProjectPaths } from '../../../core/pathConventions';
import { uriExists } from '../../../core/workspace';
import type { CardFileSystem } from '../../../files/card';
import {
  writeChapterPlanFile,
  writeSynopsisFile,
  type OutlineFileSystem,
} from '../../../files/outline';
import { readProjectJson } from '../../../files/projectJson';
import type { ChapterPlan, OutlineCharacterBrief, OutlineSynopsis } from '../../../shared/outline';
import type { StoryboardProject } from '../../../shared/project';

const VSCODE_FILE_SYSTEM: CardFileSystem & OutlineFileSystem = {
  readFile: (uri): Thenable<Uint8Array> => vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri, content): Thenable<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content),
};

export class OutlineRepository implements IOutlineRepository {
  public async hasExisting(workspaceRoot: vscode.Uri): Promise<boolean> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    return (await uriExists(paths.outlineSynopsis)) || (await uriExists(paths.outlineChapters));
  }

  public async loadCharacterBriefs(
    workspaceRoot: vscode.Uri,
  ): Promise<readonly OutlineCharacterBrief[]> {
    return await listCharacterBriefs(
      getStoryboardProjectPaths(workspaceRoot).characterDirectory,
      VSCODE_FILE_SYSTEM,
    );
  }

  public async loadProject(workspaceRoot: vscode.Uri): Promise<StoryboardProject> {
    return await readProjectJson(getStoryboardProjectPaths(workspaceRoot).projectJson);
  }

  public async save(
    workspaceRoot: vscode.Uri,
    synopsis: OutlineSynopsis,
    chapterPlan: ChapterPlan,
  ): Promise<vscode.Uri> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    await vscode.workspace.fs.createDirectory(paths.outlineDirectory);
    await writeSynopsisFile(paths.outlineSynopsis, VSCODE_FILE_SYSTEM, synopsis);
    await writeChapterPlanFile(paths.outlineChapters, VSCODE_FILE_SYSTEM, chapterPlan);
    return paths.outlineSynopsis;
  }
}
