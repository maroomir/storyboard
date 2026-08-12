import * as vscode from 'vscode';

import type { IBibleCandidateRepository } from '../../../application/project/promoteBibleCandidatesUseCase';
import { getStoryboardProjectPaths } from '../../vscode/pathConventions';
import { createEmptyBible } from '@seedkernel/wasm';
import { readBibleFile, writeBibleFile } from '@/domain/files/storyFiles';
import type { StoryBible } from '@seedkernel/wasm';
import {
  readBibleCandidateFile,
  type BibleCandidateRecord,
} from '../../../domain/files/bibleCandidates';
const VSCODE_FILE_SYSTEM = {
  readFile: (uri: unknown): Thenable<Uint8Array> => vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri: unknown, content: Uint8Array): Thenable<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content),
};

export class BibleCandidateRepository implements IBibleCandidateRepository {
  public async loadCanon(workspaceRoot: vscode.Uri): Promise<StoryBible> {
    const { bibleCanon } = getStoryboardProjectPaths(workspaceRoot);

    try {
      return await readBibleFile(bibleCanon, VSCODE_FILE_SYSTEM);
    } catch {
      return createEmptyBible();
    }
  }

  public async loadRecords(workspaceRoot: vscode.Uri): Promise<readonly BibleCandidateRecord[]> {
    const { bibleCacheDirectory } = getStoryboardProjectPaths(workspaceRoot);
    let entries: [string, vscode.FileType][];

    try {
      entries = await vscode.workspace.fs.readDirectory(bibleCacheDirectory);
    } catch {
      return [];
    }

    const records: BibleCandidateRecord[] = [];

    for (const [name, fileType] of entries) {
      if (fileType !== vscode.FileType.File || !name.endsWith('.json')) {
        continue;
      }

      try {
        records.push(
          await readBibleCandidateFile(
            vscode.Uri.joinPath(bibleCacheDirectory, name),
            VSCODE_FILE_SYSTEM,
          ),
        );
      } catch {
        // NOTE: Invalid cache records are excluded from candidate promotion.
      }
    }

    return records;
  }

  public async saveCanon(workspaceRoot: vscode.Uri, canon: StoryBible): Promise<void> {
    const { bibleCanon, bibleDirectory } = getStoryboardProjectPaths(workspaceRoot);
    await vscode.workspace.fs.createDirectory(bibleDirectory);
    await writeBibleFile(bibleCanon, VSCODE_FILE_SYSTEM, canon);
  }
}
