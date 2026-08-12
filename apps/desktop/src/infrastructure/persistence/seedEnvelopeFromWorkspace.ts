import * as vscode from 'vscode';

import { getStoryboardProjectPaths } from '@/infrastructure/vscode/pathConventions';
import { isBackgroundCard, parseCard } from '@seedkernel/wasm';
import type { BackgroundCard, CharacterCard } from '@seedkernel/wasm';
import { readProjectJson } from '@/infrastructure/persistence/projectJson';
import { collectTrackedCardAndSceneRelativePathsFromFileNames } from '@/infrastructure/seedcoat/seedImport';
import type { WorkspaceContent, SeedSceneEntry } from '@/infrastructure/seedcoat/projectAdapter';

export async function readDirectoryFileNamesOnly(directory: vscode.Uri): Promise<string[]> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(directory);
    return entries
      .filter(
        ([, fileType]) =>
          fileType === vscode.FileType.File || fileType === vscode.FileType.SymbolicLink,
      )
      .map(([name]) => name);
  } catch {
    return [];
  }
}

export async function readParsedSeedEnvelopeFromWorkspaceRoot(
  workspaceRoot: vscode.Uri,
): Promise<WorkspaceContent> {
  const paths = getStoryboardProjectPaths(workspaceRoot);
  const project = await readProjectJson(paths.projectJson);

  const characterFileNames = await readDirectoryFileNamesOnly(paths.characterDirectory);
  const backgroundFileNames = await readDirectoryFileNamesOnly(paths.backgroundDirectory);
  const sceneFileNames = await readDirectoryFileNamesOnly(paths.sceneDirectory);

  const tracked = collectTrackedCardAndSceneRelativePathsFromFileNames({
    characterFileNames,
    backgroundFileNames,
    sceneFileNames,
  });

  const characters: CharacterCard[] = [];
  const backgrounds: BackgroundCard[] = [];
  const scenes: SeedSceneEntry[] = [];

  for (const rel of tracked) {
    if (rel.startsWith('character/') && rel.endsWith('.card')) {
      const uri = vscode.Uri.joinPath(workspaceRoot, ...rel.split('/'));
      const raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
      const card = parseCard(raw);

      if (card.type === 'character') {
        characters.push(card);
      }

      continue;
    }

    if (rel.startsWith('background/') && rel.endsWith('.card')) {
      const uri = vscode.Uri.joinPath(workspaceRoot, ...rel.split('/'));
      const raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
      const card = parseCard(raw);

      if (isBackgroundCard(card)) {
        backgrounds.push(card);
      }

      continue;
    }

    if (rel.startsWith('scene/') && rel.endsWith('.txt')) {
      const fileName = rel.slice('scene/'.length);
      const stem = fileName.slice(0, -'.txt'.length);
      const uri = vscode.Uri.joinPath(workspaceRoot, 'scene', fileName);
      const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
      scenes.push({ stem, content });
    }
  }

  characters.sort((a, b) => a.id.localeCompare(b.id));
  backgrounds.sort((a, b) => a.id.localeCompare(b.id));
  scenes.sort((a, b) => a.stem.localeCompare(b.stem));

  return { project, characters, backgrounds, scenes };
}
