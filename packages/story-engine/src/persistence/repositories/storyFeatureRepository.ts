import {
  STORYBOARD_RELATIVE_PATHS,
  bundleFileNames,
  joinStoryPath,
  type StoryUri,
  parseScene,
  getStoryboardProjectPaths,
  extractErrorMessage,
} from '@storyboard/story-model';
import type { CardRoster, WorkspaceCards } from '#engine/persistence/bundles/workspaceCards';
import type { FileSystemDirectoryEntry, IFileSystem } from '#engine/ports/fileSystem';
import { createHash } from 'node:crypto';

import type {
  SceneFile,
  StoryboardCard,
  StoryboardProject,
  StoryboardProjectPaths,
} from '@storyboard/story-model';
import type {
  IStoryFeatureRepository,
  StoryFeatureSource,
  StoryFileSnapshot,
} from '#engine/application/story/storyFeatureSource';
import { StoryFeatureSourceError } from '#engine/application/story/storyFeatureSource';
import { parseProjectJson } from '#engine/persistence/projectJson';
export class StoryFeatureRepository implements IStoryFeatureRepository {
  public constructor(
    private readonly fileSystem: IFileSystem,
    private readonly cards: WorkspaceCards,
  ) {}

  public async load(workspaceRoot: StoryUri): Promise<StoryFeatureSource> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    const roster: CardRoster = await this.readRoster(workspaceRoot);
    const sourceFiles: StorySourceFiles = await this.readSourceFiles(paths, roster);
    const scenes: SceneFile[] = this.parseScenes(sourceFiles.sceneFiles);
    const cards: StoryboardCard[] = [...roster.characters, ...roster.backgrounds];

    const project: StoryboardProject = parseProjectJson(sourceFiles.projectText.text);
    const snapshots: StoryFileSnapshot[] = await this.snapshotSources(paths, sourceFiles);

    return {
      workspaceRoot,
      project,
      scenes: scenes.sort(
        (left, right) => left.order - right.order || left.slug.localeCompare(right.slug),
      ),
      cards,
      canonText: sourceFiles.canonText?.text ?? '',
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

  private async readRoster(workspaceRoot: StoryUri): Promise<CardRoster> {
    try {
      return await this.cards.loadRoster(workspaceRoot, ['character', 'background']);
    } catch (error) {
      throw new StoryFeatureSourceError(
        'invalid-card',
        `유효하지 않은 카드: ${formatParseError(error)}`,
        error,
      );
    }
  }

  private async readSourceFiles(
    paths: StoryboardProjectPaths,
    roster: CardRoster,
  ): Promise<StorySourceFiles> {
    const [projectText, sceneFiles, cardFiles, canonText] = await Promise.all([
      readRequiredText(this.fileSystem, paths.projectJson, STORYBOARD_RELATIVE_PATHS.projectJson),
      readTextFiles(
        this.fileSystem,
        paths.sceneDirectory,
        (name) => name.endsWith('.card') && !name.startsWith('.'),
      ),
      readBundleFiles(this.fileSystem, paths.workspaceRoot, roster),
      readOptionalText(this.fileSystem, paths.bibleCanon),
    ]);

    return { projectText, sceneFiles, cardFiles, canonText };
  }

  private parseScenes(sceneFiles: readonly TextFile[]): SceneFile[] {
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
        'invalid-scene',
        `유효하지 않은 씬이 있습니다.\n${invalidScenes.join('\n')}`,
      );
    }

    return scenes;
  }

  private async snapshotSources(
    paths: StoryboardProjectPaths,
    sourceFiles: StorySourceFiles,
  ): Promise<StoryFileSnapshot[]> {
    const { projectText, sceneFiles, cardFiles, canonText } = sourceFiles;

    return [
      snapshotFile(projectText.uri, projectText.bytes),
      ...sceneFiles.map((file) => snapshotFile(file.uri, file.bytes)),
      ...cardFiles.map((file) => snapshotFile(file.uri, file.bytes)),
      ...(canonText ? [snapshotFile(canonText.uri, canonText.bytes)] : []),
      await snapshotDirectory(this.fileSystem, paths.sceneDirectory),
      await snapshotDirectory(this.fileSystem, paths.characterDirectory),
      await snapshotDirectory(this.fileSystem, paths.backgroundDirectory),
    ];
  }
}

interface TextFile {
  readonly uri: StoryUri;
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly text: string;
}

interface StorySourceFiles {
  readonly projectText: TextFile;
  readonly sceneFiles: TextFile[];
  readonly cardFiles: TextFile[];
  readonly canonText: TextFile | undefined;
}

async function readRequiredText(fs: IFileSystem, uri: StoryUri, label: string): Promise<TextFile> {
  try {
    return await readTextFile(fs, uri);
  } catch {
    throw new StoryFeatureSourceError('source-read-failed', `${label}을 읽을 수 없습니다.`);
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
    throw new StoryFeatureSourceError(
      'source-read-failed',
      `씬 디렉터리를 읽을 수 없습니다: ${directory.fsPath}`,
    );
  }

  return await Promise.all(
    entries
      .filter(([name, entry]) => entry.type === 'file' && include(name))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name]) => readTextFile(fs, joinStoryPath(directory, name))),
  );
}

async function readBundleFiles(
  fs: IFileSystem,
  workspaceRoot: StoryUri,
  roster: CardRoster,
): Promise<TextFile[]> {
  const bundleFileUris: StoryUri[] = roster.bundles.flatMap((bundle) =>
    [bundleFileNames.card, bundleFileNames.statements].map((fileName) =>
      joinStoryPath(workspaceRoot, ...bundle.path.split('/'), fileName),
    ),
  );

  return await Promise.all(bundleFileUris.map((uri) => readOptionalBundleFile(fs, uri)));
}

async function readOptionalBundleFile(fs: IFileSystem, uri: StoryUri): Promise<TextFile> {
  return (await readOptionalText(fs, uri)) ?? { uri, name: uri.path, bytes: new Uint8Array(), text: '' };
}

async function readTextFile(fs: IFileSystem, uri: StoryUri): Promise<TextFile> {
  const bytes: Uint8Array = await fs.readFile(uri);
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
    const entries: FileSystemDirectoryEntry[] = await fs.readDirectory(uri);
    const manifest: string = entries
      .filter(([name]) => !name.startsWith('.'))
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
  return extractErrorMessage(error);
}
