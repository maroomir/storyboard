import { createHash } from 'node:crypto';

import * as vscode from 'vscode';

import { parseCard, parseScene } from '@storyboard/story-format';
import type { SceneFile, StoryboardCard } from '@storyboard/story-format';
import type {
  IStoryFeatureRepository,
  StoryFeatureSource,
  StoryFileSnapshot,
} from '@/application/story/storyFeatureTypes';
import { StoryFeatureSourceError } from '@/application/story/storyFeatureTypes';
import { parseProjectJson } from '@/infrastructure/persistence/projectJson';
import {
  getStoryboardProjectPaths,
  isIgnoredSampleCardFileName,
} from '@/infrastructure/vscode/pathConventions';
export class StoryFeatureRepository implements IStoryFeatureRepository {
  public async load(workspaceRoot: vscode.Uri): Promise<StoryFeatureSource> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    const [projectText, sceneFiles, cardFiles, canonText] = await Promise.all([
      readRequiredText(paths.projectJson, '.storyboard/project.json'),
      readTextFiles(
        paths.sceneDirectory,
        (name) => name.endsWith('.card') && !name.startsWith('.'),
      ),
      readCardFiles(paths.characterDirectory, paths.backgroundDirectory),
      readOptionalText(paths.bibleCanon),
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
      await snapshotDirectory(paths.sceneDirectory),
      await snapshotDirectory(paths.characterDirectory),
      await snapshotDirectory(paths.backgroundDirectory),
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
            ? await snapshotDirectory(snapshot.uri)
            : snapshotFile(snapshot.uri, await vscode.workspace.fs.readFile(snapshot.uri));
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
  readonly uri: vscode.Uri;
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly text: string;
}

async function readRequiredText(uri: vscode.Uri, label: string): Promise<TextFile> {
  try {
    return await readTextFile(uri);
  } catch {
    throw new StoryFeatureSourceError(`${label}을 읽을 수 없습니다.`);
  }
}

async function readOptionalText(uri: vscode.Uri): Promise<TextFile | undefined> {
  try {
    return await readTextFile(uri);
  } catch {
    return undefined;
  }
}

async function readTextFiles(
  directory: vscode.Uri,
  include: (name: string) => boolean,
): Promise<TextFile[]> {
  let entries: readonly [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(directory);
  } catch {
    throw new StoryFeatureSourceError(`씬 디렉터리를 읽을 수 없습니다: ${directory.fsPath}`);
  }

  return await Promise.all(
    entries
      .filter(([name, type]) => type === vscode.FileType.File && include(name))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name]) => readTextFile(vscode.Uri.joinPath(directory, name))),
  );
}

async function readCardFiles(...directories: readonly vscode.Uri[]): Promise<TextFile[]> {
  const files = await Promise.all(
    directories.map(async (directory) => {
      try {
        const entries = await vscode.workspace.fs.readDirectory(directory);
        return await Promise.all(
          entries
            .filter(
              ([name, type]) =>
                type === vscode.FileType.File &&
                name.endsWith('.card') &&
                !isIgnoredSampleCardFileName(name),
            )
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name]) => readTextFile(vscode.Uri.joinPath(directory, name))),
        );
      } catch {
        return [];
      }
    }),
  );
  return files.flat();
}

async function readTextFile(uri: vscode.Uri): Promise<TextFile> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return {
    uri,
    name: uri.path.split('/').at(-1) ?? uri.toString(),
    bytes,
    text: new TextDecoder().decode(bytes),
  };
}

function snapshotFile(uri: vscode.Uri, bytes: Uint8Array): StoryFileSnapshot {
  return { uri, sha256: sha256(bytes), kind: 'file' };
}

async function snapshotDirectory(uri: vscode.Uri): Promise<StoryFileSnapshot> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(uri);
    const manifest = entries
      .filter(([name, type]) => type === vscode.FileType.File && !name.startsWith('.'))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, type]) => `${type}:${name}`)
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
