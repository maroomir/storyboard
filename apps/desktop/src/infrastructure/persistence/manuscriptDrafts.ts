import * as vscode from 'vscode';

import type { StoryboardLogger } from '@storyboard/story-engine';
import type { ManuscriptDraftEntry } from '@storyboard/story-format';
import type { StoryboardProjectPaths } from '@storyboard/story-engine';
import { parseDraft, parseSceneStem, readDraftFile } from '@storyboard/story-format';
import type { DraftFileSystem } from '@storyboard/story-format';
export async function collectDraftsByOrder(
  paths: StoryboardProjectPaths,
  fileSystem: DraftFileSystem,
  logger: Pick<StoryboardLogger, 'warn'>,
): Promise<Map<number, ManuscriptDraftEntry>> {
  const draftsByOrder = new Map<number, ManuscriptDraftEntry>();

  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(paths.draftDirectory);
  } catch {
    return draftsByOrder;
  }

  for (const [name, fileType] of entries) {
    if (fileType !== vscode.FileType.File || !name.endsWith('.md')) {
      continue;
    }

    const stem = name.slice(0, -'.md'.length);
    const parts = parseSceneStem(stem);
    if (!parts) {
      continue;
    }

    const draftUri = vscode.Uri.joinPath(paths.draftDirectory, name);
    try {
      const draft = parseDraft(await readDraftFile(draftUri, fileSystem));
      draftsByOrder.set(parts.order, { stem, body: draft.body });
    } catch (error) {
      logger.warn(
        `Skipping unreadable draft: ${name} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  return draftsByOrder;
}
