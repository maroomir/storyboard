import * as vscode from 'vscode';

import { parseDraft, parseSceneStem } from '@storyboard/story-format';
import type { SceneFileNameParts } from '@storyboard/story-format';
import { sceneFilePath } from '@storyboard/story-engine';

export function parseDraftSceneParts(rawDraftText: string): SceneFileNameParts | undefined {
  try {
    const draft = parseDraft(rawDraftText);
    return parseSceneStem(draft.sceneStem);
  } catch {
    return undefined;
  }
}

export function deriveSceneUri(
  workspaceFolder: vscode.WorkspaceFolder,
  documentText: string,
): vscode.Uri | undefined {
  const parts = parseDraftSceneParts(documentText);

  if (!parts) {
    return undefined;
  }

  return sceneFilePath(workspaceFolder.uri, parts.orderText, parts.slug);
}
