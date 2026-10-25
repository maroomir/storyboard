import type {
  StoryUri,
  ReadWriteFileSystem,
  StoryboardProject,
  CanonDiffResult,
  StoryBible,
} from '@storyboard/story-model';
import { vscodeFileSystem } from '@/infrastructure/vscode/vscodeFileSystem';
import * as vscode from 'vscode';

import {
  buildCanonDiffMarkdown,
  diffCandidatesAgainstCanon,
  getStoryboardProjectPaths,
  type StoryboardProjectPaths,
  createEmptyBible,
  readBibleFile,
  readBibleCandidateFile,
  type BibleCandidateRecord,
  extractErrorMessage,
} from '@storyboard/story-model';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import { resolveStoryboardWorkspaceRoot, uriExists } from '@/infrastructure/vscode/workspace';
import { readProjectJson } from '@storyboard/story-engine';
import { storyboardMessages } from '@/presentation/notifications/storyboardMessages';
const canonDiffCommand: string = 'storyboard.bible.canonDiff';

const fileSystem: ReadWriteFileSystem & ReadWriteFileSystem = {
  readFile: (uri: StoryUri): PromiseLike<Uint8Array> =>
    vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri: StoryUri, content: Uint8Array): PromiseLike<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content),
};

export interface RegisterCanonDiffCommandDependencies {
  readonly logger: IStoryboardLogger;
}

export function registerCanonDiffCommand(
  dependencies: RegisterCanonDiffCommandDependencies,
): vscode.Disposable {
  return vscode.commands.registerCommand(canonDiffCommand, () => runCanonDiff(dependencies));
}

async function runCanonDiff(dependencies: RegisterCanonDiffCommandDependencies): Promise<void> {
  const workspaceRoot: vscode.Uri | undefined = await resolveStoryboardWorkspaceRoot();

  if (!workspaceRoot) {
    await vscode.window.showErrorMessage(storyboardMessages.missingWorkspace);
    return;
  }

  const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);

  try {
    const { pending, reportUri } = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Canon diff 정리 중…' },
      async () => {
        const project: StoryboardProject = await readProjectJson(
          vscodeFileSystem,
          paths.projectJson,
        );
        const canon: StoryBible = (await uriExists(paths.bibleCanon))
          ? await readBibleFile(paths.bibleCanon, fileSystem)
          : createEmptyBible();
        const candidates: BibleCandidateRecord[] = await readCandidateRecords(
          paths,
          dependencies.logger,
        );

        const diff: CanonDiffResult = diffCandidatesAgainstCanon(canon, candidates);
        const markdown: string = buildCanonDiffMarkdown(project.name, diff.pending, canon);

        await vscode.workspace.fs.createDirectory(paths.manuscriptDirectory);
        const target: vscode.Uri = vscode.Uri.joinPath(paths.manuscriptDirectory, 'CANON.md');
        await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(markdown));

        return { pending: diff.pending, reportUri: target };
      },
    );

    const document: vscode.TextDocument = await vscode.workspace.openTextDocument(reportUri);
    await vscode.window.showTextDocument(document);

    await vscode.window.showInformationMessage(
      pending.length === 0
        ? '미승격 설정 후보가 없습니다.'
        : `미승격 설정 후보 ${pending.length}건을 정리했습니다 (manuscript/CANON.md).`,
    );
  } catch (error) {
    dependencies.logger.error('Canon diff failed', error);
    dependencies.logger.show();
    const message: string = extractErrorMessage(error);
    await vscode.window.showErrorMessage(`Canon diff 생성에 실패했습니다: ${message}`);
  }
}

async function readCandidateRecords(
  paths: StoryboardProjectPaths,
  logger: IStoryboardLogger,
): Promise<BibleCandidateRecord[]> {
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(paths.bibleCacheDirectory);
  } catch {
    return [];
  }

  const records: BibleCandidateRecord[] = [];

  for (const [name, fileType] of entries) {
    if (fileType !== vscode.FileType.File || !name.endsWith('.json')) {
      continue;
    }

    const uri: vscode.Uri = vscode.Uri.joinPath(paths.bibleCacheDirectory, name);
    try {
      records.push(await readBibleCandidateFile(uri, fileSystem));
    } catch (error) {
      logger.warn(`Skipping unreadable bible candidate: ${name} (${extractErrorMessage(error)})`);
    }
  }

  return records;
}
