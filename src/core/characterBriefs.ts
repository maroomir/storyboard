import * as vscode from 'vscode';

import { readCardFile, type CardFileSystem } from '../domain/files/card';
import { type OutlineCharacterBrief } from '../shared/outline';

export async function listCharacterBriefs(
  characterDirectory: vscode.Uri,
  fileSystem: CardFileSystem,
): Promise<OutlineCharacterBrief[]> {
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(characterDirectory);
  } catch {
    return [];
  }

  const briefs: OutlineCharacterBrief[] = [];

  for (const [name, fileType] of entries) {
    if (fileType !== vscode.FileType.File || !name.endsWith('.card') || name === '.sample.card') {
      continue;
    }

    const uri = vscode.Uri.joinPath(characterDirectory, name);
    try {
      const card = await readCardFile(uri, fileSystem);
      if (card.type === 'character') {
        briefs.push({ id: card.id, name: card.name, role: card.role });
      }
    } catch {
      continue;
    }
  }

  return briefs;
}
