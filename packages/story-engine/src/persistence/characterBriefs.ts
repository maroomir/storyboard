import { joinStoryPath, type StoryUri } from '../paths/storyUri';
import type { FileSystemDirectoryEntry, IFileSystem } from '../ports/fileSystem';
import { readCardFile } from '@storyboard/story-format';
import type { OutlineCharacterBrief } from '@storyboard/story-format';
export async function listCharacterBriefs(
  fs: IFileSystem,
  characterDirectory: StoryUri,
): Promise<OutlineCharacterBrief[]> {
  let entries: FileSystemDirectoryEntry[];
  try {
    entries = await fs.readDirectory(characterDirectory);
  } catch {
    return [];
  }

  const briefs: OutlineCharacterBrief[] = [];

  for (const [name, fileType] of entries) {
    if (fileType.type !== 'file' || !name.endsWith('.card') || name === '.sample.card') {
      continue;
    }

    const uri = joinStoryPath(characterDirectory, name);
    try {
      const card = await readCardFile(uri, fs);
      if (card.type === 'character') {
        briefs.push({ id: card.id, name: card.name, role: card.role });
      }
    } catch {
      continue;
    }
  }

  return briefs;
}
