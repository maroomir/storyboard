import * as vscode from 'vscode';

import type { ICardCollectRepository } from '../../../application/cards/collectCardProposalsUseCase';
import { getStoryboardProjectPaths } from '../../vscode/pathConventions';
import { loadCharacterRoster } from '../relationGraphData';
import { parseDraft, readDraftFile, type DraftFileSystem } from '../../../domain/files/draft';
import type {
  CollectDraft,
  CollectRosterEntry,
} from '../../../infrastructure/ai/cardCollectBuilder';

const VSCODE_DRAFT_FILE_SYSTEM: DraftFileSystem = {
  readFile: (uri): Thenable<Uint8Array> => vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri, content): Thenable<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content),
};

export class CardCollectRepository implements ICardCollectRepository {
  public async loadCharacterRoster(
    workspaceRoot: vscode.Uri,
  ): Promise<readonly CollectRosterEntry[]> {
    return await loadCharacterRoster(workspaceRoot);
  }

  public async loadDrafts(workspaceRoot: vscode.Uri): Promise<readonly CollectDraft[]> {
    const { draftDirectory } = getStoryboardProjectPaths(workspaceRoot);
    let entries: [string, vscode.FileType][];

    try {
      entries = await vscode.workspace.fs.readDirectory(draftDirectory);
    } catch {
      return [];
    }

    const drafts: CollectDraft[] = [];

    for (const [name, fileType] of entries) {
      if (fileType !== vscode.FileType.File || !name.endsWith('.md')) {
        continue;
      }

      try {
        const raw = await readDraftFile(
          vscode.Uri.joinPath(draftDirectory, name),
          VSCODE_DRAFT_FILE_SYSTEM,
        );
        const draft = parseDraft(raw);
        drafts.push({ body: draft.body, sceneStem: draft.sceneStem });
      } catch {
        // NOTE: Invalid drafts are excluded from collection proposals.
      }
    }

    return drafts;
  }
}
