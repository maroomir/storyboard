import * as vscode from 'vscode';

import type {
  IManuscriptAssemblyRepository,
  ManuscriptAssemblySource,
} from '../../../application/manuscript/assemble-manuscript-use-case';
import type { StoryboardLogger } from '../../../core/logger';
import type { AssembledManuscript } from '../../../core/manuscriptAssembly';
import { collectDraftsByOrder } from '../../../core/manuscriptDrafts';
import { getStoryboardProjectPaths } from '../../../core/pathConventions';
import { uriExists } from '../../../core/workspace';
import type { DraftFileSystem } from '../../../files/draft';
import { readChapterPlanFile, type OutlineFileSystem } from '../../../files/outline';
import { readProjectJson } from '../../../files/projectJson';

const VSCODE_FILE_SYSTEM: DraftFileSystem & OutlineFileSystem = {
  readFile: (uri): Thenable<Uint8Array> => vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri, content): Thenable<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content),
};

export class ManuscriptAssemblyRepository implements IManuscriptAssemblyRepository {
  public async hasChapterPlan(workspaceRoot: vscode.Uri): Promise<boolean> {
    return await uriExists(getStoryboardProjectPaths(workspaceRoot).outlineChapters);
  }

  public async loadAssemblySource(
    workspaceRoot: vscode.Uri,
    logger: Pick<StoryboardLogger, 'warn'>,
  ): Promise<ManuscriptAssemblySource> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    const [project, plan, draftsByOrder] = await Promise.all([
      readProjectJson(paths.projectJson),
      readChapterPlanFile(paths.outlineChapters, VSCODE_FILE_SYSTEM),
      collectDraftsByOrder(paths, VSCODE_FILE_SYSTEM, logger),
    ]);

    return { draftsByOrder, plan, projectName: project.name };
  }

  public async saveAssembly(
    workspaceRoot: vscode.Uri,
    manuscript: AssembledManuscript,
    foreshadowingMarkdown: string,
  ): Promise<vscode.Uri> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    await vscode.workspace.fs.createDirectory(paths.manuscriptDirectory);

    for (const chapter of manuscript.chapters) {
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(paths.manuscriptDirectory, chapter.fileName),
        new TextEncoder().encode(chapter.markdown),
      );
    }
    await vscode.workspace.fs.writeFile(
      paths.manuscriptVolume,
      new TextEncoder().encode(manuscript.volumeMarkdown),
    );
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(paths.manuscriptDirectory, 'FORESHADOWING.md'),
      new TextEncoder().encode(foreshadowingMarkdown),
    );

    return paths.manuscriptVolume;
  }
}
