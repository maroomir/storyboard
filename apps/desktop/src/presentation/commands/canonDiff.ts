import * as vscode from 'vscode';

import { buildCanonDiffMarkdown, diffCandidatesAgainstCanon } from '../../domain/canonDiff';
import type { StoryboardLogger } from '../../infrastructure/vscode/logger';
import {
  getStoryboardProjectPaths,
  type StoryboardProjectPaths,
} from '../../infrastructure/vscode/pathConventions';
import { resolveStoryboardWorkspaceRoot, uriExists } from '../../infrastructure/vscode/workspace';
import { createEmptyBible } from '@seedkernel/wasm';
import { readBibleFile } from '@/domain/files/storyFiles';
import type { BibleFileSystem } from '@/domain/files/storyFiles';
import {
  readBibleCandidateFile,
  type BibleCandidateFileSystem,
  type BibleCandidateRecord,
} from '../../domain/files/bibleCandidates';
import { readProjectJson } from '../../infrastructure/persistence/projectJson';
const canonDiffCommand = 'storyboard.bible.canonDiff';

const fileSystem: BibleFileSystem & BibleCandidateFileSystem = {
  readFile: (uri: unknown): PromiseLike<Uint8Array> =>
    vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri: unknown, content: Uint8Array): PromiseLike<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content),
};

export interface RegisterCanonDiffCommandDependencies {
  readonly logger: StoryboardLogger;
}

export function registerCanonDiffCommand(
  dependencies: RegisterCanonDiffCommandDependencies,
): vscode.Disposable {
  return vscode.commands.registerCommand(canonDiffCommand, () => runCanonDiff(dependencies));
}

async function runCanonDiff(dependencies: RegisterCanonDiffCommandDependencies): Promise<void> {
  const workspaceRoot = await resolveStoryboardWorkspaceRoot();

  if (!workspaceRoot) {
    await vscode.window.showErrorMessage(
      'Storyboard 프로젝트(.storyboard/project.json)가 없습니다. 먼저 초기화해 주세요.',
    );
    return;
  }

  const paths = getStoryboardProjectPaths(workspaceRoot);

  try {
    const project = await readProjectJson(paths.projectJson);
    const canon = (await uriExists(paths.bibleCanon))
      ? await readBibleFile(paths.bibleCanon, fileSystem)
      : createEmptyBible();
    const candidates = await readCandidateRecords(paths, dependencies.logger);

    const { pending } = diffCandidatesAgainstCanon(canon, candidates);
    const markdown = buildCanonDiffMarkdown(project.name, pending, canon);

    await vscode.workspace.fs.createDirectory(paths.manuscriptDirectory);
    const reportUri = vscode.Uri.joinPath(paths.manuscriptDirectory, 'CANON.md');
    await vscode.workspace.fs.writeFile(reportUri, new TextEncoder().encode(markdown));

    const document = await vscode.workspace.openTextDocument(reportUri);
    await vscode.window.showTextDocument(document);

    await vscode.window.showInformationMessage(
      pending.length === 0
        ? '미승격 설정 후보가 없습니다.'
        : `미승격 설정 후보 ${pending.length}건을 정리했습니다 (manuscript/CANON.md).`,
    );
  } catch (error) {
    dependencies.logger.error('Canon diff failed', error);
    dependencies.logger.show();
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(`Canon diff 생성에 실패했습니다: ${message}`);
  }
}

async function readCandidateRecords(
  paths: StoryboardProjectPaths,
  logger: StoryboardLogger,
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

    const uri = vscode.Uri.joinPath(paths.bibleCacheDirectory, name);
    try {
      records.push(await readBibleCandidateFile(uri, fileSystem));
    } catch (error) {
      logger.warn(
        `Skipping unreadable bible candidate: ${name} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  return records;
}
