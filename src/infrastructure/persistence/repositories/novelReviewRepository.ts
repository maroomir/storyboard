import * as vscode from 'vscode';

import type {
  INovelReviewRepository,
  NovelReviewSource,
} from '../../../application/novel/novelPipeline';
import { collectDraftsByOrder } from '../../../core/manuscriptDrafts';
import { getStoryboardProjectPaths } from '../../../core/pathConventions';
import { readBibleFile, type BibleFileSystem } from '../../../domain/files/bible';
import type { DraftFileSystem } from '../../../domain/files/draft';

const VSCODE_FILE_SYSTEM: DraftFileSystem & BibleFileSystem = {
  readFile: (uri): Thenable<Uint8Array> => vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri, content): Thenable<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content),
};

export class NovelReviewRepository implements INovelReviewRepository {
  public async loadReviewSource(workspaceRoot: vscode.Uri): Promise<NovelReviewSource> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    const draftsByOrder = await collectDraftsByOrder(paths, VSCODE_FILE_SYSTEM, {
      warn: (): void => undefined,
    });
    const canonFactLines = await this.loadCanonFactLines(paths.bibleCanon);

    return { draftsByOrder, canonFactLines };
  }

  public async saveReview(workspaceRoot: vscode.Uri, markdown: string): Promise<void> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    await vscode.workspace.fs.createDirectory(paths.manuscriptDirectory);
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(paths.manuscriptDirectory, 'REVIEW.md'),
      new TextEncoder().encode(markdown),
    );
  }

  private async loadCanonFactLines(bibleCanonUri: vscode.Uri): Promise<string[]> {
    try {
      const bible = await readBibleFile(bibleCanonUri, VSCODE_FILE_SYSTEM);
      return bible.facts
        .filter((fact) => fact.status === 'canon')
        .map((fact) => `${fact.subject.id} — ${fact.key}: ${fact.value}`);
    } catch {
      return [];
    }
  }
}
