import {
  joinStoryPath,
  type StoryUri,
  extractNoteLinkTargets,
  extractNoteTitle,
  normalizeNoteName,
  stripMarkdownExtension,
} from '@storyboard/story-model';

import {
  NoteSourceError,
  type CollectedNotes,
  type INoteSource,
} from '#engine/application/notes/noteSource';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { NoteDocument, NoteOrigin, SkippedNote } from '@storyboard/story-model';

const vaultMarkerDirectory = '.obsidian';
const outsideVaultReason = '볼트 밖을 가리키는 링크라 읽지 않았습니다';

export interface ObsidianNoteSourceOptions {
  readonly fileSystem: IFileSystem;
  // A folder of notes, or one `.md` note.
  readonly root: StoryUri;
}

// Reads a folder of Markdown notes the way Obsidian lays them out: every note under the folder, in
// name order, plus the notes their links point at elsewhere in the vault — one step, no further.
export class ObsidianNoteSource implements INoteSource {
  public readonly kind = 'obsidian' as const;

  public constructor(private readonly options: ObsidianNoteSourceOptions) {}

  public async collect(): Promise<CollectedNotes> {
    const { fileSystem, root } = this.options;

    if (!(await fileSystem.exists(root))) {
      throw new NoteSourceError('not-found', `노트를 찾을 수 없습니다: ${root.fsPath}`);
    }

    const isSingleNote = /\.md$/i.test(root.path);
    const treeDirectory = isSingleNote ? parentOf(root) : root;
    const vaultRoot = await findVaultRoot(fileSystem, treeDirectory);
    const treeFiles = isSingleNote ? [root] : await listMarkdownFiles(fileSystem, root);
    const notes: NoteDocument[] = [];
    const linkTargets: string[] = [];
    const skipped: SkippedNote[] = [];

    for (const file of treeFiles) {
      // SECURITY: a symbolic link in the vault may point anywhere on disk, and what is read here is
      // sent to the AI provider. Only files that really live under the vault are read.
      if (!(await fileSystem.isRealPathInside(file, vaultRoot))) {
        skipped.push({ label: relativePath(vaultRoot, file), reason: outsideVaultReason });
        continue;
      }

      const note = await readNote(fileSystem, vaultRoot, file, 'tree');
      notes.push(note);
      linkTargets.push(...extractNoteLinkTargets(note.body));
    }

    const collectedIds = new Set([
      ...notes.map((note) => note.id),
      ...skipped.map((entry) => entry.label),
    ]);
    const pendingTargets = [...new Set(linkTargets)];

    if (pendingTargets.length > 0) {
      const vaultIndex = buildVaultIndex(vaultRoot, await listMarkdownFiles(fileSystem, vaultRoot));

      for (const target of pendingTargets) {
        const file = vaultIndex.resolve(target);

        if (file === undefined) {
          skipped.push({
            label: target,
            reason: '링크가 가리키는 노트를 볼트에서 찾지 못했습니다',
          });
          continue;
        }

        const id = relativePath(vaultRoot, file);

        if (collectedIds.has(id)) {
          continue;
        }

        collectedIds.add(id);

        if (!(await fileSystem.isRealPathInside(file, vaultRoot))) {
          skipped.push({ label: id, reason: outsideVaultReason });
          continue;
        }

        notes.push(await readNote(fileSystem, vaultRoot, file, 'link'));
      }
    }

    return { notes, skipped };
  }
}

function parentOf(uri: StoryUri): StoryUri {
  const cut = uri.path.replace(/\/+$/, '').lastIndexOf('/');

  return uri.with({ path: cut <= 0 ? '/' : uri.path.slice(0, cut) });
}

// A link resolves against the whole vault, not the folder that was handed in. The vault is the
// nearest ancestor holding `.obsidian`; a plain folder of notes is its own vault.
async function findVaultRoot(fileSystem: IFileSystem, start: StoryUri): Promise<StoryUri> {
  let current = start;

  for (;;) {
    if (await fileSystem.exists(joinStoryPath(current, vaultMarkerDirectory))) {
      return current;
    }

    const parent = parentOf(current);

    if (parent.path === current.path) {
      return start;
    }

    current = parent;
  }
}

function compareNames(left: string, right: string): number {
  return left.normalize('NFC').localeCompare(right.normalize('NFC'), 'ko', { numeric: true });
}

async function listMarkdownFiles(
  fileSystem: IFileSystem,
  directory: StoryUri,
): Promise<StoryUri[]> {
  const entries = [...(await fileSystem.readDirectory(directory))]
    .filter(([name]) => !name.startsWith('.'))
    .sort(([left], [right]) => compareNames(left, right));
  const files: StoryUri[] = [];

  for (const [name, entry] of entries) {
    const uri = joinStoryPath(directory, name);

    if (entry.type === 'directory') {
      files.push(...(await listMarkdownFiles(fileSystem, uri)));
    } else if (/\.md$/i.test(name)) {
      files.push(uri);
    }
  }

  return files;
}

function relativePath(vaultRoot: StoryUri, file: StoryUri): string {
  const base = vaultRoot.path.replace(/\/+$/, '');
  const relative = file.path.startsWith(`${base}/`) ? file.path.slice(base.length + 1) : file.path;

  return relative.normalize('NFC');
}

async function readNote(
  fileSystem: IFileSystem,
  vaultRoot: StoryUri,
  file: StoryUri,
  origin: NoteOrigin,
): Promise<NoteDocument> {
  const id = relativePath(vaultRoot, file);
  const segments = id.split('/');
  const fileName = segments[segments.length - 1] ?? id;
  const body = new TextDecoder().decode(await fileSystem.readFile(file));

  return {
    id,
    title: extractNoteTitle(body, stripMarkdownExtension(fileName)),
    path: segments.slice(0, -1),
    body,
    origin,
  };
}

interface VaultIndex {
  resolve(target: string): StoryUri | undefined;
}

// Obsidian resolves `[[Name]]` by note name anywhere in the vault and `[[folder/Name]]` by path
// suffix. When two notes share a name the shallower one wins, which is the vault's own tie-break.
function buildVaultIndex(vaultRoot: StoryUri, files: readonly StoryUri[]): VaultIndex {
  const entries = files
    .map((file) => ({
      file,
      key: normalizeNoteName(stripMarkdownExtension(relativePath(vaultRoot, file))),
    }))
    .sort((left, right) => left.key.split('/').length - right.key.split('/').length);

  return {
    resolve(target: string): StoryUri | undefined {
      const wanted = normalizeNoteName(target).replace(/^\/+/, '');

      return entries.find((entry) => entry.key === wanted || entry.key.endsWith(`/${wanted}`))
        ?.file;
    },
  };
}
