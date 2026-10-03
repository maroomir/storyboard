import { joinStoryPath, parseDraft, parseSceneStem, readDraftFile } from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import { listDirectoryFileNames } from '#engine/persistence/directoryFiles';
import type { IStoryboardLogger } from '#engine/ports/logger';
import type {
  ManuscriptDraftEntry,
  DraftFileSystem,
  StoryboardProjectPaths,
} from '@storyboard/story-model';
export async function collectDraftsByOrder(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
  fileSystem: DraftFileSystem,
  logger: Pick<IStoryboardLogger, 'warn'>,
): Promise<Map<number, ManuscriptDraftEntry>> {
  const draftsByOrder = new Map<number, ManuscriptDraftEntry>();

  const names = await listDirectoryFileNames(fs, paths.draftDirectory, (name) =>
    name.endsWith('.md'),
  );

  for (const name of names) {
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
