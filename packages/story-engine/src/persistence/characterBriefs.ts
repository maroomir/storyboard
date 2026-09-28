import { STORYBOARD_FILE_EXTENSIONS, isIgnoredSampleCardFileName, type StoryUri } from '@storyboard/story-format';
import type { IFileSystem } from '#engine/ports/fileSystem';
import { readDirectoryFiles } from '#engine/persistence/directoryFiles';
import { readCardFile } from '@storyboard/story-format';
import type { OutlineCharacterBrief } from '@storyboard/story-format';
export async function listCharacterBriefs(
  fs: IFileSystem,
  characterDirectory: StoryUri,
): Promise<OutlineCharacterBrief[]> {
  return await readDirectoryFiles(fs, characterDirectory, {
    isEligible: (name) =>
      name.endsWith(STORYBOARD_FILE_EXTENSIONS.card) && !isIgnoredSampleCardFileName(name),
    read: async (uri): Promise<OutlineCharacterBrief | undefined> => {
      const card = await readCardFile(uri, fs);
      return card.type === 'character'
        ? { id: card.id, name: card.name, role: card.role }
        : undefined;
    },
  });
}
