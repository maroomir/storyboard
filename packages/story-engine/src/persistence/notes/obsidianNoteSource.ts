import {
  compareNoteNames,
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
import type { FileSystemDirectoryEntry, IFileSystem } from '#engine/ports/fileSystem';
import type {
  NoteDocument,
  NoteOrigin,
  NoteSourceKind,
  SkippedNote,
} from '@storyboard/story-model';

const vaultMarkerDirectory: string = '.obsidian';
const outsideVaultReason: string = '볼트 밖을 가리키는 링크라 읽지 않았습니다';

interface VaultIndexEntry {
  readonly file: StoryUri;
  readonly key: string;
}

export interface ObsidianNoteSourceOptions {
  readonly fileSystem: IFileSystem;
  // A folder of notes, or one `.md` note.
  readonly root: StoryUri;
}

// Reads a folder of Markdown notes the way Obsidian lays them out: every note under the folder, in
// name order, plus the notes their links point at elsewhere in the vault — one step, no further.
export class ObsidianNoteSource implements INoteSource {
  public readonly kind: NoteSourceKind = 'obsidian';

  public constructor(private readonly options: ObsidianNoteSourceOptions) {}

  public async collect(): Promise<CollectedNotes> {
    const { fileSystem, root } = this.options;

    if (!(await fileSystem.exists(root))) {
      throw new NoteSourceError('not-found', `노트를 찾을 수 없습니다: ${root.fsPath}`);
    }

    const isSingleNote: boolean = /\.md$/i.test(root.path);
    const treeDirectory: StoryUri = isSingleNote ? parentOf(root) : root;
    const vaultRoot: StoryUri = await findVaultRoot(fileSystem, treeDirectory);
    const treeFiles: StoryUri[] = isSingleNote ? [root] : await listMarkdownFiles(fileSystem, root);
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

      const note: NoteDocument = await readNote(fileSystem, vaultRoot, file, 'tree');
      notes.push(note);
      linkTargets.push(...extractNoteLinkTargets(note.body));
    }

    const collectedIds: Set<string> = new Set([
      ...notes.map((note) => note.id),
      ...skipped.map((entry) => entry.label),
    ]);
    const pendingTargets: string[] = [...new Set(linkTargets)];

    if (pendingTargets.length > 0) {
      const vaultIndex: VaultIndex = buildVaultIndex(
        vaultRoot,
        await listMarkdownFiles(fileSystem, vaultRoot),
      );

      for (const target of pendingTargets) {
        const file: StoryUri | undefined = vaultIndex.resolve(target);

        if (file === undefined) {
          skipped.push({
            label: target,
            reason: '링크가 가리키는 노트를 볼트에서 찾지 못했습니다',
          });
          continue;
        }

        const id: string = relativePath(vaultRoot, file);

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
  const cut: number = uri.path.replace(/\/+$/, '').lastIndexOf('/');

  return uri.with({ path: cut <= 0 ? '/' : uri.path.slice(0, cut) });
}

// A link resolves against the whole vault, not the folder that was handed in. The vault is the
// nearest ancestor holding `.obsidian`; a plain folder of notes is its own vault.
async function findVaultRoot(fileSystem: IFileSystem, start: StoryUri): Promise<StoryUri> {
  let current: StoryUri = start;

  for (;;) {
    if (await fileSystem.exists(joinStoryPath(current, vaultMarkerDirectory))) {
      return current;
    }

    const parent: StoryUri = parentOf(current);

    if (parent.path === current.path) {
      return start;
    }

    current = parent;
  }
}

async function listMarkdownFiles(
  fileSystem: IFileSystem,
  directory: StoryUri,
): Promise<StoryUri[]> {
  const entries: FileSystemDirectoryEntry[] = [...(await fileSystem.readDirectory(directory))]
    .filter(([name]) => !name.startsWith('.'))
    .sort(([left], [right]) => compareNoteNames(left, right));
  const files: StoryUri[] = [];

  for (const [name, entry] of entries) {
    const uri: StoryUri = joinStoryPath(directory, name);

    if (entry.type === 'directory') {
      files.push(...(await listMarkdownFiles(fileSystem, uri)));
    } else if (/\.md$/i.test(name)) {
      files.push(uri);
    }
  }

  return files;
}

function relativePath(vaultRoot: StoryUri, file: StoryUri): string {
  const base: string = vaultRoot.path.replace(/\/+$/, '');
  const relative: string = file.path.startsWith(`${base}/`)
    ? file.path.slice(base.length + 1)
    : file.path;

  return relative.normalize('NFC');
}

async function readNote(
  fileSystem: IFileSystem,
  vaultRoot: StoryUri,
  file: StoryUri,
  origin: NoteOrigin,
): Promise<NoteDocument> {
  const id: string = relativePath(vaultRoot, file);
  const segments: string[] = id.split('/');
  const fileName: string = segments[segments.length - 1] ?? id;
  const body: string = new TextDecoder().decode(await fileSystem.readFile(file));

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
  const entries: VaultIndexEntry[] = files
    .map(
      (file): VaultIndexEntry => ({
        file,
        key: normalizeNoteName(stripMarkdownExtension(relativePath(vaultRoot, file))),
      }),
    )
    .sort((left, right) => left.key.split('/').length - right.key.split('/').length);

  return {
    resolve(target: string): StoryUri | undefined {
      const wanted: string = normalizeNoteName(target).replace(/^\/+/, '');

      return entries.find((entry) => entry.key === wanted || entry.key.endsWith(`/${wanted}`))
        ?.file;
    },
  };
}
