import { joinStoryPath } from '../paths/storyUri';
import type { FileSystemDirectoryEntry, IFileSystem } from '../ports/fileSystem';
import type { IStoryboardLogger } from '../ports/logger';
import type { ManuscriptDraftEntry } from '@storyboard/story-format';
import type { StoryboardProjectPaths } from '../paths/projectPaths';
import { parseDraft, parseSceneStem, readDraftFile } from '@storyboard/story-format';
import type { DraftFileSystem } from '@storyboard/story-format';
export async function collectDraftsByOrder(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
  fileSystem: DraftFileSystem,
  logger: Pick<IStoryboardLogger, 'warn'>,
): Promise<Map<number, ManuscriptDraftEntry>> {
  const draftsByOrder = new Map<number, ManuscriptDraftEntry>();

  let entries: FileSystemDirectoryEntry[];
  try {
    entries = await fs.readDirectory(paths.draftDirectory);
  } catch {
    return draftsByOrder;
  }

  for (const [name, fileType] of entries) {
    if (fileType.type !== 'file' || !name.endsWith('.md')) {
      continue;
    }

    const stem = name.slice(0, -'.md'.length);
    const parts = parseSceneStem(stem);
    if (!parts) {
      continue;
    }

    const draftUri = joinStoryPath(paths.draftDirectory, name);
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
