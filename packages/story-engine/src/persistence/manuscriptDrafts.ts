import { joinStoryPath, parseDraft, parseSceneStem, readDraftFile } from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import { listDirectoryFileNames } from '#engine/persistence/directoryFiles';
import type { IStoryboardLogger } from '#engine/ports/logger';
import type {
  ManuscriptDraftEntry,
  DraftFileSystem,
  StoryboardProjectPaths,
  SceneFileNameParts,
  StoryUri,
  Draft,
} from '@storyboard/story-model';
export async function collectDraftsByOrder(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
  fileSystem: DraftFileSystem,
  logger: Pick<IStoryboardLogger, 'warn'>,
): Promise<Map<number, ManuscriptDraftEntry>> {
  const draftsByOrder: Map<number, ManuscriptDraftEntry> = new Map<number, ManuscriptDraftEntry>();

  const names: readonly string[] = await listDirectoryFileNames(fs, paths.draftDirectory, (name) =>
    name.endsWith('.md'),
  );

  for (const name of names) {
    const stem: string = name.slice(0, -'.md'.length);
    const parts: SceneFileNameParts | undefined = parseSceneStem(stem);
    if (!parts) {
      continue;
    }

    const draftUri: StoryUri = joinStoryPath(paths.draftDirectory, name);
    try {
      const draft: Draft = parseDraft(await readDraftFile(draftUri, fileSystem));
      draftsByOrder.set(parts.order, { stem, body: draft.body });
    } catch (error) {
      logger.warn(
        `Skipping unreadable draft: ${name} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  return draftsByOrder;
}
