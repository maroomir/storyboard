import { joinStoryPath, type StoryUri } from '@storyboard/story-format';
import type { FileSystemDirectoryEntry, IFileSystem } from '../../ports/fileSystem';
import { createHash } from 'node:crypto';

import { parseCard, parseScene } from '@storyboard/story-format';
import type { SceneFile, StoryboardCard } from '@storyboard/story-format';
import type {
  IStoryFeatureRepository,
  StoryFeatureSource,
  StoryFileSnapshot,
} from '../../application/story/storyFeatureTypes';
import { StoryFeatureSourceError } from '../../application/story/storyFeatureTypes';
import { parseProjectJson } from '../projectJson';
import { getStoryboardProjectPaths, isIgnoredSampleCardFileName } from '../../paths/projectPaths';
export class StoryFeatureRepository implements IStoryFeatureRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async load(workspaceRoot: StoryUri): Promise<StoryFeatureSource> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    const [projectText, sceneFiles, cardFiles, canonText] = await Promise.all([
      readRequiredText(this.fileSystem, paths.projectJson, '.storyboard/project.json'),
      readTextFiles(
        this.fileSystem,
        paths.sceneDirectory,
        (name) => name.endsWith('.card') && !name.startsWith('.'),
      ),
      readCardFiles(this.fileSystem, paths.characterDirectory, paths.backgroundDirectory),
      readOptionalText(this.fileSystem, paths.bibleCanon),
    ]);
    const invalidScenes: string[] = [];
    const scenes: SceneFile[] = [];

    for (const file of sceneFiles) {
      try {
        scenes.push(parseScene(file.text, file.name));
      } catch (error) {
        invalidScenes.push(`${file.name}: ${formatParseError(error)}`);
      }
    }

    if (invalidScenes.length > 0) {
      throw new StoryFeatureSourceError(
        `유효하지 않은 씬이 있습니다.\n${invalidScenes.join('\n')}`,
      );
    }

    const cards: StoryboardCard[] = [];
    for (const file of cardFiles) {
      try {
        cards.push(parseCard(file.text));
      } catch (error) {
        throw new StoryFeatureSourceError(
          `유효하지 않은 카드: ${file.name}: ${formatParseError(error)}`,
        );
      }
    }

    const project = parseProjectJson(projectText.text);
    const snapshots = [
      snapshotFile(projectText.uri, projectText.bytes),
      ...sceneFiles.map((file) => snapshotFile(file.uri, file.bytes)),
      ...cardFiles.map((file) => snapshotFile(file.uri, file.bytes)),
      ...(canonText ? [snapshotFile(canonText.uri, canonText.bytes)] : []),
      await snapshotDirectory(this.fileSystem, paths.sceneDirectory),
      await snapshotDirectory(this.fileSystem, paths.characterDirectory),
      await snapshotDirectory(this.fileSystem, paths.backgroundDirectory),
    ];

    return {
      workspaceRoot,
      project,
      scenes: scenes.sort(
        (left, right) => left.order - right.order || left.slug.localeCompare(right.slug),
      ),
      cards,
      canonText: canonText?.text ?? '',
      snapshots,
    };
  }

  public async hasCurrentSnapshots(snapshots: readonly StoryFileSnapshot[]): Promise<boolean> {
    for (const snapshot of snapshots) {
      let current: StoryFileSnapshot;
      try {
        current =
          snapshot.kind === 'directory'
            ? await snapshotDirectory(this.fileSystem, snapshot.uri)
            : snapshotFile(snapshot.uri, await this.fileSystem.readFile(snapshot.uri));
      } catch {
        return false;
      }
      if (current.sha256 !== snapshot.sha256) {
        return false;
      }
    }
    return true;
  }
}

interface TextFile {
  readonly uri: StoryUri;
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly text: string;
}

async function readRequiredText(fs: IFileSystem, uri: StoryUri, label: string): Promise<TextFile> {
  try {
    return await readTextFile(fs, uri);
  } catch {
    throw new StoryFeatureSourceError(`${label}을 읽을 수 없습니다.`);
  }
}

async function readOptionalText(fs: IFileSystem, uri: StoryUri): Promise<TextFile | undefined> {
  try {
    return await readTextFile(fs, uri);
  } catch {
    return undefined;
  }
}

async function readTextFiles(
  fs: IFileSystem,
  directory: StoryUri,
  include: (name: string) => boolean,
): Promise<TextFile[]> {
  let entries: readonly FileSystemDirectoryEntry[];
  try {
    entries = await fs.readDirectory(directory);
  } catch {
    throw new StoryFeatureSourceError(`씬 디렉터리를 읽을 수 없습니다: ${directory.fsPath}`);
  }

  return await Promise.all(
    entries
      .filter(([name, entry]) => entry.type === 'file' && include(name))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name]) => readTextFile(fs, joinStoryPath(directory, name))),
  );
}

async function readCardFiles(
  fs: IFileSystem,
  ...directories: readonly StoryUri[]
): Promise<TextFile[]> {
  const files = await Promise.all(
    directories.map(async (directory) => {
      try {
        const entries = await fs.readDirectory(directory);
        return await Promise.all(
          entries
            .filter(
              ([name, entry]) =>
                entry.type === 'file' &&
                name.endsWith('.card') &&
                !isIgnoredSampleCardFileName(name),
            )
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name]) => readTextFile(fs, joinStoryPath(directory, name))),
        );
      } catch {
        return [];
      }
    }),
  );
  return files.flat();
}

async function readTextFile(fs: IFileSystem, uri: StoryUri): Promise<TextFile> {
  const bytes = await fs.readFile(uri);
  return {
    uri,
    name: uri.path.split('/').at(-1) ?? uri.toString(),
    bytes,
    text: new TextDecoder().decode(bytes),
  };
}

function snapshotFile(uri: StoryUri, bytes: Uint8Array): StoryFileSnapshot {
  return { uri, sha256: sha256(bytes), kind: 'file' };
}

async function snapshotDirectory(fs: IFileSystem, uri: StoryUri): Promise<StoryFileSnapshot> {
  try {
    const entries = await fs.readDirectory(uri);
    const manifest = entries
      .filter(([name, entry]) => entry.type === 'file' && !name.startsWith('.'))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, entry]) => `${entry.type}:${name}`)
      .join('\n');
    return { uri, sha256: sha256(new TextEncoder().encode(manifest)), kind: 'directory' };
  } catch {
    return { uri, sha256: sha256(new Uint8Array()), kind: 'directory' };
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function formatParseError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
