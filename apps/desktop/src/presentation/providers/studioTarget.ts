import * as vscode from 'vscode';

import {
  isIgnoredSampleCardFileName,
  parseCardIdFromFileName,
  parseSceneFileName,
  sceneStemPattern,
} from '@storyboard/story-format';

import { deriveSceneUri } from '../../infrastructure/vscode/draftSceneLink';
import {
  draftPath,
  isDirectBackgroundCardFile,
  isDirectCharacterCardFile,
  isDirectSceneCardFile,
  isDraftMarkdownFile,
} from '../../infrastructure/vscode/pathConventions';
import { hasStoryboardProject, uriExists } from '../../infrastructure/vscode/workspace';
import type { StudioTarget } from '../../shared/messaging';

export const noneStudioTarget: StudioTarget = { kind: 'none', hasSelection: false };

// NOTE: the sessions live inside one workspace root already, so a constant key keeps the project
// entity's directory name safe regardless of what the folder is called.
const projectEntityKey = 'project';

export async function computeStudioTarget(
  editor: vscode.TextEditor | undefined,
): Promise<StudioTarget> {
  const workspaceFolder =
    editor && editor.document.uri.scheme === 'file'
      ? vscode.workspace.getWorkspaceFolder(editor.document.uri)
      : vscode.workspace.workspaceFolders?.[0];

  if (!workspaceFolder || !(await hasStoryboardProject(workspaceFolder))) {
    return noneStudioTarget;
  }

  if (!editor || editor.document.uri.scheme !== 'file') {
    return projectTarget(workspaceFolder);
  }

  const uri = editor.document.uri;
  const hasSelection = !editor.selection.isEmpty;
  const label = uri.path.split('/').pop();

  if (isDraftMarkdownFile(uri, workspaceFolder)) {
    const sceneStem = resolveDraftSceneStem(uri);
    const sceneUri = deriveSceneUri(workspaceFolder, editor.document.getText());

    return {
      kind: 'draft',
      label,
      entity: sceneStem ? { kind: 'scene', key: sceneStem } : undefined,
      draftUri: uri.toString(),
      sceneUri: sceneUri?.toString(),
      hasSelection,
    };
  }

  if (isDirectSceneCardFile(uri, workspaceFolder)) {
    const parts = parseSceneFileName(uri.path.split('/').pop() ?? '');

    if (!parts) {
      return projectTarget(workspaceFolder);
    }

    const draftUri = draftPath(workspaceFolder.uri, parts.stem);

    return {
      kind: 'scene',
      label,
      entity: { kind: 'scene', key: parts.stem },
      sceneUri: uri.toString(),
      draftUri: draftUri.toString(),
      hasSelection,
      draftExists: await uriExists(draftUri),
    };
  }

  const cardKind = resolveCardTargetKind(uri, workspaceFolder);

  if (cardKind) {
    const cardId = resolveCardId(uri);

    if (!cardId) {
      return projectTarget(workspaceFolder);
    }

    return {
      kind: cardKind,
      label,
      entity: { kind: cardKind, key: cardId },
      cardUri: uri.toString(),
      hasSelection,
    };
  }

  return projectTarget(workspaceFolder);
}

function projectTarget(workspaceFolder: vscode.WorkspaceFolder): StudioTarget {
  return {
    kind: 'project',
    label: workspaceFolder.name,
    entity: { kind: 'project', key: projectEntityKey },
    hasSelection: false,
  };
}

// NOTE: draft/<stem>.md mirrors scene/<stem>.card, so the file name alone keys the shared entity
// even when the draft body has lost its scene link.
function resolveDraftSceneStem(draftUri: vscode.Uri): string | undefined {
  const fileName = draftUri.path.split('/').pop() ?? '';
  const stem = fileName.endsWith('.md') ? fileName.slice(0, -'.md'.length) : '';

  return sceneStemPattern.test(stem) ? stem : undefined;
}

function resolveCardTargetKind(
  uri: vscode.Uri,
  workspaceFolder: vscode.WorkspaceFolder,
): 'character' | 'background' | undefined {
  if (isDirectCharacterCardFile(uri, workspaceFolder)) {
    return 'character';
  }

  return isDirectBackgroundCardFile(uri, workspaceFolder) ? 'background' : undefined;
}

function resolveCardId(uri: vscode.Uri): string | undefined {
  const fileName = uri.path.split('/').pop() ?? '';

  if (isIgnoredSampleCardFileName(fileName)) {
    return undefined;
  }

  return parseCardIdFromFileName(fileName);
}
