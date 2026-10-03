import * as vscode from 'vscode';

import {
  isIgnoredSampleCardFileName,
  parseCardIdFromFileName,
  parseSceneFileName,
  sceneStemPattern,
} from '@storyboard/story-model';

import { deriveSceneUri } from '@/infrastructure/vscode/draftSceneLink';
import {
  draftPath,
  isDirectBackgroundCardFile,
  isDirectCharacterCardFile,
  isDirectSceneCardFile,
  isDraftMarkdownFile,
} from '@storyboard/story-engine';
import { hasStoryboardProject, uriExists } from '@/infrastructure/vscode/workspace';
import type { StudioTarget } from '@storyboard/story-engine';

export const noneStudioTarget: StudioTarget = { kind: 'none', hasSelection: false };

// NOTE: the sessions live inside one workspace root already, so a constant key keeps the project
// entity's directory name safe regardless of what the folder is called.
const projectEntityKey = 'project';

export interface StudioFocus {
  readonly uri: vscode.Uri;
  readonly hasSelection: boolean;
  readonly documentText?: string;
}

// NOTE: `.card` files open in the custom editor, which is never a TextEditor, so the active tab is
// the only signal that a card has focus. The text editor still wins when present because it is the
// only source of the selection and the document body.
export function resolveActiveStudioFocus(): StudioFocus | undefined {
  const editor = vscode.window.activeTextEditor;

  if (editor) {
    return {
      uri: editor.document.uri,
      hasSelection: !editor.selection.isEmpty,
      documentText: editor.document.getText(),
    };
  }

  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;

  if (input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText) {
    return { uri: input.uri, hasSelection: false };
  }

  return undefined;
}

export async function computeStudioTarget(focus: StudioFocus | undefined): Promise<StudioTarget> {
  const workspaceFolder =
    focus && focus.uri.scheme === 'file'
      ? vscode.workspace.getWorkspaceFolder(focus.uri)
      : vscode.workspace.workspaceFolders?.[0];

  if (!workspaceFolder || !(await hasStoryboardProject(workspaceFolder))) {
    return noneStudioTarget;
  }

  if (!focus || focus.uri.scheme !== 'file') {
    return projectTarget(workspaceFolder);
  }

  const { uri, hasSelection } = focus;
  const label = uri.path.split('/').pop();

  if (isDraftMarkdownFile(uri, workspaceFolder)) {
    const sceneStem = resolveDraftSceneStem(uri);
    const sceneUri = deriveSceneUri(workspaceFolder, focus.documentText ?? '');

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
